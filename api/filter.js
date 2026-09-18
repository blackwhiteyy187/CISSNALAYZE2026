// api/filter.js

import { google } from "googleapis";

/* =========================================================
   CONFIG
========================================================= */

const SPREADSHEET_ID =
  process.env.GOOGLE_SPREADSHEET_ID ||
  process.env.SPREADSHEET_ID ||
  "1tMkfZrlH2UdhiQscr3t0E8olbOT08-n1oDsNiQQomIg";

const MONTHS = [
  {
    id: "2026-10",
    label: "Oktober 2026",
    sheetId:
      "1CQna5UBOM8ss5WDop3V1_6JDhUfrc7YS5QF3ygI_HKc",
  },
  {
    id: "2026-09",
    label: "September 2026",
    sheetId:
      "1jaQuTv0-d4rW2-NzmB-eNk-GBv_Ag_zv_Dg1KOe0IhQ",
  },
];

const ALLOWED_BRANCHES = new Set([
  "Legacy",
  "Aruna 2",
  "Aruna 5",
  "Barsi",
  "Regency",
  "Soekhat 4",
]);

const CACHE_TTL = 4 * 60 * 1000;

const STATUS_PRIORITY = {
  available: 0,
  other: 1,
  scheduled: 2,
  unavailable: 3,
  leave: 4,
};

const cache = new Map();

/* =========================================================
   GOOGLE AUTH
========================================================= */

function getGoogleAuth() {
  const clientEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL;

  const privateKey = (
    process.env.GOOGLE_PRIVATE_KEY || ""
  ).replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Google credentials belum lengkap. Pastikan GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_CLIENT_EMAIL dan GOOGLE_PRIVATE_KEY tersedia."
    );
  }

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    ],
  });
}

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return clean(value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePersonName(value) {
  let name = normalizeText(value);

  // status/icon di depan nama
  name = name.replace(
    /^[🟢🔵🔴⚪✓✔×✕•?]\s*/u,
    ""
  );

  // assignment bracket di depan nama
  name = name.replace(
    /^\[[^\]]+\]\s*/,
    ""
  );

  // code di belakang nama
  name = name.replace(
    /\s+-\s+[A-Za-z0-9._/]+\s*$/i,
    ""
  );

  return normalizeText(name);
}

function normalizeBranch(value) {
  const text = normalizeText(value);

  if (!text) return "";

  if (/^barsi(?:\s+\d+)?$/i.test(text)) {
    return "Barsi";
  }

  if (/^ng\s+barsi(?:\s+\d+)?$/i.test(text)) {
    return "Barsi";
  }

  return text;
}

function canonicalBranch(value) {
  return normalizeBranch(
    String(value ?? "")
      .replace(/^\[|\]$/g, "")
      .trim()
  );
}

function isAllowedBranch(branch) {
  return ALLOWED_BRANCHES.has(
    normalizeBranch(branch)
  );
}

/* =========================================================
   DATE
========================================================= */

function parseDateFromHeader(value) {
  const text = normalizeText(value);

  if (!text) return null;

  /*
    Contoh:
    Sun, 04 Oct 2026 - 07:00
    Sat, 10 Oct 2026 - 07:00
  */

  const match = text.match(
    /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i
  );

  if (!match) return null;

  const day = Number(match[1]);
  const monthName = match[2].toLowerCase();
  const year = Number(match[3]);

  const monthMap = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };

  if (!(monthName in monthMap)) {
    return null;
  }

  const month = monthMap[monthName];

  const date = new Date(
    Date.UTC(year, month, day)
  );

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function dateKeyFromDate(date) {
  if (!date) return "";

  const year = date.getUTCFullYear();

  const month = String(
    date.getUTCMonth() + 1
  ).padStart(2, "0");

  const day = String(
    date.getUTCDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function detectDateSource(dateColumn) {
  const date = parseDateFromHeader(dateColumn);

  if (!date) return "";

  const day = date.getUTCDay();

  // Saturday = Legacy
  // Sunday = NextGen

  if (day === 6) return "Legacy";
  if (day === 0) return "NextGen";

  return "";
}

/* =========================================================
   GOOGLE SHEET READER
========================================================= */

async function readSheet(spreadsheetId, tabName) {
  const auth = getGoogleAuth();

  const sheets = google.sheets({
    version: "v4",
    auth,
  });

  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'`,
      majorDimension: "ROWS",
    });

  return response.data.values || [];
}

