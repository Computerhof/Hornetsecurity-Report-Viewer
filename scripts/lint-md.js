/*
 * Markdown-Linter: prüft alle Markdown-Dateien des Repositorys mit markdownlint
 * (Regeln in .markdownlint.json). `npm run lint:md`
 *
 * Bewusst die Bibliothek statt markdownlint-cli2: Die CLI zieht für die Dateisuche
 * Pakete mit offenen Sicherheitsmeldungen nach; die Dateiliste liefert hier git.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

async function main() {
  const { lint } = await import('markdownlint/promise');
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md'],
    { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(f => f && fs.existsSync(path.join(ROOT, f)));
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, '.markdownlint.json'), 'utf8'));
  delete config.$schema;

  const results = await lint({ files: files.map(f => path.join(ROOT, f)), config });
  let count = 0;
  for (const [file, issues] of Object.entries(results)) {
    for (const i of issues) {
      count++;
      const rule = i.ruleNames.join('/');
      const detail = i.errorDetail ? ` [${i.errorDetail}]` : '';
      console.error(`${path.relative(ROOT, file)}:${i.lineNumber} ${rule} ${i.ruleDescription}${detail}`);
    }
  }
  if (count) {
    console.error(`\nMarkdown-Lint: ${count} Befund(e).`);
    process.exit(1);
  }
  console.log(`Markdown-Lint bestanden: ${files.length} Dateien.`);
}

main().catch(e => { console.error(e); process.exit(1); });
