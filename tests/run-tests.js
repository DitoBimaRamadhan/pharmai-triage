#!/usr/bin/env node
/* Jalankan: node tests/run-tests.js */
var R = require('../js/rules.js');
var E = require('../js/engine.js');
var vig = require('./vignettes.js');
var pass = 0, fail = 0;
function report(name, ok, extra) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n      ' + (extra || '')));
}
vig.V.forEach(function (v) {
  if (!v.input) return;
  var r = E.triage(v.input), ok = false;
  try { ok = !!v.check(r); } catch (e) { ok = false; }
  report(v.name, ok, JSON.stringify({ status: r.status, reasons: r.reasons, meds: r.meds.map(function (m) { return [m.id, m.dose.text]; }), gated: r.gated.map(function (g) { return g.id; }), excluded: r.excluded.map(function (g) { return g.id; }) }));
});
// Saran modul dari teks (kata kunci)
var s1 = E.suggestFromText('Maag saya kambuh, perih di ulu hati sejak kemarin');
report('40. Teks "maag... ulu hati" -> modul cerna + keluhan ulu_hati', s1.module === 'cerna' && s1.symptoms.indexOf('ulu_hati') > -1, JSON.stringify(s1));
var s2 = E.suggestFromText('batuk berdahak dan tenggorokan gatal');
report('41. Teks "batuk berdahak, tenggorokan" -> modul ispa + batuk_dahak', s2.module === 'ispa' && s2.symptoms.indexOf('batuk_dahak') > -1, JSON.stringify(s2));
var s3 = E.suggestFromText('anak saya demam lalu kejang');
report('42. Teks "kejang" -> red flag g_kejang terdeteksi', s3.redFlags.indexOf('g_kejang') > -1, JSON.stringify(s3));
// Invarian whitelist: tidak ada zat bergolongan selain bebas/bebas terbatas/per produk yang punya dosis
var bad = Object.keys(R.INGREDIENTS).filter(function (k) { var i = R.INGREDIENTS[k]; return i.dosing && ['bebas', 'bebas_terbatas', 'per_produk'].indexOf(i.cls) === -1; });
report('43. Invarian: whitelist berdosis hanya obat bebas/bebas terbatas', bad.length === 0, bad.join(','));
var gated = ['cetirizin', 'hidrokortison'].every(function (k) { return R.INGREDIENTS[k].gated && !R.INGREDIENTS[k].dosing; });
report('44. Invarian: cetirizin & hidrokortison gated tanpa dosis', gated);
var abx = Object.keys(R.INGREDIENTS).filter(function (k) { return R.FORBIDDEN_KEYWORDS.some(function (f) { return R.INGREDIENTS[k].name.toLowerCase().indexOf(f) > -1; }); });
report('45. Invarian: tidak ada antibiotik/kortikosteroid sistemik di whitelist', abx.length === 0, abx.join(','));
// Fuzz: red flag apa pun selalu menghapus obat di semua modul
var fuzzOk = true;
Object.keys(R.MODULES).forEach(function (m) {
  E.allFlags(m).forEach(function (f) {
    var r = E.triage(vig.base({ module: m, symptoms: [R.MODULES[m].symptoms[0].id], tempC: 37, redFlags: [f.id] }));
    if (r.meds.length || r.gated.length || r.status === 'SWAMEDIKASI' || r.status === 'APOTEKER') { fuzzOk = false; console.log('   fuzz gagal', m, f.id, r.status); }
  });
});
report('46. Fuzz: setiap red flag di setiap modul -> rujuk & tanpa obat', fuzzOk);
console.log('\nHasil: ' + pass + ' lulus, ' + fail + ' gagal (total ' + (pass + fail) + ')');
process.exit(fail ? 1 : 0);
