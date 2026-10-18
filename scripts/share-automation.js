'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const docker = (args, capture = false) => execFileSync('docker', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', maxBuffer: 2 * 1024 * 1024 });
async function main() {
  docker(['compose', '--profile', 'share', 'up', '-d', 'share']);
  let url;
  for (let attempt = 0; attempt < 40 && !url; attempt++) {
    const logs = docker(['compose', 'logs', '--no-color', '--tail', '100', 'share'], true);
    url = [...logs.matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g)].at(-1)?.[0];
    if (!url) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (!url) throw new Error('The temporary tunnel did not provide an address. Check docker compose logs share, then retry.');
  const envPath = path.join(root, '.env');
  let contents = fs.readFileSync(envPath, 'utf8');
  const entry = /^CLASSBRIDGE_PUBLIC_ORIGIN=[^\r\n]*/m;
  contents = entry.test(contents) ? contents.replace(entry, `CLASSBRIDGE_PUBLIC_ORIGIN=${url}`) : contents + `\nCLASSBRIDGE_PUBLIC_ORIGIN=${url}\n`;
  fs.writeFileSync(envPath, contents, { mode: 0o600 });
  docker(['compose', 'up', '-d', '--build', 'automation']);
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const status = await fetch(url + '/api/status', { signal: AbortSignal.timeout(5000) });
      const protectedState = await fetch(url + '/api/state', { signal: AbortSignal.timeout(5000) });
      if (status.ok && protectedState.status === 401) {
        const directory = path.join(root, '.runtime'); fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'automation-share.json'), JSON.stringify({ url, checked_at: new Date().toISOString() }, null, 2) + '\n');
        console.log(`Teacher dashboard: ${url}`);
        console.log('Teacher login is required. Keep this computer and Docker running. The temporary address can change after a tunnel restart.');
        console.log('For first-time administrator setup on this HTTPS address, run: npm run automation:open -- --shared');
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('The public workspace did not pass its login protection check. Check Docker health and tunnel logs, then retry.');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
