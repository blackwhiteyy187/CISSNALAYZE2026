import { google } from "googleapis";

const SPREADSHEET_ID =
  "1tMkfZrlH2UdhiQscr3t0E8olbOT08-n1oDsNiQQomIg";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = {
  timestamp: 0,
  data: null,
};

// =========================================================
// TAB CREW
// =========================================================

const LEGACY_TABS = Array.from(
  { length: 7 },
  (_, index) => `[LGY] PrioritasDivisi${index + 1}`
);

const NEXTGEN_TABS = Array.from(
  { length: 7 },
  (_, index) => `[NG] PrioritasSubDivisi${index + 1}`
);

// =========================================================
// CABANG
// =========================================================

const LEGACY_BRANCH = "Legacy";

const NEXTGEN_BRANCHES = [
  "NG Aruna 2",
  "NG Aruna 5",
  "NG Barsi",
  "NG Regency",
  "NG Soekhat 4",
  "NG Pusat",
];

// =========================================================
// HELPER
// =========================================================

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

// =========================================================
// PARSE NAMA
// =========================================================

function parsePersonName(rawName) {
  const value = cleanText(rawName);

  if (!value) {
    return {
      name: "",
      code: "",
    };
  }

  const match = value.match(
    /^(.*?)\s-\s([A-Za-z0-9]+)$/
  );

  if (!match) {
    return {
      name: value,
      code: "",
    };
  }

  return {
    name: cleanText(match[1]),
    code: cleanText(match[2]),
  };
}

// =========================================================
// PARSE ASSIGNMENT
// =========================================================

function parseAssignment(rawValue) {
  const value = cleanText(rawValue);

  if (!value) {
    return {
      branch: "",
      field: "",
      role: "",
    };
  }

  let branch = "";
  let remaining = value;

  const branchMatch =
    remaining.match(
      /^\[([^\]]+)\]\s*/
    );

  if (branchMatch) {
    branch = cleanText(
      branchMatch[1]
    );

    remaining = remaining
      .slice(branchMatch[0].length)
      .trim();
  }

  let field = remaining;
  let role = "";

  const separatorIndex =
    remaining.lastIndexOf(" - ");

  if (separatorIndex >= 0) {
    field = cleanText(
      remaining.slice(
        0,
        separatorIndex
      )
    );

    role = cleanText(
      remaining.slice(
        separatorIndex + 3
      )
    );
  }

  return {
    branch,
    field,
    role,
  };
}

// =========================================================
// NORMALIZE BRANCH
// =========================================================

function normalizeBranch(
  branch,
  source
) {
  const value = cleanText(branch);

  if (source === "LGY") {
    return LEGACY_BRANCH;
  }

  if (!value) {
    return "";
  }

  const matched =
    NEXTGEN_BRANCHES.find(
      (item) =>
        item.toLowerCase() ===
        value.toLowerCase()
    );

  return matched || value;
}

// =========================================================
// SOURCE DARI TAB
// =========================================================

function sourceFromTab(tabName) {
  if (tabName.startsWith("[LGY]")) {
    return "LGY";
  }

  if (tabName.startsWith("[NG]")) {
    return "NG";
  }

  return "";
}

// =========================================================
// PRIORITY DARI TAB
// =========================================================

function priorityFromTab(tabName) {
  const match =
    tabName.match(/(\d+)$/);

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

// =========================================================
// GOOGLE SHEETS AUTH
// =========================================================

async function getGoogleSheets() {
  const clientEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL;

  const privateKey =
    process.env.GOOGLE_PRIVATE_KEY;

  if (!clientEmail) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL atau GOOGLE_CLIENT_EMAIL belum diset di Environment Variables."
    );
  }

  if (!privateKey) {
    throw new Error(
      "GOOGLE_PRIVATE_KEY belum diset di Environment Variables."
    );
  }

  const auth =
    new google.auth.GoogleAuth({
      credentials: {
        client_email:
          clientEmail,

        private_key:
          privateKey.replace(
            /\\n/g,
            "\n"
          ),
      },

      scopes: [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ],
    });

  const client =
    await auth.getClient();

  return google.sheets({
    version: "v4",
    auth: client,
  });
}

// =========================================================
// GET SHEET METADATA
// =========================================================

async function getSheetMetadata(
  sheets
) {
  const response =
    await sheets.spreadsheets.get({
      spreadsheetId:
        SPREADSHEET_ID,

      fields:
        "sheets.properties",
    });

  return (
    response.data.sheets || []
  ).map((sheet) => ({
    sheetId:
      sheet.properties?.sheetId,

    title:
      sheet.properties?.title,
  }));
}