/* =========================================================
   HEADER HELPERS
========================================================= */

function findHeaderIndex(headers, candidates) {
  const normalizedHeaders = headers.map(
    (header) =>
      normalizeText(header).toLowerCase()
  );

  for (const candidate of candidates) {
    const index = normalizedHeaders.indexOf(
      normalizeText(candidate).toLowerCase()
    );

    if (index !== -1) {
      return index;
    }
  }

  return -1;
}

function findDateColumns(headers) {
  const result = [];

  headers.forEach((header, index) => {
    const date = parseDateFromHeader(header);

    if (!date) return;

    result.push({
      index,
      header,
      date,
      dateKey: dateKeyFromDate(date),
      source: detectDateSource(header),
    });
  });

  return result;
}

/* =========================================================
   ASSIGNMENT PARSER
========================================================= */

function parseAssignment(value) {
  const text = normalizeText(value);

  if (!text) {
    return {
      source: "",
      branch: "",
      category: "",
      field: "",
      role: "",
      raw: "",
    };
  }

  const brackets = [];
  const regex = /\[([^\]]+)\]/g;

  let match;

  while ((match = regex.exec(text))) {
    brackets.push(
      normalizeText(match[1])
    );
  }

  let source = "";
  let branch = "";

  for (const bracket of brackets) {
    const lower = bracket.toLowerCase();

    if (
      lower === "legacy" ||
      lower === "lgy"
    ) {
      source = "Legacy";
      continue;
    }

    if (/^ng(?:\s|$)/i.test(bracket)) {
      source = "NextGen";

      const ngBranch = bracket
        .replace(/^ng\s*/i, "")
        .trim();

      if (ngBranch) {
        branch = normalizeBranch(
          ngBranch
        );
      }

      continue;
    }

    const possibleBranch =
      normalizeBranch(bracket);

    if (
      ALLOWED_BRANCHES.has(
        possibleBranch
      )
    ) {
      branch = possibleBranch;
    }
  }

  if (!branch && brackets.length) {
    for (const bracket of brackets) {
      const possibleBranch =
        normalizeBranch(bracket);

      if (
        ALLOWED_BRANCHES.has(
          possibleBranch
        )
      ) {
        branch = possibleBranch;
        break;
      }
    }
  }

  if (!source) {
    if (
      /^\[Legacy\]/i.test(text)
    ) {
      source = "Legacy";
    } else if (
      /^\[NG\b/i.test(text)
    ) {
      source = "NextGen";
    }
  }

  /*
    Format:
    [NG Aruna 2] [Prophetic] Music - Singer

    => source   NextGen
    => branch   Aruna 2
    => category Prophetic
    => field    Music
    => role     Singer
  */

  let remaining = text;

  if (brackets.length) {
    remaining = remaining
      .replace(/\[[^\]]+\]/g, "")
      .trim();
  }

  let category = "";
  let field = "";
  let role = "";

  const parts = remaining
    .split(/\s+/)
    .filter(Boolean);

  const dashMatch = remaining.match(
    /^(.+?)\s+-\s+(.+?)$/i
  );

  if (dashMatch) {
    const left = normalizeText(
      dashMatch[1]
    );

    const right = normalizeText(
      dashMatch[2]
    );

    const leftParts = left
      .split(/\s+/)
      .filter(Boolean);

    if (leftParts.length >= 2) {
      field = leftParts[0];

      category = leftParts
        .slice(1)
        .join(" ");
    } else {
      field = left;
    }

    role = right;
  } else {
    if (parts.length >= 3) {
      category = parts[0];

      field = parts[1];

      role = parts
        .slice(2)
        .join(" ");
    } else if (parts.length === 2) {
      field = parts[0];
      role = parts[1];
    } else if (parts.length === 1) {
      role = parts[0];
    }
  }

  return {
    source,
    branch: normalizeBranch(branch),
    category: normalizeText(category),
    field: normalizeText(field),
    role: normalizeText(role),
    raw: text,
  };
}

