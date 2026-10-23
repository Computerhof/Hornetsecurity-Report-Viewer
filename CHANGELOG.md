# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

## [2.0.0] - 2026-10-23

Lizenzwechsel auf PolyForm Shield 1.0.0; dazu Linter, Doku-Gate und Abhängigkeitsprüfung als
Pull-Request-Checks. Die Auswertung selbst ist unverändert.

### Hinzugefügt

- Linter als Pull-Request-Check: ESLint, markdownlint und PSScriptAnalyzer (`npm run lint`).
- Doku-Gate als Pull-Request-Check (`scripts/check-docs.js`): CHANGELOG-Eintrag bei
  Produktänderungen, Entwickler-Doku bei Werkzeug-Änderungen, Konsistenz von npm-Skripten,
  Links und CHANGELOG; Ausnahme per Label `keine-doku`.
- Abhängigkeitsprüfung (Dependency Review) als Pull-Request-Check; Dependabot zusätzlich für
  npm, wöchentlich und gebündelt; Dependabot-Sicherheitsupdates aktiviert.

### Geändert

- **Lizenz:** PolyForm Shield License 1.0.0 statt MIT. Nutzung bleibt kostenlos, auch in Firmen und
  in veränderter Form; Verkauf, Weitergabe oder Betrieb als konkurrierendes Produkt nur mit Vereinbarung.
  Version 1.0.0 bleibt unter der MIT-Lizenz. Fußzeile, README und `package.json` angepasst.
- Entwicklung benötigt Node.js ≥ 22.13 (Linter); die ausgelieferte HTML-Datei bleibt ohne Abhängigkeiten.
- `build.ps1` als UTF-8 mit BOM gespeichert, damit Windows PowerShell 5.1 Umlaute in
  Meldungen korrekt anzeigt; Statusausgabe über `Write-Output`.

### Behoben

- Release-Workflow: Release-Notizen werden korrekt aus dem CHANGELOG übernommen;
  bestehende Tags lassen sich manuell (erneut) veröffentlichen (`workflow_dispatch`).

## [1.0.0] - 2026-10-23

Erste öffentliche Version.

### Hinzugefügt

- Portable Einzeldatei `Hornetsecurity-Report-Viewer.html`: Report-ZIP des Hornetsecurity
  Security Awareness Service per Drag & Drop laden, Auswertung komplett offline im Browser.
- KPI-Kacheln: ESI mit Vormonats-Delta, simulierte, erfolgreiche und gemeldete Angriffe,
  Meldequote, riskante Interaktionen, E-Training-Fortschritt.
- Diagramme: Angriffe und Meldungen je Mitarbeiter-Level, Mitarbeiter-Verteilung, E-Training-Status
  (farbfehlsichtigkeits-geprüfte Palette, hell und dunkel).
- Monats-Verlauf von ESI, Melde- und Erfolgsquote (nur Kennzahlen, lokal im Browser gespeichert).
- Sortier-, such- und filterbare Tabellen für psychologische Faktoren, Szenarien und Mitarbeiter.
- Druck-/PDF-Ansicht, Hell-/Dunkel-Modus, Tastatur-Bedienbarkeit der Tooltips.
- Robuste Eingabeverarbeitung: eigener ZIP-Leser mit DEFLATE-Fallback, UTF-8/Windows-1252,
  Schutz vor ZIP-Bomben, Toleranz bei fehlenden Dateien, keine Reportdaten über `innerHTML`.
- Versionsanzeige und Lizenz-/Kontakthinweis in der Fußzeile.
- Synthetischer Beispiel-Report (`test/make-sample.js`, deterministisch) und Test-Suite.
- CI mit Gates: Daten-Gate gegen echte Reportdaten, Syntax-Prüfung, Tests, Build-Prüfung;
  Release-Workflow mit SHA-256-Prüfsumme.

[Unreleased]: https://github.com/Computerhof/Hornetsecurity-Report-Viewer/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/Computerhof/Hornetsecurity-Report-Viewer/releases/tag/v2.0.0
[1.0.0]: https://github.com/Computerhof/Hornetsecurity-Report-Viewer/releases/tag/v1.0.0
