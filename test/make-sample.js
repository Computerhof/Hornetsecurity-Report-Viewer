/*
 * Erzeugt test/sample.zip — einen vollständig SYNTHETISCHEN Report im Format des
 * Hornetsecurity Security Awareness Service (4 CSV-Dateien, deflate-komprimiert).
 *
 * Alle Personen, Adressen (@example.com), Gruppen und Szenario-Texte sind erfunden.
 * Der Generator ist deterministisch (fester Seed, festes Datum): gleiche Eingabe → byte-gleiche ZIP.
 * Dadurch kann die CI prüfen, dass die eingecheckte ZIP exakt aus diesem Skript stammt
 * und keine echten Reportdaten enthält.
 *
 *   node test/make-sample.js            → schreibt test/sample.zip
 *   node test/make-sample.js --check    → Exit 1, wenn test/sample.zip davon abweicht
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, 'sample.zip');
const REPORT_DATE = new Date(2026, 9, 1, 1, 10, 0); /* 01.10.2026 01:10 — Datenstand */
const USER_COUNT = 40;
const LEVELS = [1, 2, 3, 4, 5];

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261001);
const randInt = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

/* ---------- Stammdaten (erfunden) ---------- */

/* [id, Beschreibung, Typ, Faktoren, Level] */
const SCENARIOS = [
  [3, 'Paketzustellung fehlgeschlagen', 'link-login', ['time_pressure'], 1],
  [11, 'Neue Urlaubsregelung im Intranet', 'link-doc', ['routine', 'company_info'], 2],
  [19, 'Gutschein zum Firmenjubiläum', 'link-login', ['desire'], 1],
  [27, 'Rechnung eines unbekannten Lieferanten', 'attachment-docm', ['curiosity'], 2],
  [34, 'Kennwort läuft heute ab', 'link-login', ['fear', 'time_pressure'], 2],
  [42, 'Geteiltes Dokument vom Kollegen', 'link-doc', ['filesharing', 'sender_colleague'], 3],
  [58, 'Antrag auf Bürgerzuschuss der Gemeinde', 'link-doc', ['desire', 'sender_authority'], 3],
  [63, 'Spendenaufruf eines Vereins', 'link-doc', ['helpfulness'], 1],
  [77, 'Mahnung mit Inkasso-Androhung', 'attachment-docm', ['fear', 'sender_authority'], 3],
  [85, 'Einladung zur Teambesprechung', 'link-doc', ['routine', 'sender_colleague'], 2],
  [92, 'Bewerbung auf eine offene Stelle', 'attachment-docm', ['helpfulness', 'subject_area'], 4],
  [108, 'Steuerrückerstattung verfügbar', 'link-login', ['desire', 'sender_authority'], 2],
  [116, 'Kontaktanfrage über gemeinsamen Bekannten', 'link-doc', ['mutual_acquaintance'], 4],
  [125, 'Hinweis der IT-Abteilung zum Postfach', 'link-login', ['sender_authority_department', 'time_pressure'], 3],
  [139, 'Newsletter zur Fachmesse', 'link-doc', ['curiosity', 'subject_area'], 1],
  [147, 'Vertragsentwurf zur dringenden Freigabe', 'attachment-docm', ['fear', 'time_pressure', 'subject_area'], 4],
  [153, 'Gewinnspiel der Kantine', 'link-login', ['desire', 'company_info'], 1],
  [168, 'Lieferschein mit Abweichung', 'attachment-docm', ['routine', 'subject_area'], 3],
  [174, 'Sicherheitswarnung zum Bankkonto', 'link-login', ['fear'], 2],
  [181, 'Umfrage zur Mitarbeiterzufriedenheit', 'link-doc', ['helpfulness', 'company_info'], 2],
  [196, 'Freigabe einer Cloud-Datei', 'link-login', ['filesharing'], 3],
  [204, 'Bitte der Geschäftsführung um Rückruf', 'link-doc', ['sender_authority', 'time_pressure'], 4],
  [986, 'Zugangsdaten für das neue Zeiterfassungssystem', 'link-login', ['routine', 'company_info'], 2]
].map(([id, description, type, factors, level]) => ({ id, description, type, factors, level }));

const GROUPS = [
  { id: 0, name: 'Verwaltung' },
  { id: 1, name: 'Werkstatt & Montage' }
];

