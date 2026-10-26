# PharmAI-Triage — MVP Web App

Skrining keluhan ringan dan panduan **swamedikasi obat bebas & bebas terbatas** yang aman. Dibuat untuk kompetisi DeveloperDay.id / APICTA (kategori *Web Application / AI System*).

> ⚠️ **Alat edukasi dan pendukung keputusan, bukan alat diagnosis.** Semua nilai dosis, batas hari, dan red flag adalah **draf** (rules v0.2-mvp, dikembangkan dari *draft clinical rules v0.1* di paper tim). Nilai-nilai ini **wajib diperiksa dan disahkan apoteker pembimbing** sebelum dipakai orang sungguhan.

## Fitur
- **Alur triase yang benar-benar jalan.** Pengguna memilih modul (ISPA, Pencernaan, Demam & Nyeri, Kulit) dan keluhan spesifik, lalu mengisi lama keluhan, usia (tahun + bulan), berat badan, suhu, status hamil/menyusui, komorbid, obat yang sedang dipakai, alergi, dan **checklist tanda bahaya** (umum + per modul).
- **Chat teks berbasis kata kunci**, bukan LLM. Fungsinya menyarankan modul dan keluhan, serta mencentang otomatis tanda bahaya yang disebut. Label "kata kunci, bukan AI/LLM" tampil di layar. Titik integrasi LLM ada di `suggestFromText()` dalam `js/engine.js`.
- **Clinical Rules Engine deterministik** (`js/engine.js`). Aturan dibaca dari `js/rules.js`.
- **Dosis per zat aktif.** Anak dan berat badan rendah dihitung dalam mg/kg dengan batas dosis dewasa. Batas usia minimum berlaku per zat.
- **Ringkasan untuk apoteker** yang bisa disalin.
- Halaman *Obat OTC* (whitelist), *Darurat* (119/112), dan *Tentang*.
- Mode gelap/terang, mobile-first. **Tidak ada data yang dikirim atau disimpan**; semua perhitungan berjalan di browser.
- Input **Suara & Batuk** dan **Kamera PPG** ditampilkan sebagai "Segera hadir". Fitur "foto resep" dihapus karena di luar lingkup OTC.

### 4 hard rules (dari paper, diterapkan di kode)
1. Tidak pernah menyarankan antibiotik atau obat keras. Whitelist hanya berisi obat bebas/bebas terbatas. Bila teks keluhan menyebut antibiotik, aplikasi hanya memberi peringatan.
2. **Red flag apa pun menghapus semua saran obat** dan menampilkan rujukan ke dokter atau IGD. Ini termasuk suhu ≥ 39 °C, bayi < 3 bulan (selalu dirujuk; bila demam → IGD), dan lama keluhan yang melewati batas swamedikasi.
3. **Data kosong atau ragu → konsultasi apoteker**, tanpa saran obat swalayan. Contohnya: berat badan kosong, demam tanpa pengukuran suhu, hamil/menyusui/"tidak yakin", obat resep rutin, atau teks yang menyebut tanda bahaya tetapi tidak dicentang.
4. **Batas hari swamedikasi selalu ditampilkan.** Bila beberapa keluhan dipilih, yang dipakai adalah batas terpendek.

## Struktur
```
index.html          UI (Bahasa Indonesia)
css/style.css       gaya (mengikuti prototipe asli)
js/rules.js         DATA aturan klinis: modul, red flag, batas hari, whitelist zat aktif, dosis
js/engine.js        rules engine murni (tanpa DOM) + saran kata kunci
js/app.js           lapisan UI
tests/vignettes.js  39 vinyet klinis
tests/run-tests.js  runner Node (vinyet + saran teks + invarian + fuzz red flag) → 46 uji
tests/tests.html    runner yang sama di browser (39 vinyet)
netlify.toml, vercel.json   header keamanan sederhana (opsional)
```

## Menjalankan & menguji
```bash
# buka langsung: klik dua kali index.html, atau
python3 -m http.server 8000      # lalu buka http://localhost:8000
node tests/run-tests.js          # atau: npm test  → "46 lulus, 0 gagal"
```
`index.html#demo` mengisi contoh kasus otomatis untuk demo atau tangkapan layar.

