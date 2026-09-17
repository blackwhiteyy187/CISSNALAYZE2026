import { google } from "googleapis";

// ============================================================
// CISS CREW API
// ============================================================

const SPREADSHEET_ID =
  "1tMkfZrlH2UdhiQscr3t0E8olbOT08-n1oDsNiQQomIg";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = {
  timestamp: 0,
  data: null,
};

// ============================================================
// EXPECTED TABS
// ============================================================

const LEGACY_TABS = Array.from(
  { length: 7 },
  (_, index) => `[LGY] PrioritasDivisi${index + 1}`
);

const NEXTGEN_TABS = Array.from(
  { length: 7 },
  (_, index) => `[NG] PrioritasSubDivisi${index + 1}`
);

const EXPECTED_TABS = [
  ...LEGACY_TABS,
  ...NEXTGEN_TABS,
];

// ============================================================
// BRANCH
// ============================================================

const LEGACY_BRANCH = "Legacy";

const NEXTGEN_BRANCHES = [
  "NG Aruna 2",
  "NG Aruna 5",
  "NG Barsi",
  "NG Regency",
  "NG Soekhat 4",
  "NG Pusat",
];

// ============================================================
// HELPERS
// ============================================================

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================
// GOOGLE AUTH
// Mengikuti pola api/filter.js
// ============================================================

function getAuth() {
  const email =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL;

  const key = (
    process.env.GOOGLE_PRIVATE_KEY || ""
  ).replace(/\\n/g, "\n");

  if (!email || !key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_CLIENT_EMAIL atau GOOGLE_PRIVATE_KEY belum di-set di Environment Variables."
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
// PARSE PERSON
// Contoh:
// Troy Alexander Abednego - N2AR2311004
// ============================================================

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

// ============================================================
// PARSE ASSIGNMENT
//
// Contoh:
// [NG Aruna 2] [On-Stage] Multimedia - Multimedia
// ============================================================

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

  const branchMatch = remaining.match(
    /^\[([^\]]+)\]\s*/
  );

  if (branchMatch) {
    branch = cleanText(branchMatch[1]);

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
      remaining.slice(0, separatorIndex)
    );

    role = cleanText(
      remaining.slice(separatorIndex + 3)
    );
  }

  return {
    branch,
    field,
    role,
  };
}

// ============================================================
// SOURCE
// ============================================================

function sourceFromTab(tabName) {
  if (tabName.startsWith("[LGY]")) {
    return "LGY";
  }

  if (tabName.startsWith("[NG]")) {
    return "NG";
  }

  return "";
}

// ============================================================
// PRIORITY
// ============================================================

function priorityFromTab(tabName) {
  const match =
    tabName.match(/(\d+)$/);

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

// ============================================================
// NORMALIZE BRANCH
// ============================================================

function normalizeBranch(
  branch,
  source
) {
  const value =
    cleanText(branch);

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

// ============================================================
// READ CREW TAB
// ============================================================

async function readSheet(
  sheets,
  tabName
) {
  const range =
    `'${tabName}'!A1:B10000`;

  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId:
        SPREADSHEET_ID,
      range,
      valueRenderOption:
        "UNFORMATTED_VALUE",
    });

  return (
    response.data.values || []
  );
}

// ============================================================
// ADD RECORD
// ============================================================

function addRecord(
  records,
  rawName,
  rawAssignment,
  tabName
) {
  const person =
    parsePersonName(rawName);

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
    sourceFromTab(tabName);

  const priority =
    priorityFromTab(tabName);

  if (!source || !priority) {
    return;
  }

  const branch =
    normalizeBranch(
      assignment.branch,
      source
    );

  if (
    source === "LGY" &&
    branch !== LEGACY_BRANCH
  ) {
    return;
  }

  if (
    source === "NG" &&
    !NEXTGEN_BRANCHES.includes(
      branch
    )
  ) {
    return;
  }

  records.push({
    name: person.name,
    code: person.code,
    branch,
    field: assignment.field,
    role: assignment.role,
    priority,
    source,
    sourceTab: tabName,
  });
}

// ============================================================
// GROUP PEOPLE
// ============================================================