const users = [];
for (let i = 0; i < USER_COUNT; i++) {
  users.push({
    id: 900101 + i,
    email: 'user' + String(i + 1).padStart(2, '0') + '@example.com',
    level: [1, 2, 2, 3, 3, 3, 4, 4][i % 8],
    group: i % 3 === 0 ? 0 : 1,
    training: (() => {
      const completed = randInt(0, 24), started = randInt(0, 1) * randInt(0, 2), notStarted = randInt(0, 9);
      return { completed, started, notStarted, notAssigned: 40 - completed - started - notStarted };
    })()
  });
}

/* ---------- Angriffe simulieren ---------- */

const events = []; /* { user, scenario, successful, reported, clicked, login, fileOpened, macro } */
function addEvent(user, scenario, outcome) {
  const e = { user, scenario, successful: false, reported: false, clicked: false, login: false, fileOpened: false, macro: false };
  if (outcome === 'success') {
    e.successful = true;
    if (scenario.type === 'attachment-docm') { e.fileOpened = true; e.macro = rnd() < 0.5; }
    else { e.clicked = true; e.login = scenario.type === 'link-login'; }
  } else if (outcome === 'report') {
    e.reported = true;
  }
  events.push(e);
}

const pool = SCENARIOS.filter(s => s.id !== 986);
for (const u of users) {
  const n = randInt(2, 6);
  const fitting = pool.filter(s => s.level <= u.level + 1);
  for (let k = 0; k < n; k++) {
    const s = pick(fitting);
    const r = rnd();
    addEvent(u, s, r < 0.07 ? 'success' : r < 0.22 ? 'report' : 'ignored');
  }
}
/* Szenario 986: exakt 3 Versand, 2 Meldungen → report_rate 2/3 (Test auf Float-Parsing) */
const s986 = SCENARIOS.find(s => s.id === 986);
addEvent(users[4], s986, 'report');
addEvent(users[9], s986, 'report');
addEvent(users[14], s986, 'ignored');

/* ---------- Aggregation ---------- */

