import { google } from "googleapis";

/*
 * ============================================================
 * CISS ANALYZE — FILTER API
 * ============================================================
 *
 * Sumber:
 * - [LGY] Filter
 * - [NG] Filter
 *
 * Fungsi:
 * 1. Membaca availability per tanggal.
 * 2. Membawa semua informasi role seseorang.
 * 3. Tidak membuang orang yang sedang izin / unavailable.
 * 4. Membawa semua priority.
 * 5. Menentukan branch dari KeyName.
 * 6. Menyimpan source Legacy / NextGen.
 *
 * API ini BELUM melakukan AI analysis.
 * AI analysis akan dilakukan di api/analyze.js.
 */

// ============================================================
// DATE
// ============================================================

/*
 * Filter sheet biasanya mempunyai header seperti:
 *
 * Sat 03 Oct
 * Sun 04 Oct
 * Sat, 03 Oct
 *
 * Bisa juga terdapat tahun:
 *
 * Sat 03 Oct 2026
 */
const FILTER_DATE_HEADER_REGEX =
  /^[A-Za-z]{3},?\s*\d{1,2}\s+[A-Za-z]{3}(?:\s+\d{4})?$/i;


// ============================================================
// FILTER TABS
// ============================================================

const ALLOWED_TABS = [
  "[LGY] Filter",
  "[NG] Filter",
];


// ============================================================
// BRANCH
// ============================================================

const BRANCH_CODE_MAP = [
  { code: "LGY", label: "Legacy" },
  { code: "N2AR", label: "Aruna 2" },
  { code: "N5AR", label: "Aruna 5" },
  { code: "N4SH", label: "Soekhat 4" },
  { code: "NBS", label: "Barsi" },
  { code: "NRG", label: "Regency" },
  { code: "VOL", label: "Volunteer" },
];

/*
 * Contoh:
 *
 * Albert Saputra - N2AR2401013
 * Christine Evangeline Patricia - LGY2312002
 *
 * → mengambil kode branch dari belakang KeyName.
 */
const CODE_TAIL_REGEX =
  /[-\u2013]\s*([A-Za-z]+)\d+\s*$/;


// ============================================================
// MONTHS
// ============================================================

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


// ============================================================
// CACHE
// ============================================================

const CACHE_TTL_MS = 4 * 60 * 1000;

const filterCache = new Map();

function getCached(monthId) {
  const entry = filterCache.get(monthId);

  if (!entry) return null;

  const isExpired =
    Date.now() - entry.timestamp > CACHE_TTL_MS;

  return isExpired ? null : entry.payload;
}

function setCached(monthId, payload) {
  filterCache.set(monthId, {
    timestamp: Date.now(),
    payload,
  });
}


// ============================================================
// GOOGLE AUTH
// ============================================================

function getAuth() {
  const email =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  const key =
    (process.env.GOOGLE_PRIVATE_KEY || "")
      .replace(/\\n/g, "\n");

  if (!email || !key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY belum di-set di Environment Variables."
    );
  }

  return new google.auth.JWT(
    email,
    null,
    key,
    [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    ]
  );
}


// ============================================================
// HELPERS
// ============================================================

function isFilterTab(tabName) {
  return ALLOWED_TABS.includes(
    String(tabName || "").trim()
  );
}


/*
 * Ambil branch dari KeyName.
 */
function detectBranch(keyName) {
  if (
    !keyName ||
    typeof keyName !== "string"
  ) {
    return {
      code: null,
      label: "Lainnya",
    };
  }

  const match =
    keyName
      .trim()
      .match(CODE_TAIL_REGEX);

  if (!match) {
    return {
      code: null,
      label: "Lainnya",
    };
  }

  const rawCode =
    match[1].toUpperCase();

  const found =
    BRANCH_CODE_MAP.find((branch) =>
      rawCode.startsWith(branch.code)
    );

  if (found) {
    return {
      code: found.code,
      label: found.label,
    };
  }

  return {
    code: rawCode,
    label: rawCode,
  };
}


/*
 * Normalisasi text.
 */
function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}


/*
 * Normalisasi priority.
 *
 * Contoh:
 * "1"          → 1
 * "Priority 1" → 1
 * "P1"         → 1
 * ""           → null
 *
 * Kalau tidak bisa dipastikan sebagai angka,
 * raw value tetap disimpan.
 */
function normalizePriority(value) {
  const raw = normalizeText(value);

  if (!raw) {
    return {
      value: null,
      raw: "",
    };
  }

  const match =
    raw.match(/\d+/);

  if (match) {
    return {
      value: Number(match[0]),
      raw,
    };
  }

  return {
    value: null,
    raw,
  };
}


