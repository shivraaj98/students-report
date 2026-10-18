'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
let contents = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
for (const key of ['CLASSBRIDGE_INTERNAL_TOKEN', 'CLASSBRIDGE_SETUP_TOKEN', 'CLASSBRIDGE_MASTER_KEY']) {
  const entry = contents.match(new RegExp(`^${key}=([^\\r\\n]*)`, 'm'));
  if (!entry || !entry[1]) {
    const value = `${key}=${crypto.randomBytes(32).toString('hex')}`;
    contents = entry ? contents.replace(entry[0], value) : contents + '\n' + value + '\n';
  } else if (!/^[a-f0-9]{64}$/.test(entry[1])) throw new Error(`${key} must be empty or contain 64 hexadecimal characters. Existing keys were preserved.`);
}
fs.writeFileSync(envPath, contents, { mode: 0o600 });
console.log('Automation secrets are ready in the ignored .env file. No secret values were printed.');
console.log('Start with: docker compose up -d --build');
console.log('Then run: node scripts/open-automation.js');
