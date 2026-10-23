# Mitwirken

Danke für Ihr Interesse! Fehlermeldungen und Verbesserungen sind willkommen.

## Grundregeln

1. **Niemals echte Reportdaten einchecken** — keine ZIP-/CSV-Dateien aus dem Hornetsecurity-Portal,
   keine E-Mail-Adressen, keine Screenshots mit Mitarbeiterdaten. Für Tests gibt es den
   synthetischen Report `test/sample.zip`, erzeugt von `test/make-sample.js`.
   Die CI bricht ab, wenn sie fremde E-Mail-Domains oder nicht erlaubte Dateien findet.
2. **Nur `src/` ändern**, nie die gebaute HTML-Datei. Sie entsteht mit `build.ps1` in `dist/`
   und wird nicht eingecheckt.
3. **Die HTML-Datei bleibt ohne Abhängigkeiten** — sie muss offline über `file://` laufen
   (kein CDN, kein `fetch`). npm-Pakete gibt es nur als Entwicklungswerkzeuge (Linter).
4. **Report-Inhalte nur per `textContent`** in den DOM schreiben, nie per `innerHTML`.
5. **Doku gehört in denselben Pull Request** wie der Code (siehe [Doku-Gate](#doku-gate)).

## Entwicklungsumgebung

Benötigt:

- [Node.js](https://nodejs.org/) ≥ 22.13
- PowerShell (Windows PowerShell 5.1 oder PowerShell 7) für den Build
- für `npm run lint:ps` das Modul PSScriptAnalyzer:
  `Install-Module PSScriptAnalyzer -Scope CurrentUser`

```powershell
npm ci                # Entwicklungswerkzeuge exakt nach package-lock.json installieren
npm run gate:data     # Daten-Gate: nur erlaubte Dateien, keine echten Reportdaten
npm run gate:docs     # Doku-Gate gegen origin/main
npm run check         # Syntax-Prüfung
npm run lint          # alle Linter: npm run lint:js (ESLint), npm run lint:md (markdownlint),
                      #              npm run lint:ps (PSScriptAnalyzer)
npm test              # Test-Suiten: Kernlogik gegen test/sample.zip und Doku-Gate-Regeln
npm run build         # → dist/Hornetsecurity-Report-Viewer.html (oder .\build.ps1)
```

Danach `dist/Hornetsecurity-Report-Viewer.html` im Browser öffnen und `test/sample.zip`
hineinziehen. Sollwerte des Beispiel-Reports: ESI 85, 163 gesendet, 12 erfolgreich,
30 gemeldet, 40 Benutzer, 23 Szenarien.

Wird der Generator geändert, `npm run sample` ausführen und die Sollwerte in
`test/core.test.js` anpassen.

## Pull-Request-Checks

Jeder Pull Request gegen `main` muss alle Checks bestehen, bevor er gemergt werden kann:

| Check | Prüft |
| --- | --- |
| **Gates (Daten, Syntax, Tests, Build)** | Daten-Gate, Syntax, beide Test-Suiten, Build und Build-Ergebnis |
| **Lint (JS, Markdown, PowerShell)** | ESLint (`eslint.config.js`), markdownlint (`.markdownlint.json`), PSScriptAnalyzer |
| **Doku-Gate** | Doku passt zum Code (siehe unten) |
| **Abhängigkeiten prüfen** | Neue oder geänderte npm-Pakete und Actions: keine bekannten Sicherheitslücken, keine GPL/AGPL-Lizenzen |

### Doku-Gate

`scripts/check-docs.js` vergleicht den Pull Request mit `main`:

- **Produkt geändert** (`src/`, `build.ps1`) → Eintrag in `CHANGELOG.md` unter `[Unreleased]`
  (bzw. im Abschnitt der neuen Version bei einem Release-PR).
- **Entwicklungs-Werkzeuge geändert** (Workflows, `scripts/`, Linter-Konfiguration, npm-Skripte,
  `test/make-sample.js`, `.gitignore`, Dependabot) → `CONTRIBUTING.md`, `README.md` oder
  `CHANGELOG.md` anpassen.
- **Version geändert** → `CHANGELOG.md` anpassen.
- **Immer:** Jedes npm-Skript ist hier oder im README dokumentiert, relative Links in
  Markdown-Dateien funktionieren, jede Version im CHANGELOG hat Datum und Link-Referenz.

Ausnahmen: Dependabot-PRs, die nur Abhängigkeiten ändern, brauchen keine Doku. Ist in einem
anderen Fall wirklich keine Doku nötig (z. B. reiner Tippfehler im Code-Kommentar), das Label
**`keine-doku`** setzen — der Check meldet dann eine Warnung statt eines Fehlers.

### Abhängigkeiten und Dependabot

Dependabot prüft npm-Pakete und GitHub Actions jeden Montag und bündelt Minor- und
Patch-Updates je Ökosystem in einem PR (Labels `dependencies` + `javascript` bzw.
`github-actions`, Commit-Präfix `chore(deps)`). Sicherheitsupdates kommen sofort.
Update-PRs durchlaufen dieselben Checks und werden wie jeder andere PR gemergt.

## Ablauf

1. Fork bzw. Branch anlegen, Änderung mit Test.
2. Eintrag unter `[Unreleased]` in `CHANGELOG.md`.
3. Pull Request gegen `main` — alle Checks müssen grün sein.

Commit-Präfixe: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

## Release (Maintainer)

1. Version in `package.json` erhöhen (SemVer), `CHANGELOG.md`-Abschnitt anlegen.
2. Nach dem Merge Tag setzen: `git tag v1.2.3 && git push origin v1.2.3`.
3. Der Release-Workflow prüft Tag = Version, führt alle Gates aus, baut die HTML-Datei und
   veröffentlicht sie samt SHA-256-Prüfsumme als GitHub-Release.
4. Schlägt der Release fehl, nach der Korrektur auf `main` neu starten, ohne den Tag zu verschieben:
   `gh workflow run release.yml -f tag=v1.2.3`.

## Lizenz von Beiträgen

Das Projekt steht unter der [PolyForm Shield License 1.0.0](LICENSE). Mit dem Einreichen eines
Beitrags bestätigen Sie, dass Sie ihn selbst verfasst haben oder die Rechte daran besitzen, und
räumen chrive-solutions e.U. das unbefristete, unentgeltliche und nicht ausschließliche Recht ein,
den Beitrag zu nutzen, zu verändern und unter der PolyForm Shield License 1.0.0 oder einer anderen
Lizenz zu verbreiten.