function sumStats(evts) {
  const st = { sent: evts.length, successful: 0, reported: 0, clicked: 0, logins: 0, filesOpened: 0, macros: 0, byLevel: {} };
  for (const l of LEVELS) st.byLevel[l] = { sent: 0, successful: 0, reported: 0 };
  for (const e of evts) {
    if (e.successful) st.successful++;
    if (e.reported) st.reported++;
    if (e.clicked) st.clicked++;
    if (e.login) st.logins++;
    if (e.fileOpened) st.filesOpened++;
    if (e.macro) st.macros++;
    const b = st.byLevel[e.scenario.level];
    b.sent++; if (e.successful) b.successful++; if (e.reported) b.reported++;
  }
  return st;
}
function topFactors(evts) {
  const count = new Map();
  for (const e of evts) if (e.successful) for (const f of e.scenario.factors) count.set(f, (count.get(f) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(x => x[0]);
}
function esiOf(st) {
  if (!st.sent) return 100;
  return Math.max(0, Math.min(100, Math.round(100 - (st.successful / st.sent) * 250 + (st.reported / st.sent) * 20)));
}
function trainingsOf(us) {
  return us.reduce((a, u) => ({
    completed: a.completed + u.training.completed,
    started: a.started + u.training.started,
    notStarted: a.notStarted + u.training.notStarted
  }), { completed: 0, started: 0, notStarted: 0 });
}

/* ---------- CSV-Formatierung im Stil des Originals (Python-Repr) ---------- */

const pyList = (arr) => '[' + arr.map(x => typeof x === 'number' ? String(x) : "'" + x + "'").join(', ') + ']';
const pyFloat = (v) => Number.isInteger(v) ? v.toFixed(1) : String(v);
function csvField(v) {
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const csv = (header, rows) => [header, ...rows].map(r => r.map(csvField).join(',')).join('\n') + '\n';

const ATTACK_COLS = ['attacks_sent', 'attacks_successful', 'attacks_reported', 'attacks_clicked', 'attacks_logins', 'attacks_files_opened', 'attacks_macros_executed'];
const attackVals = (st) => [st.sent, st.successful, st.reported, st.clicked, st.logins, st.filesOpened, st.macros];
const levelCols = (withEmployees) => LEVELS.flatMap(l => {
  const c = ['level_' + l + '_attacks_sent', 'level_' + l + '_attacks_successful', 'level_' + l + '_attacks_reported'];
  return withEmployees ? c.concat('level_' + l + '_employees') : c;
});
const TRAIN_COLS = ['e_trainings_completed', 'e_trainings_started', 'e_trainings_not_started'];
const trainVals = (t) => [t.completed, t.started, t.notStarted];

const allStats = sumStats(events);

const companyCsv = csv(
  ['esi', 'most_effective_psychological_factors', ...ATTACK_COLS, ...levelCols(true), ...TRAIN_COLS],
  [[esiOf(allStats), pyList(topFactors(events)), ...attackVals(allStats),
    ...LEVELS.flatMap(l => [allStats.byLevel[l].sent, allStats.byLevel[l].successful, allStats.byLevel[l].reported, users.filter(u => u.level === l).length]),
    ...trainVals(trainingsOf(users))]]
);

const groupCsv = csv(
  ['group_id', 'group_name', 'group_esi', 'group_size', 'most_effective_psychological_factors', ...ATTACK_COLS, ...levelCols(false),
    ...LEVELS.map(l => 'level_' + l + '_employees'), ...TRAIN_COLS],
  GROUPS.map(g => {
    const gu = users.filter(u => u.group === g.id);
    const ge = events.filter(e => e.user.group === g.id);
    const st = sumStats(ge);
    return [g.id, g.name, esiOf(st), gu.length, pyList(topFactors(ge)), ...attackVals(st),
      ...LEVELS.flatMap(l => [st.byLevel[l].sent, st.byLevel[l].successful, st.byLevel[l].reported]),
      ...LEVELS.map(l => gu.filter(u => u.level === l).length), ...trainVals(trainingsOf(gu))];
  })
);

const userCsv = csv(
  ['employee_id', 'employee_email', 'employee_level', 'most_effective_psychological_factors', ...ATTACK_COLS, ...levelCols(false),
    ...TRAIN_COLS, 'e_trainings_not_assigned', 'successful_scenarios'],
  users.map(u => {
    const ue = events.filter(e => e.user === u);
    const st = sumStats(ue);
    const succ = [...new Set(ue.filter(e => e.successful).map(e => e.scenario.id))].sort((a, b) => a - b);
    return [u.id, u.email, u.level, pyList(topFactors(ue)), ...attackVals(st),
      ...LEVELS.flatMap(l => [st.byLevel[l].sent, st.byLevel[l].successful, st.byLevel[l].reported]),
      ...trainVals(u.training), u.training.notAssigned, pyList(succ)];
  })
);

const scenarioCsv = csv(
  ['scenario_id', 'scenario_description', 'scenario_exploit_type', 'scenario_psychological_factors', 'scenario_level',
    'success_rate', 'report_rate', ...ATTACK_COLS],
  SCENARIOS.map(s => {
    const st = sumStats(events.filter(e => e.scenario === s));
    return [s.id, s.description, s.type, pyList(s.factors), s.level,
      pyFloat(st.sent ? st.successful / st.sent : 0), pyFloat(st.sent ? st.reported / st.sent : 0), ...attackVals(st)];
  })
);

/* ---------- ZIP schreiben (deflate, feste Zeitstempel → reproduzierbar) ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };

function buildZip(entries, date) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, text } of entries) {
    const raw = Buffer.from(text, 'utf8');
    const comp = zlib.deflateRawSync(raw, { level: 9 });
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(dosTime), u16(dosDate),
      u32(crc), u32(comp.length), u32(raw.length), u16(nameBuf.length), u16(0), nameBuf, comp]);
    centrals.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(dosTime), u16(dosDate),
      u32(crc), u32(comp.length), u32(raw.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf]));
    locals.push(local);
    offset += local.length;
  }
  const cen = Buffer.concat(centrals);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cen.length), u32(offset), u16(0)]);
  return Buffer.concat([...locals, cen, eocd]);
}

const zip = buildZip([
  { name: 'company_statistics.csv', text: companyCsv },
  { name: 'group_statistics.csv', text: groupCsv },
  { name: 'user_statistics.csv', text: userCsv },
  { name: 'phishing_scenario_statistics.csv', text: scenarioCsv }
], REPORT_DATE);

if (process.argv.includes('--check')) {
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT) : Buffer.alloc(0);
  if (!existing.equals(zip)) {
    console.error('test/sample.zip weicht vom Generator ab — nur synthetische Daten erlaubt. `node test/make-sample.js` ausführen.');
    process.exit(1);
  }
  console.log('test/sample.zip entspricht dem Generator (synthetische Daten).');
} else {
  fs.writeFileSync(OUT, zip);
  console.log('Geschrieben: ' + OUT + ' (' + zip.length + ' Bytes)');
  console.log('Sollwerte: ESI ' + esiOf(allStats) + ', gesendet ' + allStats.sent + ', erfolgreich ' + allStats.successful +
    ', gemeldet ' + allStats.reported + ', Benutzer ' + users.length + ', Szenarien ' + SCENARIOS.length +
    ', Trainings ' + JSON.stringify(trainingsOf(users)));
}
