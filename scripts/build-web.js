'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const target = path.join(root, 'dist');
fs.mkdirSync(target, { recursive: true });
for (const file of ['index.html', 'styles.css', 'core.js', 'app.js']) {
  fs.copyFileSync(path.join(root, 'web', file), path.join(target, file));
}
const engine = fs.readFileSync(path.join(root, 'src/report-engine.js'), 'utf8');
fs.writeFileSync(path.join(target, 'engine.js'), `(function(root){const module={exports:{}};\n${engine}\nroot.ReportEngine=Object.freeze(module.exports);})(globalThis);\n`);
fs.copyFileSync(path.join(root, 'examples/students.csv'), path.join(target, 'students.csv'));
console.log('Built the dependency-free ClassBridge website in dist/.');