function buildPeople(records) {
  const peopleMap = new Map();

  for (const record of records) {
    const key = [
      record.source,
      record.branch,
      record.code || record.name,
    ]
      .join("__")
      .toLowerCase();

    if (!peopleMap.has(key)) {
      peopleMap.set(key, {
        name: record.name,
        code: record.code,
        branch: record.branch,
        source: record.source,
        assignments: [],
        priorities: [],
        fields: [],
      });
    }

    const person =
      peopleMap.get(key);

    const exists =
      person.assignments.some(
        (item) =>
          item.field ===
            record.field &&
          item.role ===
            record.role &&
          item.priority ===
            record.priority
      );

    if (!exists) {
      person.assignments.push({
        field: record.field,
        role: record.role,
        priority: record.priority,
        sourceTab: record.sourceTab,
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
          (a, b) => a - b
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

// ============================================================
// BUILD PAYLOAD
// ============================================================

function buildPayload(
  records,
  availableTabs
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
        branch === LEGACY_BRANCH
          ? "LGY"
          : "NG",

      people: [],
      fields: [],
    };
  }

  for (const person of people) {
    if (
      !branches[person.branch]
    ) {
      continue;
    }

    branches[
      person.branch
    ].people.push(person);

    for (
      const field of person.fields
    ) {
      if (
        !branches[
          person.branch
        ].fields.includes(field)
      ) {
        branches[
          person.branch
        ].fields.push(field);
      }
    }
  }

  for (
    const branch of Object.values(
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

    tabsExpected:
      EXPECTED_TABS,

    tabsFound:
      availableTabs,

    tabsScanned:
      availableTabs.filter(
        (tab) =>
          EXPECTED_TABS.includes(tab)
      ),

    missingTabs:
      EXPECTED_TABS.filter(
        (tab) =>
          !availableTabs.includes(tab)
      ),

    sources: {
      Legacy:
        LEGACY_TABS,

      NextGen:
        NEXTGEN_TABS,
    },

    branches:
      Object.values(branches),

    totalPeople:
      people.length,

    totalRecords:
      records.length,
  };
}

// ============================================================
// API
// ============================================================

export default async function handler(
  req,
  res
) {
  try {
    const forceRefresh =
      req.query?.refresh === "1" ||
      req.query?.refresh === "true";

    const debug =
      req.query?.debug === "1";

    const now = Date.now();

    // ========================================================
    // CACHE
    // ========================================================

    if (
      !forceRefresh &&
      !debug &&
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

    // ========================================================
    // AUTH
    // ========================================================

    const auth = getAuth();

    const sheets =
      google.sheets({
        version: "v4",
        auth,
      });

    // ========================================================
    // GET SPREADSHEET METADATA
    // ========================================================

    const meta =
      await sheets.spreadsheets.get({
        spreadsheetId:
          SPREADSHEET_ID,

        fields:
          "sheets.properties",
      });

    const availableTabs =
      (
        meta.data.sheets || []
      ).map(
        (sheet) =>
          sheet.properties.title
      );

    // ========================================================
    // FIND EXPECTED TABS
    // ========================================================

    const foundTabs =
      EXPECTED_TABS.filter(
        (tab) =>
          availableTabs.includes(tab)
      );

    const missingTabs =
      EXPECTED_TABS.filter(
        (tab) =>
          !availableTabs.includes(tab)
      );

    // ========================================================
    // KALAU ADA TAB YANG HILANG
    // ========================================================

    if (missingTabs.length > 0) {
      return res
        .status(500)
        .json({
          error:
            "Ada tab Crew yang tidak ditemukan di Google Sheets.",

          spreadsheetId:
            SPREADSHEET_ID,

          expectedTabs:
            EXPECTED_TABS,

          foundTabs:
            availableTabs,

          missingTabs,
        });
    }

    // ========================================================
    // READ ALL CREW TABS
    // ========================================================

    const records = [];

    for (
      const tabName of foundTabs
    ) {
      const rows =
        await readSheet(
          sheets,
          tabName
        );

      // Row 0 dianggap header
      for (
        let rowIndex = 1;
        rowIndex < rows.length;
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

    // ========================================================
    // BUILD
    // ========================================================

    const payload =
      buildPayload(
        records,
        availableTabs
      );

    // ========================================================
    // DEBUG
    // ========================================================

    if (debug) {
      return res
        .status(200)
        .json({
          ...payload,

          debug: {
            expectedTabs:
              EXPECTED_TABS,

            availableTabs,

            foundTabs,

            missingTabs,

            recordSample:
              records.slice(
                0,
                20
              ),
          },
        });
    }

    // ========================================================
    // CACHE
    // ========================================================

    cache = {
      timestamp: now,
      data: payload,
    };

    // ========================================================
    // RESPONSE
    // ========================================================

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
          "production"
          ? {
              stack:
                error?.stack,
            }
          : {}),
      });
  }
}