## Deploy (tanpa build step)
**Vercel**
1. Push folder ini ke repo GitHub.
2. Di vercel.com pilih *Add New → Project → Import* repo tersebut. *Framework Preset*: **Other**. Kosongkan *Build Command*; *Output Directory*: `.`
3. Klik **Deploy**. Alternatif lewat CLI: `npx vercel` lalu `npx vercel --prod`.

**Netlify**
- Cara cepat: buka app.netlify.com → *Add new site → Deploy manually*, lalu seret folder ini.
- Atau hubungkan repo GitHub (Publish directory `.`, build command kosong).
- Atau lewat CLI: `npx netlify-cli deploy --prod --dir .`

**GitHub Pages:** *Settings → Pages → Deploy from branch* (`main`, folder `/root`).

## Memasang domain .id / .my.id
1. **Daftarkan domain** lewat registrar yang terakreditasi PANDI (pengelola domain .id).
   - `.my.id` ditujukan untuk perorangan dan umumnya mensyaratkan KTP.
   - `.id` dapat didaftarkan perorangan maupun badan usaha (syarat dokumen mengikuti registrar/PANDI).
   - Subdomain kampus `.ac.id` hanya bisa diminta lewat unit TI kampus.
2. **Tambahkan domain di hosting.**
   - **Vercel:** *Project → Settings → Domains → Add* `pharmai.my.id`. Lalu buat record DNS di panel registrar:
     - domain utama (apex): **A** `@` → `76.76.21.21`
     - `www`: **CNAME** → `cname.vercel-dns.com`
   - **Netlify:** *Site configuration → Domain management → Add a domain*. Lalu:
     - apex: **A** `@` → `75.2.60.5` (atau pakai Netlify DNS)
     - `www`: **CNAME** → `<nama-situs>.netlify.app`
   - Nilai DNS di atas adalah nilai umum. **Selalu salin nilai yang ditampilkan dashboard Vercel/Netlify saat itu.**
