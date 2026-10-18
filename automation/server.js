'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store, audit } = require('./store');
const E = require('./engine');
const { AutomationService } = require('./service');
const { WhatsAppConnector } = require('./whatsapp');
const equal = (left, right) => typeof left === 'string' && typeof right === 'string' && Buffer.byteLength(left) === Buffer.byteLength(right) && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
function createApplication(options = {}) {
  const directory = options.directory || process.env.DATA_DIR || path.join(__dirname, '../.runtime/automation');
  const internalToken = options.internalToken || process.env.CLASSBRIDGE_INTERNAL_TOKEN;
  const setupToken = options.setupToken || process.env.CLASSBRIDGE_SETUP_TOKEN;
  const masterKey = options.masterKey || process.env.CLASSBRIDGE_MASTER_KEY;
  if (![internalToken, setupToken, masterKey].every((key) => /^[a-f0-9]{64}$/.test(key || ''))) throw new Error('Run node scripts/setup-automation.js before starting the automation services.');
  const store = options.store || new Store(directory), sessions = new Map(), loginAttempts = new Map();
  const n8nUrl = options.n8nUrl || process.env.N8N_URL || 'http://127.0.0.1:5678';
  const providerFetch = options.providerFetch || fetch;
  const publicOrigin = options.publicOrigin || process.env.CLASSBRIDGE_PUBLIC_ORIGIN || '';
  const notify = options.notify || (async (event, payload) => {
    const response = await fetch(`${n8nUrl}/webhook/classbridge-${event}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ClassBridge-Token': internalToken }, body: JSON.stringify(payload), signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('n8n webhook is not ready.');
  });
  const service = new AutomationService({ store, masterKey, notify, vision: options.vision });
  const connector = options.connector || new WhatsAppConnector({ directory: store.directory, getSettings: () => store.data.settings, onDocument: (document) => service.enqueue(document), onParentClaim: (claim) => service.parentClaim(claim), onStop: (sender) => service.withdraw(sender), onAck: (id, ack) => service.ack(id, ack) });
  service.connector = connector;
  function sessionUser(request) {
    const token = request.headers.cookie?.match(/(?:^|;\s*)cb_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const session = token && sessions.get(E.fingerprint(token));
    if (!session || session.expires < Date.now()) return null;
    return store.data.users.find((user) => user.id === session.userId) || null;
  }
  function signIn(response, user, request) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(E.fingerprint(token), { userId: user.id, expires: Date.now() + 12 * 3600000 });
    const secure = process.env.COOKIE_SECURE === 'true' || publicOrigin && request.headers.origin === publicOrigin;
    response.setHeader('Set-Cookie', `cb_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure ? '; Secure' : ''}`);
  }
  function publicState(user) {
    const data = structuredClone(store.data);
    const visionConnected = Boolean(data.settings.vision_key);
    delete data.settings.vision_key; delete data.users;
    for (const draft of data.drafts) { delete draft.review_hash; delete draft.review_content; }
    return { ...data, settings: { ...data.settings, vision_connected: visionConnected }, user: { id: user.id, name: user.name, role: user.role }, whatsapp: { status: connector.status, error: connector.error, self: connector.self }, n8n: { last_tick: data.last_tick } };
  }
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer'); response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    try {
      const user = sessionUser(request);
      let body = null;
      if (request.method === 'POST') {
        if (!request.headers['content-type']?.startsWith('application/json')) return json({ error: 'Use application/json.' }, 415);
        const origin = request.headers.origin;
        if (origin && new URL(origin).host !== request.headers.host && origin !== publicOrigin || request.headers['sec-fetch-site'] === 'cross-site') return json({ error: 'Cross-site writes are not accepted.' }, 403);
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 15 * 1024 * 1024) return json({ error: 'Request too large.' }, 413); chunks.push(chunk); }
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      }
      if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true });
      if (request.method === 'GET' && url.pathname === '/api/status') return json({ needs_setup: store.data.users.length === 0, authenticated: Boolean(user), user: user ? { name: user.name, role: user.role } : null });
      if (url.pathname === '/api/bootstrap' && request.method === 'POST') {
        if (store.data.users.length || !equal(body.token, setupToken)) return json({ error: 'Setup is unavailable or this setup link is invalid.' }, 403);
        const name = E.text(body.name || 'Class teacher', 120), password = E.text(body.password, 200);
        if (password.length < 10) throw new Error('Choose a password of at least 10 characters.');
        const salt = crypto.randomBytes(16).toString('hex'), admin = { id: crypto.randomUUID(), name, username: 'admin', role: 'admin', salt, password_hash: hashPassword(password, salt) };
        store.update((data) => { data.users.push(admin); data.settings.teacher_name = name; audit(data, admin.id, 'admin_created'); }); signIn(response, admin, request); return json({ ok: true });
      }
      if (url.pathname === '/api/login' && request.method === 'POST') {
        const address = request.socket.remoteAddress, attempts = (loginAttempts.get(address) || []).filter((when) => when > Date.now() - 60000);
        if (attempts.length >= 10) return json({ error: 'Too many sign-in attempts. Try again in a minute.' }, 429);
        attempts.push(Date.now()); loginAttempts.set(address, attempts);
        const account = store.data.users.find((entry) => entry.username === body.username);
        const candidate = hashPassword(E.text(body.password, 200), account?.salt || 'invalid-account');
        if (!account || !equal(candidate, account.password_hash)) return json({ error: 'Incorrect username or password.' }, 401);
        signIn(response, account, request); return json({ ok: true });
      }
      if (url.pathname.startsWith('/internal/')) {
        if (request.method !== 'POST' || !equal(request.headers['x-classbridge-token'], internalToken)) return json({ error: 'Internal authentication required.' }, 403);
        if (url.pathname === '/internal/process') return json(await service.processSource(body.source_id));
        if (url.pathname === '/internal/dispatch') return json(await service.dispatch(body.draft_id));
        if (url.pathname === '/internal/tick') return json(await service.tick());
        if (url.pathname === '/internal/generate') { const count = store.update((data) => E.generateDrafts(data)); return json({ generated: count }); }
        return json({ error: 'Not found.' }, 404);
      }
      if (url.pathname.startsWith('/api/')) {
        if (!user) return json({ error: 'Sign in to the teacher workspace.' }, 401);
        const admin = () => { if (user.role !== 'admin') throw new Error('Only the class administrator can change connections, teachers, or parent contacts.'); };
        if (request.method === 'GET' && url.pathname === '/api/state') return json(publicState(user));
        if (request.method === 'POST' && url.pathname === '/api/logout') { const token = request.headers.cookie?.match(/cb_session=([a-f0-9]{64})/)?.[1]; if (token) sessions.delete(E.fingerprint(token)); response.setHeader('Set-Cookie', 'cb_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json({ ok: true }); }
        if (request.method === 'POST' && url.pathname === '/api/whatsapp/connect') { admin(); if (body.acknowledge_unofficial !== true) throw new Error('Acknowledge the unofficial connector and account restriction risk.'); store.update((data) => { data.settings.whatsapp_enabled = true; audit(data, user.id, 'whatsapp_link_requested'); }); await connector.start(); return json({ ok: true }); }
        if (request.method === 'POST' && url.pathname === '/api/whatsapp/disconnect') { admin(); store.update((data) => { data.settings.whatsapp_enabled = false; audit(data, user.id, 'whatsapp_disconnected'); }); await connector.disconnect(); return json({ ok: true }); }
        if (request.method === 'GET' && url.pathname === '/api/whatsapp/qr') { admin(); return json({ status: connector.status, qr: connector.qr }); }
        if (request.method === 'GET' && url.pathname === '/api/whatsapp/groups') { admin(); return json({ groups: await connector.groups() }); }
        if (request.method === 'POST' && url.pathname === '/api/whatsapp/group') {
          admin(); if (store.data.settings.group_id && store.data.settings.group_id !== body.group_id) throw new Error('This installation is bound to its class group. Use a separate Docker project for another class.');
          const group = (await connector.groups()).find((entry) => entry.id === body.group_id); if (!group) throw new Error('Choose a group joined by the linked teacher account.');
          const participants = await connector.participants(group.id);
          store.update((data) => { data.settings.group_id = group.id; data.settings.class_name ||= group.name; data.settings.teacher_name = connector.self?.name || data.settings.teacher_name; data.settings.teacher_ids = [...new Set([...(data.settings.teacher_ids || []), connector.self?.id].filter(Boolean))]; data.participants = participants; audit(data, user.id, 'class_group_selected'); E.generateDrafts(data); });
          return json({ ok: true, participants: participants.length });
        }
        if (request.method === 'POST' && url.pathname === '/api/whatsapp/sync') { admin(); const participants = await connector.participants(store.data.settings.group_id); store.update((data) => { data.participants = participants; }); return json({ ok: true }); }
        if (request.method === 'POST' && url.pathname === '/api/settings') {
          admin();
          const validTeachers = new Set(store.data.participants.map((entry) => entry.id)); if (connector.self?.id) validTeachers.add(connector.self.id);
          const teachers = Array.isArray(body.teacher_ids) ? body.teacher_ids : [];
          if (teachers.some((id) => !validTeachers.has(id))) throw new Error('Select teacher accounts from the imported group contacts.');
          const days = Number(body.report_days); if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('Select a reporting window of 1–90 days.');
          store.update((data) => { for (const key of ['school_name', 'class_name', 'teacher_name']) data.settings[key] = E.text(body[key], 160); data.settings.teacher_ids = [...new Set([...teachers, connector.self?.id].filter(Boolean))]; data.settings.report_days = days; E.generateDrafts(data); audit(data, user.id, 'class_settings_updated'); }); return json({ ok: true });
        }
        if (request.method === 'POST' && url.pathname === '/api/vision') {
          admin(); if (body.authorized !== true) throw new Error('Authorize cloud reading of your selected documents.');
          const key = E.text(body.api_key, 500), model = E.text(body.model, 100);
          if (!/^[A-Za-z0-9._:-]{1,100}$/.test(model)) throw new Error('Invalid model name.');
          const check = await providerFetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
          if (!check.ok) throw new Error(`The vision account check returned HTTP ${check.status}. Check the key and model access.`);
          service.saveVision(key, model, true, user.id); return json({ ok: true });
        }
        if (request.method === 'POST' && url.pathname === '/api/vision/disconnect') { admin(); store.update((data) => { delete data.settings.vision_key; data.settings.cloud_authorized = false; }); return json({ ok: true }); }
        if (request.method === 'POST' && url.pathname === '/api/upload') {
          const bytes = Buffer.from(body.base64 || '', 'base64');
          return json(await service.enqueue({ bytes, mime: body.mime, filename: body.filename, kind: body.kind, teacher_id: user.id, document_date: body.document_date, source: 'site' }), 202);
        }
        let match;
        if (request.method === 'GET' && (match = url.pathname.match(/^\/api\/sources\/([a-f0-9-]+)\/file$/))) {
          const source = store.data.sources.find((entry) => entry.id === match[1]); if (!source) return json({ error: 'Document not found.' }, 404);
          response.writeHead(200, { 'Content-Type': source.mime, 'Content-Disposition': 'inline' }); fs.createReadStream(path.join(service.uploads, source.id)).pipe(response); return;
        }
        if (request.method === 'POST' && (match = url.pathname.match(/^\/api\/sources\/([a-f0-9-]+)\/retry$/))) { store.update((data) => { const source = data.sources.find((entry) => entry.id === match[1]); if (!source || !['failed', 'waiting_credentials'].includes(source.status)) throw new Error('This document is not waiting for a retry.'); source.status = 'queued'; source.attempts = 0; audit(data, user.id, 'extraction_retry_requested', { source_id: source.id }); }); await notify('ingest', { source_id: match[1] }).catch(() => {}); return json({ ok: true }); }
        if (request.method === 'POST' && (match = url.pathname.match(/^\/api\/records\/([a-f0-9-]+)$/))) { service.reviewRecord(match[1], body, user.id); return json({ ok: true }); }
        if (request.method === 'POST' && (match = url.pathname.match(/^\/api\/students\/([^/]+)\/contact$/))) { admin(); service.setContact(decodeURIComponent(match[1]), body, user.id); return json({ ok: true }); }
        if (request.method === 'POST' && (match = url.pathname.match(/^\/api\/drafts\/([a-f0-9-]+)\/review$/))) return json(service.reviewDraft(match[1], body.message, user.id));
        if (request.method === 'POST' && (match = url.pathname.match(/^\/api\/drafts\/([a-f0-9-]+)\/approve$/))) return json(await service.approveDraft(match[1], body, user.id));
        if (request.method === 'POST' && url.pathname === '/api/generate') return json({ generated: store.update((data) => E.generateDrafts(data)) });
        if (request.method === 'GET' && url.pathname === '/api/users') { admin(); return json({ users: store.data.users.map(({ id, name, username, role }) => ({ id, name, username, role })) }); }
        if (request.method === 'POST' && url.pathname === '/api/users') {
          admin(); const username = E.text(body.username, 60), name = E.text(body.name, 120), password = E.text(body.password, 200);
          if (!/^[a-zA-Z0-9_.-]{3,60}$/.test(username) || password.length < 10 || store.data.users.some((entry) => entry.username === username)) throw new Error('Use a unique username and a password of at least 10 characters.');
          const salt = crypto.randomBytes(16).toString('hex'); store.update((data) => { data.users.push({ id: crypto.randomUUID(), username, name, role: 'teacher', salt, password_hash: hashPassword(password, salt) }); audit(data, user.id, 'teacher_account_created'); }); return json({ ok: true });
        }
        if (request.method === 'GET' && url.pathname === '/api/export') { const data = publicState(user); delete data.whatsapp; return json(data); }
        return json({ error: 'Not found.' }, 404);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Not found.' }, 404);
      const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/base.css': ['base.css', 'text/css; charset=utf-8'] };
      const file = files[url.pathname]; if (!file) return json({ error: 'Not found.' }, 404);
      let filename = path.join(__dirname, 'public', file[0]); if (file[0] === 'base.css' && !fs.existsSync(filename)) filename = path.join(__dirname, '../web/styles.css');
      response.writeHead(200, { 'Content-Type': file[1] }); if (request.method === 'HEAD') response.end(); else fs.createReadStream(filename).pipe(response);
    } catch (error) { if (!response.headersSent) json({ error: error.message || 'The request could not be completed.' }, 400); else response.end(); }
  });
  return { server, store, service, connector, close: async () => { await new Promise((resolve) => server.close(resolve)); if (connector.client) await connector.client.destroy().catch(() => {}); } };
}
if (require.main === module) {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) { const match = line.match(/^(CLASSBRIDGE_[A-Z_]+)=([a-f0-9]{64})$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2]; }
  const application = createApplication();
  application.server.listen(Number(process.env.PORT || 8787), '0.0.0.0', () => console.log('ClassBridge automation listening on port ' + (process.env.PORT || 8787)));
  if (application.store.data.settings.whatsapp_enabled) application.connector.start().catch(() => {});
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { application.close().finally(() => process.exit(0)); });
}
module.exports = { createApplication };
