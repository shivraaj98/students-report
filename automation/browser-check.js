'use strict';
// Isolated end-to-end checks. Both cloud reading and WhatsApp delivery are mocked.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { createApplication } = require('./server');
const { localDate } = require('./engine');
async function run() {
  const tempRoot = path.resolve(os.tmpdir()), directory = fs.mkdtempSync(path.join(tempRoot, 'classbridge-browser-'));
  const screenshots = process.env.SCREENSHOT_DIR || '/tmp/classbridge-browser-artifacts'; fs.mkdirSync(screenshots, { recursive: true });
  const sends = [], errors = [];
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
  const imagePath = path.join(directory, 'fictional-diary.png'); fs.writeFileSync(imagePath, png);
  const connector = { status: 'disconnected', error: '', qr: '', self: { id: '19999990100@c.us', name: 'Example Teacher' }, async start() { this.status = 'ready'; }, async disconnect() { this.status = 'disconnected'; }, async groups() { return [{ id: '12345@g.us', name: 'Example Class 6 A', count: 2 }]; }, async participants() { return [{ id: '19999990101@c.us', phone: '19999990101', name: 'Parent One' }]; }, async sendPrivate(to, message, check) { check(); sends.push({ to, message }); return 'fictional-browser-message'; } };
  const baseRecord = { scope: 'student', student_id: 'STU001', student_name: 'Student One', date: localDate(), parent_phone: null, guardian_name: null, subject: null, description: null, evidence_quote: 'Fictional browser fixture', needs_review: false, score: null, max_score: null, homework_assigned: null, homework_completed: null };
  let application, browser;
  application = createApplication({ directory, internalToken: 'c'.repeat(64), setupToken: 'b'.repeat(64), masterKey: 'a'.repeat(64), connector,
    providerFetch: async () => ({ ok: true }),
    vision: async () => ({ school_name: 'Fictional School', class_name: '', teacher_name: '', warnings: ['Browser test fixture; no real OCR or parent information.'], records: [
      { ...baseRecord, kind: 'roster', parent_phone: '19999990101', guardian_name: 'Parent One', needs_review: true },
      { ...baseRecord, kind: 'homework', subject: 'Mathematics', description: 'Four of five exercises completed.', homework_assigned: 5, homework_completed: 4 },
      { ...baseRecord, kind: 'concern', description: 'One homework assignment is pending.', needs_review: true },
    ] }),
    notify: async (event, payload) => { setImmediate(() => (event === 'ingest' ? application.service.processSource(payload.source_id) : application.service.dispatch(payload.draft_id)).catch((error) => errors.push(error.message))); },
  });
  try {
    await new Promise((resolve) => application.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${application.server.address().port}`;
    browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking'] });
    const page = await browser.newPage(); page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => request.url().startsWith(base) || request.url().startsWith('data:') || request.url() === 'about:blank' ? request.continue() : request.abort());
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(base + '/#setup=' + 'b'.repeat(64));
    await page.waitForSelector('#login-form');
    await page.type('[name=name]', 'Example Teacher'); await page.type('[name=password]', 'fictional-browser-password');
    await page.click('#login-form button[type=submit]'); await page.waitForSelector('#unofficial-ack');
    assert.equal(await page.evaluate(() => location.hash), '', 'setup token removed from URL after bootstrap');
    await page.click('#unofficial-ack'); await page.click('[data-action=connect]');
    await page.waitForFunction(() => document.querySelector('#wa-status')?.textContent.includes('ready'));
    await page.click('[data-action=groups]'); await page.waitForSelector('#group-form');
    await page.select('#group-form select', '12345@g.us'); await page.click('#group-form button[type=submit]');
    await page.waitForFunction(() => document.body.textContent.includes('1 contacts imported'));
    await page.type('#vision-form [name=api_key]', 'fictional-browser-key'); await page.click('#vision-form [name=authorized]'); await page.click('#vision-form button[type=submit]');
    await page.waitForFunction(() => document.body.textContent.includes('Vision account connected.'));
    assert.ok(!fs.readFileSync(path.join(directory, 'state.json'), 'utf8').includes('fictional-browser-key'), 'provider key encrypted');
    await page.click('[data-page=inbox]'); await page.waitForSelector('#documents');
    const fileInput = await page.$('#documents'); await fileInput.uploadFile(imagePath); await page.click('#upload-submit');
    await page.waitForFunction(() => !!document.querySelector('[data-source]'), { timeout: 20000 });
    assert.equal(sends.length, 0, 'extraction does not approve or send');
    await page.click('[data-source]'); await page.waitForSelector('[data-record-form]');
    const concernForm = await page.$eval('[data-record-form]', (form) => form.getAttribute('data-record-form'));
    await page.evaluate((id) => { const forms = [...document.querySelectorAll('[data-record-form]')]; const form = forms.find((entry) => entry.closest('.record-review').querySelector('h3').textContent.includes('concern')) || forms[0]; form.querySelector('[name=confirmed]').checked = true; form.requestSubmit(); }, concernForm);
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('Source record confirmed'));
    await page.click('[data-close]'); await page.click('[data-page=students]'); await page.click('[data-contact]');
    await page.waitForSelector('#contact-form'); await page.click('#contact-form [name=verified]'); await page.click('#contact-form [name=opt_in]'); await page.type('#contact-form [name=evidence]', 'Fictional parent consent, verified for this isolated test.');
    await page.click('#contact-form button[type=submit]');
    await page.waitForFunction(() => !document.querySelector('#modal').open);
    await page.click('[data-page=drafts]'); await page.waitForSelector('[data-draft]'); await page.click('[data-draft]');
    await page.waitForSelector('#draft-message'); assert.match(await page.$eval('#draft-message', (element) => element.value), /^Respected Parent One,/);
    await page.click('#final-review'); await page.waitForSelector('#approve-send');
    assert.equal(await page.$eval('#approve-send', (button) => button.disabled), true);
    assert.equal(sends.length, 0, 'review without permission does not send');
    await page.click('#send-permission'); await page.click('#approve-send');
    await page.waitForFunction(() => !document.querySelector('#modal').open);
    assert.equal(sends.length, 1); assert.equal(sends[0].to, '19999990101@c.us'); assert.match(sends[0].message, /Student One/);
    await page.click('[data-page=activity]'); await page.waitForFunction(() => document.body.textContent.includes('Submitted to WhatsApp'));
    await page.click('[data-page=inbox]'); await page.screenshot({ path: path.join(screenshots, 'automation-desktop.png') });
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: path.join(screenshots, 'automation-mobile.png') });
    assert.deepEqual(errors, []);
    console.log('Automation browser checks passed: bootstrap/login, WhatsApp connection controls, group selection, encrypted vision setup, photo upload, extraction review, parent match, individual approval, activity, and mobile layout. Cloud and WhatsApp were mocked; no real messages were sent.');
  } finally {
    if (browser) await browser.close(); await application.close();
    assert.ok(path.resolve(directory).startsWith(tempRoot + path.sep)); fs.rmSync(directory, { recursive: true, force: true });
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
