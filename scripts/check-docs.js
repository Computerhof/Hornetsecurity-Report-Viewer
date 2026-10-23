/*
 * Doku-Gate: Dokumentation muss mit dem Code Schritt halten.
 * Läuft als PR-Check in der CI und lokal (`npm run gate:docs`, Vergleich gegen origin/main).
 *
 * Immer geprüft (Konsistenz):
 *   - Jedes npm-Skript aus package.json ist in CONTRIBUTING.md oder README.md dokumentiert.
 *   - Relative Links in Markdown-Dateien zeigen auf existierende Dateien.
 *   - CHANGELOG.md hat einen Abschnitt [Unreleased], einen Abschnitt für die aktuelle Version
 *     und zu jeder Version eine Link-Referenz.
 *
 * Gegen den Basis-Stand des PR geprüft (Diff):
 *   - Produkt geändert (src/, build.ps1)       → CHANGELOG.md geändert, Eintrag unter [Unreleased]
 *                                                oder im Abschnitt der neuen Version.
 *   - Entwicklungs-Werkzeuge geändert (CI, Gates, Linter-Konfiguration, npm-Skripte, Generator)
 *                                              → CONTRIBUTING.md, README.md oder CHANGELOG.md geändert.
 *   - Version in package.json geändert        → CHANGELOG.md geändert.
 *
 * Ausnahmen: Dependabot-PRs, die nur Abhängigkeiten anfassen; PR-Label `keine-doku`
 * (bewusste, sichtbare Entscheidung — die fehlende Doku wird trotzdem als Warnung gemeldet).
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_LABEL = 'keine-doku';
const DEPENDABOT = 'dependabot[bot]';

const PRODUCT = [/^src\//, /^build\.ps1$/];
const TOOLING = [/^\.github\/workflows\//, /^scripts\//, /^eslint\.config\.js$/, /^\.markdownlint\.json$/,
  /^test\/make-sample\.js$/, /^\.gitignore$/, /^\.github\/dependabot\.yml$/];
const DEV_DOCS = ['CONTRIBUTING.md', 'README.md', 'CHANGELOG.md'];
const DEPENDENCY_FILES = [/^package\.json$/, /^package-lock\.json$/, /^\.github\/workflows\/[\w.-]+\.yml$/];
/* package.json-Felder, deren Änderung nur Abhängigkeiten betrifft */
const DEPENDENCY_FIELDS = new Set(['devDependencies', 'dependencies', 'overrides']);

const matches = (file, patterns) => patterns.some(re => re.test(file));

/* ---------- CHANGELOG ---------- */

function changelogSections(text) {
  const sections = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const h = /^## \[([^\]]+)\](.*)$/.exec(line);
    if (h) { current = h[1]; sections.set(current, { suffix: h[2].trim(), body: [] }); continue; }
    if (/^\[[^\]]+\]:\s/.test(line)) { current = null; continue; }
    if (current) sections.get(current).body.push(line);
  }
  return sections;
}
const hasEntries = (section) => !!section && section.body.some(l => /^\s*[-*]\s+\S/.test(l));

/* ---------- Regeln (rein, ohne Dateisystem — testbar) ---------- */

/**
 * @param {object} ctx
 * @param {object} ctx.pkg              package.json (aktueller Stand)
 * @param {object} [ctx.basePkg]        package.json im Basis-Stand
 * @param {object} ctx.docs             { 'README.md': text, 'CONTRIBUTING.md': text, 'CHANGELOG.md': text, ... }
 * @param {function} ctx.fileExists     (repoRelativePath) => boolean
 * @param {string[]} [ctx.changed]      geänderte Dateien gegenüber Basis (undefined = kein Diff verfügbar)
 * @param {string[]} [ctx.labels]       PR-Labels
 * @param {string}   [ctx.author]       PR-Autor
 * @returns {{errors: string[], warnings: string[], notes: string[]}}
 */
