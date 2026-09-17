import { google } from "googleapis";

// Matches header labels like "Sun, 06 Sep 2026 - 07:00" (day, date, time).
const DATE_HEADER_REGEX = /^[A-Za-z]{3},\s*\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/;

// Teks placeholder di dropdown yang bukan nama orang beneran.
const IGNORE_NAMES = new Set(["x", "-", "tba", "n/a", "belum diisi", "pilih"]);

// Hanya 2 tab gabungan ini yang berisi data jadwal beneran (bukan tab fitur CISS lainnya).
// PENTING: nama di sini harus PERSIS SAMA (besar/kecil huruf, spasi) dengan nama tab di Google Sheets.
const ALLOWED_TABS = ["[NG] Schedule", "[LGY] Schedule"];

// Baris posisi seperti "[NG Aruna 2] [Pastoral] Leader - Preacher" atau
// "[LGY Barsi 2] [Pastoral] Leader - Preacher" diawali bracket berisi nama
// cabang aslinya. Baris-baris ini biasanya dikelompokkan di section
// "NG Preacher" / "LGY Preacher" di sheet, sehingga kolom Cabang (carry-forward)
// akan bernilai "NG Preacher" dsb, BUKAN cabang aslinya. Supaya jadwal Preacher
// di suatu cabang bisa terdeteksi double dengan jadwal reguler di cabang yang
// sama, kita override cabang dengan nilai dari bracket pertama ini kalau ada.
const CABANG_BRACKET_REGEX = /^\[([^\]]+)\]/;

// Daftar bulan yang tersedia. Setiap bulan = 1 file Google Sheets terpisah
// (hasil duplicate bulanan Anda), masing-masing punya Spreadsheet ID sendiri.
//
// CARA TAMBAH BULAN BARU:
// 1. Duplicate sheet seperti biasa, rename judulnya (mis. "CISS - Schedule - November 2026 (V4.1)").
// 2. Pastikan service account (GOOGLE_SERVICE_ACCOUNT_EMAIL) sudah di-invite sebagai
//    "Viewer" ke file Google Sheets yang baru itu (Share > tempel email service account).
// 3. Copy Spreadsheet ID dari URL-nya (bagian antara /d/ dan /edit).
// 4. Tambahkan 1 baris baru DI PALING ATAS array ini, supaya jadi bulan default/terbaru.
const MONTHS = [
  {
    id: "2026-10",
    label: "Oktober 2026",
    sheetId: "1CQna5UBOM8ss5WDop3V1_6JDhUfrc7YS5QF3ygI_HKc",
  },
  {
    id: "2026-09",
    label: "September 2026",
    sheetId: "1jaQuTv0-d4rW2-NzmB-eNk-GBv_Ag_zv_Dg1KOe0IhQ",
  },
];

function isBranchTab(tabName) {
  return ALLOWED_TABS.includes(tabName.trim());
}

// --- Cache sederhana di memori server ---
// Vercel serverless function bisa "warm" (instance yang sama dipakai lagi
// untuk request berikutnya dalam beberapa menit), jadi variabel di scope
// module ini bisa nyimpan hasil antar-request selama instance itu masih
// hidup. Ini bukan cache terdistribusi/permanen (tiap cold start akan
// kosong lagi), tapi cukup untuk mengurangi jumlah hit ke Google Sheets API
// saat banyak user buka bersamaan atau auto-refresh tiap 5 menit jalan
// hampir bersamaan. TTL sengaja dibuat sedikit di bawah interval
// auto-refresh frontend (5 menit) supaya data tetap terasa segar.
const CACHE_TTL_MS = 4 * 60 * 1000; // 4 menit
const scheduleCache = new Map(); // key: month.id -> { timestamp, payload }

function getCached(monthId) {
  const entry = scheduleCache.get(monthId);
  if (!entry) return null;
  const isExpired = Date.now() - entry.timestamp > CACHE_TTL_MS;
  return isExpired ? null : entry.payload;
}

function setCached(monthId, payload) {
  scheduleCache.set(monthId, { timestamp: Date.now(), payload });
}

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY belum di-set di Environment Variables."
    );
  }
  return new google.auth.JWT(email, null, key, [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ]);
}

// Find every column in the header row whose text looks like a date/service label.
// Each match is treated as the first column of a 3-column block (Nama, Indikator1, Indikator2).
function findDateColumns(headerRow) {
  const cols = [];
  (headerRow || []).forEach((cell, idx) => {
    if (typeof cell === "string" && DATE_HEADER_REGEX.test(cell.trim())) {
      cols.push({ colIndex: idx, label: cell.trim() });
    }
  });
  return cols;
}

// Scan the first few rows to find the one that contains date headers.
function findHeaderRowIndex(rows) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    if (findDateColumns(rows[r]).length > 0) return r;
  }
  return -1;
}

// Locate the Cabang / Posisi / Subposisi columns by matching header text.
function findLabelColumns(headerRow) {
  const find = (needle) =>
    (headerRow || []).findIndex(
      (c) => typeof c === "string" && c.toLowerCase().includes(needle)
    );
  return {
    cabangCol: find("cabang"),
    posisiCol: find("posisi"),
    subposisiCol: find("subposisi"),
  };
}

// Kalau teks posisi diawali "[Nama Cabang] ...", ekstrak nama cabang itu.
// Contoh: "[NG Aruna 2] [Pastoral] Leader - Preacher" -> "NG Aruna 2".
// Return null kalau tidak match (bukan baris jenis ini).
function extractCabangFromPosisi(posisiText) {
  if (!posisiText || typeof posisiText !== "string") return null;
  const match = posisiText.trim().match(CABANG_BRACKET_REGEX);
  return match ? match[1].trim() : null;
}