/*
 * Menentukan availability dari cell tanggal.
 *
 * "" / 0 → available
 * X      → unavailable
 * lainnya → other
 */
function parseAvailability(rawValue) {
  const raw =
    normalizeText(rawValue);

  if (
    raw.toUpperCase() === "X"
  ) {
    return "unavailable";
  }

  if (
    raw === "" ||
    raw === "0"
  ) {
    return "available";
  }

  return "other";
}


/*
 * Tentukan source berdasarkan tab.
 */
function detectSource(tabName) {
  const normalized =
    normalizeText(tabName)
      .toUpperCase();

  if (
    normalized === "[LGY] FILTER"
  ) {
    return "Legacy";
  }

  if (
    normalized === "[NG] FILTER"
  ) {
    return "NextGen";
  }

  return null;
}


// ============================================================
// DATE PARSER
// ============================================================

const MONTH_MAP = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};


/*
 * Mengubah:
 *
 * Sat 03 Oct
 * Sat, 03 Oct
 * Sat 03 Oct 2026
 *
 * menjadi:
 *
 * YYYY-MM-DD
 *
 * Kalau tahun tidak ada,
 * tahun diambil dari month.id.
 */
function normalizeDate(
  label,
  monthId
) {
  const text =
    normalizeText(label);

  if (!text) return null;

  const match =
    text.match(
      /^[A-Za-z]{3},?\s*(\d{1,2})\s+([A-Za-z]{3})(?:\s+(\d{4}))?/i
    );

  if (!match) {
    return null;
  }

  const day =
    Number(match[1]);

  const monthName =
    match[2].toLowerCase();

  const monthIndex =
    MONTH_MAP[monthName];

  if (
    monthIndex === undefined ||
    !day
  ) {
    return null;
  }

  let year;

  if (match[3]) {
    year = Number(match[3]);
  } else if (
    monthId &&
    /^\d{4}-\d{2}$/.test(monthId)
  ) {
    year =
      Number(monthId.slice(0, 4));
  } else {
    year =
      new Date().getFullYear();
  }

  const date =
    new Date(
      Date.UTC(
        year,
        monthIndex,
        day
      )
    );

  return date
    .toISOString()
    .slice(0, 10);
}


/*
 * Menentukan Legacy / NextGen
 * dari weekday tanggal.
 *
 * Sabtu  → Legacy
 * Minggu → NextGen
 */
function detectDateSource(
  dateKey
) {
  if (!dateKey) return null;

  const date =
    new Date(
      `${dateKey}T00:00:00Z`
    );

  const day =
    date.getUTCDay();

  if (day === 6) {
    return "Legacy";
  }

  if (day === 0) {
    return "NextGen";
  }

  return null;
}


// ============================================================
// HEADER
// ============================================================

function findDateColumns(
  headerRow,
  monthId
) {
  const cols = [];

  (
    headerRow || []
  ).forEach(
    (cell, idx) => {
      if (
        typeof cell !== "string"
      ) {
        return;
      }

      const label =
        cell.trim();

      if (
        !FILTER_DATE_HEADER_REGEX.test(
          label
        )
      ) {
        return;
      }

      const dateKey =
        normalizeDate(
          label,
          monthId
        );

      if (!dateKey) {
        return;
      }

      const source =
        detectDateSource(
          dateKey
        );

      cols.push({
        colIndex: idx,
        label,
        dateKey,
        source,
      });
    }
  );

  return cols;
}


function findHeaderRowIndex(
  rows,
  monthId
) {
  for (
    let r = 0;
    r < Math.min(
      rows.length,
      10
    );
    r++
  ) {
    if (
      findDateColumns(
        rows[r],
        monthId
      ).length > 0
    ) {
      return r;
    }
  }

  return -1;
}


// ============================================================
// LABEL COLUMNS
// ============================================================

function findLabelColumns(
  headerRow
) {
  const find = (
    needle
  ) =>
    (
      headerRow || []
    ).findIndex(
      (cell) =>
        typeof cell === "string" &&
        cell
          .toLowerCase()
          .includes(needle)
    );

  return {
    keyNameCol:
      find("keyname"),

    subdivisiCol:
      find("subdivisi"),

    priorityCol:
      find("priori"),

    statusCol:
      find("status"),

    isiIzinCol:
      (
        headerRow || []
      ).findIndex(
        (cell) =>
          typeof cell === "string" &&
          cell
            .toLowerCase()
            .trim() ===
            "isi izin"
      ),

    alasanCol:
      find("alasan"),

    crewNotesCol:
      find("crew"),

    legacyCol:
      find("legacy"),
  };
}


