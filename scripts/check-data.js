/*
 * Daten-Gate: verhindert, dass echte Reportdaten oder nicht benötigte Dateien im Repository landen.
 * Läuft lokal (`npm run gate:data`) und in der CI bei jedem Push/PR.
 *
 * Prüft alle von Git verfolgten Dateien (inkl. gestagter):
 *   1. Pfad steht auf der Positivliste (nur Quellcode, Tests, Build, Doku, CI).
 *   2. Keine Report-Dateien (ZIP/CSV/XLSX) außer der synthetischen test/sample.zip.
 *   3. Keine E-Mail-Adressen außer erlaubten Domains — auch innerhalb von ZIP-Archiven.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');

const ALLOWED_PATHS = [
  /^\.gitignore$/, /^\.gitattributes$/,
  /^\.github\/(workflows\/[\w.-]+\.yml|dependabot\.yml|ISSUE_TEMPLATE\/[\w.-]+\.(yml|md)|pull_request_template\.md)$/,
  /^src\/(core\.js|ui\.js|template\.html)$/,
  /^test\/(core\.test\.js|gates\.test\.js|make-sample\.js|sample\.zip)$/,
  /^scripts\/[\w-]+\.(js|ps1)$/,
  /^docs\/[\w.-]+\.(md|png|svg)$/,
  /^(eslint\.config\.js|\.markdownlint\.json|package-lock\.json)$/,
  /^(build\.ps1|package\.json|README\.md|CHANGELOG\.md|LICENSE|SECURITY\.md|CONTRIBUTING\.md)$/
];
const REPORT_FILE = /\.(zip|csv|xlsx?|json\.gz)$/i;
const ALLOWED_REPORT_FILES = new Set(['test/sample.zip']);
const ALLOWED_EMAIL_DOMAINS = new Set(['example.com', 'example.org', 'example.net', 'chrive-solutions.at']);
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

/* Minimaler ZIP-Leser (Central Directory) — reicht für deflate/stored-Einträge */
function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('kein gültiges ZIP');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Central Directory beschädigt');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOff + 26), lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    entries.push({ name, text: (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function foreignEmails(text) {
  const hits = new Set();
  for (const m of text.matchAll(EMAIL)) {
    if (!ALLOWED_EMAIL_DOMAINS.has(m[1].toLowerCase())) hits.add(m[0]);
  }
  return [...hits];
}

const problems = [];
const files = trackedFiles();
for (const f of files) {
  if (!ALLOWED_PATHS.some(re => re.test(f))) problems.push(`${f}: Pfad nicht auf der Positivliste (scripts/check-data.js)`);
  if (REPORT_FILE.test(f) && !ALLOWED_REPORT_FILES.has(f)) problems.push(`${f}: Report-/Datendatei — echte Reports gehören nicht ins Repository`);

  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) continue;
  const buf = fs.readFileSync(abs);
  const texts = /\.zip$/i.test(f)
    ? zipEntries(buf).map(e => ({ where: `${f} → ${e.name}`, text: e.text }))
    : /\.(png|jpe?g|gif|ico)$/i.test(f) ? [] : [{ where: f, text: buf.toString('utf8') }];
  for (const { where, text } of texts) {
    const hits = foreignEmails(text);
    if (hits.length) {
      /* Bewusst keine Adressen/Domains ausgeben — CI-Logs öffentlicher Repos sind öffentlich */
      const domains = new Set(hits.map(h => h.split('@')[1].toLowerCase())).size;
      problems.push(`${where}: ${hits.length} E-Mail-Adresse(n) aus ${domains} nicht erlaubten Domain(s)`);
    }
  }
}

if (problems.length) {
  console.error('Daten-Gate FEHLGESCHLAGEN:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(`Daten-Gate bestanden: ${files.length} Dateien geprüft, keine echten Reportdaten, nur erlaubte Pfade.`);