// Turn one sheet's raw grid into a flat list of {name, date, cabang, posisi, subposisi}.
function extractEntriesFromSheet(sheetName, rows) {
  const headerIdx = findHeaderRowIndex(rows);
  if (headerIdx === -1) return [];

  const headerRow = rows[headerIdx];
  const dateCols = findDateColumns(headerRow);
  const { cabangCol, posisiCol, subposisiCol } = findLabelColumns(headerRow);

  const entries = [];
  // Cabang/Posisi/Subposisi cells are often merged across several rows,
  // so we carry the last seen value forward until a new one appears.
  let lastCabang = "";
  let lastPosisi = "";
  let lastSubposisi = "";

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];

    if (cabangCol >= 0 && row[cabangCol]) lastCabang = row[cabangCol];
    if (posisiCol >= 0 && row[posisiCol]) lastPosisi = row[posisiCol];
    if (subposisiCol >= 0 && row[subposisiCol]) lastSubposisi = row[subposisiCol];

    // Baris seperti section "NG Preacher" / "LGY Preacher" punya cabang asli
    // tertulis di dalam bracket posisi (mis. "[NG Aruna 2] ..."), BUKAN di
    // kolom Cabang carry-forward (yang bernilai "NG Preacher" dsb). Kalau
    // terdeteksi, pakai itu sebagai cabang efektif supaya double booking
    // preacher-vs-reguler di cabang yang sama ikut ketahuan.
    const cabangFromPosisi = extractCabangFromPosisi(lastPosisi);
    const effectiveCabang = cabangFromPosisi || lastCabang || sheetName;

    dateCols.forEach(({ colIndex, label }) => {
      // Teks placeholder di dropdown yang bukan nama orang beneran diabaikan lewat IGNORE_NAMES.
      const rawName = row[colIndex];
      if (!rawName || typeof rawName !== "string") return;
      const name = rawName.replace(/\s*[▾▼]\s*$/, "").trim();
      if (!name) return;
      if (IGNORE_NAMES.has(name.toLowerCase())) return;

      entries.push({
        name,
        date: label,
        cabang: effectiveCabang,
        posisi: lastPosisi,
        subposisi: lastSubposisi,
      });
    });
  }

  return entries;
}

// Group entries: same name + same date + same cabang, appearing more than once, is a conflict.
// Conflicts are kept per-cabang (never merged across branches), so a name double-booked
// in Cabang A and separately double-booked in Cabang B shows up as two independent cards.
// Catatan: berkat extractCabangFromPosisi di atas, jadwal Preacher di suatu cabang
// sekarang dianggap satu "cabang" yang sama dengan jadwal reguler cabang tsb.
function groupConflicts(entries) {
  const byNameDateCabang = new Map();
  entries.forEach((e) => {
    const key = `${e.name}__${e.date}__${e.cabang}`;
    if (!byNameDateCabang.has(key)) byNameDateCabang.set(key, []);
    byNameDateCabang.get(key).push(e);
  });

  // Collapse to one bucket per (name, cabang), collecting every double-booked slot
  // that belongs to that name within that specific cabang.
  const byNameCabang = new Map();
  byNameDateCabang.forEach((slots) => {
    if (slots.length < 2) return;
    const { name, cabang } = slots[0];
    const key = `${name}__${cabang}`;
    if (!byNameCabang.has(key)) byNameCabang.set(key, { name, cabang, slots: [] });
    byNameCabang.get(key).slots.push(...slots);
  });

  return Array.from(byNameCabang.values())
    .map(({ name, cabang, slots }) => ({ name, cabang, slots, count: slots.length }))
    .sort((a, b) => b.count - a.count);
}

export default async function handler(req, res) {
  try {
    if (MONTHS.length === 0) {
      return res.status(500).json({
        error: "Belum ada bulan yang dikonfigurasi di MONTHS (api/schedule.js).",
      });
    }

    // ?month=2026-10 dari frontend. Kalau tidak dikirim / tidak ketemu, pakai bulan
    // paling atas di MONTHS (dianggap bulan terbaru/default).
    const requestedMonthId =
      typeof req.query.month === "string" ? req.query.month : null;
    const month =
      MONTHS.find((m) => m.id === requestedMonthId) || MONTHS[0];

    // ?refresh=1 dipakai tombol "Sinkron" manual di frontend untuk memaksa
    // ambil data baru dari Google Sheets, melewati cache.
    const forceRefresh = req.query.refresh === "1";

    if (!forceRefresh) {
      const cached = getCached(month.id);
      if (cached) {
        return res.status(200).json({ ...cached, fromCache: true });
      }
    }

    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: month.sheetId });
    const allTabNames = meta.data.sheets.map((s) => s.properties.title);
    const tabNames = allTabNames.filter(isBranchTab);

    let allEntries = [];
    for (const tabName of tabNames) {
      const range = `'${tabName}'!A1:ZZ500`;
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: month.sheetId,
        range,
      });
      const rows = resp.data.values || [];
      allEntries = allEntries.concat(extractEntriesFromSheet(tabName, rows));
    }

    const conflicts = groupConflicts(allEntries);

    const payload = {
      syncedAt: new Date().toISOString(),
      month: { id: month.id, label: month.label },
      availableMonths: MONTHS.map((m) => ({ id: m.id, label: m.label })),
      tabsScanned: tabNames,
      totalEntriesScanned: allEntries.length,
      conflicts,
    };

    setCached(month.id, payload);

    res.status(200).json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}