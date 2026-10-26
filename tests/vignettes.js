/* Vinyet klinis untuk menguji rules engine. Dipakai oleh run-tests.js (Node) dan tests.html (browser). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PharmVignettes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var base = function (o) {
    var b = { module: 'demam', symptoms: ['demam'], ageYears: 25, ageMonths: 0, weightKg: 60, tempC: 38.2, durationDays: 1,
      pregnancy: 'tidak', comorb: [], meds: [], allergies: [], allergyText: '', redFlags: [], dengueSuspect: false, freeText: '' };
    for (var k in o) b[k] = o[k];
    return b;
  };
  var ids = function (r) { return r.meds.map(function (m) { return m.id; }); };
  var med = function (r, id) { return r.meds.filter(function (m) { return m.id === id; })[0]; };
  var noMeds = function (r) { return r.meds.length === 0 && r.gated.length === 0; };
  var V = [];
  function t(name, input, check) { V.push({ name: name, input: input, check: check }); }

  // --- Red flag menghapus semua obat ---
  t('1. Dewasa demam 38,2 °C tanpa red flag -> swamedikasi parasetamol + ibuprofen dosis dewasa', base({}),
    function (r) { return r.status === 'SWAMEDIKASI' && ids(r).indexOf('paracetamol') > -1 && med(r, 'paracetamol').dose.mode === 'dewasa' && ids(r).indexOf('ibuprofen') > -1; });
  t('2. Suhu 39,0 °C -> rujuk dokter, tanpa obat', base({ tempC: 39 }),
    function (r) { return r.status === 'DOKTER' && noMeds(r); });
  t('3. Demam + kejang -> IGD, tanpa obat', base({ redFlags: ['g_kejang'] }),
    function (r) { return r.status === 'IGD' && noMeds(r); });
  t('4. Demam 4 hari (> batas 3 hari) -> dokter, tanpa obat', base({ durationDays: 4 }),
    function (r) { return r.status === 'DOKTER' && noMeds(r) && r.limitDays === 3; });
  t('5. ISPA batuk berdahak + batuk berdarah -> IGD, tanpa obat', base({ module: 'ispa', symptoms: ['batuk_dahak'], tempC: '', redFlags: ['r_darah'] }),
    function (r) { return r.status === 'IGD' && noMeds(r); });
  t('6. ISPA batuk 15 hari -> dokter (skrining TBC)', base({ module: 'ispa', symptoms: ['batuk_dahak'], tempC: '', durationDays: 15 }),
    function (r) { return r.status === 'DOKTER' && noMeds(r) && r.reasons.some(function (x) { return /TBC/.test(x.text); }); });
  t('7. Pencernaan: BAB hitam -> IGD, tanpa obat', base({ module: 'cerna', symptoms: ['ulu_hati'], tempC: '', redFlags: ['c_darah'] }),
    function (r) { return r.status === 'IGD' && noMeds(r); });
  t('8. Kulit: bibir bengkak (anafilaksis) -> IGD', base({ module: 'kulit', symptoms: ['alergi'], tempC: '', redFlags: ['k_bengkak'] }),
    function (r) { return r.status === 'IGD' && noMeds(r); });
  t('9. Kulit: ruam + demam 37,9 °C -> dokter', base({ module: 'kulit', symptoms: ['dermatitis'], tempC: 37.9 }),
    function (r) { return r.status === 'DOKTER' && noMeds(r); });

  // --- Bayi ---
  t('10. Bayi 2 bulan demam 38,1 °C -> IGD, tanpa obat', base({ ageYears: 0, ageMonths: 2, weightKg: 5, tempC: 38.1 }),
    function (r) { return r.status === 'IGD' && noMeds(r); });
  t('11. Bayi 1 bulan kulit biang keringat tanpa demam -> tetap rujuk dokter', base({ module: 'kulit', symptoms: ['biang_keringat'], ageYears: 0, ageMonths: 1, weightKg: 4, tempC: '' }),
    function (r) { return r.status === 'DOKTER' && noMeds(r); });
  t('12. Bayi 4 bulan 6 kg demam 38,0 -> parasetamol mg/kg, ibuprofen TIDAK (< 6 bln), perlu konfirmasi apoteker', base({ ageYears: 0, ageMonths: 4, weightKg: 6, tempC: 38 }),
    function (r) { var p = med(r, 'paracetamol'); return r.status === 'SWAMEDIKASI' && p && p.dose.perDoseLo === 60 && p.dose.perDoseHi === 90 && ids(r).indexOf('ibuprofen') === -1 && r.needsPharmacistConfirm; });

  // --- Dosis berbasis berat ---
  t('13. Remaja 13 th 30 kg -> parasetamol 300–450 mg (mg/kg), BUKAN 500–1000 mg', base({ ageYears: 13, weightKg: 30 }),
    function (r) { var p = med(r, 'paracetamol'); return p && p.dose.mode === 'berat' && p.dose.perDoseHi === 450 && p.dose.maxDayMg === 1800; });
  t('14. Remaja 13 th 30 kg -> ibuprofen 150–300 mg, maks 900 mg/hari', base({ ageYears: 13, weightKg: 30 }),
    function (r) { var i = med(r, 'ibuprofen'); return i && i.dose.mode === 'berat' && i.dose.perDoseLo === 150 && i.dose.perDoseHi === 300 && i.dose.maxDayMg === 900; });
  t('15. Dewasa 20 th 45 kg (berat rendah) -> parasetamol maks 2.700 mg/hari (bukan 4 g)', base({ ageYears: 20, weightKg: 45 }),
    function (r) { var p = med(r, 'paracetamol'); return p && p.dose.mode === 'berat' && p.dose.maxDayMg === 2700 && p.dose.perDoseHi <= 675; });
  t('16. Anak 10 th 80 kg -> dosis per dosis tidak melebihi 1000 mg / 400 mg', base({ ageYears: 10, weightKg: 80 }),
    function (r) { return med(r, 'paracetamol').dose.perDoseHi <= 1000 && med(r, 'ibuprofen').dose.perDoseHi <= 400 && med(r, 'paracetamol').dose.maxDayMg <= 4000; });

  // --- Kontraindikasi ibuprofen ---
  t('17. Tukak lambung -> ibuprofen diblok, parasetamol tetap', base({ comorb: ['tukak'] }),
    function (r) { return ids(r).indexOf('ibuprofen') === -1 && r.excluded.some(function (e) { return e.id === 'ibuprofen'; }) && ids(r).indexOf('paracetamol') > -1; });
  t('18. Hamil -> ke apoteker, tidak ada ibuprofen (dan tidak ada obat swalayan)', base({ pregnancy: 'hamil' }),
    function (r) { return r.status === 'APOTEKER' && ids(r).indexOf('ibuprofen') === -1 && noMeds(r); });
  t('19. Curiga DBD -> ibuprofen diblok', base({ dengueSuspect: true }),
    function (r) { return ids(r).indexOf('ibuprofen') === -1 && r.excluded.some(function (e) { return e.id === 'ibuprofen' && /DBD/.test(e.reason); }); });
  t('20. Pengencer darah -> ibuprofen diblok', base({ meds: ['antikoagulan'] }),
    function (r) { return ids(r).indexOf('ibuprofen') === -1; });
  t('21. Asma -> ibuprofen hanya via apoteker (tanpa dosis)', base({ comorb: ['asma'] }),
    function (r) { return ids(r).indexOf('ibuprofen') === -1 && r.gated.some(function (g) { return g.id === 'ibuprofen'; }); });
  t('22. Penyakit hati -> parasetamol via apoteker (bukan dosis 4 g)', base({ comorb: ['hati'] }),
    function (r) { return ids(r).indexOf('paracetamol') === -1 && r.gated.some(function (g) { return g.id === 'paracetamol'; }); });
  t('23. Sudah minum obat flu berisi parasetamol -> parasetamol tidak disarankan (dobel)', base({ meds: ['parasetamol_lain'] }),
    function (r) { return ids(r).indexOf('paracetamol') === -1; });
  t('24. Alergi OAINS -> ibuprofen diblok', base({ allergies: ['alergi_oains'] }),
    function (r) { return ids(r).indexOf('ibuprofen') === -1; });

  // --- Pencernaan ---
  t('25. Dispepsia saja -> antasida; TIDAK ada oralit & parasetamol', base({ module: 'cerna', symptoms: ['ulu_hati'], tempC: '' }),
    function (r) { return r.status === 'SWAMEDIKASI' && ids(r).indexOf('antasida') > -1 && ids(r).indexOf('oralit') === -1 && ids(r).indexOf('paracetamol') === -1; });
  t('26. Antasida berlabel Obat Bebas (koreksi 6.3)', base({ module: 'cerna', symptoms: ['ulu_hati'], tempC: '' }),
    function (r) { return med(r, 'antasida').cls === 'bebas'; });
  t('27. Diare 1 hari -> oralit sesuai usia', base({ module: 'cerna', symptoms: ['diare'], tempC: '' }),
    function (r) { return ids(r).indexOf('oralit') > -1 && /200–400/.test(med(r, 'oralit').dose.text); });
  t('28. Diare 3 hari (> batas 2 hari) -> dokter', base({ module: 'cerna', symptoms: ['diare'], tempC: '', durationDays: 3 }),
    function (r) { return r.status === 'DOKTER' && noMeds(r); });
  t('29. Penyakit ginjal + maag -> antasida via apoteker', base({ module: 'cerna', symptoms: ['ulu_hati'], tempC: '', comorb: ['ginjal'] }),
    function (r) { return ids(r).indexOf('antasida') === -1 && r.gated.some(function (g) { return g.id === 'antasida'; }); });

  // --- ISPA / kulit / golongan ---
  t('30. Guaifenesin = Obat Bebas, dosis ≥ 12 th', base({ module: 'ispa', symptoms: ['batuk_dahak'], tempC: '' }),
    function (r) { var g = med(r, 'guaifenesin'); return g && g.cls === 'bebas' && /200–400 mg/.test(g.dose.text); });
  t('31. Anak 4 th batuk berdahak -> guaifenesin tidak swalayan (via apoteker)', base({ module: 'ispa', symptoms: ['batuk_dahak'], tempC: '', ageYears: 4, weightKg: 16 }),
    function (r) { return ids(r).indexOf('guaifenesin') === -1 && r.gated.some(function (g) { return g.id === 'guaifenesin'; }); });
  t('32. Alergi ringan -> cetirizin hanya via apoteker, tidak pernah dengan dosis', base({ module: 'kulit', symptoms: ['alergi'], tempC: '' }),
    function (r) { return ids(r).indexOf('cetirizin') === -1 && r.gated.some(function (g) { return g.id === 'cetirizin'; }); });
  t('33. Dermatitis -> kalamin swalayan, hidrokortison via apoteker', base({ module: 'kulit', symptoms: ['dermatitis'], tempC: '' }),
    function (r) { return ids(r).indexOf('kalamin') > -1 && ids(r).indexOf('hidrokortison') === -1 && r.gated.some(function (g) { return g.id === 'hidrokortison'; }); });

  // --- Data ragu -> apoteker ---
  t('34. Berat badan kosong -> apoteker, tanpa obat', base({ weightKg: '' }),
    function (r) { return r.status === 'APOTEKER' && noMeds(r); });
  t('35. Demam tetapi suhu tidak diukur -> apoteker', base({ tempC: '' }),
    function (r) { return r.status === 'APOTEKER' && noMeds(r); });
  t('36. Kehamilan "tidak yakin" -> apoteker', base({ pregnancy: 'tidak_yakin' }),
    function (r) { return r.status === 'APOTEKER' && noMeds(r); });
  t('37. Teks menyebut "sesak" tanpa dicentang -> apoteker, tanpa obat', base({ freeText: 'demam dan agak sesak' }),
    function (r) { return r.status === 'APOTEKER' && noMeds(r); });
  t('38. Minta antibiotik -> peringatan, tidak ada antibiotik di hasil', base({ freeText: 'demam, mau amoksisilin' }),
    function (r) { return r.warnings.some(function (w) { return /Antibiotik/.test(w); }) && r.meds.every(function (m) { return ['bebas', 'bebas_terbatas', 'per_produk'].indexOf(m.cls) > -1; }); });

  // --- Hard rule 4 & saran teks ---
  t('39. Setiap hasil menampilkan batas hari swamedikasi (juga saat rujuk)', base({ tempC: 40 }),
    function (r) { return typeof r.limitDays === 'number' && r.limitDays > 0; });
  return { V: V, base: base };
});
