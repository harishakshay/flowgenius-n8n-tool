// Helpers for reading node parameters.

/** n8n marks expression values with a leading "=", for example "={{ $json.id }}". */
export function isExpression(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("=");
}

/** True when the value is fixed text (or an expression with no {{ }} placeholders in it). */
export function isLiteral(value: unknown): value is string {
  return typeof value === "string" && !value.includes("{{");
}

/** Removes the leading "=" n8n puts on expressions. */
export function stripExpressionMarker(value: string): string {
  return value.startsWith("=") ? value.slice(1) : value;
}

export interface StringValue {
  value: string;
  /** Dotted path inside parameters, for example "headerParameters.parameters[0].value". */
  path: string;
}

/**
 * Every string inside a parameters object, with its path, in document order.
 * Iterative, so deeply nested input cannot overflow the call stack.
 */
export function walkStrings(params: unknown, path = ""): StringValue[] {
  const out: StringValue[] = [];
  const stack: { value: unknown; at: string }[] = [{ value: params, at: path }];
  while (stack.length) {
    const { value, at } = stack.pop()!;
    if (typeof value === "string") out.push({ value, path: at });
    else if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push({ value: value[i], at: `${at}[${i}]` });
    } else if (value && typeof value === "object") {
      const entries = Object.entries(value);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [k, v] = entries[i]!;
        stack.push({ value: v, at: at ? `${at}.${k}` : k });
      }
    }
  }
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Decodes base64 or base64url to a string (ASCII/Latin-1, enough for JWT payloads).
 * Written out because the core runs in browsers and Node without either's globals.
 */
export function decodeBase64(input: string): string | null {
  const s = input.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  let bits = 0;
  let buffer = 0;
  let out = "";
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

export function get(obj: unknown, path: string): unknown {
  let current = obj;
  for (const key of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Name/value pairs from n8n "fixedCollection" parameters such as headerParameters.parameters. */
export function namedPairs(collection: unknown): { name: string; value: unknown; index: number }[] {
  const list = get(collection, "parameters");
  if (!Array.isArray(list)) return [];
  return list
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string")
    .map(({ entry, index }) => ({
      name: (entry as { name: string }).name,
      value: (entry as { value?: unknown }).value,
      index,
    }));
}

/** Values people leave as placeholders: "YOUR_API_KEY", "<token>", "xxxx", "sk-...". */
export function isPlaceholder(value: string): boolean {
  const v = value.trim();
  return (
    v.length === 0 ||
    /your|replace|example|placeholder|insert|enter[_ -]?|change[_ -]?me|dummy|sample|<[^>]*>|\.\.\.|^x{3,}$|^\*+$/i.test(v) ||
    // ALL_CAPS names: letters only, or words joined by underscores. Not AKIA... AWS keys, which mix in digits.
    /^[A-Z][A-Z_]*$/.test(v) ||
    /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(v) ||
    /^\[[^\]]+\]$/.test(v) || // [FACEBOOK_ACCESS_TOKEN]
    /^\$\{?[A-Za-z_]/.test(v) || // $OPENAI_API_KEY, ${TOKEN}
    /^[a-z]+(?:_[a-z]+)*_(?:key|token|secret|id|password|pass)$/.test(v) || // google_api_key
    /(.)\1{5,}/.test(v) // aaaaaa, 000000
  );
}