// ============================================================
// EXTRACT ROLE ROWS
// ============================================================

/*
 * 1 baris Filter =
 * 1 role seseorang.
 *
 * Kita TIDAK membuang:
 *
 * - Priority rendah
 * - orang izin
 * - orang unavailable
 * - status lain
 */
function extractRoleRowsFromSheet(
  rows,
  monthId,
  source
) {
  const headerIdx =
    findHeaderRowIndex(
      rows,
      monthId
    );

  if (
    headerIdx === -1
  ) {
    return [];
  }

  const headerRow =
    rows[headerIdx];

  const dateCols =
    findDateColumns(
      headerRow,
      monthId
    );

  const cols =
    findLabelColumns(
      headerRow
    );

  const roleRows = [];

  for (
    let r = headerIdx + 1;
    r < rows.length;
    r++
  ) {
    const row =
      rows[r] || [];

    const keyName =
      cols.keyNameCol >= 0
        ? normalizeText(
            row[
              cols.keyNameCol
            ]
          )
        : "";

    if (!keyName) {
      continue;
    }

    const branch =
      detectBranch(
        keyName
      );

    const priority =
      normalizePriority(
        cols.priorityCol >= 0
          ? row[
              cols.priorityCol
            ]
          : ""
      );

    const subdivisi =
      cols.subdivisiCol >= 0
        ? normalizeText(
            row[
              cols.subdivisiCol
            ]
          )
        : "";

    const status =
      cols.statusCol >= 0
        ? normalizeText(
            row[
              cols.statusCol
            ]
          )
        : "";

    const isiIzin =
      cols.isiIzinCol >= 0
        ? normalizeText(
            row[
              cols.isiIzinCol
            ]
          )
        : "";

    const alasanIzin =
      cols.alasanCol >= 0
        ? normalizeText(
            row[
              cols.alasanCol
            ]
          )
        : "";

    const crewNotes =
      cols.crewNotesCol >= 0
        ? normalizeText(
            row[
              cols.crewNotesCol
            ]
          )
        : "";

    const pelayananLegacy =
      cols.legacyCol >= 0
        ? normalizeText(
            row[
              cols.legacyCol
            ]
          )
        : "";


    /*
     * Availability per tanggal.
     */
    const availability =
      dateCols.map(
        ({
          colIndex,
          label,
          dateKey,
          source: dateSource,
        }) => {
          const raw =
            row[colIndex] ??
            "";

          const availabilityStatus =
            parseAvailability(
              raw
            );

          /*
           * Izin dianggap sebagai
           * informasi tambahan.
           *
           * Jadi walaupun cell tidak
           * bernilai X, kita tetap
           * menyimpan informasi izin.
           */
          const hasLeave =
            Boolean(
              isiIzin ||
              alasanIzin
            );

          return {
            date: label,

            dateKey,

            source:
              dateSource ||
              source,

            status:
              availabilityStatus,

            raw:

              normalizeText(
                raw
              ),

            isAvailable:
              availabilityStatus ===
              "available",

            isUnavailable:
              availabilityStatus ===
              "unavailable",

            isLeave:
              hasLeave,

            leaveInfo:
              hasLeave
                ? {
                    isiIzin,
                    alasanIzin,
                  }
                : null,
          };
        }
      );


    roleRows.push({
      keyName,

      name:
        keyName,

      branchCode:
        branch.code,

      branchLabel:
        branch.label,

      source,

      /*
       * Category saat ini mengikuti
       * field Subdivisi.
       *
       * Nanti Crew API akan menjadi
       * sumber category utama untuk
       * AI analysis.
       */
      category:
        subdivisi,

      subdivisi,

      /*
       * SEMUA priority tetap dibawa.
       */
      priority:
        priority.value,

      priorityRaw:
        priority.raw,

      status,

      isiIzin,

      alasanIzin,

      crewNotes,

      pelayananLegacy,

      availability,
    });
  }

  return roleRows;
}


// ============================================================
// GROUP PEOPLE
// ============================================================

/*
 * Kalau seseorang mempunyai beberapa
 * role/baris di Filter:
 *
 * Albert
 * ├── Music Priority 1
 * ├── Music Priority 2
 * └── Multimedia Priority 3
 *
 * semuanya tetap disimpan.
 */
