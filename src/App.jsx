import { useEffect, useMemo, useRef, useState } from "react";

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

export default function App() {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [errorMessage, setErrorMessage] = useState("");
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [cabangFilter, setCabangFilter] = useState("Semua Cabang");
  // activeMonthId = bulan yang sedang diminta/ditampilkan user (dipakai untuk
  // value dropdown & target retry), beda dari data.month.id yang baru berubah
  // setelah fetch benar-benar sukses.
  const [activeMonthId, setActiveMonthId] = useState(null);

  // Ref supaya interval auto-refresh selalu tahu bulan yang sedang aktif saat
  // ini, tanpa perlu re-create interval-nya tiap kali activeMonthId berubah.
  const activeMonthIdRef = useRef(null);
  // Ref supaya auto-refresh tidak numpuk fetch kalau sedang loading/error
  // (mis. koneksi lambat), dicek lewat state terbaru saat interval jalan.
  const statusRef = useRef("loading");

  useEffect(() => {
    activeMonthIdRef.current = activeMonthId;
  }, [activeMonthId]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Fetch sekali saat pertama kali dibuka: backend otomatis pakai bulan terbaru.
  useEffect(() => {
    loadData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh tiap 5 menit, silent (tidak menampilkan spinner loading
  // penuh) supaya user yang sedang baca list tidak terganggu tampilannya
  // tiba-tiba kosong lalu terisi lagi. Kalau lagi ada error state, auto
  // refresh tetap dicoba (pakai bulan terakhir yang diminta).
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
      // Klik tombol "Sinkron" manual harus benar-benar ambil data baru dari
      // Google Sheets, melewati cache server (yang dipakai supaya banyak
      // user + auto-refresh tiap 5 menit tidak masing-masing hit Sheets API).
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
      // Auto-refresh yang gagal diam-diam saja (tidak melempar user ke layar
      // error) supaya tidak mengganggu data yang sedang ditampilkan; user
      // masih bisa refresh manual kalau mau lihat pesan errornya.
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
        {status === "ready" && (
          <div className="topbar-meta">
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
      </header>

      <main className="content">
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
      </main>
    </div>
  );
}