/* =========================================================
   POSITION / BRANCH
========================================================= */

function extractCabangFromPosisi(value) {
  const text = normalizeText(value);

  const match = text.match(
    /^\[([^\]]+)\]/
  );

  if (!match) return "";

  const inside = normalizeText(
    match[1]
  );

  if (/^ng\s+/i.test(inside)) {
    return normalizeBranch(
      inside.replace(/^ng\s+/i, "")
    );
  }

  if (/^legacy$/i.test(inside)) {
    return "Legacy";
  }

  return normalizeBranch(inside);
}

/* =========================================================
   AVAILABILITY PARSER
========================================================= */

function parseAvailability(value) {
  const raw = clean(value);

  if (
    raw === "" ||
    raw === "0"
  ) {
    return {
      status: "available",
      isAvailable: true,
      isUnavailable: false,
    };
  }

  const upper = raw.toUpperCase();

  if (
    upper === "X" ||
    upper === "×" ||
    upper === "NO"
  ) {
    return {
      status: "unavailable",
      isAvailable: false,
      isUnavailable: true,
    };
  }

  return {
    status: "other",
    isAvailable: false,
    isUnavailable: false,
  };
}

/*
  Hanya nilai affirmative yang dianggap izin.

  IMPORTANT:
  "No" tidak boleh dianggap leave.
*/
function isLeaveValue(value) {
  const text = normalizeText(value)
    .toLowerCase();

  return [
    "yes",
    "y",
    "iya",
    "ya",
    "izin",
    "leave",
    "true",
  ].includes(text);
}

/* =========================================================
   SCHEDULE
========================================================= */

function normalizeSchedulePersonName(value) {
  return normalizePersonName(value)
    .toLowerCase();
}

function buildScheduleIndexes(scheduleEntries) {
  const byBranchNameDate = new Map();
  const byNameDate = new Map();

  for (const entry of scheduleEntries) {
    if (!entry) continue;

    const nameKey =
      normalizeSchedulePersonName(
        entry.name
      );

    const dateKey =
      clean(entry.dateKey);

    const branchKey =
      canonicalBranch(entry.branch)
        .toLowerCase();

    if (!nameKey || !dateKey) {
      continue;
    }

    const nameDateKey =
      `${nameKey}|${dateKey}`;

    const branchNameDateKey =
      `${branchKey}|${nameKey}|${dateKey}`;

    if (!byNameDate.has(nameDateKey)) {
      byNameDate.set(
        nameDateKey,
        []
      );
    }

    byNameDate
      .get(nameDateKey)
      .push(entry);

    if (branchKey) {
      if (
        !byBranchNameDate.has(
          branchNameDateKey
        )
      ) {
        byBranchNameDate.set(
          branchNameDateKey,
          []
        );
      }

      byBranchNameDate
        .get(branchNameDateKey)
        .push(entry);
    }
  }

  return {
    byBranchNameDate,
    byNameDate,
  };
}

function findScheduleMatch(
  indexes,
  {
    name,
    branch,
    dateKey,
  }
) {
  const nameKey =
    normalizeSchedulePersonName(name);

  const branchKey =
    canonicalBranch(branch)
      .toLowerCase();

  const exactKey =
    `${branchKey}|${nameKey}|${dateKey}`;

  const exact =
    indexes.byBranchNameDate.get(
      exactKey
    ) || [];

  if (exact.length) {
    return exact[0];
  }

  const fallbackKey =
    `${nameKey}|${dateKey}`;

  const fallback =
    indexes.byNameDate.get(
      fallbackKey
    ) || [];

  if (fallback.length === 1) {
    return fallback[0];
  }

  if (fallback.length > 1) {
    const sameBranch =
      fallback.filter(
        (item) =>
          canonicalBranch(
            item.branch
          ).toLowerCase() ===
          branchKey
      );

    if (sameBranch.length) {
      return sameBranch[0];
    }
  }

  return null;
}