function groupByBranch(
  roleRows
) {
  const people =
    new Map();


  roleRows.forEach(
    (row) => {
      /*
       * Gunakan branch + name
       * sebagai identity.
       */
      const personKey =
        `${row.branchLabel}__${row.keyName}`;


      if (
        !people.has(
          personKey
        )
      ) {
        people.set(
          personKey,
          {
            name:
              row.name,

            keyName:
              row.keyName,

            branchCode:
              row.branchCode,

            branchLabel:
              row.branchLabel,

            roles: [],

            availabilityMap:
              new Map(),

            leaveMap:
              new Map(),
          }
        );
      }


      const person =
        people.get(
          personKey
        );


      /*
       * SEMUA role tetap masuk.
       */
      person.roles.push({
        category:
          row.category,

        subdivisi:
          row.subdivisi,

        priority:
          row.priority,

        priorityRaw:
          row.priorityRaw,

        status:
          row.status,

        isiIzin:
          row.isiIzin,

        alasanIzin:
          row.alasanIzin,

        crewNotes:
          row.crewNotes,

        pelayananLegacy:
          row.pelayananLegacy,

        source:
          row.source,
      });


      /*
       * Gabungkan availability.
       *
       * Key:
       * source + tanggal
       */
      row.availability.forEach(
        (item) => {
          const key =
            `${item.source}__${item.dateKey}`;


          const existing =
            person.availabilityMap.get(
              key
            );


          /*
           * Priority status:
           *
           * unavailable
           * > other
           * > available
           *
           * Jadi kalau salah satu role
           * menyatakan X, orang tersebut
           * tetap dianggap unavailable
           * pada tanggal tersebut.
           */
          const STATUS_PRIORITY = {
            available: 0,
            other: 1,
            unavailable: 2,
          };


          if (
            !existing ||
            STATUS_PRIORITY[
              item.status
            ] >
              STATUS_PRIORITY[
                existing.status
              ]
          ) {
            person.availabilityMap.set(
              key,
              {
                ...item,
              }
            );
          }


          /*
           * Simpan informasi izin
           * secara terpisah.
           *
           * Ini penting supaya nanti
           * AI bisa mengetahui:
           *
           * "orangnya tetap ada,
           * tapi sedang izin."
           */
          if (
            item.isLeave
          ) {
            person.leaveMap.set(
              key,
              {
                isLeave: true,

                isiIzin:
                  item.leaveInfo
                    ?.isiIzin ||
                  "",

                alasanIzin:
                  item.leaveInfo
                    ?.alasanIzin ||
                  "",
              }
            );
          }
        }
      );
    }
  );


  const byBranch =
    new Map();


  people.forEach(
    (person) => {
      const availability =
        Array.from(
          person.availabilityMap.entries()
        ).map(
          ([key, value]) => {
            const leave =
              person.leaveMap.get(
                key
              );

            return {
              ...value,

              isLeave:
                Boolean(
                  value.isLeave ||
                  leave
                ),

              leaveInfo:
                leave ||
                value.leaveInfo ||
                null,
            };
          }
        );


      /*
       * Semua priority unik.
       */
      const priorities =
        Array.from(
          new Set(
            person.roles
              .map(
                (role) =>
                  role.priority
              )
              .filter(
                (value) =>
                  value !== null &&
                  value !== undefined
              )
          )
        ).sort(
          (a, b) =>
            Number(a) -
            Number(b)
        );


      /*
       * Semua category unik.
       */
      const categories =
        Array.from(
          new Set(
            person.roles
              .map(
                (role) =>
                  role.category
              )
              .filter(Boolean)
          )
        );


      const finalPerson = {
        name:
          person.name,

        keyName:
          person.keyName,

        branchCode:
          person.branchCode,

        branchLabel:
          person.branchLabel,

        /*
         * SEMUA role.
         */
        roles:
          person.roles,

        /*
         * Semua category.
         */
        categories,

        /*
         * Semua priority.
         */
        priorities,

        /*
         * Availability per tanggal.
         */
        availability,

        /*
         * Jumlah unavailable.
         */
        unavailableCount:
          availability.filter(
            (item) =>
              item.status ===
              "unavailable"
          ).length,

        /*
         * Jumlah izin.
         */
        leaveCount:
          availability.filter(
            (item) =>
              item.isLeave
          ).length,
      };


      if (
        !byBranch.has(
          person.branchLabel
        )
      ) {
        byBranch.set(
          person.branchLabel,
          []
        );
      }


      byBranch
        .get(
          person.branchLabel
        )
        .push(
          finalPerson
        );
    }
  );


  return Array.from(
    byBranch.entries()
  )
    .map(
      ([
        branchLabel,
        list,
      ]) => ({
        branchLabel,

        people:
          list.sort(
            (a, b) =>
              a.name.localeCompare(
                b.name
              )
          ),
      })
    )
    .sort(
      (a, b) =>
        a.branchLabel.localeCompare(
          b.branchLabel
        )
    );
}