function evaluate(ctx) {
  const errors = [], warnings = [], notes = [];
  const changelog = ctx.docs['CHANGELOG.md'] || '';
  const sections = changelogSections(changelog);

  /* 1. npm-Skripte dokumentiert */
  const devDocText = (ctx.docs['CONTRIBUTING.md'] || '') + '\n' + (ctx.docs['README.md'] || '');
  for (const name of Object.keys(ctx.pkg.scripts || {})) {
    const documented = name === 'test'
      ? /npm (run )?test\b/.test(devDocText)
      : new RegExp('npm run ' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w:-])').test(devDocText);
    if (!documented) errors.push(`package.json: npm-Skript "${name}" ist weder in CONTRIBUTING.md noch in README.md dokumentiert`);
  }

  /* 2. Relative Links */
  for (const [file, text] of Object.entries(ctx.docs)) {
    const dir = path.posix.dirname(file);
    for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/i.test(target)) continue;
      const rel = path.posix.normalize(path.posix.join(dir, decodeURIComponent(target.split('#')[0])));
      if (!ctx.fileExists(rel)) errors.push(`${file}: Link auf nicht vorhandene Datei "${target}"`);
    }
  }

  /* 3. CHANGELOG-Struktur */
  if (!sections.has('Unreleased')) errors.push('CHANGELOG.md: Abschnitt "## [Unreleased]" fehlt');
  const version = ctx.pkg.version;
  if (!sections.has(version)) {
    errors.push(`CHANGELOG.md: kein Abschnitt "## [${version}] - JJJJ-MM-TT" für die Version aus package.json`);
  }
  for (const [name, s] of sections) {
    if (name === 'Unreleased') continue;
    if (!/^- \d{4}-\d{2}-\d{2}$/.test(s.suffix)) errors.push(`CHANGELOG.md: Abschnitt [${name}] ohne Datum im Format "- JJJJ-MM-TT"`);
    if (!new RegExp('^\\[' + name.replace(/\./g, '\\.') + '\\]: https?://', 'm').test(changelog)) {
      errors.push(`CHANGELOG.md: Link-Referenz "[${name}]: …" fehlt`);
    }
  }

  /* 4. Diff-Regeln */
  if (!ctx.changed) {
    notes.push('Kein Basis-Stand angegeben — nur Konsistenzprüfung.');
    return { errors, warnings, notes };
  }
  const changed = ctx.changed;
  const touched = (f) => changed.includes(f);

  if (ctx.author === DEPENDABOT && changed.length > 0 && changed.every(f => matches(f, DEPENDENCY_FILES))
      && packageChangeIsDependenciesOnly(ctx.basePkg, ctx.pkg)) {
    notes.push('Dependabot-PR, nur Abhängigkeiten geändert — keine Doku nötig.');
    return { errors, warnings, notes };
  }

  const required = [];
  const productFiles = changed.filter(f => matches(f, PRODUCT));
  if (productFiles.length) {
    const target = version !== (ctx.basePkg && ctx.basePkg.version) ? version : 'Unreleased';
    if (!touched('CHANGELOG.md') || !hasEntries(sections.get(target))) {
      required.push(`Produkt geändert (${productFiles.join(', ')}) → Eintrag in CHANGELOG.md unter [${target}]`);
    }
  }
  const toolingFiles = changed.filter(f => matches(f, TOOLING))
    .concat(packageToolingChanged(ctx.basePkg, ctx.pkg) ? ['package.json (Skripte/Engines)'] : []);
  if (toolingFiles.length && !DEV_DOCS.some(touched)) {
    required.push(`Entwicklungs-Werkzeuge geändert (${toolingFiles.join(', ')}) → ${DEV_DOCS.slice(0, -1).join(', ')} oder ${DEV_DOCS[DEV_DOCS.length - 1]} anpassen`);
  }
  if (ctx.basePkg && ctx.basePkg.version !== version && !touched('CHANGELOG.md')) {
    required.push(`Version ${ctx.basePkg.version} → ${version} geändert → CHANGELOG.md anpassen`);
  }

  if (required.length && (ctx.labels || []).includes(SKIP_LABEL)) {
    warnings.push(...required.map(r => `Label "${SKIP_LABEL}" gesetzt, übersprungen: ${r}`));
  } else {
    errors.push(...required);
  }
  return { errors, warnings, notes };
}

function strip(pkg, fields) {
  const copy = { ...(pkg || {}) };
  for (const f of fields) delete copy[f];
  return JSON.stringify(copy);
}
function packageChangeIsDependenciesOnly(basePkg, pkg) {
  if (!basePkg) return false;
  return strip(basePkg, DEPENDENCY_FIELDS) === strip(pkg, DEPENDENCY_FIELDS);
}
function packageToolingChanged(basePkg, pkg) {
  if (!basePkg) return false;
  return ['scripts', 'engines'].some(f => JSON.stringify(basePkg[f] || null) !== JSON.stringify(pkg[f] || null));
}

/* ---------- Git/Dateisystem ---------- */

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function run() {
  const base = process.env.DOCS_GATE_BASE || (process.argv[2] || 'origin/main');
  const tracked = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
  const trackedSet = new Set(tracked);
  const docs = {};
  for (const f of tracked) if (/\.md$/i.test(f) && fs.existsSync(path.join(ROOT, f))) docs[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

  let changed, basePkg;
  try {
    const mergeBase = git(['merge-base', base, 'HEAD']).trim();
    changed = git(['diff', '--name-only', mergeBase]).split('\n').filter(Boolean)
      .concat(git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean));
    changed = [...new Set(changed)];
    try { basePkg = JSON.parse(git(['show', mergeBase + ':package.json'])); } catch (_e) { basePkg = undefined; }
  } catch (_e) {
    changed = undefined;
  }

  const result = evaluate({
    pkg: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')),
    basePkg,
    docs,
    fileExists: (f) => trackedSet.has(f) || tracked.some(t => t.startsWith(f.replace(/\/?$/, '/'))),
    changed,
    labels: (process.env.PR_LABELS || '').split(',').map(s => s.trim()).filter(Boolean),
    author: process.env.PR_AUTHOR || ''
  });

  const gha = !!process.env.GITHUB_ACTIONS;
  for (const n of result.notes) console.log(n);
  for (const w of result.warnings) console.log(gha ? `::warning title=Doku-Gate::${w}` : `WARNUNG: ${w}`);
  if (result.errors.length) {
    for (const e of result.errors) console.error(gha ? `::error title=Doku-Gate::${e}` : `FEHLER: ${e}`);
    console.error(`\nDoku-Gate FEHLGESCHLAGEN (${result.errors.length}). Doku im selben PR nachziehen` +
      ` oder — nur wenn wirklich keine Doku nötig ist — das Label "${SKIP_LABEL}" setzen.`);
    process.exit(1);
  }
  console.log(`Doku-Gate bestanden${changed ? ` (${changed.length} geänderte Dateien gegenüber ${base})` : ''}.`);
}

module.exports = { evaluate, changelogSections };
if (require.main === module) run();