3. Tunggu propagasi DNS (beberapa menit hingga 48 jam). HTTPS (Let's Encrypt) aktif otomatis.

## Dasar dosis (rules v0.2-mvp — wajib sign-off apoteker)
| Zat aktif | Golongan (cek per produk) | Aturan dosis di aplikasi | Batas usia | Dasar |
|---|---|---|---|---|
| Parasetamol | Obat bebas | ≥ 12 th **dan** ≥ 50 kg: 500–1000 mg tiap 4–6 jam, maks 4 g/hari. Selain itu: 10–15 mg/kg per dosis tiap 4–6 jam, maks 4 dosis & 60 mg/kg/hari, tidak melebihi 1000 mg/dosis & 4 g/hari | ≥ 3 bulan | Label produk; BNF/BNFc (60 mg/kg/hari dipilih sebagai nilai konservatif) |
| Ibuprofen 200 mg | Bebas terbatas | ≥ 12 th **dan** ≥ 40 kg: 200–400 mg tiap 6–8 jam, maks 1200 mg/hari (batas OTC). Selain itu: 5–10 mg/kg tiap 6–8 jam, maks 30 mg/kg/hari, ≤ 400 mg/dosis | ≥ 6 bulan | Label OTC; BNFc |
| Guaifenesin | Obat bebas (koreksi 6.3) | 6–<12 th: 100–200 mg tiap 4 jam, maks 1,2 g/hari. ≥ 12 th: 200–400 mg tiap 4 jam, maks 2,4 g/hari | ≥ 6 th (di bawahnya → apoteker) | Label OTC (US OTC monograph) |
| Antasida Al(OH)₃+Mg(OH)₂ | Obat bebas (koreksi 6.3) | Ikuti label (umumnya 1–2 tablet kunyah atau 5–10 mL, 3–4×/hari, 1 jam setelah makan & sebelum tidur) | ≥ 12 th | Pedoman Depkes 2006 & label produk |
| Simetikon | Per produk | 40–125 mg setelah makan & sebelum tidur, maks 500 mg/hari | ≥ 12 th | Label OTC |
| Oralit | Obat bebas | Setiap BAB cair: < 2 th 50–100 mL; 2–<10 th 100–200 mL; ≥ 10 th sesuai keinginan (± 200–400 mL). **Hanya untuk diare** | ≥ 3 bulan | Pedoman WHO tata laksana diare |
| Tablet hisap antiseptik | Per produk | Ikuti label (tidak ada angka lintas produk) | ≥ 6 th (risiko tersedak) | Label produk |
| Kalamin losion | Obat bebas | Oles tipis sesuai label, pemakaian luar | ≥ 3 bulan | Label produk |
| Cetirizin | **Hanya via apoteker** | Tidak diberi dosis | – | Koreksi paper 6.3 (umumnya resep/OWA) |
| Hidrokortison 1% krim | **Hanya via apoteker** | Tidak diberi dosis | – | Koreksi paper 6.3 |

**Kontraindikasi dan gating utama**
- **Ibuprofen diblok** pada:
  - hamil atau "tidak yakin" hamil
  - tukak lambung/perdarahan saluran cerna
  - penyakit ginjal
  - penyakit jantung/stroke
  - gangguan pembekuan darah atau pemakaian pengencer darah
  - pemakaian OAINS lain
  - alergi OAINS
  - curiga DBD
  - usia < 6 bulan
- **Ibuprofen hanya via apoteker** pada: asma, hipertensi, usia ≥ 65 tahun.
- **Parasetamol** diblok bila alergi atau bila sudah memakai produk lain berisi parasetamol. Pada penyakit hati/alkohol, parasetamol hanya via apoteker, karena batas yang lebih rendah harus ditentukan profesional.
- **Antasida** hanya via apoteker pada penyakit ginjal.
- Anak < 12 tahun selalu diberi peringatan "konfirmasi ke apoteker".
- Dispepsia **tidak** memunculkan oralit maupun parasetamol.

## Sengaja tidak dimasukkan
- Dekstrometorfan dan antitusif lain (batuk kering), dekongestan, antihistamin oral, laksatif, antiemetik, adsorben antidiare, dan zinc. Status regulasi/keamanannya bervariasi atau perlu penilaian apoteker. Untuk keluhan terkait, aplikasi memberi saran non-obat dan arahan ke apoteker.
- Obat sediaan bayi (drops) dengan konversi mL. Aplikasi hanya memberi mg dan meminta pengguna mengikuti label sediaan.
- LLM, analisis suara batuk, PPG, akun, riwayat, dan penyimpanan data.

## Integrasi LLM nanti
Ganti `suggestFromText()` dengan layanan anamnesis LLM (OLDARTS → JSON terstruktur: modul, keluhan, durasi, red flag). **Output LLM hanya mengisi formulir.** Keputusan obat tetap diambil `triage()` dari whitelist `rules.js`, dan LLM tidak boleh menimpanya.

## Checklist sebelum pilot (wajib)
- [ ] Apoteker pembimbing menyetujui setiap angka di `rules.js` (dosis, batas usia, batas hari, red flag) dan menandatangani versinya.
- [ ] Golongan setiap produk yang akan disebut diverifikasi di https://cekbpom.pom.go.id/
- [ ] Batas hari "mual" dan "sembelit" (sementara 3 hari, belum ada di draf v0.1) ditetapkan.
- [ ] Bank vinyet diperluas ke ≥ 100 kasus dan diuji panel (target paper: ≥ 90% setuju, 0 tidak aman).
- [ ] Persetujuan etik sebelum uji coba dengan pengguna sungguhan.

Rujukan: Depkes RI (2006) *Pedoman Penggunaan Obat Bebas dan Bebas Terbatas*; Kepmenkes 347/1990 (OWA); WHO (2000) pedoman swamedikasi; NICE NG143 (2019) *Fever in under 5s*; BNF/BNFc; label produk OTC terdaftar. Rujukan lengkap ada di Competition Paper tim.
