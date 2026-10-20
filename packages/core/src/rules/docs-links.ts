// FlowGenius article for each rule, matched by topic from flowgenius.in's sitemap (2026-10-20).
// Rules without a close match have no link yet.

const BASE = "https://flowgenius.in/";

export const DOCS_LINKS: Record<string, string> = {
  "error-handling/no-error-workflow": `${BASE}n8n-silent-failures-no-logs/`,
  "error-handling/no-retry": `${BASE}fallback-and-retry-strategies/`,
  "error-handling/swallowed-errors": `${BASE}n8n-partial-failure-handling/`,
  "error-handling/unconnected-error-output": `${BASE}error-handling-optimizations/`,
  "error-handling/silent-error-trigger": `${BASE}n8n-error-node-catch-all-failure/`,
  "reliability/http-no-timeout": `${BASE}n8n-http-request-node-timeout/`,
  "reliability/no-execution-timeout": `${BASE}n8n-stuck-executions-detection/`,
  "reliability/endless-loop": `${BASE}n8n-long-running-workflow-failures/`,
  "reliability/return-all": `${BASE}memory-limit-error-n8n/`,
  "reliability/webhook-without-responder": `${BASE}n8n-webhook-response-errors/`,
  "reliability/schedule-no-timezone": `${BASE}cron-job-setup-error-n8n/`,
  "reliability/schedule-too-frequent": `${BASE}n8n-execution-history-time-bomb/`,
  "security/hardcoded-secret": `${BASE}n8n-secrets-management/`,
  "security/secret-in-url": `${BASE}n8n-secrets-management/`,
  "security/webhook-no-auth": `${BASE}insecure-webhook-exposure/`,
  "security/code-eval": `${BASE}xss-vectors-in-custom-code/`,
  "security/command-injection": `${BASE}n8n-security-errors-guide/`,
  "security/insecure-transport": `${BASE}ssl-certificate-issues/`,
  "maintainability/default-node-names": `${BASE}workflow-design-best-practices/`,
  "maintainability/disabled-nodes": `${BASE}lifecycle-management-for-n8n-workflows/`,
  "maintainability/orphan-nodes": `${BASE}workflow-design-best-practices/`,
  "maintainability/undocumented": `${BASE}n8n-ownership-handoff-risks/`,
};
