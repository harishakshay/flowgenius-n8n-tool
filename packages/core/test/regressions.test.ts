// False positives found while labelling the development sample (study/precision/dev-labels.json).
// Each test pins one pattern so it cannot come back.

import { describe, expect, it } from "vitest";
import { T, hits, link, node, workflow } from "./helpers.js";

const to = (n: string) => [{ node: n, type: "main", index: 0 }];

describe("endless-loop: loops that do have an exit", () => {
  const id = "reliability/endless-loop";

  it("a classifier that routes one category out of the loop", () => {
    const wf = workflow([node("Classify", "@n8n/n8n-nodes-langchain.textClassifier"), node("Ask again", "n8n-nodes-base.form"), node("Done", T.slack)], {
      Classify: { main: [to("Done"), to("Ask again")] },
      "Ask again": { main: [to("Classify")] },
    });
    expect(hits(id, wf)).toHaveLength(0);
  });

  it("a retry loop on the error output, where success leaves the loop", () => {
    const wf = workflow([node("Poll", T.http, { onError: "continueErrorOutput" }), node("Wait 1 min", "n8n-nodes-base.wait"), node("Use result", T.set)], {
      Poll: { main: [to("Use result"), to("Wait 1 min")] },
      "Wait 1 min": { main: [to("Poll")] },
    });
    expect(hits(id, wf)).toHaveLength(0);
  });

  it("still fires when one output fans out both into and out of the loop", () => {
    const wf = workflow([node("A", T.http), node("B", T.set), node("Out", T.slack)], {
      A: { main: [[...to("B"), ...to("Out")]] },
      B: { main: [to("A")] },
    });
    expect(hits(id, wf)).toHaveLength(1);
  });
});

// Patterns from test sample 1 (study/precision/test-labels.json).
describe("endless-loop: retry-on-error and listing loops end", () => {
  const id = "reliability/endless-loop";

  it("a retry loop where the success output is left unconnected", () => {
    const wf = workflow([node("Update Sheet", T.sheets, { onError: "continueErrorOutput" }), node("Wait", "n8n-nodes-base.wait")], {
      "Update Sheet": { main: [[], to("Wait")] },
      Wait: { main: [to("Update Sheet")] },
    });
    expect(hits(id, wf)).toHaveLength(0);
  });

  it("a loop through a listing that returns no items once the folder is empty", () => {
    const wf = workflow([node("List files", "n8n-nodes-base.googleDrive", { parameters: { operation: "search" } }), node("Process", T.http), node("Delete", "n8n-nodes-base.googleDrive", { parameters: { operation: "deleteFile" } })], {
      ...link("List files", "Process", "Delete"),
      Delete: { main: [to("List files")] },
    });
    expect(hits(id, wf)).toHaveLength(0);
  });
});

describe("return-all: small lists", () => {
  it("skips labels and attachments", () => {
    const id = "reliability/return-all";
    expect(hits(id, workflow([node("Labels", "n8n-nodes-base.gmail", { parameters: { resource: "label", returnAll: true } })]))).toHaveLength(0);
    expect(hits(id, workflow([node("Files", "n8n-nodes-base.microsoftOutlook", { parameters: { resource: "messageAttachment", returnAll: true } })]))).toHaveLength(0);
  });
});

describe("secrets: more placeholders", () => {
  it("skips a PEM block with a placeholder inside", () => {
    const jsCode = "const k = `-----BEGIN PRIVATE KEY-----\\n[INSERT YOUR KEY HERE]\\n-----END PRIVATE KEY-----`;";
    expect(hits("security/hardcoded-secret", workflow([node("Decrypt", T.code, { parameters: { jsCode } })]))).toHaveLength(0);
  });

  it("finds a PEM block with real key material", () => {
    const jsCode = `const k = "-----BEGIN PRIVATE KEY-----\\n${"MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7"}";`;
    expect(hits("security/hardcoded-secret", workflow([node("Decrypt", T.code, { parameters: { jsCode } })]))).toHaveLength(1);
  });

  it("skips plain words as values", () => {
    const query = { parameters: [{ name: "Key", value: "Content-Type" }] };
    expect(hits("security/secret-in-url", workflow([node("Call", T.http, { parameters: { queryParameters: query } })]))).toHaveLength(0);
  });
});

