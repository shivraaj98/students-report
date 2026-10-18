'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'automation', 'workflows');
fs.mkdirSync(root, { recursive: true });
const request = (id, name, endpoint, body, position) => ({ id, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position, parameters: {
  method: 'POST', url: `http://automation:8787/internal/${endpoint}`, sendHeaders: true,
  headerParameters: { parameters: [{ name: 'X-ClassBridge-Token', value: '={{ $env.CLASSBRIDGE_INTERNAL_TOKEN }}' }] },
  sendBody: true, specifyBody: 'json', jsonBody: body, options: { timeout: 150000 },
} });
const settings = { executionOrder: 'v1', timezone: 'Asia/Kathmandu', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false };
function webhookWorkflow(id, name, event, endpoint, body, suffix) {
  const trigger = { id: 'trigger-' + suffix, name: 'Authenticated event', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: `classbridge-${event}-v1`, parameters: { httpMethod: 'POST', path: 'classbridge-' + event, responseMode: 'onReceived', options: {} } };
  const gate = { id: 'gate-' + suffix, name: 'Verify internal event token', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [250, 0], parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ id: 'token-' + suffix, leftValue: "={{ $json.headers['x-classbridge-token'] }}", rightValue: '={{ $env.CLASSBRIDGE_INTERNAL_TOKEN }}', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, options: {} } };
  const action = request('action-' + suffix, name, endpoint, body, [500, 0]);
  return { id, name, nodes: [trigger, gate, action], connections: { 'Authenticated event': { main: [[{ node: gate.name, type: 'main', index: 0 }]] }, [gate.name]: { main: [[{ node: action.name, type: 'main', index: 0 }], []] } }, settings, active: false, pinData: {} };
}
const workflows = [
  webhookWorkflow('cbIngest20261018', 'ClassBridge - extract teacher photo or diary', 'ingest', 'process', '={{ JSON.stringify({ source_id: $json.body.source_id }) }}', 'ingest'),
  webhookWorkflow('cbDispatch20261018', 'ClassBridge - send one explicitly approved private report', 'dispatch', 'dispatch', '={{ JSON.stringify({ draft_id: $json.body.draft_id }) }}', 'dispatch'),
  { id: 'cbSchedule20261018', name: 'ClassBridge - recover queued jobs and prepare daily drafts', nodes: [
    { id: 'minute-timer', name: 'Recover queued jobs every minute', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 0], parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } } },
    request('tick', 'Process queued documents and approved jobs only', 'tick', '{}', [350, 0]),
    { id: 'daily-timer', name: 'Prepare daily drafts at 18:00', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 250], parameters: { rule: { interval: [{ field: 'days', triggerAtHour: 18, triggerAtMinute: 0 }] } } },
    request('daily-drafts', 'Prepare reports without approving or sending', 'generate', '{}', [350, 250]),
  ], connections: {
    'Recover queued jobs every minute': { main: [[{ node: 'Process queued documents and approved jobs only', type: 'main', index: 0 }]] },
    'Prepare daily drafts at 18:00': { main: [[{ node: 'Prepare reports without approving or sending', type: 'main', index: 0 }]] },
  }, settings, active: false, pinData: {} },
];
for (const workflow of workflows) fs.writeFileSync(path.join(root, workflow.id + '.json'), JSON.stringify(workflow, null, 2) + '\n');
console.log('Built three n8n workflows: extraction, approval-only delivery, and queue/daily scheduling.');
