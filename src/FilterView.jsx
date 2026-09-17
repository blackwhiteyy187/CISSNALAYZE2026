import { useEffect, useMemo, useRef, useState } from "react";

const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const BRANCH_COLORS = {
  Legacy: "#7c3aed",
  "Aruna 2": "#2563eb",
  "Aruna 5": "#0891b2",
  Barsi: "#059669",
  Regency: "#d97706",
  "Soekhat 4": "#db2777",
};

function branchColor(label) {
  return BRANCH_COLORS[label] || "#6b7280";
}

function initials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

function formatSyncedAt(iso) {
  if (!iso) return "";

  const d = new Date(iso);

  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortDateLabel(label) {
  if (!label) return "";

  const match = label.match(/^[A-Za-z]{3},?\s*(\d{1,2}\s+[A-Za-z]{3})/i);

  return match ? match[1] : label;
}

export default function FilterView() {
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("Semua Cabang");
  const [onlyWithUnavailable, setOnlyWithUnavailable] = useState(false);
  const [activeMonthId, setActiveMonthId] = useState(null);

  const activeMonthIdRef = useRef(null);

  useEffect(() => {
    activeMonthIdRef.current = activeMonthId;
  }, [activeMonthId]);

  useEffect(() => {
    loadData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      loadData(activeMonthIdRef.current, { silent: true });
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData(targetMonthId, options = {}) {
    const { silent = false, forceRefresh = false } = options;

    if (!silent) setStatus("loading");

    try {
      const params = new URLSearchParams();
      if (targetMonthId) params.set("month", targetMonthId);
      if (forceRefresh) params.set("refresh", "1");

      const qs = params.toString();
      const url = qs ? `/api/filter?${qs}` : "/api/filter";

      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal mengambil data.");

      setData(json);
      setActiveMonthId(json.month?.id || targetMonthId || null);

      if (!silent) {
        setSearch("");
        setBranchFilter("Semua Cabang");
      }

      setStatus("ready");
    } catch (err) {
      if (silent) {
        console.error("Auto-refresh filter gagal:", err.message);
        return;
      }
      setErrorMessage(err.message);
      setStatus("error");
    }
  }

  function handleMonthChange(newMonthId) {
    loadData(newMonthId);
  }

  const branchOptions = useMemo(() => {
    if (!data) return ["Semua Cabang"];
    return ["Semua Cabang", ...data.branches.map((b) => b.branchLabel)];
  }, [data]);

  const filteredBranches = useMemo(() => {
    if (!data) return [];

    return data.branches
      .filter(
        (branch) =>
          branchFilter === "Semua Cabang" ||
          branch.branchLabel === branchFilter
      )
      .map((branch) => ({
        ...branch,
        people: branch.people.filter((person) => {
          const matchesSearch = person.name
            .toLowerCase()
            .includes(search.toLowerCase());
          const matchesUnavail =
            !onlyWithUnavailable || person.unavailableCount > 0;
          return matchesSearch && matchesUnavail;
        }),
      }))
      .filter((branch) => branch.people.length > 0);
  }, [data, search, branchFilter, onlyWithUnavailable]);

  const totalPeopleShown = filteredBranches.reduce(
    (sum, branch) => sum + branch.people.length,
    0
  );

  return (
    <div className="filterview-wrap">
      {status === "loading" && (
        <div className="state-block">
          <div className="spinner" aria-hidden="true" />
          <p>Mengambil data availability…</p>
        </div>
      )}

      {status === "error" && (
        <div className="state-block state-error">
          <p className="state-title">Gagal memuat data</p>
          <p>{errorMessage}</p>
          <button
            className="btn-primary"
            onClick={() => loadData(activeMonthId, { forceRefresh: true })}
          >
            Coba lagi
          </button>
        </div>
      )}

      {status === "ready" && data && (
        <>
          {/* SUMMARY */}
          <section className="filterview-summary">
            <div className="filterview-number">{totalPeopleShown}</div>
            <div className="filterview-numlabel">
              orang ditampilkan
              {branchFilter !== "Semua Cabang" ? ` di ${branchFilter}` : ""}
            </div>
            <div className="filterview-badges">
              {data.month && (
                <span className="filterview-badge-month">
                  {data.month.label}
                </span>
              )}
              {data.syncedAt && (
                <span className="filterview-badge-synced">
                  Tersinkron {formatSyncedAt(data.syncedAt)}
                </span>
              )}
            </div>
          </section>

          {/* FILTER BAR */}
          <section className="filterview-bar">
            <input
              type="text"
              placeholder="Cari nama…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input filterview-input"
            />

            {data.availableMonths && data.availableMonths.length > 0 && (
              <select
                value={activeMonthId || data.month?.id || ""}
                onChange={(e) => handleMonthChange(e.target.value)}
                aria-label="Pilih bulan"
                className="select filterview-select"
              >
                {data.availableMonths.map((month) => (
                  <option key={month.id} value={month.id}>
                    {month.label}
                  </option>
                ))}
              </select>
            )}

            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              aria-label="Pilih cabang"
              className="select filterview-select"
            >
              {branchOptions.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>

            <label className="filterview-checkbox-label">
              <input
                type="checkbox"
                checked={onlyWithUnavailable}
                onChange={(e) => setOnlyWithUnavailable(e.target.checked)}
              />
              Hanya yang ada unavailable
            </label>
          </section>

          {filteredBranches.length === 0 && (
            <div className="state-block state-empty">
              <p>Tidak ada orang untuk filter ini.</p>
            </div>
          )}

          {/* BRANCH LIST */}
          <div className="filterview-branch-list">
            {filteredBranches.map((branch) => {
              const color = branchColor(branch.branchLabel);

              const allDates = [];
              const seen = new Set();

              branch.people.forEach((person) => {
                person.availability.forEach((availability) => {
                  const key = `${availability.source}__${availability.dateKey}`;
                  if (!seen.has(key)) {
                    seen.add(key);
                    allDates.push(availability);
                  }
                });
              });

              const legacyDates = allDates
                .filter((date) => date.source === "Legacy")
                .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

              const nextGenDates = allDates
                .filter((date) => date.source === "NextGen")
                .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

              const hasBothSources =
                legacyDates.length > 0 && nextGenDates.length > 0;

              const branchDates = [
                ...legacyDates,
                ...(hasBothSources
                  ? [
                      {
                        source: "SPACER",
                        dateKey: "spacer-legacy-nextgen",
                        date: "",
                      },
                    ]
                  : []),
                ...nextGenDates,
              ];

              return (
                <div
                  key={branch.branchLabel}
                  className="filterview-branch-card"
                >
                  <div
                    className="filterview-branch-header"
                    style={{ background: color }}
                  >
                    <span className="filterview-branch-name">
                      {branch.branchLabel}
                    </span>
                    <span className="filterview-branch-count">
                      {branch.people.length} orang
                    </span>
                  </div>

                  <div className="filterview-table-wrap filterview-desktop-only">
                    <table className="filterview-table">
                      <thead>
                        <tr>
                          <th className="filterview-th filterview-th-name">
                            Nama
                          </th>

                          {legacyDates.length > 0 && (
                            <th
                              colSpan={legacyDates.length}
                              className="filterview-th filterview-th-source filterview-th-legacy"
                            >
                              Legacy
                            </th>
                          )}

                          {hasBothSources && (
                            <th className="filterview-th-spacer" />
                          )}

                          {nextGenDates.length > 0 && (
                            <th
                              colSpan={nextGenDates.length}
                              className="filterview-th filterview-th-source filterview-th-nextgen"
                            >
                              NextGen
                            </th>
                          )}
                        </tr>

                        <tr>
                          <th className="filterview-th filterview-th-name">
                            Nama
                          </th>

                          {branchDates.map((date) => {
                            if (date.source === "SPACER") {
                              return (
                                <th
                                  key={date.dateKey}
                                  className="filterview-th-spacer"
                                />
                              );
                            }

                            return (
                              <th
                                key={`${date.source}__${date.dateKey}`}
                                className="filterview-th"
                                title={date.date}
                              >
                                {shortDateLabel(date.date)}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>

                      <tbody>
                        {branch.people.map((person, index) => {
                          const availabilityMap = new Map(
                            person.availability.map((item) => [
                              `${item.source}__${item.dateKey}`,
                              item,
                            ])
                          );

                          return (
                            <tr
                              key={person.name}
                              className={
                                index % 2 === 1
                                  ? "filterview-row filterview-row-alt"
                                  : "filterview-row"
                              }
                            >
                              <td className="filterview-td filterview-td-name">
                                <span
                                  className="filterview-avatar"
                                  style={{ background: color }}
                                >
                                  {initials(person.name)}
                                </span>
                                {person.name}
                              </td>

                              {branchDates.map((date) => {
                                if (date.source === "SPACER") {
                                  return (
                                    <td
                                      key={date.dateKey}
                                      className="filterview-td-spacer"
                                    />
                                  );
                                }

                                const key = `${date.source}__${date.dateKey}`;
                                const availability = availabilityMap.get(key);
                                const isUnavail =
                                  availability?.status === "unavailable";
                                const isOther =
                                  availability?.status === "other";

                                return (
                                  <td
                                    key={key}
                                    className="filterview-td"
                                    title={
                                      availability
                                        ? `raw: "${availability.raw}"`
                                        : "tidak ada data"
                                    }
                                  >
                                    {isUnavail && (
                                      <span className="filterview-unavail">
                                        X
                                      </span>
                                    )}

                                    {isOther && (
                                      <span className="filterview-other">
                                        {availability.raw || "?"}
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mode list untuk panel sempit (Google Sheets) — tanpa tabel,
                      tanpa scroll horizontal, tanggal ditampilkan sebagai chip. */}
                  <div className="filterview-mobile-list filterview-mobile-only">
                    {branch.people.map((person) => {
                      const flagged = person.availability.filter(
                        (a) =>
                          a.status === "unavailable" || a.status === "other"
                      );

                      return (
                        <div
                          key={person.name}
                          className="filterview-mrow"
                        >
                          <div className="filterview-mrow-head">
                            <span
                              className="filterview-avatar"
                              style={{ background: color }}
                            >
                              {initials(person.name)}
                            </span>
                            <span className="filterview-mrow-name">
                              {person.name}
                            </span>
                          </div>

                          {flagged.length === 0 ? (
                            <div className="filterview-mrow-empty">
                              Tersedia semua tanggal
                            </div>
                          ) : (
                            <div className="filterview-mrow-chips">
                              {flagged.map((a) => (
                                <span
                                  key={`${a.source}__${a.dateKey}`}
                                  className={
                                    a.status === "unavailable"
                                      ? "filterview-mchip filterview-mchip-unavail"
                                      : "filterview-mchip filterview-mchip-other"
                                  }
                                  title={`raw: "${a.raw}"`}
                                >
                                  {shortDateLabel(a.date)}
                                  {a.status === "other"
                                    ? ` · ${a.raw || "?"}`
                                    : ""}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}