/* =========================================================
   NORMALIZE AVAILABILITY OBJECT
========================================================= */

function normalizeAvailabilityItem(item) {
  const status =
    item?.status || "other";

  return {
    ...item,

    status,

    isLeave:
      status === "leave",

    isUnavailable:
      status === "unavailable" ||
      status === "leave",

    isAvailable:
      status === "available",

    leaveInfo:
      status === "leave"
        ? item?.leaveInfo || null
        : null,
  };
}

/* =========================================================
   AVAILABILITY MERGE
========================================================= */

function mergeAvailability(
  current,
  incoming
) {
  if (!current) {
    return normalizeAvailabilityItem(
      incoming
    );
  }

  const currentItem =
    normalizeAvailabilityItem(
      current
    );

  const incomingItem =
    normalizeAvailabilityItem(
      incoming
    );

  const currentPriority =
    STATUS_PRIORITY[
      currentItem.status
    ] ??
    STATUS_PRIORITY.other;

  const incomingPriority =
    STATUS_PRIORITY[
      incomingItem.status
    ] ??
    STATUS_PRIORITY.other;

  /*
    Higher priority wins:

    leave
    > unavailable
    > scheduled
    > other
    > available
  */

  let winner;

  if (
    incomingPriority >
    currentPriority
  ) {
    winner = {
      ...currentItem,
      ...incomingItem,
    };
  } else if (
    incomingPriority <
    currentPriority
  ) {
    winner = {
      ...incomingItem,
      ...currentItem,
    };
  } else {
    /*
      Same priority:
      pertahankan data current,
      tetapi jangan sampai flag status
      menjadi tidak konsisten.
    */
    winner = {
      ...currentItem,
      ...incomingItem,
      status: currentItem.status,
    };
  }

  /*
    STATUS adalah sumber kebenaran utama.
    Jadi tidak mungkin lagi terjadi:

    status: "available"
    isLeave: true

    atau kombinasi flag lain yang kontradiktif.
  */
  return normalizeAvailabilityItem(
    winner
  );
}

/* =========================================================
   FILTER DATA PARSER
========================================================= */

function parseFilterSheet(
  rows,
  tabName
) {
  if (!rows.length) {
    return {
      people: [],
      dateColumns: [],
    };
  }

  const headers = rows[0] || [];

  const nameIndex =
    findHeaderIndex(headers, [
      "nama",
      "name",
      "crew",
      "crew name",
      "nama crew",
    ]);

  const assignmentIndex =
    findHeaderIndex(headers, [
      "prioritas",
      "subdivisi",
      "posisi",
      "assignment",
      "role",
    ]);

  const cabangIndex =
    findHeaderIndex(headers, [
      "cabang",
      "branch",
    ]);

  const isiIzinIndex =
    findHeaderIndex(headers, [
      "isiIzin",
      "isi izin",
      "izin",
      "is izin",
    ]);

  const alasanIzinIndex =
    findHeaderIndex(headers, [
      "alasanIzin",
      "alasan izin",
      "reason",
    ]);

  const dateColumns =
    findDateColumns(headers);

  const people = [];

  for (
    let rowIndex = 1;
    rowIndex < rows.length;
    rowIndex++
  ) {
    const row = rows[rowIndex] || [];

    const rawName =
      nameIndex >= 0
        ? row[nameIndex]
        : "";

    const name =
      normalizePersonName(rawName);

    if (!name) {
      continue;
    }

    const rawAssignment =
      assignmentIndex >= 0
        ? row[assignmentIndex]
        : "";

    const assignment =
      parseAssignment(
        rawAssignment
      );

    let branch =
      assignment.branch;

    if (
      !branch &&
      cabangIndex >= 0
    ) {
      branch = canonicalBranch(
        row[cabangIndex]
      );
    }

    if (!branch) {
      branch =
        extractCabangFromPosisi(
          rawAssignment
        );
    }

    branch =
      normalizeBranch(branch);

    if (!isAllowedBranch(branch)) {
      continue;
    }

    const isiIzin =
      isiIzinIndex >= 0
        ? clean(row[isiIzinIndex])
        : "";

    const alasanIzin =
      alasanIzinIndex >= 0
        ? clean(row[alasanIzinIndex])
        : "";

    const hasPermissionFlag =
      isLeaveValue(isiIzin);

    const availability = {};

    for (const dateColumn of dateColumns) {
      const raw =
        row[dateColumn.index] ?? "";

      const parsed =
        parseAvailability(raw);

      /*
        X + isiIzin affirmative = leave.

        IMPORTANT:
        Leave hanya berlaku pada tanggal
        yang cell-nya memang X.

        Jadi tidak membuat seluruh bulan
        menjadi leave.
      */

      const isLeave =
        hasPermissionFlag &&
        parsed.status === "unavailable";

      availability[
        dateColumn.dateKey
      ] = {
        date: dateColumn.header,

        dateKey:
          dateColumn.dateKey,

        source:
          dateColumn.source,

        raw: clean(raw),

        status: isLeave
          ? "leave"
          : parsed.status,

        isAvailable:
          parsed.isAvailable &&
          !isLeave,

        isUnavailable:
          isLeave ||
          parsed.isUnavailable,

        isLeave,

        leaveInfo: isLeave
          ? {
              isiIzin,
              alasanIzin,
              date:
                dateColumn.header,
              dateKey:
                dateColumn.dateKey,
            }
          : null,
      };
    }

    people.push({
      name,
      branch,

      source:
        assignment.source,

      category:
        assignment.category,

      field:
        assignment.field,

      role:
        assignment.role,

      assignment:
        assignment.raw,

      tab:
        tabName,

      rowIndex,

      isiIzin,

      alasanIzin,

      availability,
    });
  }

  return {
    people,
    dateColumns,
  };
}