// ============================================================
// ALLOWED BRANCHES
// ============================================================

const ALLOWED_BRANCH_LABELS = [
  "Legacy",
  "Aruna 2",
  "Aruna 5",
  "Barsi",
  "Regency",
  "Soekhat 4",
];


// ============================================================
// API HANDLER
// ============================================================

export default async function handler(
  req,
  res
) {
  try {
    if (
      MONTHS.length === 0
    ) {
      return res.status(500).json({
        error:
          "Belum ada bulan yang dikonfigurasi di MONTHS (api/filter.js).",
      });
    }


    const requestedMonthId =
      typeof req.query.month ===
      "string"
        ? req.query.month
        : null;


    const month =
      MONTHS.find(
        (m) =>
          m.id ===
          requestedMonthId
      ) ||
      MONTHS[0];


    const forceRefresh =
      req.query.refresh === "1";


    const debug =
      req.query.debug === "1";


    /*
     * Cache.
     */
    if (
      !forceRefresh &&
      !debug
    ) {
      const cached =
        getCached(
          month.id
        );


      if (cached) {
        return res
          .status(200)
          .json({
            ...cached,
            fromCache: true,
          });
      }
    }


    const auth =
      getAuth();


    const sheets =
      google.sheets({
        version: "v4",
        auth,
      });


    /*
     * Ambil metadata spreadsheet.
     */
    const meta =
      await sheets.spreadsheets.get(
        {
          spreadsheetId:
            month.sheetId,
        }
      );


    const allTabNames =
      meta.data.sheets.map(
        (sheet) =>
          sheet.properties.title
      );


    const tabNames =
      allTabNames.filter(
        isFilterTab
      );


    let allRoleRows = [];

    const debugInfo = [];


    /*
     * Scan semua Filter tab.
     */
    for (
      const tabName of tabNames
    ) {
      const range =
        `'${tabName}'!A1:ZZ2000`;


      const resp =
        await sheets.spreadsheets.values.get(
          {
            spreadsheetId:
              month.sheetId,

            range,
          }
        );


      const rows =
        resp.data.values ||
        [];


      const source =
        detectSource(
          tabName
        );


      const headerIdx =
        findHeaderRowIndex(
          rows,
          month.id
        );


      const headerRow =
        headerIdx >= 0
          ? rows[headerIdx]
          : [];


      const dateCols =
        findDateColumns(
          headerRow,
          month.id
        );


      if (debug) {
        debugInfo.push({
          tabName,

          source,

          headerRowIndex:
            headerIdx,

          allHeaderCells:
            headerRow,

          dateColsDetected:
            dateCols.map(
              (date) => ({
                label:
                  date.label,

                dateKey:
                  date.dateKey,

                source:
                  date.source,
              })
            ),
        });
      }


      const roleRows =
        extractRoleRowsFromSheet(
          rows,
          month.id,
          source
        );


      allRoleRows =
        allRoleRows.concat(
          roleRows
        );
    }


    /*
     * Group per branch.
     */
    let branches =
      groupByBranch(
        allRoleRows
      );


    /*
     * Hanya branch CISS.
     */
    branches =
      branches.filter(
        (branch) =>
          ALLOWED_BRANCH_LABELS.includes(
            branch.branchLabel
          )
      );


    /*
     * Payload.
     */
    const payload = {
      syncedAt:
        new Date().toISOString(),

      month: {
        id:
          month.id,

        label:
          month.label,
      },

      availableMonths:
        MONTHS.map(
          (m) => ({
            id:
              m.id,

            label:
              m.label,
          })
        ),

      tabsScanned:
        tabNames,

      totalRoleRowsScanned:
        allRoleRows.length,

      /*
       * Data utama Filter.
       */
      branches,

      /*
       * Metadata untuk AI.
       */
      dataCapabilities: {
        includesAllPriorities:
          true,

        includesUnavailable:
          true,

        includesLeave:
          true,

        includesAvailability:
          true,

        includesCategories:
          true,

        includesSource:
          true,
      },

      ...(debug
        ? {
            debug:
              debugInfo,
          }
        : {}),
    };


    /*
     * Simpan cache.
     */
    if (!debug) {
      setCached(
        month.id,
        payload
      );
    }


    return res
      .status(200)
      .json(payload);

  } catch (err) {
    console.error(
      "FILTER API ERROR:",
      err
    );

    return res
      .status(500)
      .json({
        error:
          err.message ||
          "Gagal mengambil data Filter.",
      });
  }
}