// A made-up but typical workflow with the problems people ship every day, for the "Try a sample" button.

export const SAMPLE_WORKFLOW = {
  name: "Sync new Shopify orders to CRM",
  nodes: [
    {
      id: "1",
      name: "Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: "3f1c",
      parameters: { path: "new-order", httpMethod: "POST", responseMode: "onReceived" },
    },
    {
      id: "2",
      name: "Edit Fields",
      type: "n8n-nodes-base.set",
      typeVersion: 3.4,
      position: [220, 0],
      parameters: {
        assignments: {
          assignments: [
            { id: "a", name: "email", type: "string", value: "={{ $json.body.customer.email }}" },
            { id: "b", name: "total", type: "number", value: "={{ $json.body.total_price }}" },
          ],
        },
      },
    },
    {
      id: "3",
      name: "HTTP Request",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [440, 0],
      onError: "continueRegularOutput",
      parameters: {
        url: "https://api.acme-crm.com/v1/contacts",
        method: "POST",
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "x-api-key", value: "9f3b2c7d1e8a4f60b5c2" }] },
        sendBody: true,
        bodyParameters: { parameters: [{ name: "email", value: "={{ $json.email }}" }] },
        options: {},
      },
    },
    {
      id: "4",
      name: "Notify sales on Slack",
      type: "n8n-nodes-base.slack",
      typeVersion: 2.2,
      position: [660, 0],
      parameters: { select: "channel", channelId: "C0123", text: "=New order from {{ $('Edit Fields').item.json.email }}" },
    },
    {
      id: "5",
      name: "Daily 9 AM",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 220],
      parameters: { rule: { interval: [{ triggerAtHour: 9 }] } },
    },
    {
      id: "6",
      name: "Get all orders",
      type: "n8n-nodes-base.shopify",
      typeVersion: 1,
      position: [220, 220],
      parameters: { operation: "getAll", returnAll: true },
    },
    {
      id: "7",
      name: "Email daily report",
      type: "n8n-nodes-base.emailSend",
      typeVersion: 2.1,
      position: [440, 220],
      parameters: { toEmail: "sales@acme.com", subject: "Orders today", text: "={{ $json.count }} orders" },
    },
  ],
  connections: {
    Webhook: { main: [[{ node: "Edit Fields", type: "main", index: 0 }]] },
    "Edit Fields": { main: [[{ node: "HTTP Request", type: "main", index: 0 }]] },
    "HTTP Request": { main: [[{ node: "Notify sales on Slack", type: "main", index: 0 }]] },
    "Daily 9 AM": { main: [[{ node: "Get all orders", type: "main", index: 0 }]] },
    "Get all orders": { main: [[{ node: "Email daily report", type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1" },
  pinData: { Webhook: [{ json: { body: { customer: { email: "jane.doe@gmail.com" }, total_price: "129.00" } } }] },
};
