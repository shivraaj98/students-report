'use strict';

// A small renderer for the Markdown constructs used by the college report.
// No npm dependencies or external document conversion service are required.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const reportPath = path.join(root, 'docs/PROJECT_REPORT.md');
const htmlPath = path.join(root, 'docs/PROJECT_REPORT.html');
const pdfPath = path.join(root, 'docs/PROJECT_REPORT.pdf');
const escape = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inline(value) {
  const tokens = [];
  const protect = (html) => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
  const protectedText = value
    .replace(/`([^`]+)`/g, (_, code) => protect(`<code>${escape(code)}</code>`))
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => protect(`<img alt="${escape(alt)}" src="${escape(src)}">`))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => protect(`<a href="${escape(href)}">${escape(label)}</a>`));
  return escape(protectedText).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}
function render(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    if (line.startsWith('```')) {
      const code = [];
      index++;
      while (index < lines.length && !lines[index].startsWith('```')) code.push(lines[index++]);
      output.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
      index++;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const slug = heading[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      output.push(`<h${level} id="${slug}">${inline(heading[2])}</h${level}>`);
      index++;
      continue;
    }
    if (line.startsWith('|') && /^\|[\s:|\-]+\|$/.test(lines[index + 1] || '')) {
      const cells = (row) => row.trim().slice(1, -1).split('|').map((cell) => cell.trim());
      output.push('<table><thead><tr>' + cells(line).map((cell) => `<th>${inline(cell)}</th>`).join('') + '</tr></thead><tbody>');
      index += 2;
      while (index < lines.length && lines[index].startsWith('|')) {
        output.push('<tr>' + cells(lines[index++]).map((cell) => `<td>${inline(cell)}</td>`).join('') + '</tr>');
      }
      output.push('</tbody></table>');
      continue;
    }
    if (/^(?:- |\d+\. )/.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const pattern = ordered ? /^\d+\. / : /^- /;
      const tag = ordered ? 'ol' : 'ul';
      output.push(`<${tag}>`);
      while (index < lines.length && pattern.test(lines[index])) output.push(`<li>${inline(lines[index++].replace(pattern, ''))}</li>`);
      output.push(`</${tag}>`);
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !/^(?:#|```|\||- |\d+\. )/.test(lines[index])) paragraph.push(lines[index++]);
    if (!paragraph.length) throw new Error(`Unsupported Markdown at line ${index + 1}.`);
    output.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return output.join('\n');
}
const body = render(fs.readFileSync(reportPath, 'utf8'));
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>College Project Report - Student Progress Reporting</title>
<style>
@page{size:A4;margin:20mm 18mm 20mm 22mm;@bottom-center{content:counter(page);font:10pt Georgia,serif;color:#55646b}}
*{box-sizing:border-box}body{margin:0 auto;max-width:900px;padding:42px 44px;background:#fff;color:#192d38;font:16px/1.65 Georgia,'Times New Roman',serif}
h1,h2,h3{font-family:Arial,sans-serif;color:#164c47;line-height:1.3}h1{font-size:34px;margin:48px 0 32px;border-top:7px solid #164c47;padding-top:28px}h2{font-size:25px;margin:54px 0 22px;padding-bottom:9px;border-bottom:1px solid #b9cdc7}h3{font-size:18px;margin:25px 0 10px}
p{margin:12px 0;text-align:justify}a{color:#17615c;text-decoration:underline;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font:13px/1.5 Arial,sans-serif;margin:20px 0;table-layout:fixed}th,td{border:1px solid #c7d5cf;padding:9px 10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#e7f0ed;color:#164c47}tr:nth-child(even) td{background:#f7faf8}
code{font:12px/1.5 Consolas,monospace;background:#f0f4f2;padding:1px 3px;overflow-wrap:anywhere}pre{background:#f0f4f2;padding:14px;border-left:3px solid #82a99c;white-space:pre-wrap;overflow-wrap:anywhere}pre code{padding:0;background:none}img{display:block;max-width:100%;height:auto;margin:20px auto}li{margin:7px 0}strong{font-weight:700}
.print-note{font:12px/1.6 Arial,sans-serif;background:#edf4f1;padding:12px 16px;border-radius:5px}
@media print{body{max-width:none;padding:0;font-size:11pt;line-height:1.55}h1{font-size:27pt;margin-top:25mm}h2{break-before:page;margin-top:0;font-size:19pt}h3{font-size:13pt;break-after:avoid}p,li{orphans:3;widows:3}table{font-size:9pt}tr{break-inside:avoid}thead{display:table-header-group}img,pre{break-inside:avoid}a{color:inherit}.print-note{display:none}}
</style></head><body>
<aside class="print-note">Editable source: PROJECT_REPORT.md. Complete the bracketed cover details before submission. Use your browser's Print command to save a PDF.</aside>
${body}
</body></html>\n`;
fs.writeFileSync(htmlPath, html, 'utf8');
console.log('Built docs/PROJECT_REPORT.html');
if (process.argv.includes('--pdf')) {
  const candidates = [process.env.REPORT_BROWSER,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const browser = candidates.find((candidate) => fs.existsSync(candidate));
  if (!browser) throw new Error('Chrome/Edge was not found. Set REPORT_BROWSER to its executable, or print the HTML manually.');
  const profile = path.join(root, '.runtime/report-browser');
  fs.mkdirSync(profile, { recursive: true });
  const printed = spawnSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--no-pdf-header-footer', `--user-data-dir=${profile}`,
    `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href,
  ], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  if (printed.error || printed.status !== 0 || !fs.existsSync(pdfPath)) {
    throw new Error('Browser PDF generation failed. Open docs/PROJECT_REPORT.html and print to PDF.');
  }
  console.log(`Built docs/PROJECT_REPORT.pdf (${fs.statSync(pdfPath).size} bytes)`);
}
