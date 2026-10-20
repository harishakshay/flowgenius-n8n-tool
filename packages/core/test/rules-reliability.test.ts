import { describe, expect, it } from "vitest";
import { T, hits, link, node, workflow } from "./helpers.js";

describe("reliability/http-no-timeout", () => {
  const id = "reliability/http-no-timeout";

  it("fires without options.timeout", () => {
    expect(hits(id, workflow([node("Call", T.http, { parameters: { url: "https://a.com", options: {} } })]))).toHaveLength(1);
  });

  it("is quiet with a timeout", () => {
    expect(hits(id, workflow([node("Call", T.http, { parameters: { options: { timeout: 30000 } } })]))).toHaveLength(0);
  });
});

describe("reliability/no-execution-timeout", () => {
  const id = "reliability/no-execution-timeout";

  it("fires for production workflows with no timeout or -1", () => {
    expect(hits(id, workflow([node("Hook", T.webhook)]))).toHaveLength(1);
    expect(hits(id, workflow([node("Hook", T.webhook)], {}, { settings: { executionTimeout: -1 } }))).toHaveLength(1);
  });

  it("is quiet with a timeout, or for manual-only workflows", () => {
    expect(hits(id, workflow([node("Hook", T.webhook)], {}, { settings: { executionTimeout: 300 } }))).toHaveLength(0);
    expect(hits(id, workflow([node("Run", T.manual)]))).toHaveLength(0);
  });
});

describe("reliability/endless-loop", () => {
  const id = "reliability/endless-loop";

  it("fires for a cycle with no node that can exit", () => {
    const wf = workflow([node("A", T.http), node("B", T.set)], { ...link("A", "B"), B: { main: [[{ node: "A", type: "main", index: 0 }]] } });
    expect(hits(id, wf)).toHaveLength(1);
  });

  it("fires for a node wired to itself", () => {
    expect(hits(id, workflow([node("A", T.http)], link("A", "A")))).toHaveLength(1);
  });

  it("is quiet when the loop goes through Loop Over Items or an If", () => {
    const loop = workflow([node("Loop", T.loop), node("Work", T.http)], {
      Loop: { main: [[], [{ node: "Work", type: "main", index: 0 }]] },
      Work: { main: [[{ node: "Loop", type: "main", index: 0 }]] },
    });
    expect(hits(id, loop)).toHaveLength(0);
    const viaIf = workflow([node("Poll", T.http), node("Done?", T.if)], {
      ...link("Poll", "Done?"),
      "Done?": { main: [[], [{ node: "Poll", type: "main", index: 0 }]] },
    });
    expect(hits(id, viaIf)).toHaveLength(0);
  });

  it("is quiet for a straight line", () => {
    expect(hits(id, workflow([node("A", T.http), node("B", T.set)], link("A", "B")))).toHaveLength(0);
  });
});

describe("reliability/return-all", () => {
  const id = "reliability/return-all";

  it("fires for returnAll: true", () => {
    expect(hits(id, workflow([node("Rows", T.sheets, { parameters: { returnAll: true } })]))).toHaveLength(1);
  });

  it("ignores expressions, false, and AI tools", () => {
    expect(hits(id, workflow([node("Rows", T.sheets, { parameters: { returnAll: "={{ true }}" } })]))).toHaveLength(0);
    expect(hits(id, workflow([node("Rows", T.sheets, { parameters: { returnAll: false } })]))).toHaveLength(0);
    expect(hits(id, workflow([node("Mail", T.gmailTool, { parameters: { returnAll: true } })]))).toHaveLength(0);
  });
});

describe("reliability/webhook-without-responder", () => {
  const id = "reliability/webhook-without-responder";
  const hook = node("Hook", T.webhook, { parameters: { responseMode: "responseNode" } });

  it("fires when responseNode is set and there is no Respond to Webhook node", () => {
    expect(hits(id, workflow([hook]))).toHaveLength(1);
  });

  it("fires when the only Respond to Webhook node is disabled", () => {
    expect(hits(id, workflow([hook, node("Reply", T.respond, { disabled: true })]))).toHaveLength(1);
  });

  it("is quiet with a responder, or other response modes", () => {
    expect(hits(id, workflow([hook, node("Reply", T.respond)], link("Hook", "Reply")))).toHaveLength(0);
    expect(hits(id, workflow([node("Hook", T.webhook, { parameters: { responseMode: "lastNode" } })]))).toHaveLength(0);
  });
});

describe("reliability/schedule-no-timezone", () => {
  const id = "reliability/schedule-no-timezone";
  const daily = node("Daily", T.schedule, { parameters: { rule: { interval: [{ triggerAtHour: 9 }] } } });

  it("fires for time-of-day schedules without a timezone", () => {
    expect(hits(id, workflow([daily]))).toHaveLength(1);
    const cronDaily = node("Cron", T.schedule, { parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 9 * * 1-5" }] } } });
    expect(hits(id, workflow([cronDaily]))).toHaveLength(1);
    const oldCron = node("Old", T.cron, { parameters: { triggerTimes: { item: [{ mode: "everyDay", hour: 9 }] } } });
    expect(hits(id, workflow([oldCron]))).toHaveLength(1);
  });

  it("is quiet with a timezone, or for interval schedules", () => {
    expect(hits(id, workflow([daily], {}, { settings: { timezone: "Asia/Kolkata" } }))).toHaveLength(0);
    const every5 = node("Every 5", T.schedule, { parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 5 }] } } });
    expect(hits(id, workflow([every5]))).toHaveLength(0);
    const cronHourly = node("Cron", T.schedule, { parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 */2 * * *" }] } } });
    expect(hits(id, workflow([cronHourly]))).toHaveLength(0);
  });
});

describe("reliability/schedule-too-frequent", () => {
  const id = "reliability/schedule-too-frequent";

  it("fires for second-level schedules", () => {
    const seconds = node("Fast", T.schedule, { parameters: { rule: { interval: [{ field: "seconds", secondsInterval: 10 }] } } });
    expect(hits(id, workflow([seconds]))).toHaveLength(1);
    const cron = node("Fast", T.schedule, { parameters: { rule: { interval: [{ field: "cronExpression", expression: "*/5 * * * * *" }] } } });
    expect(hits(id, workflow([cron]))).toHaveLength(1);
  });

  it("is quiet for once a minute or slower", () => {
    const minute = node("Min", T.schedule, { parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } } });
    expect(hits(id, workflow([minute]))).toHaveLength(0);
    const cron = node("Min", T.schedule, { parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 */2 * * * *" }] } } });
    expect(hits(id, workflow([cron]))).toHaveLength(0);
  });
});
