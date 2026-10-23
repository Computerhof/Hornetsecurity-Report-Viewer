# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

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

[Unreleased]: https://github.com/Computerhof/Hornetsecurity-Report-Viewer/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Computerhof/Hornetsecurity-Report-Viewer/releases/tag/v1.0.0
