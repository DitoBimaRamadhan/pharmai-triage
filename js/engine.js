/*
 * PharmAI-Triage — Clinical Rules Engine (deterministik, dapat diaudit)
 * ------------------------------------------------------------------
 * Urutan sesuai arsitektur paper: Input -> Profil keamanan -> Filter red flag
 * -> Rules engine (whitelist OTC, kontraindikasi, dosis) -> Panduan.
 *
 * 4 HARD RULES (tidak bisa ditimpa AI/LLM):
 *  1. Tidak pernah menyarankan antibiotik atau obat keras untuk swamedikasi.
 *  2. Red flag apa pun MENGHAPUS semua saran obat dan menampilkan rujukan.
 *  3. Jawaban keamanan yang kosong/ragu -> "konsultasikan ke apoteker".
 *  4. Setiap hasil selalu menampilkan batas hari swamedikasi.
 *
 * Fungsi murni (tanpa DOM) agar bisa diuji dengan Node: lihat tests/run-tests.js
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.PharmEngine = factory(root.PharmRules);
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  var RANK = { SWAMEDIKASI: 0, APOTEKER: 1, DOKTER: 2, IGD: 3 };
  var STATUS_LABEL = {
    SWAMEDIKASI: 'Boleh swamedikasi dengan obat bebas',
    APOTEKER: 'Konsultasikan dulu ke apoteker',
    DOKTER: 'Hentikan swamedikasi — periksa ke dokter / Puskesmas',
    IGD: 'DARURAT — segera ke IGD / hubungi 119 atau 112'
  };

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  }
  function has(arr, x) { return Array.isArray(arr) && arr.indexOf(x) !== -1; }
  function norm(s) { return String(s || '').toLowerCase(); }
  function fmt(n) { return Math.round(n).toLocaleString('id-ID'); }

  /* ---------- Teks bebas -> saran modul (KATA KUNCI, BUKAN LLM) ----------
   * >>> Titik integrasi LLM: ganti fungsi ini dengan panggilan ke layanan
   * anamnesis LLM (OLDARTS -> JSON {module, symptoms, durationDays, redFlags}).
   * Output LLM hanya MENGISI formulir; keputusan obat tetap oleh triage(). */
  function suggestFromText(text) {
    var t = ' ' + norm(text) + ' ';
    var out = { module: null, scores: {}, symptoms: [], redFlags: [], forbidden: [] };
    if (!t.trim()) return out;
    Object.keys(R.KEYWORDS).forEach(function (m) {
      out.scores[m] = R.KEYWORDS[m].filter(function (k) { return t.indexOf(k) !== -1; }).length;
    });
    var best = null, bestScore = 0;
    ['ispa', 'cerna', 'kulit', 'demam'].forEach(function (m) { // urutan prioritas saat seri
      if (out.scores[m] > bestScore) { best = m; bestScore = out.scores[m]; }
    });
    out.module = best;
    if (best) {
      Object.keys(R.SYMPTOM_KEYWORDS).forEach(function (key) {
        var p = key.split('.');
        if (p[0] !== best) return;
        if (R.SYMPTOM_KEYWORDS[key].some(function (k) { return t.indexOf(k) !== -1; })) out.symptoms.push(p[1]);
      });
      if (has(out.symptoms, 'batuk_kering') && out.symptoms.indexOf('batuk_dahak') !== -1 && t.indexOf('berdahak') === -1) {
        out.symptoms.splice(out.symptoms.indexOf('batuk_dahak'), 1);
      }
    }
    out.redFlags = findFlagKeywords(t, best);
    out.forbidden = R.FORBIDDEN_KEYWORDS.filter(function (k) { return t.indexOf(k) !== -1; });
    return out;
  }

  function findFlagKeywords(t, moduleId) {
    var flags = R.GLOBAL_RED_FLAGS.slice();
    Object.keys(R.MODULES).forEach(function (m) {
      if (!moduleId || m === moduleId) flags = flags.concat(R.MODULES[m].redFlags);
    });
    var hits = [];
    flags.forEach(function (f) {
      (f.kw || []).forEach(function (k) { if (t.indexOf(k) !== -1 && !has(hits, f.id)) hits.push(f.id); });
    });
    return hits;
  }

  function allFlags(moduleId) {
    var m = R.MODULES[moduleId];
    return R.GLOBAL_RED_FLAGS.concat(m ? m.redFlags : []);
  }

  /* ---------- Dosis per zat aktif ---------- */
  function computeDose(ing, ageM, kg) {
    var d = ing.dosing;
    if (!d) return null;
    if (d.kind === 'mgkg_or_adult') {
      var isAdult = ageM >= d.adultMinAge * 12 && kg >= d.adultMinKg;
      if (isAdult) {
        return {
          mode: 'dewasa',
          text: d.adultLo + '–' + d.adultHi + ' mg per dosis, ' + d.interval + ', maks ' + fmt(d.adultMaxDay) + ' mg/hari',
          perDoseLo: d.adultLo, perDoseHi: d.adultHi, maxDayMg: d.adultMaxDay
        };
      }
      var lo = Math.min(Math.round(d.mgkgLo * kg), d.capDoseMg);
      var hi = Math.min(Math.floor(d.mgkgHi * kg), d.capDoseMg);
      var maxDay = Math.min(Math.floor(d.maxMgkgDay * kg), d.adultMaxDay);
      return {
        mode: 'berat',
        text: fmt(lo) + '–' + fmt(hi) + ' mg per dosis (' + d.mgkgLo + '–' + d.mgkgHi + ' mg/kg), ' + d.interval +
          ', maks ' + d.maxDosesDay + ' dosis & ' + fmt(maxDay) + ' mg/hari. Pilih sediaan (sirup/drops/tablet) sesuai label & ukur dengan sendok takar.',
        perDoseLo: lo, perDoseHi: hi, maxDayMg: maxDay
      };
    }
    if (d.kind === 'age_band' || d.kind === 'ors') {
      for (var i = 0; i < d.bands.length; i++) {
        var b = d.bands[i];
        if (ageM >= b.minM && ageM < b.maxM) return { mode: d.kind, text: b.text };
      }
      return null;
    }
    if (d.kind === 'label') return { mode: 'label', text: d.text };
    return null;
  }

  /* Kontraindikasi / gating per zat aktif. return {block|gate: alasan} */
  function checkIngredient(id, ing, ctx) {
    var c = ctx;
    if (ing.gated) return { gate: 'Bukan untuk swalayan (umumnya produk resep/OWA) — hanya setelah konsultasi apoteker.' };
    if (R.SELF_SERVE_CLASSES.indexOf(ing.cls) === -1 && ing.cls !== 'per_produk') return { block: 'Bukan obat bebas/bebas terbatas.' };
    // alergi
    if (id === 'paracetamol' && has(c.allergies, 'alergi_parasetamol')) return { block: 'Alergi parasetamol.' };
    if (id === 'ibuprofen' && has(c.allergies, 'alergi_oains')) return { block: 'Alergi ibuprofen/aspirin/OAINS.' };
    var at = norm(c.allergyText);
    if (at && (at.indexOf(norm(id)) !== -1 || at.indexOf(norm(ing.name).split(' ')[0]) !== -1)) return { block: 'Tercantum di daftar alergi Anda.' };
    // usia minimum
    if (c.ageM < (ing.minAgeMonths || 0)) return { gate: 'Usia di bawah batas swamedikasi untuk zat ini — tanyakan apoteker.' };
    if (id === 'paracetamol') {
      if (has(c.meds, 'parasetamol_lain')) return { block: 'Sudah memakai produk lain berisi parasetamol (risiko dosis ganda).' };
      if (has(c.comorb, 'hati')) return { gate: 'Penyakit hati/alkohol: perlu batas dosis lebih rendah yang ditentukan apoteker/dokter.' };
    }
    if (id === 'ibuprofen') {
      if (c.pregnancy === 'hamil' || c.pregnancy === 'tidak_yakin') return { block: 'Kehamilan (OAINS dihindari, terutama trimester 3).' };
      if (has(c.comorb, 'tukak')) return { block: 'Riwayat tukak lambung/perdarahan saluran cerna.' };
      if (has(c.comorb, 'ginjal')) return { block: 'Penyakit ginjal.' };
      if (has(c.comorb, 'jantung')) return { block: 'Penyakit jantung/riwayat stroke.' };
      if (has(c.comorb, 'pembekuan') || has(c.meds, 'antikoagulan')) return { block: 'Risiko perdarahan (gangguan pembekuan / pengencer darah).' };
      if (has(c.meds, 'oains_lain')) return { block: 'Sudah memakai OAINS lain (dosis ganda).' };
      if (c.dengueSuspect) return { block: 'Curiga demam berdarah (DBD): OAINS meningkatkan risiko perdarahan.' };
      if (c.dehydration) return { block: 'Diare/muntah atau risiko dehidrasi: risiko gangguan ginjal.' };
      if (has(c.comorb, 'asma')) return { gate: 'Asma: OAINS dapat memicu serangan pada sebagian orang — tanyakan apoteker.' };
      if (has(c.comorb, 'hipertensi')) return { gate: 'Hipertensi: OAINS dapat menaikkan tekanan darah — tanyakan apoteker.' };
      if (c.ageM >= R.GLOBAL.elderlyYears * 12) return { gate: 'Usia ≥ 65 tahun: risiko lambung & ginjal — tanyakan apoteker.' };
    }
    if (ing.blockIf && ing.blockIf.comorb) {
      for (var k in ing.blockIf.comorb) if (has(c.comorb, k)) return { gate: ing.blockIf.comorb[k] + ' — tanyakan apoteker.' };
    }
    return null;
  }

  /* ---------- Triage utama ---------- */
  function triage(input) {
    var inp = input || {};
    var mod = R.MODULES[inp.module];
    var res = {
      rulesVersion: R.VERSION, module: inp.module || null, moduleName: mod ? mod.name : null,
      status: 'SWAMEDIKASI', reasons: [], meds: [], gated: [], excluded: [], warnings: [],
      nonPharm: mod ? mod.nonPharm.slice() : [], limitDays: null, limitAssumed: false, daysLeft: null,
      needsPharmacistConfirm: false
    };
    function escalate(level, text) {
      res.reasons.push({ level: level, text: text });
      if (RANK[level] > RANK[res.status]) res.status = level;
    }
    if (!mod) { escalate('APOTEKER', 'Modul keluhan belum dipilih.'); return finish(res, inp); }

    var symptoms = (inp.symptoms || []).filter(function (s) { return mod.symptoms.some(function (x) { return x.id === s; }); });
    var symObjs = mod.symptoms.filter(function (x) { return has(symptoms, x.id); });

    // Hard rule 4: batas swamedikasi (konservatif = batas terpendek dari keluhan yang dipilih)
    var pool = symObjs.length ? symObjs : mod.symptoms;
    res.limitDays = Math.min.apply(null, pool.map(function (s) { return s.limitDays; }));
    res.limitAssumed = pool.some(function (s) { return s.assumed && s.limitDays === res.limitDays; });

    var years = num(inp.ageYears), months = num(inp.ageMonths) || 0;
    var ageM = years === null ? null : years * 12 + months;
    var kg = num(inp.weightKg), temp = num(inp.tempC), dur = num(inp.durationDays);
    var flags = inp.redFlags || [];
    var hasFeverSym = has(symptoms, 'demam');

    // ---- 1. Validasi data (Hard rule 3: kosong/ragu -> apoteker) ----
    if (!symObjs.length) escalate('APOTEKER', 'Belum ada keluhan spesifik yang dipilih.');
    if (ageM === null || ageM < 0 || ageM > 1320 || months < 0 || months > 11) escalate('APOTEKER', 'Usia belum diisi/tidak valid.');
    if (kg === null || kg < 2 || kg > 250) escalate('APOTEKER', 'Berat badan belum diisi/tidak valid (dibutuhkan untuk dosis).');
    if (dur === null || dur < 0) escalate('APOTEKER', 'Lama keluhan belum diisi.');
    if (temp !== null && (temp < R.GLOBAL.implausibleLowC || temp > R.GLOBAL.implausibleHighC)) {
      escalate('APOTEKER', 'Suhu ' + temp + ' °C tidak masuk akal — ukur ulang dengan termometer digital.'); temp = null;
    }
    if (hasFeverSym && temp === null) escalate('APOTEKER', 'Ada keluhan demam tetapi suhu belum diukur — ukur dengan termometer digital.');
    var pregAsk = ageM !== null && ageM >= 120;
    var preg = inp.pregnancy || '';
    if (pregAsk) {
      if (!preg) escalate('APOTEKER', 'Pertanyaan kehamilan/menyusui belum dijawab.');
      else if (preg === 'hamil' || preg === 'menyusui' || preg === 'tidak_yakin') {
        escalate('APOTEKER', 'Hamil/menyusui/tidak yakin: pemilihan obat hanya melalui apoteker atau dokter.');
      }
    }
    if (has(inp.meds, 'obat_rutin')) escalate('APOTEKER', 'Sedang memakai obat resep rutin: perlu cek interaksi oleh apoteker.');

    // ---- 2. Bayi < 3 bulan: selalu rujuk ----
    if (ageM !== null && ageM < R.GLOBAL.infantReferMonths) {
      if ((temp !== null && temp >= R.GLOBAL.infantFeverC) || hasFeverSym) escalate('IGD', 'Bayi < 3 bulan dengan demam: segera ke IGD/dokter.');
      else escalate('DOKTER', 'Bayi < 3 bulan: tidak untuk swamedikasi, periksakan ke dokter/bidan/Puskesmas.');
    }

    // ---- 3. Filter red flag (global + modul) ----
    allFlags(mod.id).forEach(function (f) {
      if (has(flags, f.id)) escalate(f.level, 'Tanda bahaya: ' + f.label + '.');
    });
    if (temp !== null && temp >= R.GLOBAL.highFeverC) escalate('DOKTER', 'Suhu ' + temp + ' °C (≥ 39 °C).');
    if (temp !== null && temp < R.GLOBAL.hypothermiaC) escalate('DOKTER', 'Suhu ' + temp + ' °C terlalu rendah saat sakit.');
    if (dur !== null && dur > res.limitDays) escalate('DOKTER', 'Keluhan sudah ' + dur + ' hari, melewati batas swamedikasi ' + res.limitDays + ' hari.');
    if (mod.id === 'ispa' && dur !== null && dur >= 14 && symObjs.some(function (s) { return s.id.indexOf('batuk') === 0; })) {
      escalate('DOKTER', 'Batuk ≥ 2 minggu: perlu skrining TBC.');
    }
    if (mod.id === 'kulit' && temp !== null && temp >= R.GLOBAL.feverC) escalate('DOKTER', 'Ruam disertai demam.');

    // Kata kunci bahaya di teks bebas yang tidak dicentang -> ragu -> apoteker (konservatif)
    var kwHits = findFlagKeywords(' ' + norm(inp.freeText) + ' ', mod.id).filter(function (id) { return !has(flags, id); });
    if (kwHits.length) {
      var labels = allFlags(mod.id).concat(R.GLOBAL_RED_FLAGS).filter(function (f) { return has(kwHits, f.id); }).map(function (f) { return f.label; });
      escalate('APOTEKER', 'Teks keluhan menyebut kemungkinan tanda bahaya (' + labels.filter(function (v, i, a) { return a.indexOf(v) === i; }).join('; ') + ') tetapi tidak dicentang — pastikan dengan apoteker/dokter.');
    }
    var forb = R.FORBIDDEN_KEYWORDS.filter(function (k) { return norm(inp.freeText).indexOf(k) !== -1; });
    if (forb.length) res.warnings.push('Antibiotik/obat keras (' + forb.join(', ') + ') tidak untuk swamedikasi dan tidak akan pernah disarankan aplikasi ini. Hanya dengan resep dokter.');

    if (inp.dengueSuspect && mod.id === 'demam') res.warnings.push('Curiga DBD: ibuprofen/OAINS dihindari. Pantau tanda bahaya dan periksakan ke dokter/Puskesmas untuk cek darah.');

    // ---- 4. Hard rule 2 & 3: rujukan/ragu -> TIDAK ADA saran obat ----
    if (res.status !== 'SWAMEDIKASI') return finish(res, inp);

    // ---- 5. Rules engine: whitelist -> kontraindikasi -> dosis ----
    var ctx = {
      ageM: ageM, kg: kg, comorb: inp.comorb || [], meds: inp.meds || [], allergies: inp.allergies || [],
      allergyText: inp.allergyText || '', pregnancy: preg, dengueSuspect: !!inp.dengueSuspect,
      dehydration: has(symptoms, 'diare')
    };
    var seen = {};
    symObjs.forEach(function (s) {
      s.ingredients.forEach(function (id) {
        if (seen[id]) return; seen[id] = true;
        var ing = R.INGREDIENTS[id];
        if (!ing) return;
        var chk = checkIngredient(id, ing, ctx);
        if (chk && chk.block) { res.excluded.push({ id: id, name: ing.name, reason: chk.block }); return; }
        if (chk && chk.gate) { res.gated.push({ id: id, name: ing.name, use: ing.use, reason: chk.gate, notes: ing.notes || [] }); return; }
        var dose = computeDose(ing, ageM, kg);
        if (!dose) { res.gated.push({ id: id, name: ing.name, use: ing.use, reason: 'Dosis untuk usia ini tidak tersedia di aturan — tanyakan apoteker.', notes: [] }); return; }
        res.meds.push({
          id: id, name: ing.name, cls: ing.cls, clsLabel: R.CLASS_LABEL[ing.cls], use: ing.use,
          dose: dose, notes: (ing.notes || []).slice()
        });
      });
    });

    if (ageM < R.GLOBAL.childMaxYears * 12) {
      res.needsPharmacistConfirm = true;
      res.warnings.push('Anak < 12 tahun: dosis dihitung dari berat badan — konfirmasikan ke apoteker sebelum memberi obat.');
    }
    if (has(ctx.comorb, 'diabetes')) res.warnings.push('Diabetes: pilih sediaan bebas gula bila ada (banyak sirup & tablet hisap mengandung gula).');
    if (symObjs.some(function (s) { return !s.ingredients.length; })) {
      res.warnings.push('Untuk sebagian keluhan (' + symObjs.filter(function (s) { return !s.ingredients.length; }).map(function (s) { return s.label.toLowerCase(); }).join(', ') +
        ') aplikasi tidak menyarankan obat swalayan — gunakan saran non-obat atau tanyakan apoteker.');
    }
    if (res.limitAssumed) res.warnings.push('Batas hari untuk keluhan ini belum ditetapkan di draf aturan v0.1 — dipakai batas konservatif 3 hari.');
    return finish(res, inp);
  }

  function finish(res, inp) {
    res.statusLabel = STATUS_LABEL[res.status];
    if (res.status !== 'SWAMEDIKASI') { res.meds = []; res.gated = []; res.excluded = []; } // Hard rule 2 & 3 (pengaman ganda)
    var dur = num(inp.durationDays);
    if (res.limitDays !== null && dur !== null) res.daysLeft = Math.max(0, res.limitDays - dur);
    res.summary = buildSummary(res, inp);
    return res;
  }

  function buildSummary(res, inp) {
    var R2 = R, mod = R2.MODULES[inp.module];
    var lab = function (list, ids) { return list.filter(function (x) { return has(ids, x.id); }).map(function (x) { return x.label; }); };
    var L = [];
    L.push('RINGKASAN PharmAI-Triage (untuk apoteker) — ' + R2.VERSION);
    L.push('Modul: ' + (mod ? mod.name : '-'));
    if (mod) L.push('Keluhan: ' + (lab(mod.symptoms, inp.symptoms || []).join(', ') || '-'));
    L.push('Usia: ' + (inp.ageYears || 0) + ' th ' + (inp.ageMonths || 0) + ' bln · BB: ' + (inp.weightKg || '-') + ' kg · Suhu: ' + (inp.tempC || '-') + ' °C · Lama: ' + (inp.durationDays === '' || inp.durationDays == null ? '-' : inp.durationDays) + ' hari');
    L.push('Hamil/menyusui: ' + (inp.pregnancy || '-'));
    L.push('Komorbid: ' + (lab(R2.COMORBIDITIES, inp.comorb || []).join(', ') || '-'));
    L.push('Obat saat ini: ' + (lab(R2.CURRENT_MEDS, inp.meds || []).join(', ') || '-'));
    L.push('Alergi: ' + (lab(R2.ALLERGIES, inp.allergies || []).concat(inp.allergyText ? [inp.allergyText] : []).join(', ') || '-'));
    if (mod) L.push('Tanda bahaya dicentang: ' + (lab(allFlags(mod.id), inp.redFlags || []).join(', ') || 'tidak ada'));
    if (inp.freeText) L.push('Cerita keluhan: "' + inp.freeText + '"');
    L.push('HASIL: ' + res.statusLabel);
    res.reasons.forEach(function (r) { L.push(' - [' + r.level + '] ' + r.text); });
    res.meds.forEach(function (m) { L.push(' + ' + m.name + ' (' + m.clsLabel + '): ' + m.dose.text); });
    res.gated.forEach(function (m) { L.push(' ? ' + m.name + ': ' + m.reason); });
    res.excluded.forEach(function (m) { L.push(' x ' + m.name + ': ' + m.reason); });
    L.push('Batas swamedikasi: ' + res.limitDays + ' hari.');
    return L.join('\n');
  }

  return { triage: triage, suggestFromText: suggestFromText, computeDose: computeDose, STATUS_LABEL: STATUS_LABEL, allFlags: allFlags };
});
