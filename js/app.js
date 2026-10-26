/* PharmAI-Triage MVP — lapisan UI. Semua keputusan klinis ada di engine.js. */
(function () {
  'use strict';
  var R = window.PharmRules, E = window.PharmEngine;
  var $ = function (id) { return document.getElementById(id); };
  var cur = null;

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'cls') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function checkbox(name, item, isFlag) {
    var input = el('input', { type: 'checkbox', name: name, value: item.id });
    var label = el('span', null, [item.label]);
    if (item.level) label.appendChild(el('i', { cls: 'lvl ' + item.level, text: item.level === 'IGD' ? 'IGD' : 'Dokter' }));
    return el('label', { cls: 'chk' + (isFlag ? ' flag' : '') }, [input, label]);
  }
  function checked(name) {
    return Array.prototype.slice.call(document.querySelectorAll('input[name="' + name + '"]:checked')).map(function (i) { return i.value; });
  }
  function setChecked(name, ids) {
    document.querySelectorAll('input[name="' + name + '"]').forEach(function (i) { if (ids.indexOf(i.value) > -1) i.checked = true; });
  }

  /* ---------- Render statis ---------- */
  $('engineVer').textContent = 'Rules Engine siap · v0.2';
  $('rulesVer').textContent = R.VERSION;

  var modGrid = $('mods'), cIdx = { ispa: 'c1', cerna: 'c2', demam: 'c3', kulit: 'c4' };
  Object.keys(R.MODULES).forEach(function (k) {
    var m = R.MODULES[k];
    var b = el('button', { cls: 'mod ' + cIdx[k], type: 'button', 'data-k': k, 'aria-pressed': 'false' },
      [el('div', { cls: 'ico', text: m.icon }), el('b', { text: m.name }), el('small', { text: m.desc })]);
    b.onclick = function () { selectModule(k); };
    modGrid.appendChild(b);
  });
  R.COMORBIDITIES.forEach(function (c) { $('comorbList').appendChild(checkbox('comorb', c)); });
  R.CURRENT_MEDS.forEach(function (c) { $('medList').appendChild(checkbox('meds', c)); });
  R.ALLERGIES.forEach(function (c) { $('allergyList').appendChild(checkbox('allergies', c)); });
  R.GLOBAL_RED_FLAGS.forEach(function (f) { $('emerList').appendChild(el('li', { text: f.label })); });
  ['Bengkak wajah/bibir atau sulit bernapas setelah obat/makanan', 'BAB hitam/berdarah, muntah darah', 'Leher kaku, bintik merah yang tidak hilang saat ditekan', 'Bibir kebiruan'].forEach(function (t) { $('emerList').appendChild(el('li', { text: t })); });

  function renderFlags(modId) {
    var prev = checked('flags');
    var box = $('flagList'); box.innerHTML = '';
    box.appendChild(el('div', { cls: 'grp', text: 'Tanda bahaya umum' }));
    R.GLOBAL_RED_FLAGS.forEach(function (f) { box.appendChild(checkbox('flags', f, true)); });
    if (modId) {
      box.appendChild(el('div', { cls: 'grp', text: 'Tanda bahaya ' + R.MODULES[modId].name }));
      R.MODULES[modId].redFlags.forEach(function (f) { box.appendChild(checkbox('flags', f, true)); });
    }
    setChecked('flags', prev);
  }
  renderFlags(null);

  function selectModule(k) {
    cur = k;
    document.querySelectorAll('.mod').forEach(function (m) { m.setAttribute('aria-pressed', String(m.dataset.k === k)); });
    var list = $('symList'); list.innerHTML = '';
    R.MODULES[k].symptoms.forEach(function (s) { list.appendChild(checkbox('sym', s)); });
    $('symCard').hidden = false;
    $('dbdWrap').hidden = k !== 'demam';
    renderFlags(k);
  }

  /* ---------- Daftar obat ---------- */
  Object.keys(R.INGREDIENTS).forEach(function (k) {
    var i = R.INGREDIENTS[k];
    $('obatList').appendChild(drugRow(i.name, i.use + (i.notes && i.notes.length ? ' · ' + i.notes[0] : ''), i.cls));
  });

  function drugRow(name, sub, cls, extra) {
    var logo = { bebas: 'logo', bebas_terbatas: 'logo blue', per_produk: 'logo grey', apoteker: 'logo amber', x: 'logo x' }[cls] || 'logo grey';
    var tag = { bebas: 'tag', bebas_terbatas: 'tag b', per_produk: 'tag g', apoteker: 'tag a', x: 'tag a' }[cls] || 'tag g';
    var tagText = cls === 'x' ? 'Tidak disarankan' : R.CLASS_LABEL[cls];
    var body = el('div', null, [el('b', { text: name }), el('small', { text: sub })]);
    (extra || []).forEach(function (e) { body.appendChild(e); });
    return el('div', { cls: 'drug' }, [el('i', { cls: logo, 'aria-hidden': 'true' }), body, el('span', { cls: tag, text: tagText })]);
  }

  /* ---------- Saran dari teks (kata kunci) ---------- */
  $('chatTile').onclick = function () { $('freeText').focus(); };
  $('suggestBtn').onclick = function () {
    var s = E.suggestFromText($('freeText').value), out = $('suggestOut');
    out.style.display = 'block'; out.innerHTML = '';
    if (!s.module) { out.textContent = 'Tidak ada kata kunci yang dikenali. Silakan pilih modul secara manual.'; return; }
    selectModule(s.module);
    setChecked('sym', s.symptoms);
    if (s.redFlags.length) { renderFlags(s.module); setChecked('flags', s.redFlags); }
    out.appendChild(document.createTextNode('Saran (kata kunci): modul "' + R.MODULES[s.module].name + '"' +
      (s.symptoms.length ? ', keluhan dicentang otomatis' : '') + '. Periksa & ubah bila tidak sesuai.'));
    if (s.redFlags.length) out.appendChild(el('div', { style: 'color:#E5384B;font-weight:700;margin-top:4px', text: '⚠️ Teks menyebut kemungkinan tanda bahaya — sudah dicentang di langkah 3. Hapus centang hanya jika memang tidak ada.' }));
    if (s.forbidden.length) out.appendChild(el('div', { style: 'margin-top:4px', text: 'ℹ️ Antibiotik/obat keras hanya dengan resep dokter dan tidak akan disarankan.' }));
  };

  /* ---------- Analisis ---------- */
  function collect() {
    return {
      module: cur, symptoms: checked('sym'), ageYears: $('ageY').value, ageMonths: $('ageM').value || 0,
      weightKg: $('bb').value, tempC: $('suhu').value, durationDays: $('durasi') ? $('durasi').value : '',
      pregnancy: $('preg').value, comorb: checked('comorb'), meds: checked('meds'), allergies: checked('allergies'),
      allergyText: $('allergyText').value.trim(), redFlags: checked('flags'), dengueSuspect: $('dbd').checked,
      freeText: $('freeText').value.trim()
    };
  }
  function togglePreg() { var y = parseFloat($('ageY').value); $('pregWrap').hidden = !(y >= 10); if ($('pregWrap').hidden) $('preg').value = ''; }
  $('ageY').addEventListener('input', togglePreg); togglePreg();

  $('runBtn').onclick = function () {
    var inp = collect(), err = $('formErr');
    err.style.display = 'none';
    if (!cur) { err.textContent = 'Pilih modul keluhan dulu (langkah 1).'; err.style.display = 'block'; $('mods').scrollIntoView({ behavior: 'smooth' }); return; }
    render(E.triage(inp));
  };

  function render(r) {
    var box = $('result'); box.innerHTML = ''; box.hidden = false;
    var icon = { SWAMEDIKASI: '✅', APOTEKER: '🧑‍⚕️', DOKTER: '⚠️', IGD: '🚨' }[r.status];
    var st = el('div', { cls: 'status ' + r.status }, [el('span', { cls: 'big', 'aria-hidden': 'true', text: icon }),
      el('div', null, [el('small', { text: 'Indikasi awal · ' + (r.moduleName || '') }), el('b', { text: r.statusLabel })])]);
    box.appendChild(st);
    if (r.reasons.length) {
      var ul = el('ul', { cls: 'reasons' });
      r.reasons.forEach(function (x) { ul.appendChild(el('li', { text: x.text })); });
      box.appendChild(ul);
    }
    if (r.status === 'IGD') box.appendChild(el('p', { cls: 'warn', text: 'Jangan menunggu. Hubungi 119 / 112 atau segera ke IGD terdekat. Tidak ada saran obat yang ditampilkan.' }));
    if (r.status === 'DOKTER') box.appendChild(el('p', { cls: 'warn', text: 'Semua saran obat dihentikan. Periksakan ke dokter atau Puskesmas.' }));
    if (r.status === 'APOTEKER') box.appendChild(el('p', { cls: 'warn', text: 'Belum aman memberi saran obat swalayan. Tunjukkan ringkasan di bawah ke apoteker.' }));

    // Hard rule 4: batas swamedikasi selalu tampil
    var lim = el('div', { cls: 'limit' }, [
      el('span', null, ['Batas swamedikasi', el('br'), el('small', { cls: 'hint', text: r.daysLeft !== null ? 'Sisa ± ' + r.daysLeft + ' hari dari lama keluhan yang diisi' : 'Dihitung dari awal keluhan' })]),
      el('b', { text: r.limitDays + ' hari' })]);
    box.appendChild(lim);
    box.appendChild(el('p', { cls: 'hint', style: 'margin-top:4px', text: 'Bila belum membaik dalam ' + r.limitDays + ' hari, atau muncul tanda bahaya, hentikan dan periksa ke dokter.' }));

    if (r.meds.length) {
      box.appendChild(el('div', { cls: 'h4', text: 'Rekomendasi zat aktif (bukan merek)' }));
      r.meds.forEach(function (m) {
        var extra = [el('div', { cls: 'dose' }, [el('strong', { text: 'Dosis: ' }), m.dose.text])];
        m.notes.forEach(function (n) { extra.push(el('small', { text: '• ' + n })); });
        if (m.cls === 'per_produk') extra.push(el('small', { text: '• Pilih produk berlogo hijau/biru; golongan berbeda antar produk.' }));
        box.appendChild(drugRow(m.name, m.use, m.cls, extra));
      });
    }
    if (r.gated.length) {
      box.appendChild(el('div', { cls: 'h4', text: 'Hanya setelah konsultasi apoteker' }));
      r.gated.forEach(function (g) { box.appendChild(drugRow(g.name, g.reason, 'apoteker')); });
    }
    if (r.excluded.length) {
      box.appendChild(el('div', { cls: 'h4', text: 'Tidak disarankan untuk kamu' }));
      r.excluded.forEach(function (g) { box.appendChild(drugRow(g.name, g.reason, 'x')); });
    }
    if (r.status === 'SWAMEDIKASI' && !r.meds.length && !r.gated.length) box.appendChild(el('p', { cls: 'warn', text: 'Tidak ada obat swalayan yang disarankan untuk keluhan ini. Ikuti saran non-obat atau tanyakan apoteker.' }));
    r.warnings.forEach(function (w) { box.appendChild(el('p', { cls: 'warn', text: w })); });

    if (r.nonPharm.length && r.status !== 'IGD') {
      box.appendChild(el('div', { cls: 'h4', text: 'Saran non-farmakologis' }));
      var tl = el('ul', { cls: 'tips' }); r.nonPharm.forEach(function (t) { tl.appendChild(el('li', { text: t })); }); box.appendChild(tl);
    }
    box.appendChild(el('div', { cls: 'h4', text: 'Ringkasan untuk apoteker' }));
    var pre = el('pre', { cls: 'sum', text: r.summary }); box.appendChild(pre);
    var copy = el('button', { cls: 'btn sec2', type: 'button', text: '📋 Salin ringkasan' });
    copy.onclick = function () {
      (navigator.clipboard ? navigator.clipboard.writeText(r.summary) : Promise.reject()).then(function () { copy.textContent = '✔ Tersalin'; }, function () { copy.textContent = 'Salin manual dari kotak di atas'; });
    };
    var again = el('button', { cls: 'btn', type: 'button', text: '↺ Skrining ulang' });
    again.onclick = function () { location.reload(); };
    box.appendChild(el('div', { cls: 'actions' }, [copy, again]));
    var note = el('p', { cls: 'note' }, ['Hanya obat bebas (logo hijau) dan bebas terbatas (logo biru). Golongan harus dicek per produk di ',
      el('a', { href: 'https://cekbpom.pom.go.id/', target: '_blank', rel: 'noopener', text: 'cekbpom.pom.go.id' }),
      '. Aturan: ' + r.rulesVersion + '. Bukan pengganti saran tenaga kesehatan.']);
    box.appendChild(note);
    if (location.hash.indexOf('#demo') !== 0) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- Navigasi & tema ---------- */
  function go(v) {
    ['skrining', 'obat', 'darurat', 'tentang'].forEach(function (x) { $('v-' + x).hidden = x !== v; });
    document.querySelectorAll('nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.go === v); });
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { go(b.dataset.go); }; });
  $('themeBtn').onclick = function () {
    var d = document.documentElement, dark = d.dataset.theme ? d.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    d.dataset.theme = dark ? 'light' : 'dark';
  };
  // Hook demo untuk screenshot/QA: index.html#demo mengisi contoh kasus
  if (location.hash === '#demo' || location.hash === '#demo-dark') {
    if (location.hash === '#demo-dark') document.documentElement.dataset.theme = 'dark';
    $('freeText').value = 'Tenggorokan gatal dan batuk berdahak sejak 2 hari, sedikit demam';
    $('suggestBtn').onclick(); $('suhu').value = '37.8'; $('durasi').value = '2';
    $('ageY').value = '21'; $('bb').value = '52'; togglePreg(); $('preg').value = 'tidak';
    $('runBtn').onclick();
  }
})();
