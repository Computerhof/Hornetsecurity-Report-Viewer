/* Tests für die Regeln des Doku-Gates (scripts/check-docs.js) — `node test/gates.test.js` */
'use strict';

const { evaluate, changelogSections } = require('../scripts/check-docs.js');

let passed = 0, failed = 0;
function check(cond, name, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.error('  FAIL: ' + name + (detail ? ' — ' + JSON.stringify(detail) : ''));
}

const CHANGELOG = [
  '# Changelog', '', '## [Unreleased]', '', '## [1.0.0] - 2026-10-23', '', '### Hinzugefügt', '', '- Erste Version.', '',
  '[Unreleased]: https://example.com/compare/v1.0.0...HEAD', '[1.0.0]: https://example.com/releases/tag/v1.0.0', ''
].join('\n');
const CONTRIBUTING = 'npm run lint\nnpm test\n';
const PKG = { name: 'x', version: '1.0.0', scripts: { lint: 'eslint .', test: 'node t.js' }, devDependencies: { eslint: '^10.0.0' } };

function ctx(over) {
  return Object.assign({
    pkg: PKG,
    basePkg: PKG,
    docs: { 'CHANGELOG.md': CHANGELOG, 'CONTRIBUTING.md': CONTRIBUTING, 'README.md': '[Lizenz](LICENSE)' },
    fileExists: (f) => ['LICENSE', 'CHANGELOG.md', 'README.md', 'CONTRIBUTING.md'].includes(f),
    changed: [],
    labels: [],
    author: 'someone'
  }, over);
}
const withUnreleased = (entry) => CHANGELOG.replace('## [Unreleased]\n', '## [Unreleased]\n\n### Behoben\n\n- ' + entry + '\n');

console.log('Doku-Gate…');

/* Konsistenz */
let r = evaluate(ctx({ changed: undefined }));
check(r.errors.length === 0, 'konsistenter Stand ohne Diff: keine Fehler', r.errors);

r = evaluate(ctx({ pkg: { ...PKG, scripts: { ...PKG.scripts, 'gate:data': 'x' } } }));
check(r.errors.some(e => e.includes('"gate:data"')), 'undokumentiertes npm-Skript erkannt', r.errors);

r = evaluate(ctx({ pkg: { ...PKG, scripts: { lint: 'x' } }, docs: { 'CHANGELOG.md': CHANGELOG, 'CONTRIBUTING.md': 'npm run lint:js' } }));
check(r.errors.some(e => e.includes('"lint"')), '"npm run lint:js" dokumentiert nicht "lint"', r.errors);

r = evaluate(ctx({ docs: { 'CHANGELOG.md': CHANGELOG, 'CONTRIBUTING.md': CONTRIBUTING, 'README.md': '[x](docs/fehlt.png) [y](https://a.b) [z](#anker) [m](mailto:a@example.com)' } }));
check(r.errors.length === 1 && r.errors[0].includes('docs/fehlt.png'), 'kaputter relativer Link erkannt, externe ignoriert', r.errors);

r = evaluate(ctx({ docs: { 'CHANGELOG.md': CHANGELOG, 'CONTRIBUTING.md': CONTRIBUTING, 'docs/a.md': '[b](../LICENSE)' } }));
check(r.errors.length === 0, 'Link relativ zum Unterordner aufgelöst', r.errors);

r = evaluate(ctx({ pkg: { ...PKG, version: '1.1.0' } }));
check(r.errors.some(e => e.includes('[1.1.0]')), 'Version ohne CHANGELOG-Abschnitt erkannt', r.errors);

r = evaluate(ctx({ docs: { 'CHANGELOG.md': CHANGELOG.replace('[1.0.0]: https://example.com/releases/tag/v1.0.0\n', ''), 'CONTRIBUTING.md': CONTRIBUTING } }));
check(r.errors.some(e => e.includes('Link-Referenz "[1.0.0]')), 'fehlende Link-Referenz erkannt', r.errors);

r = evaluate(ctx({ docs: { 'CHANGELOG.md': CHANGELOG.replace('## [Unreleased]\n', ''), 'CONTRIBUTING.md': CONTRIBUTING } }));
check(r.errors.some(e => e.includes('[Unreleased]')), 'fehlender Unreleased-Abschnitt erkannt', r.errors);

/* Diff: Produkt */
r = evaluate(ctx({ changed: ['src/ui.js'] }));
check(r.errors.some(e => e.includes('src/ui.js') && e.includes('[Unreleased]')), 'Produktänderung ohne CHANGELOG blockiert', r.errors);

