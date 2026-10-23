# Sicherheit

## Unterstützte Versionen

Sicherheitskorrekturen gibt es für die jeweils neueste Version (siehe [Releases](https://github.com/Computerhof/Hornetsecurity-Report-Viewer/releases)).

## Sicherheitslücke melden

Bitte **nicht** als öffentliches Issue melden, sondern vertraulich:

- über [GitHub Security Advisories](https://github.com/Computerhof/Hornetsecurity-Report-Viewer/security/advisories/new) oder
- per E-Mail an **office@chrive-solutions.at** (Betreff „Security: Hornetsecurity Report Viewer").

Wir bestätigen den Eingang in der Regel innerhalb von 5 Werktagen und stimmen den
Veröffentlichungszeitpunkt einer Korrektur mit Ihnen ab.

**Bitte keine echten Reports oder Mitarbeiterdaten mitschicken** — ein nachgestelltes Beispiel
(z. B. auf Basis von `test/sample.zip`) genügt.

## Sicherheitsmodell

- Der Viewer ist eine statische HTML-Datei. Er lädt nichts nach, sendet nichts und braucht keinen Server.
- Report-Inhalte gelten als nicht vertrauenswürdig: sie gelangen ausschließlich per `textContent` in
  die Seite, nie per `innerHTML`.
- ZIP-Einträge werden auf Größe geprüft (Schutz vor ZIP-Bomben); beschädigte Dateien führen zu
  einer Fehlermeldung, nicht zu einem Absturz.
- Im `localStorage` des Browsers liegen nur Monats-Kennzahlen für den Verlauf, keine Mitarbeiterdaten.
