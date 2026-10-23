## Was ändert sich?

<!-- Kurz beschreiben, was und warum. -->

## Checkliste

- [ ] Änderungen nur in `src/`, `test/`, `scripts/` oder Doku — keine gebaute HTML eingecheckt
- [ ] **Keine echten Reportdaten** (ZIP/CSV, E-Mail-Adressen, Namen) im Diff
- [ ] `npm run gate:data`, `npm run lint` und `npm test` lokal grün
- [ ] Im Browser mit `test/sample.zip` geprüft
- [ ] `CHANGELOG.md` ergänzt (Abschnitt `[Unreleased]`) und betroffene Doku im selben PR angepasst
  (`npm run gate:docs`; nur wenn wirklich keine Doku nötig ist: Label `keine-doku`)
