/* Test-Suite für src/core.js — läuft in Node: `node test/core.test.js <pfad-zur-beispiel-zip>` */
'use strict';

const fs = require('fs');
const zlib = require('zlib');
const core = require('../src/core.js');

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + name); }
}
function assertEq(actual, expected, name) {
  const ok = actual === expected;
  if (!ok) console.error(`  FAIL: ${name} — erwartet ${JSON.stringify(expected)}, erhalten ${JSON.stringify(actual)}`);
  ok ? passed++ : failed++;
}
async function assertThrows(fn, name) {
  try { await fn(); failed++; console.error('  FAIL (kein Fehler geworfen): ' + name); }
  catch (e) { passed++; }
}

/* Deterministischer PRNG für reproduzierbare Fuzz-Tests */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const zipPath = process.argv[2];

  /* ---------- 1. Inflate-Fuzz: zufällige & repetitive Daten, alle Kompressionslevel ---------- */
  console.log('1) DEFLATE-Fuzz (JS-Inflate gegen node:zlib)…');
  const rnd = mulberry32(0xA47);
  const sizes = [0, 1, 2, 3, 10, 100, 1000, 65535, 65536, 70000, 250000];
  for (const size of sizes) {
    for (const mode of ['random', 'repetitive', 'text']) {
      const buf = Buffer.alloc(size);
      for (let i = 0; i < size; i++) {
        if (mode === 'random') buf[i] = Math.floor(rnd() * 256);
        else if (mode === 'repetitive') buf[i] = (i % 7 === 0) ? Math.floor(rnd() * 256) : 65 + (i % 3);
        else buf[i] = 32 + (Math.floor(rnd() * 8) === 0 ? 10 : Math.floor(rnd() * 90));
      }
      for (const level of [0, 1, 6, 9]) {
        const compressed = zlib.deflateRawSync(buf, { level });
        const result = core.inflateRawJS(new Uint8Array(compressed), size);
        assert(Buffer.from(result).equals(buf), `inflate size=${size} mode=${mode} level=${level}`);
      }
    }
  }

  /* fixed-Huffman-Block erzwingen (strategy FIXED) */
  const fixedSrc = Buffer.from('Hallo Welt! '.repeat(50));
  const fixedComp = zlib.deflateRawSync(fixedSrc, { strategy: zlib.constants.Z_FIXED });
  assert(Buffer.from(core.inflateRawJS(new Uint8Array(fixedComp), fixedSrc.length)).equals(fixedSrc), 'inflate fixed-huffman');

  /* Fehlerfälle */
  await assertThrows(() => core.inflateRawJS(new Uint8Array([0xff, 0xff, 0xff]), 10), 'inflate: Müll wirft Fehler');
  await assertThrows(() => core.inflateRawJS(new Uint8Array(0), 10), 'inflate: leerer Input wirft Fehler');

  /* ---------- 2. CSV-Parser ---------- */
  console.log('2) CSV-Parser…');
  assertEq(JSON.stringify(core.parseCSV('a,b,c\n1,2,3')), '[["a","b","c"],["1","2","3"]]', 'csv simpel');
  assertEq(JSON.stringify(core.parseCSV('a,"b,c",d\r\n1,"sagt ""hi""",3\r\n')), '[["a","b,c","d"],["1","sagt \\"hi\\"","3"]]', 'csv quotes+CRLF');
  assertEq(JSON.stringify(core.parseCSV('a,b\n"mehr\nzeilig",2\n')), '[["a","b"],["mehr\\nzeilig","2"]]', 'csv newline im feld');
  assertEq(core.parseCSV('a,b\n1,2\n\n').length, 2, 'csv leere endzeile entfernt');
  assertEq(JSON.stringify(core.parseCSV('ä,ö\nü,ß')), '[["ä","ö"],["ü","ß"]]', 'csv umlaute');
  const objs = core.csvToObjects('x,y\n1,2\n3,4');
  assertEq(objs.length, 2, 'csvToObjects anzahl');
  assertEq(objs[1].y, '4', 'csvToObjects wert');
  assertEq(core.csvToObjects('x,y\n1', )[0].y, '', 'csvToObjects fehlende spalte → leer');

  /* ---------- 3. Listen-Felder ---------- */
  console.log('3) parseListField…');
  assertEq(JSON.stringify(core.parseListField("['fear', 'time_pressure']")), '["fear","time_pressure"]', 'liste 2 strings');
  assertEq(JSON.stringify(core.parseListField('[]')), '[]', 'leere liste');
  assertEq(JSON.stringify(core.parseListField('')), '[]', 'leerer string');
  assertEq(JSON.stringify(core.parseListField("['curiosity']")), '["curiosity"]', 'liste 1 string');
  assertEq(JSON.stringify(core.parseListField('[123, 456]')), '["123","456"]', 'liste zahlen');
  assertEq(JSON.stringify(core.parseListField('["a", "b"]')), '["a","b"]', 'doppelte anführungszeichen');

  /* ---------- 4. Text-Dekodierung ---------- */
  console.log('4) decodeText…');
  assertEq(core.decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 65, 66])), 'AB', 'BOM entfernt');
  assertEq(core.decodeText(new TextEncoder().encode('Bürgerzuschuss')), 'Bürgerzuschuss', 'utf-8 umlaut');
  /* Windows-1252: 0xFC = ü */
  assertEq(core.decodeText(new Uint8Array([0x42, 0xfc, 0x72, 0x6f])), 'Büro', 'cp1252-fallback');

  /* ---------- 5. ZIP: kaputte Eingaben ---------- */
  console.log('5) ZIP-Fehlerfälle…');
  await assertThrows(() => core.unzip(new Uint8Array([1, 2, 3]).buffer), 'zip: zu klein');
  await assertThrows(() => core.unzip(new Uint8Array(100).buffer), 'zip: kein EOCD');
  const pngLike = new Uint8Array(2000); pngLike[0] = 0x89; pngLike[1] = 0x50;
  await assertThrows(() => core.unzip(pngLike.buffer), 'zip: falsches format');

  /* ---------- 6. Beispiel-ZIP (beide Inflate-Pfade) ---------- */
  if (zipPath && fs.existsSync(zipPath)) {
    console.log('6) Beispiel-ZIP…');
    const zipBuf = fs.readFileSync(zipPath);
    const ab = zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength);

    for (const forceJS of [true, false]) {
      const files = await core.unzip(ab, { forceJS });
      assertEq(files.length, 4, `unzip(forceJS=${forceJS}): 4 dateien`);
      const names = files.map(f => f.name).sort().join(',');
      assert(names.includes('company_statistics.csv') && names.includes('user_statistics.csv'), `unzip(forceJS=${forceJS}): dateinamen`);
      for (const f of files) {
        assert(f.bytes.length > 0, `unzip(forceJS=${forceJS}): ${f.name} nicht leer`);
        assert(f.date instanceof Date && !isNaN(f.date), `unzip(forceJS=${forceJS}): ${f.name} datum`);
      }
      /* Beide Pfade müssen identischen Inhalt liefern wie ein Referenz-Entpacker (node zlib über yauzl wäre extern —
         stattdessen: Quervergleich JS vs. nativ weiter unten) */
      if (forceJS) {
        global.__jsFiles = files;
      } else {
        const jsFiles = global.__jsFiles;
        for (const f of files) {
          const j = jsFiles.find(x => x.name === f.name);
          assert(j && Buffer.from(j.bytes).equals(Buffer.from(f.bytes)), `JS- und nativer Inflate identisch: ${f.name}`);
        }
      }
    }

    /* ---------- 7. Datenmodell gegen Sollwerte des synthetischen Beispiel-Reports (test/make-sample.js) ---------- */
    console.log('7) Datenmodell (Beispiel-Report)…');
    const files = await core.unzip(ab);
    const ident = core.identifyFiles(files.map(f => ({ name: f.name, text: core.decodeText(f.bytes), date: f.date })));
    assertEq(ident.missing.length, 0, 'keine fehlenden dateien');
    assertEq(ident.unknown.length, 0, 'keine unbekannten dateien');
    assert(ident.newestDate instanceof Date, 'newestDate vorhanden');

    const model = core.buildModel({
      company: ident.found.company,
      groups: ident.found.groups,
      users: ident.found.users,
      scenarios: ident.found.scenarios,
      reportDate: ident.newestDate,
      missing: ident.missing,
      unknown: ident.unknown
    });

    assertEq(model.kpi.esi, 85, 'ESI = 85');
    assertEq(model.kpi.sent, 163, 'angriffe gesendet = 163');
    assertEq(model.kpi.successful, 12, 'angriffe erfolgreich = 12');
    assertEq(model.kpi.reported, 30, 'angriffe gemeldet = 30');
    assertEq(Math.round(model.kpi.reportRate * 10000), Math.round(30 / 163 * 10000), 'meldequote');
    assertEq(model.users.length, 40, '40 benutzer');
    assertEq(model.scenarios.length, 23, '23 szenarien');
    assertEq(model.groups.length, 2, '2 gruppen');
    assertEq(model.groups[1].name, 'Werkstatt & Montage', 'gruppenname mit sonderzeichen');
    assertEq(model.employees, 40, '40 mitarbeiter (level-summe)');
    assertEq(model.training.completed, 409, 'trainings abgeschlossen = 409');
    assertEq(model.training.started, 25, 'trainings gestartet = 25');
    assertEq(model.training.notStarted, 176, 'trainings nicht gestartet = 176');
    assertEq(model.training.total, 610, 'trainings gesamt = 610');

    /* Level-Prüfsummen: level-summen == firmen-gesamtwerte */
    const lvlSent = model.levels.reduce((a, l) => a + l.sent, 0);
    const lvlEmp = model.levels.reduce((a, l) => a + l.employees, 0);
    assertEq(lvlSent, 163, 'level-summe gesendet = 163');
    assertEq(lvlEmp, 40, 'level-summe mitarbeiter = 40');

    /* Benutzer-Summen == Firmen-Summen (Konsistenz der Quelle) */
    const uSent = model.users.reduce((a, u) => a + u.sent, 0);
    const uRep = model.users.reduce((a, u) => a + u.reported, 0);
    assertEq(uSent, 163, 'benutzer-summe gesendet = 163');
    assertEq(uRep, 30, 'benutzer-summe gemeldet = 30');

    const gSent = model.groups.reduce((a, g) => a + g.sent, 0);
    assertEq(gSent, 163, 'gruppen-summe gesendet = 163');
    assert(model.users.some(u => u.successful > 0 && u.successfulScenarios.length > 0), 'erfolgreiche szenarien je benutzer');

    /* Faktoren: time_pressure muss existieren und plausibel sein */
    const tp = model.factors.find(f => f.key === 'time_pressure');
    assert(tp && tp.sent > 0, 'faktor time_pressure aggregiert');
    assert(model.factors.every(f => f.reported <= f.sent), 'faktoren: gemeldet <= gesendet');

    /* Szenario mit Umlaut korrekt dekodiert */
    assert(model.scenarios.some(s => s.description.includes('Bürgerzuschuss')), 'umlaut in szenario-beschreibung');

    /* Szenario mit Faktor-Liste in Anführungszeichen (Komma im Feld) */
    const s147 = model.scenarios.find(s => s.id === '147');
    assertEq(JSON.stringify(s147.factors), '["fear","time_pressure","subject_area"]', 'szenario 147: 3 faktoren');
    assertEq(s147.exploitType, 'attachment-docm', 'szenario 147: typ');

    /* report_rate als float geparst */
    const s986 = model.scenarios.find(s => s.id === '986');
    assert(Math.abs(s986.reportRate - 2 / 3) < 1e-9, 'szenario 986: report_rate 0.667');

    /* ---------- 8. Teilmengen-Robustheit ---------- */
    console.log('8) Robustheit bei fehlenden Dateien…');
    const modelNoCompany = core.buildModel({ users: ident.found.users, scenarios: ident.found.scenarios });
    assertEq(modelNoCompany.kpi.esi, null, 'ohne company: kein ESI');
    assertEq(modelNoCompany.kpi.sent, 163, 'ohne company: gesendet aus benutzern');
    assertEq(modelNoCompany.kpi.reported, 30, 'ohne company: gemeldet aus benutzern');
    assertEq(modelNoCompany.employees, 40, 'ohne company: mitarbeiter aus benutzern');
    assert(modelNoCompany.warnings.length > 0, 'ohne company: warnung vorhanden');

    const modelEmpty = core.buildModel({});
    assertEq(modelEmpty.kpi.sent, 0, 'leeres modell: 0 gesendet');
    assertEq(modelEmpty.kpi.reportRate, null, 'leeres modell: keine meldequote');

    /* ---------- 9. Review-Fixes (Findings aus dem adversarialen Review) ---------- */
    console.log('9) Review-Fixes…');

    /* 9a: newestDate darf nur aus zugeordneten Report-CSVs stammen */
    const identMixed = core.identifyFiles([
      { name: 'user_statistics.csv', text: 'employee_id\n1', date: new Date(2026, 5, 1) },
      { name: 'readme.txt', text: 'hallo', date: new Date(2026, 6, 8) }
    ]);
    assertEq(identMixed.newestDate.getMonth(), 5, 'newestDate ignoriert fremddateien');
    assertEq(identMixed.unknown.length, 1, 'fremddatei als unknown gemeldet');

    /* 9b: Duplikate werden gemeldet, erste Datei gewinnt */
    const identDup = core.identifyFiles([
      { name: 'user_statistics.csv', text: 'A', date: null },
      { name: 'user_statistics (1).csv', text: 'B', date: null }
    ]);
    assertEq(identDup.found.users, 'A', 'duplikat: erste datei gewinnt');
    assertEq(identDup.duplicates.length, 1, 'duplikat gemeldet');

    /* 9c: macOS-Metadaten werden ausgefiltert */
    const identMac = core.identifyFiles([
      { name: '__MACOSX/._user_statistics.csv', text: 'MÜLL', date: new Date(2026, 6, 9) },
      { name: 'user_statistics.csv', text: 'employee_id\n1', date: new Date(2026, 5, 1) }
    ]);
    assertEq(identMac.found.users, 'employee_id\n1', '__MACOSX-eintrag ignoriert');
    assertEq(identMac.duplicates.length, 0, 'appledouble zählt nicht als duplikat');
    assertEq(identMac.newestDate.getMonth(), 5, 'appledouble-datum ignoriert');

    /* 9d: unbalanciertes Anführungszeichen → truncated-Flag + Warnung im Modell */
    assertEq(core.parseCSVEx('a,b\n1,2').truncated, false, 'sauberes csv: nicht truncated');
    assertEq(core.parseCSVEx('a,b\n1,"2\n3,4').truncated, true, 'stray quote: truncated');
    const modelTrunc = core.buildModel({ users: 'employee_id,employee_email\n1,"x@y\n2,a@b' });
    assert(modelTrunc.warnings.some(w => w.includes('Anführungszeichen')), 'truncated-warnung im modell');

    /* 9e: fehlende/nicht-numerische esi-Spalte → null statt 0 */
    const noEsi = core.buildModel({ company: 'attacks_sent,attacks_reported\n10,2' });
    assertEq(noEsi.kpi.esi, null, 'fehlende esi-spalte → null');
    const badEsi = core.buildModel({ company: 'esi,attacks_sent\nn/a,10' });
    assertEq(badEsi.kpi.esi, null, 'esi "n/a" → null');
    const okEsi = core.buildModel({ company: 'esi,attacks_sent\n90,10' });
    assertEq(okEsi.kpi.esi, 90, 'esi 90 bleibt 90');

    /* 9f: Zip-Bomb-Guard — Eintrag mit absurder uncompSize wird abgelehnt */
    {
      const smallCsv = Buffer.from('a,b\n1,2');
      const comp = zlib.deflateRawSync(smallCsv);
      /* Minimal-ZIP von Hand bauen: local header + central dir + EOCD, uncompSize gefälscht */
      function u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }
      function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; }
      const name = Buffer.from('big.csv');
      const fakeUncomp = 500 * 1024 * 1024;
      const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0), u32(0), u32(comp.length), u32(fakeUncomp), u16(name.length), u16(0), name, comp]);
      const cen = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0), u32(0), u32(comp.length), u32(fakeUncomp), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), name]);
      const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(cen.length), u32(local.length), u16(0)]);
      const evilZip = Buffer.concat([local, cen, eocd]);
      const ab2 = evilZip.buffer.slice(evilZip.byteOffset, evilZip.byteOffset + evilZip.byteLength);
      await assertThrows(() => core.unzip(ab2), 'zip-bomb-guard: absurde uncompSize abgelehnt');
    }
  } else {
    console.log('6-9) ÜBERSPRUNGEN — keine Beispiel-ZIP übergeben.');
  }

  console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Testlauf abgebrochen:', e); process.exit(1); });
