'use strict';
// Real Chromium UI checks with fictional contacts. All window.open calls are intercepted.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const runtime = path.resolve(__dirname, '../.runtime');
const base = process.env.WEB_TEST_URL || 'http://127.0.0.1:4173/';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Browser checks run only against a local preview.');
const browserPath = [process.env.REPORT_BROWSER, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((candidate) => candidate && fs.existsSync(candidate));
if (!browserPath) throw new Error('Chrome/Edge/Chromium not found; set REPORT_BROWSER to its executable.');
fs.mkdirSync(runtime, { recursive: true });
const profile = fs.mkdtempSync(path.join(runtime, 'web-browser-'));
const browser = spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket, nextId = 0; const pending = new Map(), errors = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  for (let attempt = 0; attempt < 100; attempt++) { if (await check()) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
function fillForm(selector, values) {
  return evaluate(`(() => {const form=document.querySelector(${JSON.stringify(selector)}); for(const [name,value] of Object.entries(${JSON.stringify(values)})){const input=form.querySelector('[name="'+name+'"]'); if(input.type==='checkbox')input.checked=value;else input.value=value;} form.requestSubmit(); return true;})()`);
}
async function screenshot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(runtime, name), Buffer.from(result.data, 'base64'));
}
(async () => {
  try {
    await until(() => fs.existsSync(path.join(profile, 'DevToolsActivePort')), 'browser startup');
    const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find((item) => item.type === 'page');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
      if (pending.has(message.id)) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result); }
    });
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__opened=[];window.open=(url)=>{window.__opened.push(url);return null;};' });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: base });
    await until(() => evaluate('!!window.ClassBridge && !!document.querySelector("#settings-form")'), 'teacher workspace');
    assert.equal(await evaluate('window.__opened.length'), 0);
    const settings = { school_name: 'Browser Test School', class_name: '6 A', teacher_name: 'Test Teacher', report_period: 'Test week', teacher_phone: '19999990100' };
    await fillForm('#settings-form', settings);
    await evaluate('document.querySelector("[data-page=students]").click(); document.querySelector("[data-action=add]").click()');
    await fillForm('#modal-form', { student_id: 'STU001', student_name: 'Student One', parent_name: 'Parent One', parent_phone: '19999990101', homework_completed: '4', homework_assigned: '5', exam_results: 'Mathematics: 38/50' });
    assert.equal(await evaluate('document.querySelector("dialog").open'), false, 'student saved');
    await evaluate('document.querySelector("[data-page=reports]").click()');
    assert.equal(await evaluate('document.querySelectorAll("[data-review]").length'), 0, 'missing parent consent blocks report opening');
    await evaluate('document.querySelector("[data-edit]").click()');
    await fillForm('#modal-form', { verified: true, opt_in: true, evidence: 'Fictional parent reply verified for browser test' });
    await evaluate('document.querySelector("[data-review]").click()');
    assert.equal(await evaluate('document.querySelector("#open-whatsapp").disabled'), true, 'fresh teacher approval required');
    await evaluate('document.querySelector("#modal-form").requestSubmit()');
    assert.equal(await evaluate('window.__opened.length'), 0, 'submitting without approval cannot open WhatsApp');
    await evaluate('document.querySelector("#approve-message").checked=true;document.querySelector("#approve-message").dispatchEvent(new Event("change"));document.querySelector("#modal-form").requestSubmit()');
    assert.equal(await evaluate('window.__opened.length'), 1);
    const handoff = new URL(await evaluate('window.__opened[0]'));
    assert.equal(handoff.pathname, '/19999990101'); assert.match(handoff.searchParams.get('text'), /Student One/);
    await evaluate('document.querySelector("[data-review]").click()');
    assert.equal(await evaluate('document.querySelector("#approve-message").checked'), false, 'approval is not remembered');
    await evaluate('document.querySelector("[data-close]").click();document.querySelector("[data-page=activity]").click()');
    assert.equal(await evaluate('document.body.textContent.includes("Sending unverified")'), true);
    await evaluate('document.querySelector("[data-page=students]").click()');
    await screenshot('classbridge-desktop.png');
    await evaluate('document.querySelector("[data-page=setup]").click();document.querySelector("[data-action=invite]").click()');
    assert.equal(await evaluate('document.querySelector("#share-invite").disabled'), true);
    const invitation = await evaluate('document.querySelector("#invite-link").value');
    await evaluate(`document.querySelector('[data-close]').click();location.hash=${JSON.stringify(new URL(invitation).hash)}`);
    await until(() => evaluate('!!document.querySelector("#parent-form")'), 'public parent form');
    assert.equal(await evaluate('document.querySelector("#parent-form [name=student_name]").value'), '');
    await fillForm('#parent-form', { student_id: 'STU002', student_name: 'Another Student', parent_name: 'Another Parent', parent_phone: '19999990102', consent: true });
    assert.equal(await evaluate('document.querySelector("#send-registration").disabled'), true);
    await evaluate('document.querySelector("#approve-registration").checked=true;document.querySelector("#approve-registration").dispatchEvent(new Event("change"));document.querySelector("#modal-form").requestSubmit()');
    assert.equal(await evaluate('window.__opened.length'), 2);
    const registration = new URL(await evaluate('window.__opened[1]'));
    assert.equal(registration.pathname, '/19999990100'); assert.match(registration.searchParams.get('text'), /CLASSBRIDGE PARENT REGISTRATION/);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true, 'parent page fits mobile viewport');
    await screenshot('classbridge-parent-mobile.png');
    await evaluate('location.hash=""');
    await until(() => evaluate('!!document.querySelector("#settings-form")'), 'return to teacher workspace');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true, 'teacher page fits mobile viewport');
    await screenshot('classbridge-mobile.png');
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    console.log('Browser checks passed: setup, roster editing, consent gate, individual approval, private handoff, repeat approval, activity, group invitation, parent registration, desktop and mobile. No messages or WhatsApp requests were sent.');
  } finally {
    if (socket?.readyState === 1) { try { await send('Browser.close'); } catch {} socket.close(); }
    if (browser.exitCode === null) browser.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