// =========================================================
// FIND SHEET
// =========================================================

function findSheet(
  sheetMetadata,
  tabName
) {
  const exact =
    sheetMetadata.find(
      (sheet) =>
        sheet.title === tabName
    );

  if (exact) {
    return exact;
  }

  const normalized =
    cleanText(tabName)
      .toLowerCase();

  return sheetMetadata.find(
    (sheet) =>
      cleanText(
        sheet.title
      ).toLowerCase() ===
      normalized
  );
}

// =========================================================
// READ SHEET
//
// Menggunakan sheetId + grid range.
// Tidak menggunakan A:B lagi.
// =========================================================

async function readSheet(
  sheets,
  sheet
) {
  if (!sheet) {
    throw new Error(
      "Sheet tidak ditemukan."
    );
  }

  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId:
        SPREADSHEET_ID,

      range: {
        sheetId:
          sheet.sheetId,

        startRowIndex: 0,

        endRowIndex: 10000,

        startColumnIndex: 0,

        endColumnIndex: 2,
      },

      valueRenderOption:
        "UNFORMATTED_VALUE",
    });

  return (
    response.data.values || []
  );
}

// =========================================================
// ADD RECORD
// =========================================================

function addRecord(
  records,
  rawName,
  rawAssignment,
  tabName
) {
  const person =
    parsePersonName(
      rawName
    );

  const assignment =
    parseAssignment(
      rawAssignment
    );

  if (
    !person.name ||
    !assignment.field
  ) {
    return;
  }

  const source =
    sourceFromTab(
      tabName
    );

  const priority =
    priorityFromTab(
      tabName
    );

  if (
    !source ||
    !priority
  ) {
    return;
  }

  const branch =
    normalizeBranch(
      assignment.branch,
      source
    );

  if (source === "LGY") {
    if (
      branch !==
      LEGACY_BRANCH
    ) {
      return;
    }
  }

  if (source === "NG") {
    if (
      !NEXTGEN_BRANCHES.includes(
        branch
      )
    ) {
      return;
    }
  }

  records.push({
    name:
      person.name,

    code:
      person.code,

    branch,

    field:
      assignment.field,

    role:
      assignment.role,

    priority,

    source,

    sourceTab:
      tabName,
  });
}

// =========================================================
// GROUP PEOPLE
// =========================================================

function buildPeople(
  records
) {
  const peopleMap =
    new Map();

  for (
    const record of records
  ) {
    const key = [
      record.source,
      record.branch,
      record.code ||
        record.name,
    ]
      .join("__")
      .toLowerCase();

    if (
      !peopleMap.has(key)
    ) {
      peopleMap.set(
        key,
        {
          name:
            record.name,

          code:
            record.code,

          branch:
            record.branch,

          source:
            record.source,

          assignments: [],

          priorities: [],

          fields: [],
        }
      );
    }

    const person =
      peopleMap.get(key);

    const assignmentExists =
      person.assignments.some(
        (item) =>
          item.field ===
            record.field &&
          item.role ===
            record.role &&
          item.priority ===
            record.priority
      );

    if (
      !assignmentExists
    ) {
      person.assignments.push({
        field:
          record.field,

        role:
          record.role,

        priority:
          record.priority,

        sourceTab:
          record.sourceTab,
      });
    }

    if (
      !person.priorities.includes(
        record.priority
      )
    ) {
      person.priorities.push(
        record.priority
      );
    }

    if (
      !person.fields.includes(
        record.field
      )
    ) {
      person.fields.push(
        record.field
      );
    }
  }

  return Array.from(
    peopleMap.values()
  )
    .map((person) => ({
      ...person,

      priorities:
        person.priorities.sort(
          (a, b) =>
            a - b
        ),

      fields:
        person.fields.sort(
          (a, b) =>
            a.localeCompare(b)
        ),

      assignments:
        person.assignments.sort(
          (a, b) =>
            a.priority -
              b.priority ||
            a.field.localeCompare(
              b.field
            )
        ),
    }))
    .sort((a, b) =>
      a.name.localeCompare(
        b.name
      )
    );
}

// =========================================================
// BUILD PAYLOAD
// =========================================================