/* =========================================================
   SCHEDULE SHEET PARSER
========================================================= */

function parseScheduleSheet(
  rows,
  tabName
) {
  if (!rows.length) {
    return [];
  }

  const headers = rows[0] || [];

  const nameIndex =
    findHeaderIndex(headers, [
      "nama",
      "name",
      "crew",
      "crew name",
      "nama crew",
    ]);

  const posisiIndex =
    findHeaderIndex(headers, [
      "posisi",
      "position",
      "assignment",
      "role",
    ]);

  const cabangIndex =
    findHeaderIndex(headers, [
      "cabang",
      "branch",
    ]);

  const dateColumns =
    findDateColumns(headers);

  const entries = [];

  /*
    Schedule sering memakai merged cells.

    Jadi Cabang/Posisi perlu carry-forward.
  */

  let lastBranch = "";
  let lastPosition = "";

  for (
    let rowIndex = 1;
    rowIndex < rows.length;
    rowIndex++
  ) {
    const row = rows[rowIndex] || [];

    let branch =
      cabangIndex >= 0
        ? clean(row[cabangIndex])
        : "";

    let position =
      posisiIndex >= 0
        ? clean(row[posisiIndex])
        : "";

    if (branch) {
      lastBranch =
        canonicalBranch(branch);
    } else {
      branch = lastBranch;
    }

    if (position) {
      lastPosition = position;
    } else {
      position = lastPosition;
    }

    if (!branch && position) {
      branch =
        extractCabangFromPosisi(
          position
        );
    }

    branch =
      normalizeBranch(branch);

    if (!isAllowedBranch(branch)) {
      continue;
    }

    const assignment =
      parseAssignment(position);

    for (const dateColumn of dateColumns) {
      const value =
        row[dateColumn.index];

      if (
        value === undefined ||
        clean(value) === ""
      ) {
        continue;
      }

      let name =
        nameIndex >= 0
          ? normalizePersonName(
              row[nameIndex]
            )
          : "";

      if (!name) {
        continue;
      }

      entries.push({
        name,
        branch,

        source:
          dateColumn.source ||
          assignment.source ||
          "",

        date:
          dateColumn.header,

        dateKey:
          dateColumn.dateKey,

        raw:
          clean(value),

        position,

        category:
          assignment.category,

        field:
          assignment.field,

        role:
          assignment.role,

        tab:
          tabName,

        rowIndex,
      });
    }
  }

  return entries;
}

