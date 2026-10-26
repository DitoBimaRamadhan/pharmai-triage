/*
 * PharmAI-Triage — Clinical Rules Data (draft v0.2-mvp)
 * ------------------------------------------------------------------
 * Data aturan klinis DETERMINISTIK. File ini adalah satu-satunya sumber
 * zat aktif yang boleh ditampilkan. LLM (jika nanti dipasang) TIDAK boleh
 * menambah/mengubah isi file ini; perubahan wajib lewat review apoteker.
 *
 * Basis:
 *  - Red flag & batas swamedikasi: "draft clinical rules v0.1" (Competition
 *    Paper PharmAI-Triage, bagian 4.3), yang merujuk Depkes RI (2006) Pedoman
 *    Penggunaan Obat Bebas dan Bebas Terbatas, WHO (2000), NICE NG143 (2019).
 *  - Golongan obat: koreksi reviewer di paper bagian 6.3. WAJIB diverifikasi
 *    per produk di https://cekbpom.pom.go.id/ (golongan mengikuti registrasi
 *    produk, bukan zat aktif saja).
 *  - Dosis: nilai lazim pada label produk OTC, BNF / BNF for Children,
 *    dan pedoman WHO untuk oralit. Lihat README.md bagian "Dasar dosis".
 *    Nilai ini BELUM disahkan apoteker tim — wajib sign-off sebelum pilot.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PharmRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 'rules-v0.2-mvp (draf, belum disahkan apoteker)';

  /* Golongan yang BOLEH disarankan swalayan. Obat keras / antibiotik tidak
     pernah ada di whitelist (Hard rule #1). */
  var SELF_SERVE_CLASSES = ['bebas', 'bebas_terbatas'];

  var CLASS_LABEL = {
    bebas: 'Obat Bebas',
    bebas_terbatas: 'Bebas Terbatas',
    per_produk: 'Golongan per produk',
    apoteker: 'Hanya via apoteker'
  };

  /* Ambang global */
  var GLOBAL = {
    infantReferMonths: 3,        // < 3 bulan -> selalu rujuk (paper 4.3)
    childMaxYears: 12,           // < 12 th -> dosis berbasis berat + konfirmasi apoteker
    elderlyYears: 65,            // >= 65 -> kehati-hatian OAINS/ginjal
    feverC: 37.5,                // ambang "demam" untuk deteksi
    highFeverC: 39,              // >= 39 °C -> red flag, rujuk dokter
    infantFeverC: 38,            // bayi < 3 bln dengan suhu >= 38 -> segera IGD (NICE NG143)
    hypothermiaC: 35,            // < 35 °C saat sakit -> rujuk dokter (konservatif)
    implausibleLowC: 30, implausibleHighC: 43.5
  };

  /* Tanda bahaya global (semua modul). level: IGD | DOKTER */
  var GLOBAL_RED_FLAGS = [
    { id: 'g_sadar', label: 'Penurunan kesadaran / sangat mengantuk, sulit dibangunkan', level: 'IGD', kw: ['pingsan', 'tidak sadar', 'sulit dibangunkan'] },
    { id: 'g_kejang', label: 'Kejang', level: 'IGD', kw: ['kejang', 'step'] },
    { id: 'g_dada', label: 'Nyeri dada', level: 'IGD', kw: ['nyeri dada', 'sakit dada', 'dada sakit', 'dada nyeri'] },
    { id: 'g_sesak', label: 'Sesak napas / sulit bernapas', level: 'IGD', kw: ['sesak', 'sulit bernapas', 'sulit bernafas', 'susah napas', 'susah nafas'] },
    { id: 'g_dehidrasi', label: 'Dehidrasi berat (sangat lemas, hampir tidak buang air kecil, mata cekung)', level: 'IGD', kw: ['mata cekung', 'tidak pipis', 'tidak kencing'] }
  ];

  /* Modul. symptoms: keluhan spesifik yang menentukan zat aktif kandidat.
     limitDays: batas swamedikasi sebelum rujuk (paper 4.3). Nilai yang
     tidak ada di paper ditandai 'assumed: true' dan dipakai batas konservatif. */
  var MODULES = {
    ispa: {
      id: 'ispa', name: 'Saluran Pernapasan / ISPA', icon: '🫁',
      desc: 'Flu, batuk (kering/berdahak), faringitis/serak',
      symptoms: [
        { id: 'demam', label: 'Demam', limitDays: 3, ingredients: ['paracetamol'] },
        { id: 'tenggorokan', label: 'Nyeri tenggorokan / serak', limitDays: 7, ingredients: ['paracetamol', 'lozenges'] },
        { id: 'batuk_dahak', label: 'Batuk berdahak', limitDays: 7, ingredients: ['guaifenesin'] },
        { id: 'batuk_kering', label: 'Batuk kering', limitDays: 7, ingredients: [] },
        { id: 'pilek', label: 'Pilek / hidung tersumbat', limitDays: 7, ingredients: [] }
      ],
      redFlags: [
        { id: 'r_mengi', label: 'Sesak atau napas berbunyi (mengi)', level: 'IGD', kw: ['mengi', 'ngik'] },
        { id: 'r_darah', label: 'Batuk berdarah', level: 'IGD', kw: ['batuk darah', 'batuk berdarah'] },
        { id: 'r_2minggu', label: 'Batuk sudah ≥ 2 minggu (perlu skrining TBC)', level: 'DOKTER', kw: ['2 minggu', 'dua minggu', 'sebulan'] },
        { id: 'r_biru', label: 'Bibir/ujung jari kebiruan', level: 'IGD', kw: ['kebiruan', 'bibir biru'] },
        { id: 'r_dada', label: 'Nyeri dada saat bernapas/batuk', level: 'IGD', kw: [] }
      ],
      nonPharm: ['💧 Minum air hangat yang cukup', '😴 Istirahat 7–8 jam', '🧂 Berkumur air garam hangat (bila bisa berkumur)', '🍯 Madu untuk batuk — JANGAN untuk bayi < 1 tahun', '😷 Pakai masker & cuci tangan']
    },
    cerna: {
      id: 'cerna', name: 'Pencernaan Ringan', icon: '🩺',
      desc: 'Maag/dispepsia, diare non-spesifik, mual, sembelit',
      symptoms: [
        { id: 'ulu_hati', label: 'Nyeri/perih ulu hati (maag/dispepsia)', limitDays: 3, ingredients: ['antasida'] },
        { id: 'kembung', label: 'Kembung / banyak gas', limitDays: 3, ingredients: ['simetikon'] },
        { id: 'diare', label: 'Diare (BAB cair)', limitDays: 2, ingredients: ['oralit'] },
        { id: 'mual', label: 'Mual ringan', limitDays: 3, assumed: true, ingredients: [] },
        { id: 'sembelit', label: 'Sembelit', limitDays: 3, assumed: true, ingredients: [] }
      ],
      redFlags: [
        { id: 'c_darah', label: 'BAB berdarah atau hitam seperti aspal', level: 'IGD', kw: ['bab darah', 'bab berdarah', 'feses hitam', 'bab hitam', 'muntah darah'] },
        { id: 'c_muntah', label: 'Muntah terus-menerus / tidak bisa menahan minum', level: 'IGD', kw: ['muntah terus'] },
        { id: 'c_dehidrasi', label: 'Tanda dehidrasi: jarang BAK, lemas, mata cekung', level: 'IGD', kw: [] },
        { id: 'c_nyeri_berat', label: 'Nyeri perut hebat atau terlokalisasi (mis. kanan bawah)', level: 'IGD', kw: ['nyeri perut hebat', 'sakit perut hebat', 'kanan bawah'] },
        { id: 'c_menelan', label: 'Sulit/nyeri menelan', level: 'DOKTER', kw: ['sulit menelan', 'susah menelan'] },
        { id: 'c_bb', label: 'Berat badan turun tanpa sebab', level: 'DOKTER', kw: ['berat badan turun'] },
        { id: 'c_demam_tinggi', label: 'Demam tinggi', level: 'DOKTER', kw: [] }
      ],
      nonPharm: ['🍚 Makan sedikit tapi sering', '🚫 Hindari kopi, alkohol, makanan pedas/asam/berlemak', '🛏️ Jangan langsung berbaring setelah makan', '💧 Cukupi cairan', '🥦 Sembelit: perbanyak serat, air & aktivitas fisik']
    },
    demam: {
      id: 'demam', name: 'Demam & Nyeri', icon: '🌡️',
      desc: 'Sakit kepala, demam ringan, nyeri otot (myalgia)',
      symptoms: [
        { id: 'demam', label: 'Demam', limitDays: 3, ingredients: ['paracetamol', 'ibuprofen'] },
        { id: 'sakit_kepala', label: 'Sakit kepala (tegang)', limitDays: 3, ingredients: ['paracetamol', 'ibuprofen'] },
        { id: 'nyeri_otot', label: 'Nyeri otot (myalgia)', limitDays: 3, ingredients: ['paracetamol', 'ibuprofen'] }
      ],
      redFlags: [
        { id: 'd_kaku', label: 'Leher kaku', level: 'IGD', kw: ['leher kaku', 'kaku kuduk'] },
        { id: 'd_bingung', label: 'Bingung / perilaku tidak biasa', level: 'IGD', kw: ['bingung', 'linglung'] },
        { id: 'd_ruam', label: 'Ruam bintik merah yang tidak hilang saat ditekan (petekie)', level: 'IGD', kw: ['bintik merah', 'petekie'] },
        { id: 'd_kepala', label: 'Sakit kepala mendadak & sangat hebat', level: 'IGD', kw: ['sakit kepala hebat', 'kepala sakit sekali'] },
        { id: 'd_dbd', label: 'Tanda bahaya DBD: gusi/hidung berdarah, nyeri perut, muntah terus', level: 'IGD', kw: ['mimisan', 'gusi berdarah'] }
      ],
      nonPharm: ['💧 Perbanyak minum', '🧊 Kompres air hangat (bukan air es/alkohol)', '👕 Pakaian tipis & ruangan sejuk', '😴 Istirahat cukup']
    },
    kulit: {
      id: 'kulit', name: 'Kulit Ringan', icon: '🧴',
      desc: 'Dermatitis kontak, gatal/biang keringat, alergi ringan',
      symptoms: [
        { id: 'dermatitis', label: 'Gatal/iritasi karena kontak (dermatitis kontak)', limitDays: 7, ingredients: ['kalamin', 'hidrokortison'] },
        { id: 'biang_keringat', label: 'Biang keringat', limitDays: 7, ingredients: ['kalamin'] },
        { id: 'alergi', label: 'Alergi ringan / gatal menyeluruh ringan', limitDays: 7, ingredients: ['cetirizin'] }
      ],
      redFlags: [
        { id: 'k_lepuh', label: 'Kulit melepuh', level: 'DOKTER', kw: ['melepuh', 'lepuh'] },
        { id: 'k_menyebar', label: 'Ruam menyebar cepat', level: 'DOKTER', kw: ['menyebar'] },
        { id: 'k_demam', label: 'Ruam disertai demam', level: 'DOKTER', kw: [] },
        { id: 'k_bengkak', label: 'Bengkak wajah/bibir atau sulit bernapas (curiga anafilaksis)', level: 'IGD', kw: ['bibir bengkak', 'wajah bengkak', 'mata bengkak'] },
        { id: 'k_infeksi', label: 'Tanda infeksi: bernanah, panas, makin nyeri', level: 'DOKTER', kw: ['nanah', 'bernanah'] },
        { id: 'k_area', label: 'Mengenai mata atau area kelamin', level: 'DOKTER', kw: ['kelamin'] }
      ],
      nonPharm: ['🚿 Bilas area dengan air mengalir, hentikan kontak pemicu', '✋ Jangan digaruk', '👕 Pakai bahan katun longgar', '❄️ Kompres dingin untuk gatal']
    }
  };

  /* Komorbid & obat yang sedang dipakai (profil keamanan, paper 4.3) */
  var COMORBIDITIES = [
    { id: 'hati', label: 'Penyakit hati / sering minum alkohol' },
    { id: 'ginjal', label: 'Penyakit ginjal' },
    { id: 'tukak', label: 'Tukak lambung / riwayat perdarahan saluran cerna' },
    { id: 'asma', label: 'Asma' },
    { id: 'jantung', label: 'Penyakit jantung / riwayat stroke' },
    { id: 'hipertensi', label: 'Hipertensi' },
    { id: 'diabetes', label: 'Diabetes' },
    { id: 'pembekuan', label: 'Gangguan pembekuan darah' }
  ];
  var CURRENT_MEDS = [
    { id: 'antikoagulan', label: 'Pengencer darah (mis. warfarin, aspirin, clopidogrel)' },
    { id: 'parasetamol_lain', label: 'Produk lain yang mengandung parasetamol (mis. obat flu kombinasi)' },
    { id: 'oains_lain', label: 'Obat antinyeri OAINS lain (mis. asam mefenamat, natrium diklofenak)' },
    { id: 'obat_rutin', label: 'Obat rutin lain (resep dokter)' }
  ];
  var ALLERGIES = [
    { id: 'alergi_parasetamol', label: 'Parasetamol' },
    { id: 'alergi_oains', label: 'Ibuprofen / aspirin / OAINS lain' }
  ];

  /* ------------------------------------------------------------------
   * ZAT AKTIF (whitelist). dosing.kind:
   *   'mgkg_or_adult' : mg/kg untuk anak/berat rendah, dosis dewasa bila memenuhi ambang
   *   'age_band'      : dosis tetap per pita usia (label OTC)
   *   'label'         : ikuti label produk (tidak ada angka mg yang distandarkan lintas produk)
   *   'ors'           : volume oralit per BAB cair (WHO)
   *   gated: true     : hanya melalui apoteker — TIDAK pernah ditampilkan dengan dosis
   * ------------------------------------------------------------------ */
  var INGREDIENTS = {
    paracetamol: {
      name: 'Parasetamol', cls: 'bebas', use: 'Demam & nyeri',
      minAgeMonths: 3,
      dosing: {
        kind: 'mgkg_or_adult',
        // Anak / berat < 50 kg: 10–15 mg/kg per dosis tiap 4–6 jam, maks 60 mg/kg/hari
        // (BNFc; nilai konservatif, di bawah batas atas 75 mg/kg/hari), tidak melebihi dosis dewasa.
        mgkgLo: 10, mgkgHi: 15, maxMgkgDay: 60, interval: 'tiap 4–6 jam', maxDosesDay: 4,
        // Dewasa (>= 12 th DAN >= 50 kg): 500–1000 mg tiap 4–6 jam, maks 4 g/hari (label, BNF).
        adultMinAge: 12, adultMinKg: 50, adultLo: 500, adultHi: 1000, adultMaxDay: 4000,
        capDoseMg: 1000
      },
      notes: ['Jangan dobel dengan produk kombinasi lain yang mengandung parasetamol.']
    },
    ibuprofen: {
      name: 'Ibuprofen 200 mg', cls: 'bebas_terbatas', use: 'Nyeri/demam — diminum setelah makan',
      minAgeMonths: 6,
      dosing: {
        kind: 'mgkg_or_adult',
        // Anak / berat < 40 kg: 5–10 mg/kg tiap 6–8 jam, maks 30 mg/kg/hari (BNFc), dibatasi dosis OTC dewasa.
        mgkgLo: 5, mgkgHi: 10, maxMgkgDay: 30, interval: 'tiap 6–8 jam', maxDosesDay: 3,
        // Dewasa (>= 12 th DAN >= 40 kg): 200–400 mg tiap 6–8 jam, maks 1200 mg/hari (batas OTC pada label).
        adultMinAge: 12, adultMinKg: 40, adultLo: 200, adultHi: 400, adultMaxDay: 1200,
        capDoseMg: 400
      },
      notes: ['Minum setelah makan. Hentikan bila nyeri lambung, BAB hitam, atau sesak.']
    },
    guaifenesin: {
      name: 'Guaifenesin', cls: 'bebas', use: 'Pengencer dahak (batuk berdahak)',
      minAgeMonths: 72, // < 6 th: tidak disarankan swamedikasi -> apoteker
      dosing: {
        kind: 'age_band',
        // Label OTC (US OTC monograph): 6–<12 th 100–200 mg tiap 4 jam maks 1,2 g/hari;
        // >= 12 th 200–400 mg tiap 4 jam maks 2,4 g/hari.
        bands: [
          { minM: 72, maxM: 144, text: '100–200 mg tiap 4 jam, maks 1.200 mg/hari' },
          { minM: 144, maxM: 99999, text: '200–400 mg tiap 4 jam, maks 2.400 mg/hari' }
        ]
      },
      notes: ['Minum banyak air. Banyak sirup berisi gula — perhatikan bila diabetes.', 'Hindari produk kombinasi yang juga berisi parasetamol bila sudah minum parasetamol.']
    },
    lozenges: {
      name: 'Tablet hisap antiseptik', cls: 'per_produk', use: 'Nyeri menelan ringan',
      minAgeMonths: 72, // risiko tersedak < 6 th
      dosing: { kind: 'label', text: 'Ikuti dosis & interval pada label produk.' },
      notes: ['Golongan berbeda antar produk — cek label (logo hijau/biru) & cekbpom.']
    },
    antasida: {
      name: 'Antasida (Al(OH)₃ + Mg(OH)₂)', cls: 'bebas', use: 'Nyeri/perih ulu hati',
      minAgeMonths: 144, // < 12 th -> apoteker
      blockIf: { comorb: { ginjal: 'Penyakit ginjal: aluminium/magnesium dapat menumpuk' } },
      dosing: {
        kind: 'label',
        // Pedoman Depkes 2006 & label produk: umumnya 1–2 tablet kunyah atau 5–10 mL suspensi,
        // 3–4 kali sehari, 1 jam setelah makan dan sebelum tidur. Ikuti label produk.
        text: 'Umumnya 1–2 tablet kunyah atau 5–10 mL suspensi, 3–4×/hari (1 jam setelah makan & sebelum tidur). Ikuti label produk.'
      },
      notes: ['Beri jarak ± 2 jam dengan obat lain (dapat mengganggu penyerapan).']
    },
    simetikon: {
      name: 'Simetikon', cls: 'per_produk', use: 'Kembung',
      minAgeMonths: 144,
      dosing: {
        kind: 'age_band',
        // Label OTC dewasa: 40–125 mg setelah makan & sebelum tidur, maks 500 mg/hari.
        bands: [{ minM: 144, maxM: 99999, text: '40–125 mg setelah makan & sebelum tidur, maks 500 mg/hari' }]
      },
      notes: ['Sering dikombinasi dengan antasida — cek komposisi agar tidak dobel.']
    },
    oralit: {
      name: 'Oralit', cls: 'bebas', use: 'Mengganti cairan saat diare (cegah dehidrasi)',
      minAgeMonths: 3,
      dosing: {
        kind: 'ors',
        // WHO (penanganan diare): setiap kali BAB cair — < 2 th 50–100 mL; 2–<10 th 100–200 mL;
        // >= 10 th sebanyak yang diinginkan (± 200–400 mL).
        bands: [
          { minM: 0, maxM: 24, text: '50–100 mL setiap kali BAB cair' },
          { minM: 24, maxM: 120, text: '100–200 mL setiap kali BAB cair' },
          { minM: 120, maxM: 99999, text: 'Sebanyak yang diinginkan (± 200–400 mL) setiap kali BAB cair' }
        ]
      },
      notes: ['Larutkan sesuai petunjuk kemasan dengan air matang; buang sisa setelah 24 jam.', 'Anak dengan diare: tanyakan apoteker/tenaga kesehatan soal zinc.']
    },
    kalamin: {
      name: 'Kalamin losion', cls: 'bebas', use: 'Gatal & iritasi ringan (pemakaian luar)',
      minAgeMonths: 3,
      dosing: { kind: 'label', text: 'Oleskan tipis pada area gatal sesuai petunjuk label. Hanya untuk pemakaian luar; hindari mata & luka terbuka.' },
      notes: []
    },
    /* --- Pharmacist-gated (koreksi paper 6.3): tidak pernah swalayan, tanpa dosis --- */
    cetirizin: {
      name: 'Cetirizin (antihistamin oral)', cls: 'apoteker', gated: true, use: 'Alergi ringan',
      notes: ['Umumnya produk resep/OWA di Indonesia — hanya setelah konsultasi apoteker.']
    },
    hidrokortison: {
      name: 'Krim hidrokortison 1%', cls: 'apoteker', gated: true, use: 'Peradangan kulit ringan',
      notes: ['Umumnya produk resep/OWA di Indonesia — hanya setelah konsultasi apoteker.']
    }
  };

  /* Kata kunci sederhana untuk menyarankan modul dari teks bebas.
     >>> Titik integrasi LLM: ganti suggestFromText() di engine.js dengan layanan
     anamnesis LLM (OLDARTS -> JSON terstruktur). Rules engine tetap pemutus akhir. */
  var KEYWORDS = {
    ispa: ['batuk', 'pilek', 'flu', 'tenggorok', 'serak', 'hidung', 'ingus', 'dahak', 'bersin', 'radang'],
    cerna: ['maag', 'lambung', 'ulu hati', 'perut', 'mual', 'diare', 'mencret', 'kembung', 'sembelit', 'susah bab', 'begah', 'perih', 'asam lambung', 'gerd'],
    demam: ['demam', 'panas', 'meriang', 'pusing', 'sakit kepala', 'nyeri otot', 'pegal', 'linu', 'nyeri'],
    kulit: ['gatal', 'ruam', 'kulit', 'biang keringat', 'bentol', 'kemerahan', 'alergi', 'biduran', 'eksim']
  };
  var SYMPTOM_KEYWORDS = {
    'ispa.demam': ['demam', 'panas', 'meriang'], 'ispa.tenggorokan': ['tenggorok', 'serak', 'nyeri menelan'],
    'ispa.batuk_dahak': ['berdahak', 'dahak'], 'ispa.batuk_kering': ['batuk kering'], 'ispa.pilek': ['pilek', 'hidung tersumbat', 'ingus', 'flu'],
    'cerna.ulu_hati': ['maag', 'ulu hati', 'perih', 'asam lambung', 'gerd', 'lambung'], 'cerna.kembung': ['kembung', 'begah', 'gas'],
    'cerna.diare': ['diare', 'mencret', 'bab cair'], 'cerna.mual': ['mual'], 'cerna.sembelit': ['sembelit', 'susah bab', 'konstipasi'],
    'demam.demam': ['demam', 'panas', 'meriang'], 'demam.sakit_kepala': ['sakit kepala', 'pusing'], 'demam.nyeri_otot': ['nyeri otot', 'pegal', 'linu'],
    'kulit.dermatitis': ['gatal', 'iritasi', 'kontak'], 'kulit.biang_keringat': ['biang keringat'], 'kulit.alergi': ['alergi', 'biduran', 'bentol']
  };
  var FORBIDDEN_KEYWORDS = ['antibiotik', 'amoksisilin', 'amoxicillin', 'ampisilin', 'ciprofloxacin', 'siprofloksasin', 'cefadroxil', 'sefadroksil', 'azitromisin', 'tetrasiklin', 'metronidazol', 'deksametason', 'dexamethasone', 'prednison'];

  return {
    VERSION: VERSION, SELF_SERVE_CLASSES: SELF_SERVE_CLASSES, CLASS_LABEL: CLASS_LABEL,
    GLOBAL: GLOBAL, GLOBAL_RED_FLAGS: GLOBAL_RED_FLAGS, MODULES: MODULES,
    COMORBIDITIES: COMORBIDITIES, CURRENT_MEDS: CURRENT_MEDS, ALLERGIES: ALLERGIES,
    INGREDIENTS: INGREDIENTS, KEYWORDS: KEYWORDS, SYMPTOM_KEYWORDS: SYMPTOM_KEYWORDS,
    FORBIDDEN_KEYWORDS: FORBIDDEN_KEYWORDS
  };
});
