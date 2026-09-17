# CISS Conflict Watch

Web app kecil buat bantu tim analisa CISS menemukan nama yang terjadwal ganda (double booking) secara otomatis, langsung dari Google Sheet CISS.

## Cara kerjanya

1. Backend (`api/schedule.js`) login ke Google Sheets pakai Service Account, baca semua tab/cabang di spreadsheet kamu.
2. Dia otomatis mencari baris header yang berisi tanggal (contoh: "Sun, 06 Sep 2026 - 07:00") dan kolom Cabang/Posisi/Subposisi berdasarkan teksnya — jadi tidak bergantung pada posisi kolom yang pasti.
3. Semua nama yang terisi di setiap tanggal dikumpulkan, lalu dicek: kalau ada nama yang muncul lebih dari sekali di tanggal yang sama, itu dianggap konflik.
4. Frontend menampilkan daftar nama yang konflik, lengkap dengan cabang & posisi yang bentrok, bisa difilter per cabang atau dicari per nama.

## Setup awal (sekali saja)

### 1. Install dependencies

Buka folder ini di VS Code, lalu buka Terminal (`Terminal > New Terminal`), jalankan:

```bash
npm install
```

### 2. Install Vercel CLI (buat testing & deploy, gratis)

```bash
npm install -g vercel
```

### 3. Isi environment variables

Salin `.env.example` jadi `.env`:

```bash
cp .env.example .env
```

Buka `.env`, isi 3 nilainya dari file JSON kredensial service account yang sudah kamu download:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL` → dari field `client_email`
- `GOOGLE_PRIVATE_KEY` → dari field `private_key` (biarkan tanda `\n`-nya apa adanya)
- `GOOGLE_SHEET_ID` → potongan URL sheet kamu, contoh:
  `docs.google.com/spreadsheets/d/`**`1AbCEfGhIjK...`**`/edit` → itu bagian yang di-copy

### 4. Pastikan sheet sudah di-share

Sheet CISS harus sudah di-share (akses **Viewer**) ke alamat email di `client_email` tadi.

## Menjalankan di lokal

```bash
vercel dev
```

Ini menjalankan frontend **dan** backend (`/api/schedule`) sekaligus di `http://localhost:3000`, jadi perilakunya sama persis seperti nanti di production. (Perintah biasa `npm run dev` hanya menjalankan frontend saja, `/api` tidak akan berfungsi.)

Saat pertama kali jalan, `vercel` akan tanya beberapa pertanyaan setup (link ke akun Vercel kamu, nama project, dst) — jawab default/Enter saja kalau bingung.

## Kalau hasilnya kosong atau salah

Parser ini otomatis mendeteksi struktur, tapi kalau sheet kamu punya variasi yang tidak terbaca:

1. Cek response mentah di `http://localhost:3000/api/schedule` — lihat `tabsScanned` dan `totalEntriesScanned`. Kalau `totalEntriesScanned: 0`, berarti parser gagal menemukan baris header atau kolom nama.
2. Pastikan baris header (baris yang ada tanggalnya) polanya seperti `"Sun, 06 Sep 2026 - 07:00"` — kalau format tanggalnya beda, sesuaikan `DATE_HEADER_REGEX` di `api/schedule.js`.
3. Pastikan ada kolom dengan teks mengandung kata "cabang", "posisi", "subposisi" di baris header yang sama — kalau tidak, sesuaikan `findLabelColumns`.

Bagian-bagian ini sengaja dipisah jadi fungsi kecil di `api/schedule.js` supaya gampang di-tweak tanpa perlu paham keseluruhan kode.

## Deploy gratis ke Vercel

1. Push project ini ke repo GitHub baru (private lebih aman karena ada `api/schedule.js` yang menyebut nama env var, meski secret-nya sendiri tidak ikut ter-commit).
2. Buka [vercel.com](https://vercel.com), login pakai akun yang sama dengan waktu install CLI, klik **Add New > Project**, pilih repo ini.
3. Sebelum deploy, buka bagian **Environment Variables**, isi 3 variabel yang sama seperti di `.env` kamu.
4. Klik **Deploy**. Selesai — kamu dapat URL gratis (misal `ciss-conflict-watch.vercel.app`) yang bisa dibuka tim analisa kapan saja.

## Struktur file

```
├── api/
│   └── schedule.js       ← backend: baca sheet + deteksi konflik
├── src/
│   ├── App.jsx            ← tampilan utama
│   ├── main.jsx            ← entry point React
│   └── styles.css          ← desain visual
├── .env.example             ← template environment variables
└── vite.config.js
```