/* =========================================================
   BUILD RESULT
========================================================= */

function combinePeople(
  parsedSheets,
  scheduleIndexes
) {
  const peopleMap = new Map();

  for (const parsed of parsedSheets) {
    for (const person of parsed.people) {
      const key =
        `${normalizePersonName(
          person.name
        ).toLowerCase()}|${normalizeBranch(
          person.branch
        ).toLowerCase()}|${normalizeText(
          person.category
        ).toLowerCase()}|${normalizeText(
          person.field
        ).toLowerCase()}|${normalizeText(
          person.role
        ).toLowerCase()}`;

      let target =
        peopleMap.get(key);

      if (!target) {
        target = {
          name: person.name,
          branch: person.branch,
          source: person.source,
          category: person.category,
          field: person.field,
          role: person.role,
          assignment:
            person.assignment,
          isiIzin:
            person.isiIzin,
          alasanIzin:
            person.alasanIzin,
          availability: {},
        };

        peopleMap.set(
          key,
          target
        );
      }

      for (const [
        dateKey,
        incoming,
      ] of Object.entries(
        person.availability
      )) {
        const scheduled =
          findScheduleMatch(
            scheduleIndexes,
            {
              name:
                person.name,

              branch:
                person.branch,

              dateKey,
            }
          );

        let status =
          incoming.status;

        /*
          Priority:

          leave
          > unavailable
          > scheduled
          > available
          > other
        */

        if (
          incoming.isLeave
        ) {
          status = "leave";
        } else if (
          incoming.isUnavailable
        ) {
          status = "unavailable";
        } else if (
          scheduled
        ) {
          status = "scheduled";
        } else if (
          incoming.isAvailable
        ) {
          status = "available";
        } else {
          status = "other";
        }

        const merged = {
          ...incoming,

          status,

          scheduled:
            Boolean(scheduled),

          schedule:
            scheduled
              ? {
                  source:
                    scheduled.source,

                  raw:
                    scheduled.raw,

                  position:
                    scheduled.position,

                  date:
                    scheduled.date,

                  dateKey:
                    scheduled.dateKey,
                }
              : null,
        };

        target.availability[
          dateKey
        ] = mergeAvailability(
          target.availability[
            dateKey
          ],
          merged
        );
      }
    }
  }

  return Array.from(
    peopleMap.values()
  );
}

/* =========================================================
   MAIN LOADER
========================================================= */

async function loadFilterData(
  month
) {
  /*
    FIX UTAMA:

    spreadsheet sumber = month.sheetId

    Jadi:
    2026-10 -> spreadsheet Oktober
    2026-09 -> spreadsheet September
  */

  const sourceSpreadsheetId =
    month.sheetId ||
    SPREADSHEET_ID;

  const [
    lgyFilterRows,
    ngFilterRows,
    lgyScheduleRows,
    ngScheduleRows,
  ] = await Promise.all([
    readSheet(
      sourceSpreadsheetId,
      "[LGY] Filter"
    ),

    readSheet(
      sourceSpreadsheetId,
      "[NG] Filter"
    ),

    readSheet(
      sourceSpreadsheetId,
      "[LGY] Schedule"
    ),

    readSheet(
      sourceSpreadsheetId,
      "[NG] Schedule"
    ),
  ]);

  const parsedLGY =
    parseFilterSheet(
      lgyFilterRows,
      "[LGY] Filter"
    );

  const parsedNG =
    parseFilterSheet(
      ngFilterRows,
      "[NG] Filter"
    );

  const scheduleLGY =
    parseScheduleSheet(
      lgyScheduleRows,
      "[LGY] Schedule"
    );

  const scheduleNG =
    parseScheduleSheet(
      ngScheduleRows,
      "[NG] Schedule"
    );

  const scheduleEntries = [
    ...scheduleLGY,
    ...scheduleNG,
  ];

  const scheduleIndexes =
    buildScheduleIndexes(
      scheduleEntries
    );

  const people =
    combinePeople(
      [
        parsedLGY,
        parsedNG,
      ],
      scheduleIndexes
    );

  /*
    Semua tanggal yang tersedia
    dari Filter.

    Deduplicate berdasarkan dateKey.
  */

  const dateMap = new Map();

  for (const parsed of [
    parsedLGY,
    parsedNG,
  ]) {
    for (const dateColumn of parsed.dateColumns) {
      if (
        !dateMap.has(
          dateColumn.dateKey
        )
      ) {
        dateMap.set(
          dateColumn.dateKey,
          dateColumn
        );
      }
    }
  }

  const dates = Array.from(
    dateMap.values()
  ).sort(
    (a, b) =>
      a.date.getTime() -
      b.date.getTime()
  );

  const scheduledPeople =
    new Set();

  const leavePeople =
    new Set();

  for (const person of people) {
    for (const item of Object.values(
      person.availability
    )) {
      if (item.scheduled) {
        scheduledPeople.add(
          person.name
        );
      }

      if (item.isLeave) {
        leavePeople.add(
          person.name
        );
      }
    }
  }

  return {
    sourceSpreadsheetId,

    tabsScanned: [
      "[LGY] Filter",
      "[NG] Filter",
    ],

    scheduleTabsScanned: [
      "[LGY] Schedule",
      "[NG] Schedule",
    ],

    totalRoleRowsScanned:
      lgyFilterRows.length +
      ngFilterRows.length,

    totalScheduleEntriesScanned:
      scheduleEntries.length,

    scheduledPeopleCount:
      scheduledPeople.size,

    leavePeopleCount:
      leavePeople.size,

    dates,

    people,
  };
}