r = evaluate(ctx({ changed: ['src/ui.js', 'CHANGELOG.md'] }));
check(r.errors.length === 1, 'CHANGELOG angefasst, aber Unreleased leer → blockiert', r.errors);

r = evaluate(ctx({ changed: ['src/ui.js', 'CHANGELOG.md'], docs: { 'CHANGELOG.md': withUnreleased('Fehler behoben.'), 'CONTRIBUTING.md': CONTRIBUTING } }));
check(r.errors.length === 0, 'Produktänderung mit Unreleased-Eintrag ok', r.errors);

const cl110 = CHANGELOG.replace('## [1.0.0]', '## [1.1.0] - 2026-11-01\n\n### Hinzugefügt\n\n- Neu.\n\n## [1.0.0]')
  .replace('[1.0.0]: https', '[1.1.0]: https://example.com/releases/tag/v1.1.0\n[1.0.0]: https');
r = evaluate(ctx({ pkg: { ...PKG, version: '1.1.0' }, changed: ['src/ui.js', 'package.json', 'CHANGELOG.md'], docs: { 'CHANGELOG.md': cl110, 'CONTRIBUTING.md': CONTRIBUTING } }));
check(r.errors.length === 0, 'Release-PR: Eintrag im Abschnitt der neuen Version ok', r.errors);

r = evaluate(ctx({ pkg: { ...PKG, version: '1.1.0' }, changed: ['package.json'], docs: { 'CHANGELOG.md': cl110, 'CONTRIBUTING.md': CONTRIBUTING } }));
check(r.errors.some(e => e.includes('1.0.0 → 1.1.0')), 'Versionssprung ohne CHANGELOG-Änderung blockiert', r.errors);

/* Diff: Werkzeuge */
r = evaluate(ctx({ changed: ['.github/workflows/ci.yml'] }));
check(r.errors.some(e => e.includes('Entwicklungs-Werkzeuge')), 'Workflow-Änderung ohne Doku blockiert', r.errors);

r = evaluate(ctx({ changed: ['.github/workflows/ci.yml', 'CONTRIBUTING.md'] }));
check(r.errors.length === 0, 'Workflow-Änderung mit CONTRIBUTING ok', r.errors);

r = evaluate(ctx({ pkg: { ...PKG, scripts: { ...PKG.scripts, test: 'node t2.js' } }, changed: ['package.json'] }));
check(r.errors.some(e => e.includes('package.json (Skripte/Engines)')), 'geändertes npm-Skript ohne Doku blockiert', r.errors);

r = evaluate(ctx({ changed: ['test/core.test.js'] }));
check(r.errors.length === 0, 'reine Teständerung braucht keine Doku', r.errors);

/* Ausnahmen */
r = evaluate(ctx({ changed: ['src/ui.js'], labels: ['keine-doku'] }));
check(r.errors.length === 0 && r.warnings.length === 1, 'Label keine-doku: Warnung statt Fehler', r);

const bumped = { ...PKG, devDependencies: { eslint: '^10.1.0' } };
r = evaluate(ctx({ pkg: bumped, author: 'dependabot[bot]', changed: ['package.json', 'package-lock.json'] }));
check(r.errors.length === 0 && r.notes.some(n => n.includes('Dependabot')), 'Dependabot-Abhängigkeitsupdate ausgenommen', r);

r = evaluate(ctx({ author: 'dependabot[bot]', changed: ['.github/workflows/ci.yml'] }));
check(r.errors.length === 0, 'Dependabot-Actions-Update ausgenommen', r.errors);

r = evaluate(ctx({ pkg: { ...bumped, scripts: { lint: 'x', test: 'y' } }, author: 'dependabot[bot]', changed: ['package.json'] }));
check(r.errors.length > 0, 'Dependabot mit Skript-Änderung NICHT ausgenommen', r.errors);

r = evaluate(ctx({ pkg: bumped, author: 'someone', changed: ['package.json', 'package-lock.json'] }));
check(r.errors.length === 0, 'manuelles Abhängigkeitsupdate braucht keine Doku', r.errors);

/* Parser */
const s = changelogSections(withUnreleased('X'));
check(s.get('Unreleased').body.some(l => l === '- X'), 'changelogSections: Unreleased-Eintrag gelesen');
check(!s.get('1.0.0').body.some(l => l.startsWith('[')), 'changelogSections: Link-Referenzen nicht im Abschnitt');

console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen.`);
process.exit(failed > 0 ? 1 : 0);
