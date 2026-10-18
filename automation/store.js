'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function initialState() {
  return { version: 1, users: [], settings: { school_name: '', class_name: '', teacher_name: 'Class teacher', group_id: '', teacher_ids: [], cloud_authorized: false, report_days: 7, timezone: 'Asia/Kathmandu', model: 'gpt-4.1-mini' }, participants: [], students: [], sources: [], observations: [], drafts: [], audit: [], last_tick: null };
}
class Store {
  constructor(directory) {
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.file = path.join(this.directory, 'state.json');
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : initialState();
    if (this.data.version !== 1) throw new Error('Unsupported automation database version.');
    this.update((data) => {
      for (const source of data.sources) if (source.status === 'processing') source.status = source.attempts < 3 ? 'queued' : 'failed';
      for (const draft of data.drafts) if (draft.status === 'sending') { draft.status = 'unknown'; draft.error = 'Service restarted during delivery. Check WhatsApp before creating a new approval.'; }
    });
  }
  update(change) {
    const next = structuredClone(this.data);
    const result = change(next);
    const temporary = this.file + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
    const descriptor = fs.openSync(temporary, 'r+');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, this.file);
    this.data = next;
    return result;
  }
}
function encrypt(value, masterKey) {
  const key = Buffer.from(masterKey, 'hex'); if (key.length !== 32) throw new Error('Invalid master key.');
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), value: ciphertext.toString('base64') };
}
function decrypt(box, masterKey) {
  if (!box) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(masterKey, 'hex'), Buffer.from(box.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(box.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(box.value, 'base64')), decipher.final()]).toString('utf8');
}
function audit(data, actor, action, details = {}) {
  data.audit.push({ id: crypto.randomUUID(), at: new Date().toISOString(), actor, action, ...details });
  if (data.audit.length > 5000) data.audit.splice(0, data.audit.length - 5000);
}
module.exports = { Store, initialState, encrypt, decrypt, audit };