/* =========================================================
   API HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        error: "Method not allowed",
      });
    }

    const requestedMonth =
      clean(req.query.month);

    const refresh =
      String(
        req.query.refresh || ""
      ) === "1";

    const month =
      MONTHS.find(
        (item) =>
          item.id === requestedMonth
      ) || MONTHS[0];

    if (!month) {
      return res.status(400).json({
        error:
          "Month tidak tersedia.",
      });
    }

    /*
      Cache ikut:

      month + spreadsheet ID

      Jadi Oktober dan September
      tidak mungkin menggunakan
      cache data yang salah.
    */

    const sourceSpreadsheetId =
      month.sheetId ||
      SPREADSHEET_ID;

    const cacheKey =
      `filter:${month.id}:${sourceSpreadsheetId}`;

    if (!refresh) {
      const cached =
        cache.get(cacheKey);

      if (
        cached &&
        Date.now() -
          cached.timestamp <
          CACHE_TTL
      ) {
        return res.status(200).json(
          cached.data
        );
      }
    }

    const loaded =
      await loadFilterData(
        month
      );

    const data = {
      syncedAt:
        new Date().toISOString(),

      month: {
        id: month.id,

        label: month.label,

        sheetId:
          month.sheetId,
      },

      availableMonths:
        MONTHS.map((item) => ({
          id: item.id,

          label:
            item.label,

          sheetId:
            item.sheetId,
        })),

      tabsScanned:
        loaded.tabsScanned,

      scheduleTabsScanned:
        loaded.scheduleTabsScanned,

      totalRoleRowsScanned:
        loaded.totalRoleRowsScanned,

      totalScheduleEntriesScanned:
        loaded.totalScheduleEntriesScanned,

      scheduledPeopleCount:
        loaded.scheduledPeopleCount,

      leavePeopleCount:
        loaded.leavePeopleCount,

      dates:
        loaded.dates.map(
          (item) => ({
            date:
              item.header,

            dateKey:
              item.dateKey,

            source:
              item.source,
          })
        ),

      people:
        loaded.people,
    };

    cache.set(cacheKey, {
      timestamp: Date.now(),
      data,
    });

    /*
      Cache cleanup sederhana.
    */

    for (const [
      key,
      value,
    ] of cache.entries()) {
      if (
        Date.now() -
          value.timestamp >
        CACHE_TTL
      ) {
        cache.delete(key);
      }
    }

    return res.status(200).json(
      data
    );
  } catch (error) {
    console.error(
      "FILTER API ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "Gagal mengambil data filter.",

      detail:
        error?.message ||
        String(error),
    });
  }
}