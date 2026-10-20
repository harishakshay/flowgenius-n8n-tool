import type { Rule } from "../rule.js";
import { dataRules } from "./data.js";
import { DOCS_LINKS } from "./docs-links.js";
import { errorHandlingRules } from "./error-handling.js";
import { maintainabilityRules } from "./maintainability.js";
import { reliabilityRules } from "./reliability.js";
import { securityRules } from "./security.js";

export const rules: Rule[] = [
  ...errorHandlingRules,
  ...reliabilityRules,
  ...securityRules,
  ...dataRules,
  ...maintainabilityRules,
].map((rule) => {
  const docsUrl = DOCS_LINKS[rule.id];
  return docsUrl ? { ...rule, docsUrl } : rule;
});
