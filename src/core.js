/* ============================================================
 * Hornetsecurity Report Viewer — Kern-Logik (ohne UI)
 * ZIP-Reader, DEFLATE-Dekompression, CSV-Parser, Datenmodell.
 * Läuft im Browser (global PRVCore) und in Node (module.exports)
 * für die Test-Suite.
 * ============================================================ */
'use strict';

var PRVCore = (function () {

  /* ---------- Hilfsfunktionen ---------- */

  function toNum(v) {
    if (v === null || v === undefined) return 0;
    var n = Number(String(v).trim());
    return Number.isFinite(n) ? n : 0;
  }

  /* "['fear', 'time_pressure']" → ["fear","time_pressure"], "[]" → [] */
  function parseListField(value) {
    var s = String(value === null || value === undefined ? '' : value).trim();
    if (!s || s === '[]') return [];
    var inner = s.replace(/^\[/, '').replace(/\]$/, '');
    var out = [];
    var re = /'([^']*)'|"([^"]*)"|([^,\s][^,]*)/g;
    var m;
    while ((m = re.exec(inner)) !== null) {
      var tok = (m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3])).trim();
      if (tok) out.push(tok);
    }
    return out;
  }

  /* ---------- DEFLATE (raw) — pure JS-Implementierung (Port von zlib "puff") ----------
   * Fallback für Browser ohne DecompressionStream('deflate-raw'). */

  var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CLC_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function inflateRawJS(src, expectedSize) {
    var pos = 0, bitbuf = 0, bitcnt = 0;
    var out = new Uint8Array(expectedSize > 0 ? expectedSize : Math.max(1024, src.length * 4));
    var outLen = 0;

    function ensure(n) {
      if (outLen + n > out.length) {
        var grown = new Uint8Array(Math.max(out.length * 2, outLen + n));
        grown.set(out);
        out = grown;
      }
    }

    function bits(need) {
      var val = bitbuf;
      while (bitcnt < need) {
        if (pos >= src.length) throw new Error('DEFLATE: unerwartetes Datenende.');
        val |= src[pos++] << bitcnt;
        bitcnt += 8;
      }
      bitbuf = val >>> need;
      bitcnt -= need;
      return val & ((1 << need) - 1);
    }

    function buildTree(lengths) {
      var counts = new Array(16).fill(0);
      var i;
      for (i = 0; i < lengths.length; i++) counts[lengths[i]]++;
      counts[0] = 0;
      var left = 1;
      for (i = 1; i <= 15; i++) {
        left <<= 1;
        left -= counts[i];
        if (left < 0) throw new Error('DEFLATE: Huffman-Code überbelegt.');
      }
      var offs = new Array(16).fill(0);
      for (i = 1; i < 15; i++) offs[i + 1] = offs[i] + counts[i];
      var symbols = new Array(lengths.length);
      for (i = 0; i < lengths.length; i++) {
        if (lengths[i] !== 0) symbols[offs[lengths[i]]++] = i;
      }
      return { counts: counts, symbols: symbols };
    }

    function decode(tree) {
      var code = 0, first = 0, index = 0;
      for (var len = 1; len <= 15; len++) {
        code |= bits(1);
        var count = tree.counts[len];
        if (code - first < count) return tree.symbols[index + (code - first)];
        index += count;
        first = (first + count) << 1;
        code <<= 1;
      }
      throw new Error('DEFLATE: ungültiger Huffman-Code.');
    }

    function codes(lentree, disttree) {
      for (;;) {
        var sym = decode(lentree);
        if (sym < 256) {
          ensure(1);
          out[outLen++] = sym;
        } else if (sym === 256) {
          return;
        } else {
          sym -= 257;
          if (sym >= 29) throw new Error('DEFLATE: ungültiger Längencode.');
          var len = LEN_BASE[sym] + bits(LEN_EXTRA[sym]);
          var dsym = decode(disttree);
          if (dsym >= 30) throw new Error('DEFLATE: ungültiger Distanzcode.');
          var dist = DIST_BASE[dsym] + bits(DIST_EXTRA[dsym]);
          if (dist > outLen) throw new Error('DEFLATE: Distanz zeigt vor den Datenanfang.');
          ensure(len);
          for (var i = 0; i < len; i++) {
            out[outLen] = out[outLen - dist];
            outLen++;
          }
        }
      }
    }

    function stored() {
      bitbuf = 0; bitcnt = 0; /* auf Bytegrenze ausrichten */
      if (pos + 4 > src.length) throw new Error('DEFLATE: stored-Block abgeschnitten.');
      var len = src[pos] | (src[pos + 1] << 8);
      var nlen = src[pos + 2] | (src[pos + 3] << 8);
      if ((len ^ 0xffff) !== nlen) throw new Error('DEFLATE: stored-Block LEN/NLEN-Prüfung fehlgeschlagen.');
      pos += 4;
      if (pos + len > src.length) throw new Error('DEFLATE: stored-Block abgeschnitten.');
      ensure(len);
      out.set(src.subarray(pos, pos + len), outLen);
      outLen += len;
      pos += len;
    }

    var fixedLen = null, fixedDist = null;
    function fixedTrees() {
      if (!fixedLen) {
        var l = new Array(288);
        var i;
        for (i = 0; i < 144; i++) l[i] = 8;
        for (i = 144; i < 256; i++) l[i] = 9;
        for (i = 256; i < 280; i++) l[i] = 7;
        for (i = 280; i < 288; i++) l[i] = 8;
        fixedLen = buildTree(l);
        var d = new Array(30).fill(5);
        fixedDist = buildTree(d);
      }
      return { len: fixedLen, dist: fixedDist };
    }

    function dynamicBlock() {
      var hlit = bits(5) + 257;
      var hdist = bits(5) + 1;
      var hclen = bits(4) + 4;
      if (hlit > 286 || hdist > 30) throw new Error('DEFLATE: ungültige Tabellengrößen.');
      var clens = new Array(19).fill(0);
      var i;
      for (i = 0; i < hclen; i++) clens[CLC_ORDER[i]] = bits(3);
      var cltree = buildTree(clens);
      var total = hlit + hdist;
      var lengths = new Array(total).fill(0);
      i = 0;
      while (i < total) {
        var sym = decode(cltree);
        var n;
        if (sym < 16) {
          lengths[i++] = sym;
        } else if (sym === 16) {
          if (i === 0) throw new Error('DEFLATE: Wiederholung ohne vorherige Länge.');
          n = 3 + bits(2);
          if (i + n > total) throw new Error('DEFLATE: Längen-Wiederholung überläuft.');
          var prev = lengths[i - 1];
          while (n--) lengths[i++] = prev;
        } else if (sym === 17) {
          n = 3 + bits(3);
          if (i + n > total) throw new Error('DEFLATE: Längen-Wiederholung überläuft.');
          while (n--) lengths[i++] = 0;
        } else {
          n = 11 + bits(7);
          if (i + n > total) throw new Error('DEFLATE: Längen-Wiederholung überläuft.');
          while (n--) lengths[i++] = 0;
        }
      }
      if (lengths[256] === 0) throw new Error('DEFLATE: kein End-of-Block-Code.');
      var lentree = buildTree(lengths.slice(0, hlit));
      var disttree = buildTree(lengths.slice(hlit));
      codes(lentree, disttree);
    }

    var final;
    do {
      final = bits(1);
      var type = bits(2);
      if (type === 0) stored();
      else if (type === 1) { var f = fixedTrees(); codes(f.len, f.dist); }
      else if (type === 2) dynamicBlock();
      else throw new Error('DEFLATE: ungültiger Blocktyp 3.');
    } while (!final);

    return out.slice(0, outLen);
  }

  /* Dekomprimiert raw-DEFLATE: nativ (DecompressionStream) wenn möglich, sonst JS. */
  async function inflateRaw(data, expectedSize, forceJS) {
    if (!forceJS && typeof DecompressionStream === 'function') {
      try {
        var ds = new DecompressionStream('deflate-raw');
        var stream = new Blob([data]).stream().pipeThrough(ds);
        var buf = await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
      } catch (e) {
        /* Fallback auf JS-Implementierung */
      }
    }
    return inflateRawJS(data, expectedSize);
  }

  /* ---------- ZIP-Archiv ---------- */

  var SIG_EOCD = 0x06054b50, SIG_CEN = 0x02014b50, SIG_LOC = 0x04034b50;

  function dosDateToDate(d, t) {
    var year = ((d >> 9) & 0x7f) + 1980;
    var month = (d >> 5) & 0x0f;
    var day = d & 0x1f;
    if (!month || !day) return null;
    var hh = (t >> 11) & 0x1f, mm = (t >> 5) & 0x3f, ss = (t & 0x1f) * 2;
    return new Date(year, month - 1, day, hh, mm, ss);
  }

  function parseZipEntries(buffer) {
    var bytes = new Uint8Array(buffer);
    var view = new DataView(buffer);
    var MIN_EOCD = 22;
    if (bytes.length < MIN_EOCD) throw new Error('Die Datei ist zu klein für ein ZIP-Archiv.');
    var eocd = -1;
    var scanEnd = Math.max(0, bytes.length - MIN_EOCD - 65535);
    for (var i = bytes.length - MIN_EOCD; i >= scanEnd; i--) {
      if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Das ist keine ZIP-Datei (End-of-Central-Directory nicht gefunden).');
    var count = view.getUint16(eocd + 10, true);
    var cdOffset = view.getUint32(eocd + 16, true);
    if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('ZIP64-Archive werden nicht unterstützt.');

    var entries = [];
    var p = cdOffset;
    for (var n = 0; n < count; n++) {
      if (p + 46 > bytes.length || view.getUint32(p, true) !== SIG_CEN) {
        throw new Error('ZIP: Central Directory ist beschädigt.');
      }
      var flags = view.getUint16(p + 8, true);
      var method = view.getUint16(p + 10, true);
      var dosTime = view.getUint16(p + 12, true);
      var dosDate = view.getUint16(p + 14, true);
      var compSize = view.getUint32(p + 20, true);
      var uncompSize = view.getUint32(p + 24, true);
      var nameLen = view.getUint16(p + 28, true);
      var extraLen = view.getUint16(p + 30, true);
      var commentLen = view.getUint16(p + 32, true);
      var headerOffset = view.getUint32(p + 42, true);
      var name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLen));
      entries.push({
        name: name, flags: flags, method: method,
        compSize: compSize, uncompSize: uncompSize,
        headerOffset: headerOffset, date: dosDateToDate(dosDate, dosTime)
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  function entryCompressedData(buffer, entry) {
    var view = new DataView(buffer);
    var p = entry.headerOffset;
    if (p + 30 > buffer.byteLength || view.getUint32(p, true) !== SIG_LOC) {
      throw new Error('ZIP: Local File Header ist beschädigt.');
    }
    var nameLen = view.getUint16(p + 26, true);
    var extraLen = view.getUint16(p + 28, true);
    var start = p + 30 + nameLen + extraLen;
    if (start + entry.compSize > buffer.byteLength) throw new Error('ZIP: Datei-Eintrag ist abgeschnitten.');
    return new Uint8Array(buffer, start, entry.compSize);
  }

  /* Schutz vor präparierten Archiven (Zip-Bomb): Obergrenzen für entpackte Größen */
  var MAX_ENTRY_SIZE = 100 * 1024 * 1024;
  var MAX_TOTAL_SIZE = 200 * 1024 * 1024;

  /* Entpackt alle Dateien eines ZIP-Archivs → [{name, date, bytes}] */
  async function unzip(buffer, opts) {
    opts = opts || {};
    var entries = parseZipEntries(buffer).filter(function (e) { return !/\/$/.test(e.name); });
    var files = [];
    var totalSize = 0;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.flags & 0x1) throw new Error('Der ZIP-Eintrag "' + e.name + '" ist verschlüsselt und kann nicht gelesen werden.');
      totalSize += e.uncompSize;
      if (e.uncompSize > MAX_ENTRY_SIZE || totalSize > MAX_TOTAL_SIZE) {
        throw new Error('Das ZIP-Archiv ist unplausibel groß (Eintrag "' + e.name + '") — Verarbeitung abgebrochen.');
      }
      var raw = entryCompressedData(buffer, e);
      var bytes;
      if (e.method === 0) {
        bytes = raw.slice();
      } else if (e.method === 8) {
        bytes = await inflateRaw(raw, e.uncompSize, opts.forceJS);
      } else {
        throw new Error('Der ZIP-Eintrag "' + e.name + '" nutzt eine nicht unterstützte Kompressionsmethode (' + e.method + ').');
      }
      if (e.uncompSize > 0 && bytes.length !== e.uncompSize) {
        throw new Error('ZIP-Eintrag "' + e.name + '": entpackte Größe stimmt nicht (erwartet ' + e.uncompSize + ', erhalten ' + bytes.length + ').');
      }
      files.push({ name: e.name, date: e.date, bytes: bytes });
    }
    return files;
  }

  /* ---------- Text-Dekodierung (UTF-8 mit Windows-1252-Fallback) ---------- */

  function decodeText(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      bytes = bytes.subarray(3);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      try {
        return new TextDecoder('windows-1252').decode(bytes);
      } catch (e2) {
        return new TextDecoder('utf-8').decode(bytes);
      }
    }
  }

  /* ---------- CSV-Parser (RFC 4180: Anführungszeichen, Kommas in Feldern, CRLF) ---------- */

  /* Liefert zusätzlich truncated=true, wenn die Datei innerhalb eines
   * Anführungszeichens endet (unbalanciertes Quote → Rest wäre verschluckt worden). */
  function parseCSVEx(text) {
    var rows = [], row = [], field = '', inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else if (c !== '\r') {
        field += c;
      }
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
    return {
      rows: rows.filter(function (r) { return !(r.length === 1 && r[0].trim() === ''); }),
      truncated: inQuotes
    };
  }

  function parseCSV(text) {
    return parseCSVEx(text).rows;
  }

  function csvToObjectsEx(text) {
    var parsed = parseCSVEx(text);
    var rows = parsed.rows;
    if (rows.length < 1) return { rows: [], truncated: parsed.truncated };
    var header = rows[0].map(function (h) { return h.trim(); });
    var objects = rows.slice(1).map(function (r) {
      var o = {};
      for (var i = 0; i < header.length; i++) o[header[i]] = r[i] !== undefined ? r[i] : '';
      return o;
    });
    return { rows: objects, truncated: parsed.truncated };
  }

  function csvToObjects(text) {
    return csvToObjectsEx(text).rows;
  }

  /* ---------- Datei-Zuordnung ---------- */

  var FILE_KEYS = [
    { key: 'company', pattern: /company_statistics/i, label: 'company_statistics.csv' },
    { key: 'groups', pattern: /group_statistics/i, label: 'group_statistics.csv' },
    { key: 'users', pattern: /user_statistics/i, label: 'user_statistics.csv' },
    { key: 'scenarios', pattern: /scenario_statistics/i, label: 'phishing_scenario_statistics.csv' }
  ];

  /* files: [{name, text, date}] →
   * {found: {key → text}, missing: [labels], unknown: [names], duplicates: [names], newestDate}
   * newestDate stammt nur aus zugeordneten Report-CSVs — Fremddateien im ZIP
   * dürfen weder Datenstand noch Monats-Key des Verlaufs verfälschen. */
  function identifyFiles(files) {
    var found = {}, unknown = [], duplicates = [], newestDate = null;
    files.forEach(function (f) {
      var full = String(f.name);
      var base = full.split('/').pop().split('\\').pop();
      /* macOS-Archiv-Metadaten aussortieren (__MACOSX/, AppleDouble ._*, .DS_Store) */
      if (/(^|[\/\\])__MACOSX([\/\\]|$)/.test(full) || /^\._/.test(base) || /^\.DS_Store$/i.test(base)) return;
      var match = null;
      for (var i = 0; i < FILE_KEYS.length; i++) {
        if (FILE_KEYS[i].pattern.test(base)) { match = FILE_KEYS[i].key; break; }
      }
      if (match && !(match in found)) {
        found[match] = f.text;
        if (f.date && (!newestDate || f.date > newestDate)) newestDate = f.date;
      } else if (match) {
        duplicates.push(base);
      } else {
        unknown.push(base);
      }
    });
    var missing = FILE_KEYS.filter(function (k) { return !(k.key in found); }).map(function (k) { return k.label; });
    return { found: found, missing: missing, unknown: unknown, duplicates: duplicates, newestDate: newestDate };
  }

  /* ---------- Deutsche Beschriftungen ---------- */

  var FACTOR_LABELS = {
    curiosity: 'Neugier',
    time_pressure: 'Zeitdruck',
    fear: 'Angst',
    desire: 'Anreiz / Verlangen',
    helpfulness: 'Hilfsbereitschaft',
    routine: 'Routine',
    sender_authority: 'Autorität (Absender)',
    sender_authority_department: 'Autorität (Abteilung)',
    sender_colleague: 'Absender: Kollege',
    subject_area: 'Fachlicher Bezug',
    company_info: 'Firmenbezug',
    mutual_acquaintance: 'Gemeinsame Bekannte',
    filesharing: 'Filesharing',
    trust: 'Vertrauen',
    urgency: 'Dringlichkeit',
    reward: 'Belohnung',
    greed: 'Gier'
  };

  var EXPLOIT_LABELS = {
    'link-doc': 'Link → Dokument',
    'link-login': 'Link → Login-Seite',
    'link': 'Link',
    'attachment-docm': 'Anhang (Word-Makro)',
    'attachment-xlsm': 'Anhang (Excel-Makro)',
    'attachment': 'Anhang',
    'qr-code': 'QR-Code',
    'reply': 'Antwort-Köder'
  };

  function factorLabel(key) {
    return FACTOR_LABELS[key] || String(key).replace(/_/g, ' ');
  }

  function exploitLabel(key) {
    return EXPLOIT_LABELS[key] || String(key);
  }

  /* ---------- Datenmodell ----------
   * input: {company?, groups?, users?, scenarios? (CSV-Texte), reportDate?, missing?, unknown?}
   */
  function buildModel(input) {
    var warnings = [];

    /* CSV einlesen + auf unbalanciertes Anführungszeichen (verschluckter Rest) hinweisen */
    function readCsv(text, label) {
      if (!text) return [];
      var parsed = csvToObjectsEx(text);
      if (parsed.truncated) {
        warnings.push(label + ': Datei endet innerhalb eines Anführungszeichens — möglicherweise unvollständig eingelesen.');
      }
      return parsed.rows;
    }

    var companyRow = null;
    if (input.company) {
      var cRows = readCsv(input.company, 'company_statistics.csv');
      companyRow = cRows[0] || null;
      if (!companyRow) warnings.push('company_statistics.csv enthält keine Datenzeile.');
    }

    var users = readCsv(input.users, 'user_statistics.csv').map(function (u) {
      return {
        id: String(u.employee_id || ''),
        email: String(u.employee_email || ''),
        level: toNum(u.employee_level),
        sent: toNum(u.attacks_sent),
        successful: toNum(u.attacks_successful),
        reported: toNum(u.attacks_reported),
        clicked: toNum(u.attacks_clicked),
        logins: toNum(u.attacks_logins),
        filesOpened: toNum(u.attacks_files_opened),
        macros: toNum(u.attacks_macros_executed),
        trainingsCompleted: toNum(u.e_trainings_completed),
        trainingsStarted: toNum(u.e_trainings_started),
        trainingsNotStarted: toNum(u.e_trainings_not_started),
        trainingsNotAssigned: toNum(u.e_trainings_not_assigned),
        successfulScenarios: parseListField(u.successful_scenarios)
      };
    });

    var scenarios = readCsv(input.scenarios, 'phishing_scenario_statistics.csv').map(function (s) {
      return {
        id: String(s.scenario_id || ''),
        description: String(s.scenario_description || ''),
        exploitType: String(s.scenario_exploit_type || ''),
        factors: parseListField(s.scenario_psychological_factors),
        level: toNum(s.scenario_level),
        successRate: toNum(s.success_rate),
        reportRate: toNum(s.report_rate),
        sent: toNum(s.attacks_sent),
        successful: toNum(s.attacks_successful),
        reported: toNum(s.attacks_reported),
        clicked: toNum(s.attacks_clicked),
        logins: toNum(s.attacks_logins),
        filesOpened: toNum(s.attacks_files_opened),
        macros: toNum(s.attacks_macros_executed)
      };
    });

    var groups = readCsv(input.groups, 'group_statistics.csv').map(function (g) {
      return {
        id: String(g.group_id || ''),
        name: String(g.group_name || ''),
        esi: g.group_esi !== undefined && String(g.group_esi).trim() !== '' ? toNum(g.group_esi) : null,
        size: toNum(g.group_size),
        sent: toNum(g.attacks_sent),
        successful: toNum(g.attacks_successful),
        reported: toNum(g.attacks_reported),
        trainingsCompleted: toNum(g.e_trainings_completed),
        trainingsStarted: toNum(g.e_trainings_started),
        trainingsNotStarted: toNum(g.e_trainings_not_started)
      };
    });

    function sumUsers(field) {
      return users.reduce(function (acc, u) { return acc + u[field]; }, 0);
    }

    /* KPIs: bevorzugt aus company_statistics, sonst aus Benutzerdaten aggregiert */
    var kpi;
    if (companyRow) {
      kpi = {
        esi: companyRow.esi !== undefined && String(companyRow.esi).trim() !== '' && Number.isFinite(Number(String(companyRow.esi).trim()))
          ? toNum(companyRow.esi) : null,
        sent: toNum(companyRow.attacks_sent),
        successful: toNum(companyRow.attacks_successful),
        reported: toNum(companyRow.attacks_reported),
        clicked: toNum(companyRow.attacks_clicked),
        logins: toNum(companyRow.attacks_logins),
        filesOpened: toNum(companyRow.attacks_files_opened),
        macros: toNum(companyRow.attacks_macros_executed),
        topFactors: parseListField(companyRow.most_effective_psychological_factors)
      };
    } else if (users.length) {
      warnings.push('company_statistics.csv fehlt — Kennzahlen wurden aus den Benutzerdaten aggregiert (kein ESI verfügbar).');
      kpi = {
        esi: null,
        sent: sumUsers('sent'),
        successful: sumUsers('successful'),
        reported: sumUsers('reported'),
        clicked: sumUsers('clicked'),
        logins: sumUsers('logins'),
        filesOpened: sumUsers('filesOpened'),
        macros: sumUsers('macros'),
        topFactors: []
      };
    } else {
      kpi = { esi: null, sent: 0, successful: 0, reported: 0, clicked: 0, logins: 0, filesOpened: 0, macros: 0, topFactors: [] };
    }
    kpi.reportRate = kpi.sent > 0 ? kpi.reported / kpi.sent : null;
    kpi.successRate = kpi.sent > 0 ? kpi.successful / kpi.sent : null;

    /* Level-Statistik 1–5 */
    var levels = [];
    for (var L = 1; L <= 5; L++) {
      if (companyRow) {
        levels.push({
          level: L,
          employees: toNum(companyRow['level_' + L + '_employees']),
          sent: toNum(companyRow['level_' + L + '_attacks_sent']),
          successful: toNum(companyRow['level_' + L + '_attacks_successful']),
          reported: toNum(companyRow['level_' + L + '_attacks_reported'])
        });
      } else {
        var inLevel = users.filter(function (u) { return u.level === L; });
        levels.push({
          level: L,
          employees: inLevel.length,
          sent: inLevel.reduce(function (a, u) { return a + u.sent; }, 0),
          successful: inLevel.reduce(function (a, u) { return a + u.successful; }, 0),
          reported: inLevel.reduce(function (a, u) { return a + u.reported; }, 0)
        });
      }
    }

    var employees = companyRow
      ? levels.reduce(function (a, l) { return a + l.employees; }, 0)
      : users.length;
    if (!employees && users.length) employees = users.length;

    /* E-Training */
    var training;
    if (companyRow) {
      training = {
        completed: toNum(companyRow.e_trainings_completed),
        started: toNum(companyRow.e_trainings_started),
        notStarted: toNum(companyRow.e_trainings_not_started)
      };
    } else {
      training = {
        completed: sumUsers('trainingsCompleted'),
        started: sumUsers('trainingsStarted'),
        notStarted: sumUsers('trainingsNotStarted')
      };
    }
    training.total = training.completed + training.started + training.notStarted;
    training.completionRate = training.total > 0 ? training.completed / training.total : null;

    /* Psychologische Faktoren (aus Szenarien aggregiert) */
    var fmap = new Map();
    scenarios.forEach(function (s) {
      s.factors.forEach(function (f) {
        var e = fmap.get(f) || { key: f, label: factorLabel(f), scenarios: 0, sent: 0, reported: 0, successful: 0 };
        e.scenarios++;
        e.sent += s.sent;
        e.reported += s.reported;
        e.successful += s.successful;
        fmap.set(f, e);
      });
    });
    var factors = Array.from(fmap.values());
    factors.forEach(function (f) {
      f.reportRate = f.sent > 0 ? f.reported / f.sent : null;
      f.successRate = f.sent > 0 ? f.successful / f.sent : null;
    });
    factors.sort(function (a, b) {
      return (b.successful - a.successful) || (b.sent - a.sent) || a.label.localeCompare(b.label, 'de');
    });

    /* Szenario-Namen für die "erfolgreiche Szenarien"-Auflösung pro Benutzer */
    var scenarioById = new Map();
    scenarios.forEach(function (s) { scenarioById.set(String(s.id), s); });

    return {
      kpi: kpi,
      levels: levels,
      employees: employees,
      training: training,
      factors: factors,
      users: users,
      scenarios: scenarios,
      scenarioById: scenarioById,
      groups: groups,
      warnings: warnings,
      missing: input.missing || [],
      unknown: input.unknown || [],
      duplicates: input.duplicates || [],
      reportDate: input.reportDate || null
    };
  }

  return {
    toNum: toNum,
    parseListField: parseListField,
    inflateRawJS: inflateRawJS,
    inflateRaw: inflateRaw,
    parseZipEntries: parseZipEntries,
    unzip: unzip,
    decodeText: decodeText,
    parseCSV: parseCSV,
    parseCSVEx: parseCSVEx,
    csvToObjects: csvToObjects,
    csvToObjectsEx: csvToObjectsEx,
    identifyFiles: identifyFiles,
    buildModel: buildModel,
    factorLabel: factorLabel,
    exploitLabel: exploitLabel,
    FACTOR_LABELS: FACTOR_LABELS,
    EXPLOIT_LABELS: EXPLOIT_LABELS
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PRVCore;
