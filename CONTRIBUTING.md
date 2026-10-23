# Mitwirken

Danke für Ihr Interesse! Fehlermeldungen und Verbesserungen sind willkommen.

## Grundregeln

1. **Niemals echte Reportdaten einchecken** — keine ZIP-/CSV-Dateien aus dem Hornetsecurity-Portal,
   keine E-Mail-Adressen, keine Screenshots mit Mitarbeiterdaten. Für Tests gibt es den
   synthetischen Report `test/sample.zip`, erzeugt von `test/make-sample.js`.
   Die CI bricht ab, wenn sie fremde E-Mail-Domains oder nicht erlaubte Dateien findet.
2. **Nur `src/` ändern**, nie die gebaute HTML-Datei. Sie entsteht mit `build.ps1` in `dist/`
   und wird nicht eingecheckt.
3. **Keine externen Abhängigkeiten** — die HTML-Datei muss offline über `file://` laufen
   (kein CDN, kein `fetch`).
4. **Report-Inhalte nur per `textContent`** in den DOM schreiben, nie per `innerHTML`.

## Entwicklungsumgebung

Benötigt: [Node.js](https://nodejs.org/) ≥ 20 und PowerShell (Windows PowerShell 5.1 oder
PowerShell 7). Es gibt keine npm-Abhängigkeiten, `npm install` ist nicht nötig.

```powershell
npm run gate:data   # Daten-Gate: nur erlaubte Dateien, keine echten Reportdaten
npm run check       # Syntax-Prüfung
npm test            # Test-Suite gegen test/sample.zip
npm run build       # → dist/Hornetsecurity-Report-Viewer.html
```

Danach `dist/Hornetsecurity-Report-Viewer.html` im Browser öffnen und `test/sample.zip`
hineinziehen. Sollwerte des Beispiel-Reports: ESI 85, 163 gesendet, 12 erfolgreich,
30 gemeldet, 40 Benutzer, 23 Szenarien.

Wird der Generator geändert, `npm run sample` ausführen und die Sollwerte in
`test/core.test.js` anpassen.

## Ablauf

1. Fork bzw. Branch anlegen, Änderung mit Test.
2. Eintrag unter `[Unreleased]` in `CHANGELOG.md`.
3. Pull Request gegen `main` — die CI-Gates müssen grün sein.

Commit-Präfixe: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

## Release (Maintainer)

1. Version in `package.json` erhöhen (SemVer), `CHANGELOG.md`-Abschnitt anlegen.
2. Nach dem Merge Tag setzen: `git tag v1.2.3 && git push origin v1.2.3`.
3. Der Release-Workflow prüft Tag = Version, führt alle Gates aus, baut die HTML-Datei und
   veröffentlicht sie samt SHA-256-Prüfsumme als GitHub-Release.

Mit dem Einreichen eines Beitrags stimmen Sie zu, dass er unter der [MIT-Lizenz](LICENSE) steht.