function buildPayload(
  records
) {
  const people =
    buildPeople(records);

  const branches = {};

  for (
    const branch of [
      LEGACY_BRANCH,
      ...NEXTGEN_BRANCHES,
    ]
  ) {
    branches[branch] = {
      branch,

      source:
        branch ===
        LEGACY_BRANCH
          ? "LGY"
          : "NG",

      people: [],

      fields: [],
    };
  }

  for (
    const person of people
  ) {
    if (
      !branches[
        person.branch
      ]
    ) {
      continue;
    }

    branches[
      person.branch
    ].people.push(
      person
    );

    for (
      const field of
        person.fields
    ) {
      if (
        !branches[
          person.branch
        ].fields.includes(
          field
        )
      ) {
        branches[
          person.branch
        ].fields.push(
          field
        );
      }
    }
  }

  for (
    const branch of
      Object.values(
        branches
      )
  ) {
    branch.fields.sort(
      (a, b) =>
        a.localeCompare(b)
    );
  }

  return {
    syncedAt:
      new Date().toISOString(),

    spreadsheetId:
      SPREADSHEET_ID,

    tabsScanned: [
      ...LEGACY_TABS,
      ...NEXTGEN_TABS,
    ],

    sources: {
      Legacy:
        LEGACY_TABS,

      NextGen:
        NEXTGEN_TABS,
    },

    branches:
      Object.values(
        branches
      ),

    totalPeople:
      people.length,

    totalRecords:
      records.length,
  };
}

// =========================================================
// API HANDLER
// =========================================================

export default async function handler(
  req,
  res
) {
  try {
    const forceRefresh =
      req.query?.refresh ===
        "1" ||
      req.query?.refresh ===
        "true";

    const now =
      Date.now();

    // =====================================================
    // CACHE
    // =====================================================

    if (
      !forceRefresh &&
      cache.data &&
      now -
        cache.timestamp <
        CACHE_TTL_MS
    ) {
      return res
        .status(200)
        .json({
          ...cache.data,
          cached: true,
        });
    }

    // =====================================================
    // GOOGLE SHEETS
    // =====================================================

    const sheets =
      await getGoogleSheets();

    // Ambil semua metadata tab
    const sheetMetadata =
      await getSheetMetadata(
        sheets
      );

    const records = [];

    // =====================================================
    // BACA LEGACY
    // =====================================================

    for (
      const tabName of
        LEGACY_TABS
    ) {
      const sheet =
        findSheet(
          sheetMetadata,
          tabName
        );

      if (!sheet) {
        throw new Error(
          `Tab "${tabName}" tidak ditemukan di spreadsheet. Tab yang tersedia: ${sheetMetadata
            .map(
              (item) =>
                item.title
            )
            .join(", ")}`
        );
      }

      const rows =
        await readSheet(
          sheets,
          sheet
        );

      for (
        let rowIndex = 1;
        rowIndex <
          rows.length;
        rowIndex++
      ) {
        const row =
          rows[rowIndex];

        addRecord(
          records,
          row?.[0],
          row?.[1],
          tabName
        );
      }
    }

    // =====================================================
    // BACA NEXTGEN
    // =====================================================

    for (
      const tabName of
        NEXTGEN_TABS
    ) {
      const sheet =
        findSheet(
          sheetMetadata,
          tabName
        );

      if (!sheet) {
        throw new Error(
          `Tab "${tabName}" tidak ditemukan di spreadsheet. Tab yang tersedia: ${sheetMetadata
            .map(
              (item) =>
                item.title
            )
            .join(", ")}`
        );
      }

      const rows =
        await readSheet(
          sheets,
          sheet
        );

      for (
        let rowIndex = 1;
        rowIndex <
          rows.length;
        rowIndex++
      ) {
        const row =
          rows[rowIndex];

        addRecord(
          records,
          row?.[0],
          row?.[1],
          tabName
        );
      }
    }

    // =====================================================
    // BUILD DATA
    // =====================================================

    const payload =
      buildPayload(
        records
      );

    // =====================================================
    // CACHE
    // =====================================================

    cache = {
      timestamp: now,
      data: payload,
    };

    // =====================================================
    // RESPONSE
    // =====================================================

    return res
      .status(200)
      .json({
        ...payload,
        cached: false,
      });

  } catch (error) {
    console.error(
      "CISS CREW API ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        error:
          "Gagal mengambil data Crew",

        message:
          error?.message ||
          "Unknown error",

        ...(process.env.NODE_ENV !==
          "production" && {
          stack:
            error?.stack,
        }),
      });
  }
}