describe("webhook-no-auth: verified or callback webhooks", () => {
  const id = "security/webhook-no-auth";

  it("skips webhooks whose first step checks a header", () => {
    const check = node("Check secret", T.if, { parameters: { conditions: { leftValue: "={{ $json.headers['x-secret'] }}" } } });
    expect(hits(id, workflow([node("Hook", T.webhook), check], link("Hook", "Check secret")))).toHaveLength(0);
  });

  it("skips OAuth callbacks", () => {
    expect(hits(id, workflow([node("catch Auth code", T.webhook)]))).toHaveLength(0);
    expect(hits(id, workflow([node("Hook", T.webhook, { parameters: { path: "oauth/callback" } })]))).toHaveLength(0);
  });
});

describe("insecure-transport: internal hosts", () => {
  it("treats cluster service names and placeholder IPs as internal, public IPs as public", () => {
    const id = "security/insecure-transport";
    const call = (url: string) => workflow([node("Call", T.http, { parameters: { url } })]);
    expect(hits(id, call("http://prometheus-kube-prometheus-prometheus.monitoring:9090/api"))).toHaveLength(0);
    expect(hits(id, call("http://00.00.00.000:11235/crawl"))).toHaveLength(0);
    expect(hits(id, call("http://52.63.10.1/api"))).toHaveLength(1);
    expect(hits(id, call("http://api.zyphra.com/v1"))).toHaveLength(1);
  });
});

describe("return-all: filtered queries are bounded", () => {
  it("skips getAll with a time window or filter", () => {
    const id = "reliability/return-all";
    const calendar = node("Events", "n8n-nodes-base.googleCalendar", { parameters: { returnAll: true, timeMin: "={{ $now }}", timeMax: "={{ $now.plus(7, 'days') }}" } });
    expect(hits(id, workflow([calendar]))).toHaveLength(0);
    const table = node("Rows", "n8n-nodes-base.dataTable", { parameters: { returnAll: true, filters: { conditions: [{ keyName: "id", keyValue: "1" }] } } });
    expect(hits(id, workflow([table]))).toHaveLength(0);
    const empty = node("Rows", "n8n-nodes-base.dataTable", { parameters: { returnAll: true, filters: { conditions: [] } } });
    expect(hits(id, workflow([empty]))).toHaveLength(1);
  });
});

describe("secrets: placeholders are not secrets", () => {
  const header = (value: string) => node("Call", T.http, { parameters: { headerParameters: { parameters: [{ name: "Authorization", value }] } } });
  const query = (url: string) => node("Call", T.http, { parameters: { url } });

  it("skips $VAR, [BRACKETED] and snake_case placeholder names", () => {
    expect(hits("security/hardcoded-secret", workflow([header("Bearer $OPENAI_API_KEY")]))).toHaveLength(0);
    expect(hits("security/secret-in-url", workflow([query("https://graph.facebook.com/x?access_token=[FACEBOOK_ACCESS_TOKEN]")]))).toHaveLength(0);
    const named = node("Search", T.http, { parameters: { queryParameters: { parameters: [{ name: "key", value: "google_api_key" }] } } });
    expect(hits("security/secret-in-url", workflow([named]))).toHaveLength(0);
  });
});

describe("command-injection: only item data counts", () => {
  const id = "security/command-injection";
  const cmd = (command: string) => workflow([node("Run", T.exec, { parameters: { command } })]);

  it("skips commands that only use values n8n controls", () => {
    expect(hits(id, cmd("=ffmpeg -i /data/{{ $execution.id }}_in.mp4 /data/{{ $execution.id }}_out.mp4"))).toHaveLength(0);
    expect(hits(id, cmd("=backup --date {{ $now.toISODate() }}"))).toHaveLength(0);
  });

  it("fires for item data, including the old $node syntax", () => {
    expect(hits(id, cmd('=dig NS {{$node["Webhook"].data["query"]["q"]}} +short'))).toHaveLength(1);
    expect(hits(id, cmd("=mkdir -p \"{{ $('Prepare').item.json.dir }}\""))).toHaveLength(1);
  });
});

describe("test-endpoint: only inside URLs", () => {
  it("skips a domain name in a code list", () => {
    const code = node("TLDs", T.code, { parameters: { jsCode: 'const suffixes = ["com", "ngrok.io", "github.io"];' } });
    expect(hits("data/test-endpoint", workflow([code]))).toHaveLength(0);
  });
});

describe("broken-connections: duplicate sticky notes are harmless", () => {
  it("skips duplicate sticky note names", () => {
    const wf = workflow([node("Sticky Note", T.sticky), node("Sticky Note", T.sticky), node("A", T.set)], link("A", "A2"));
    const found = hits("data/broken-connections", wf);
    expect(found.every((f) => !f.message.includes("Sticky Note"))).toBe(true);
  });
});
