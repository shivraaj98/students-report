'use strict';
const path = require('node:path');
const { phone } = require('./engine');
class WhatsAppConnector {
  constructor({ directory, getSettings, onDocument, onParentClaim, onStop, onAck }) {
    Object.assign(this, { directory, getSettings, onDocument, onParentClaim, onStop, onAck });
    this.client = null; this.status = 'disconnected'; this.qr = ''; this.error = ''; this.self = null; this.busy = false;
  }
  async start() {
    if (this.client || this.busy) return;
    this.busy = true; this.status = 'starting'; this.error = '';
    try {
      const { Client, LocalAuth } = require('whatsapp-web.js');
      const QRCode = require('qrcode');
      const client = new Client({ authStrategy: new LocalAuth({ dataPath: path.join(this.directory, 'whatsapp') }), puppeteer: { executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] }, authTimeoutMs: 120000 });
      this.client = client;
      client.on('qr', async (value) => { this.qr = await QRCode.toDataURL(value, { width: 280, margin: 2 }); this.status = 'scan_qr'; });
      client.on('authenticated', () => { this.qr = ''; this.status = 'authenticated'; });
      client.on('ready', () => { this.qr = ''; this.status = 'ready'; this.self = { id: client.info.wid._serialized, name: client.info.pushname || 'Class teacher' }; });
      client.on('auth_failure', () => { this.status = 'error'; this.error = 'WhatsApp authentication failed. Disconnect and link the teacher account again.'; });
      client.on('disconnected', () => { this.status = 'disconnected'; this.qr = ''; this.self = null; });
      client.on('message_create', (message) => { this.handleMessage(message).catch(() => { this.error = 'A WhatsApp item could not be imported. Check the connection and selected group.'; }); });
      client.on('message_ack', (message, ack) => this.onAck(message.id._serialized, ack));
      client.initialize().catch(() => { this.status = 'error'; this.error = 'The WhatsApp browser could not connect. Disconnect and try linking again.'; });
    } catch { this.client = null; this.status = 'error'; this.error = 'Could not start the WhatsApp connector.'; }
    finally { this.busy = false; }
  }
  async disconnect() {
    const client = this.client; this.client = null; this.status = 'disconnected'; this.qr = ''; this.self = null;
    if (client) { try { await client.logout(); } finally { await client.destroy().catch(() => {}); } }
  }
  requireReady() { if (this.status !== 'ready' || !this.client) throw new Error('Link the teacher WhatsApp account and wait until it is connected.'); }
  async groups() {
    this.requireReady();
    return (await this.client.getChats()).filter((chat) => chat.isGroup).map((chat) => ({ id: chat.id._serialized, name: chat.name, count: chat.participants?.length || 0 }));
  }
  async resolve(id) {
    const contact = await this.client.getContactById(id);
    let number = '';
    const candidate = contact.id?.server === 'c.us' ? contact.number : '';
    if (candidate) { try { number = phone(candidate); } catch {} }
    if (!number && this.client.getContactLidAndPhone) {
      try { const found = await this.client.getContactLidAndPhone([id]); const pn = found[0]?.pn; if (pn) number = phone(String(pn).split('@')[0]); } catch {}
    }
    return { id, phone: number, name: contact.name || contact.pushname || number || 'Number unavailable' };
  }
  async participants(groupId) {
    this.requireReady();
    if (!/^\d+(?:-\d+)?@g\.us$/.test(groupId)) throw new Error('Choose a valid WhatsApp group.');
    const group = await this.client.getChatById(groupId);
    if (!group.isGroup) throw new Error('The selected chat is not a group.');
    const result = [];
    for (const participant of group.participants) {
      const id = participant.id._serialized;
      let entry; try { entry = await this.resolve(id); } catch { entry = { id, phone: '', name: 'Contact unavailable' }; }
      result.push({ ...entry, admin: Boolean(participant.isAdmin || participant.isSuperAdmin) });
    }
    return result;
  }
  async handleMessage(message) {
    if (this.status !== 'ready') return;
    const settings = this.getSettings(); if (!settings.group_id) return;
    const conversationId = message.fromMe ? message.to : message.from;
    const command = !message.fromMe && /^(STOP\b|PARENT\s)/i.test(message.body.trim());
    if (conversationId !== settings.group_id && !command) return;
    const chat = await message.getChat();
    if (!chat.isGroup && !message.fromMe) {
      if (!command) return;
      const sender = await this.resolve(message.from);
      if (/^STOP\b/i.test(message.body.trim())) { this.onStop(sender); return; }
      // A parent sends this once privately. It establishes a claim, never identity verification.
      const claim = message.body.trim().match(/^PARENT\s+([^|\n]+)\s*\|\s*([^|\n]+)\s*\|\s*I AGREE\s*$/i);
      if (claim) {
        const participants = await this.participants(settings.group_id);
        if (participants.some((entry) => entry.id === sender.id || entry.phone && entry.phone === sender.phone)) this.onParentClaim({ ...sender, student_id: claim[1].trim(), student_name: claim[2].trim(), evidence: message.body, message_id: message.id._serialized });
      }
      return;
    }
    if (!chat.isGroup || chat.id._serialized !== settings.group_id) return;
    const senderId = message.fromMe ? this.self?.id : message.author;
    if (!settings.teacher_ids.includes(senderId)) return;
    if (!message.hasMedia && !message.body.trim()) return;
    let mime = 'text/plain', bytes = Buffer.from(message.body.slice(0, 50000)), filename = 'teacher-message.txt';
    if (message.hasMedia) {
      const media = await message.downloadMedia();
      if (!media || !['image/jpeg', 'image/png', 'image/webp'].includes(media.mimetype) || media.data.length > 14 * 1024 * 1024) return;
      mime = media.mimetype; bytes = Buffer.from(media.data, 'base64'); filename = media.filename || 'teacher-photo.' + mime.split('/')[1];
    }
    await this.onDocument({ bytes, mime, filename, kind: 'auto', teacher_id: senderId, source: 'whatsapp', source_message_id: message.id._serialized, caption: message.hasMedia ? message.body.slice(0, 1000) : '' });
  }
  async sendPrivate(recipient, message, finalCheck = () => {}) {
    this.requireReady();
    if (!/^\d+@(c\.us|lid)$/.test(recipient)) throw new Error('Private parent chat required.');
    const members = await this.participants(this.getSettings().group_id);
    if (!members.some((entry) => entry.id === recipient)) throw new Error('The approved parent is no longer available in the selected group.');
    finalCheck();
    const result = await this.client.sendMessage(recipient, message, { sendSeen: false });
    return result.id._serialized;
  }
}
module.exports = { WhatsAppConnector };
