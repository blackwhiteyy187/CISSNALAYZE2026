import { useEffect, useMemo, useRef, useState } from "react";
import FilterView from "./FilterView";

const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 menit

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

function initials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

function monthLabelFor(monthId, data) {
  if (!monthId) return "";
  const found = data?.availableMonths?.find((m) => m.id === monthId);
  return found ? found.label : "";
}

function ConflictView() {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [errorMessage, setErrorMessage] = useState("");
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [cabangFilter, setCabangFilter] = useState("Semua Cabang");
  const [activeMonthId, setActiveMonthId] = useState(null);

  const activeMonthIdRef = useRef(null);
  const statusRef = useRef("loading");

  useEffect(() => {
    activeMonthIdRef.current = activeMonthId;
  }, [activeMonthId]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

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
    if (!silent) {
      setStatus("loading");
    }
    setActiveMonthId(targetMonthId);
    try {
      const params = new URLSearchParams();
      if (targetMonthId) params.set("month", targetMonthId);
      if (forceRefresh) params.set("refresh", "1");
      const qs = params.toString();
      const url = qs ? `/api/schedule?${qs}` : "/api/schedule";
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal mengambil data.");
      setData(json);
      setActiveMonthId(json.month?.id || targetMonthId || null);
      if (!silent) {
        setCabangFilter("Semua Cabang");
      }
      setStatus("ready");
    } catch (err) {
      if (silent) {
        console.error("Auto-refresh gagal:", err.message);
        return;
      }
      setErrorMessage(err.message);
      setStatus("error");
    }
  }

  function handleMonthChange(newMonthId) {
    loadData(newMonthId);
  }

  const cabangOptions = useMemo(() => {
    if (!data) return ["Semua Cabang"];
    const set = new Set();
    data.conflicts.forEach((c) => c.cabang && set.add(c.cabang));
    return ["Semua Cabang", ...Array.from(set).sort()];
  }, [data]);

  const filteredConflicts = useMemo(() => {
    if (!data) return [];
    return data.conflicts.filter((c) => {
      const matchesSearch = c.name
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchesCabang =
        cabangFilter === "Semua Cabang" || c.cabang === cabangFilter;
      return matchesSearch && matchesCabang;
    });
  }, [data, search, cabangFilter]);

  return (
    <>
      {status === "ready" && (
        <div className="topbar-meta" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <span className="synced-at">
            Tersinkron {formatSyncedAt(data.syncedAt)}
            <span className="synced-auto-note"> · auto tiap 5 menit</span>
          </span>
          <button
            className="btn-ghost"
            onClick={() => loadData(activeMonthId, { forceRefresh: true })}
            aria-label="Sinkron ulang"
          >
            <span className="btn-ghost-icon">⟳</span>
            <span className="btn-ghost-label">Sinkron</span>
          </button>
        </div>
      )}

      {status === "loading" && (
        <div className="state-block">
          <div className="spinner" aria-hidden="true" />
          <p>Mengambil data jadwal…</p>
        </div>
      )}

      {status === "error" && (
        <div className="state-block state-error">
          <p className="state-title">Gagal memuat data</p>
          <p>{errorMessage}</p>
          {activeMonthId && (
            <p className="state-sub">
              Sedang mencoba memuat:{" "}
              {monthLabelFor(activeMonthId, data) || activeMonthId}
            </p>
          )}
          <button
            className="btn-primary"
            onClick={() => loadData(activeMonthId, { forceRefresh: true })}
          >
            Coba lagi
          </button>
        </div>
      )}

      {status === "ready" && (
        <>
          <section className="hero">
            <div className="hero-number">{filteredConflicts.length}</div>
            <div className="hero-label">
              nama terjadwal ganda
              {cabangFilter !== "Semua Cabang" ? ` di ${cabangFilter}` : ""}
            </div>
            {data.month && (
              <div className="hero-month">{data.month.label}</div>
            )}
          </section>

          <section className="filters">
            <input
              className="input input-search"
              type="text"
              placeholder="Cari nama…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="filter-row">
              {data.availableMonths && data.availableMonths.length > 0 && (
                <select
                  className="input select"
                  value={activeMonthId || data.month?.id || ""}
                  onChange={(e) => handleMonthChange(e.target.value)}
                  aria-label="Pilih bulan"
                >
                  {data.availableMonths.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
              <select
                className="input select"
                value={cabangFilter}
                onChange={(e) => setCabangFilter(e.target.value)}
                aria-label="Pilih cabang"
              >
                {cabangOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="list">
            {filteredConflicts.length === 0 && (
              <div className="state-block state-empty">
                <p>Tidak ada nama double untuk filter ini.</p>
              </div>
            )}

            {filteredConflicts.map((c) => (
              <article
                key={`${c.name}__${c.cabang}`}
                className="conflict-card"
              >
                <div className="conflict-head">
                  <div className="avatar">{initials(c.name)}</div>
                  <div className="conflict-headtext">
                    <div className="conflict-name">{c.name}</div>
                    <div className="conflict-cabang">{c.cabang}</div>
                  </div>
                  <div className="conflict-count">{c.count} slot</div>
                </div>
                <ul className="slot-list">
                  {c.slots.map((s, i) => (
                    <li key={i} className="slot-row">
                      <div className="slot-row-top">
                        <span className="slot-date">{s.date}</span>
                        <span className="chip">{s.cabang}</span>
                      </div>
                      <span className="slot-role">
                        {s.posisi}
                        {s.subposisi ? ` · ${s.subposisi}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>
        </>
      )}
    </>
  );
}

function TabButton({ active, onClick, children }) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);

  // Efek "3D": shadow lebih tebal + naik dikit saat hover, dan
  // "ketekan" (translateY turun, shadow tipis) saat active/klik.
  const lifted = active || hover;
  const translateY = pressed ? 1 : lifted ? -2 : 0;
  const shadow = pressed
    ? "0 1px 0 rgba(124,58,237,0.25)"
    : active
    ? "0 4px 14px rgba(124,58,237,0.45), 0 2px 0 rgba(91,33,182,0.9)"
    : hover
    ? "0 4px 10px rgba(0,0,0,0.08)"
    : "0 1px 2px rgba(0,0,0,0.05)";

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        padding: "9px 18px",
        borderRadius: 10,
        border: "1px solid " + (active ? "#7c3aed" : "#d1d5db"),
        background: active
          ? "linear-gradient(135deg, #8b5cf6, #6d28d9)"
          : hover
          ? "#f5f3ff"
          : "#fff",
        color: active ? "#fff" : "#374151",
        fontWeight: 600,
        cursor: "pointer",
        transform: `translateY(${translateY}px)`,
        boxShadow: shadow,
        transition: "transform 150ms ease, box-shadow 150ms ease, background 150ms ease",
      }}
    >
      {children}
    </button>
  );
}

export default function App() {
  const [tab, setTab] = useState("conflict"); // conflict | filter

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar-title">
          <img
            src="/logo.png"
            alt="CISS"
            className="topbar-logo"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              e.currentTarget.nextSibling.style.display = "inline-flex";
            }}
          />
          <span className="topbar-mark topbar-mark-fallback">CS</span>
          <span className="topbar-brand">CISS Analyze</span>
        </div>
      </header>

      <nav
        style={{
          display: "flex",
          gap: 10,
          padding: "16px 24px",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <TabButton active={tab === "conflict"} onClick={() => setTab("conflict")}>
          Cek Double
        </TabButton>
        <TabButton active={tab === "filter"} onClick={() => setTab("filter")}>
          Filter Nama
        </TabButton>
      </nav>

      <main className="content">
        {tab === "conflict" ? <ConflictView /> : <FilterView />}
      </main>
    </div>
  );
}