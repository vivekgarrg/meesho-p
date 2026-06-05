import React,{ useState, useEffect } from "react";
import { API, C, fmt, S, SKUTable, StatCard, btn } from "../../App";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// ── Date helpers (same pattern as OverviewTab) ────────────────────────────────

function fmtMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function monthToRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { date_from: `${ym}-01`, date_to: `${ym}-${String(last).padStart(2, "0")}` };
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({ mode, setMode, selMonth, setSelMonth, months,
                     customFrom, setCustomFrom, customTo, setCustomTo, onApply }) {
  const pill = (active) => ({
    padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
    fontSize: 12, fontWeight: active ? 700 : 500, fontFamily: "inherit",
    background: active ? C.orange : C.gray100,
    color: active ? C.white : C.gray600,
    transition: "all 0.15s",
  });

  return (
    <div style={{ ...S.card, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 4 }}>
        📅 Filter
      </span>

      <button style={pill(mode === "all")} onClick={() => { setMode("all"); onApply({}); }}>
        All Time
      </button>

      <select
        value={mode === "month" ? selMonth : ""}
        onChange={e => {
          const m = e.target.value;
          if (!m) return;
          setMode("month"); setSelMonth(m); onApply(monthToRange(m));
        }}
        style={{
          ...S.inp, width: "auto", minWidth: 175, cursor: "pointer", fontSize: 12,
          background: mode === "month" ? C.orangeLight : C.white,
          borderColor: mode === "month" ? C.orange : C.gray300,
          color: mode === "month" ? C.orange : C.gray700,
          fontWeight: mode === "month" ? 700 : 400,
        }}
      >
        <option value="">Select month…</option>
        {months.map(m => <option key={m} value={m}>{fmtMonth(m)}</option>)}
      </select>

      <span style={{ color: C.gray300, fontSize: 18 }}>|</span>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, color: C.gray500, fontWeight: 600 }}>Custom:</span>
        <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
          style={{ ...S.inp, width: 140, fontSize: 12, padding: "7px 10px" }} />
        <span style={{ color: C.gray400, fontSize: 13 }}>→</span>
        <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
          style={{ ...S.inp, width: 140, fontSize: 12, padding: "7px 10px" }} />
        <button
          disabled={!customFrom || !customTo}
          onClick={() => {
            if (!customFrom || !customTo) return;
            setMode("custom"); onApply({ date_from: customFrom, date_to: customTo });
          }}
          style={{ ...btn(mode === "custom" ? "primary" : "ghost", "sm"), opacity: (!customFrom || !customTo) ? 0.45 : 1 }}
        >Apply</button>
      </div>
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export function SKUAnalysisTab() {
  const [allData, setAllData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view,    setView]    = useState("all");

  // Date filter state
  const [months,      setMonths]      = useState([]);
  const [mode,        setMode]        = useState("month");
  const [selMonth,    setSelMonth]    = useState("");
  const [customFrom,  setCustomFrom]  = useState("");
  const [customTo,    setCustomTo]    = useState("");
  const [activeRange, setActiveRange] = useState(null); // null = waiting for init

  // ── Init: fetch available months, default to latest ────────────────────────
  useEffect(() => {
    fetch(`${API}/profit/available-months/`)
      .then(r => r.json())
      .then(ms => {
        setMonths(ms);
        if (ms.length > 0) {
          setMode("month"); setSelMonth(ms[0]);
          setActiveRange(monthToRange(ms[0]));
        } else {
          setActiveRange({});
        }
      })
      .catch(() => setActiveRange({}));
  }, []);

  // ── Fetch SKU data whenever activeRange changes ────────────────────────────
  useEffect(() => {
    if (activeRange === null) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (activeRange.date_from) params.set("date_from", activeRange.date_from);
    if (activeRange.date_to)   params.set("date_to",   activeRange.date_to);
    fetch(`${API}/profit/?${params}`)
      .then(r => r.json())
      .then(d => {
        const raw = d.sku_wise_profit || {};
        const prepared = Object.keys(raw).map(key => ({
          sku_id:     key,
          net_profit: raw[key]["profit"] + raw[key]["loss"],
          ...raw[key],
        }));
        setAllData(prepared.sort((a, b) => b.net_profit - a.net_profit));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [JSON.stringify(activeRange)]); // eslint-disable-line

  // ── Derived ────────────────────────────────────────────────────────────────
  const profitRows = allData.filter(s => s.net_profit > 0);
  const lossRows   = [...allData.filter(s => s.net_profit < 0)].reverse();

  const viewData =
    view === "profit" ? profitRows :
    view === "loss"   ? lossRows   :
    allData;

  const totalNet    = allData.reduce((a, s) => a + s.net_profit, 0);
  const totalProfit = profitRows.reduce((a, s) => a + s.net_profit, 0);
  const totalLoss   = lossRows.reduce((a, s) => a + s.net_profit, 0);
  const bestSKU     = profitRows[0];
  const worstSKU    = lossRows[0];

  const chartData =
    view === "all"
      ? [...allData].sort((a, b) => Math.abs(b.net_profit) - Math.abs(a.net_profit)).slice(0, 10)
      : viewData.slice(0, 10);

  const filterLabel =
    mode === "month"  ? fmtMonth(selMonth) :
    mode === "custom" ? `${customFrom} → ${customTo}` :
    "All Time";

  const VIEWS = [
    { id: "all",    label: "All SKUs",    count: allData.length    },
    { id: "profit", label: "Profitable",  count: profitRows.length },
    { id: "loss",   label: "Loss-making", count: lossRows.length   },
  ];

  const chartTitle =
    view === "profit" ? `Top ${chartData.length} Profitable SKUs` :
    view === "loss"   ? `Worst ${chartData.length} Loss-making SKUs` :
                        `Top ${chartData.length} SKUs by Impact`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header + view toggle */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: C.gray800, marginBottom: 4 }}>
            📊 SKU P&L Analysis
          </h2>
          <p style={{ fontSize: 13, color: C.gray400 }}>
            Profit and loss by SKU for <strong style={{ color: C.gray600 }}>{filterLabel}</strong> — settled orders only.
          </p>
        </div>
        <div style={{ display: "flex", gap: 4, background: C.gray100, borderRadius: 10, padding: 3 }}>
          {VIEWS.map(({ id, label, count }) => {
            const active      = view === id;
            const activeColor = id === "loss" ? C.red : id === "profit" ? C.green : C.gray800;
            return (
              <button key={id} onClick={() => setView(id)} style={{
                padding: "6px 16px", borderRadius: 8, border: "none", cursor: "pointer",
                fontFamily: "inherit", fontSize: 12, fontWeight: active ? 700 : 500,
                background: active ? C.white : "transparent",
                color: active ? activeColor : C.gray500,
                boxShadow: active ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                transition: "all 0.15s",
              }}>
                {label} <span style={{ fontSize: 11, opacity: 0.7 }}>({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Date filter bar */}
      <FilterBar
        mode={mode} setMode={setMode}
        selMonth={selMonth} setSelMonth={setSelMonth}
        months={months}
        customFrom={customFrom} setCustomFrom={setCustomFrom}
        customTo={customTo}   setCustomTo={setCustomTo}
        onApply={range => setActiveRange(range)}
      />

      {/* Loading */}
      {loading && (
        <div style={{ ...S.card, textAlign: "center", padding: "60px 32px" }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>⏳</div>
          <p style={{ fontSize: 15, fontWeight: 700, color: C.gray700, marginBottom: 6 }}>Loading SKU analysis…</p>
          <p style={{ fontSize: 13, color: C.gray400 }}>Fetching profit data for {filterLabel}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && allData.length === 0 && (
        <div style={{ ...S.card, textAlign: "center", padding: "60px 32px" }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>📭</div>
          <p style={{ fontSize: 15, fontWeight: 700, color: C.gray700, marginBottom: 6 }}>No data for {filterLabel}</p>
          <p style={{ fontSize: 13, color: C.gray400 }}>No settled orders with pricing found for this period.</p>
        </div>
      )}

      {!loading && allData.length > 0 && (
        <>
          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14 }}>
            <StatCard label="Net P&L"      value={totalNet}             accent={totalNet >= 0 ? C.green : C.red} icon="💹" sub={`${allData.length} mapped SKUs`} />
            <StatCard label="Total Profit" value={totalProfit}          accent={C.green} icon="✅" sub={`${profitRows.length} SKUs earning`} />
            <StatCard label="Total Loss"   value={totalLoss}            accent={C.red}   icon="📉" sub={`${lossRows.length} SKUs in loss`} />
            {bestSKU  && <StatCard label="Best SKU"  value={bestSKU.net_profit}  accent={C.green} sub={bestSKU.sku_id}  icon="🏆" />}
            {worstSKU && <StatCard label="Worst SKU" value={worstSKU.net_profit} accent={C.red}   sub={worstSKU.sku_id} icon="⚠️" />}
          </div>

          {/* Chart */}
          {chartData.length > 0 && (
            <div style={S.card}>
              <p style={S.cardTitle}>{chartTitle}</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.gray100} />
                  <XAxis dataKey="sku_id" tick={{ fill: C.gray500, fontSize: 10 }} angle={-30} textAnchor="end" interval={0} tickLine={false} />
                  <YAxis tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }}
                    formatter={(v) => [fmt(v), "Net P&L"]}
                  />
                  <Bar dataKey="net_profit" radius={[5, 5, 0, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={entry.net_profit >= 0 ? C.green : C.red} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Table */}
          <div style={S.card}>
            <SKUTable data={viewData} mode={view} />
          </div>
        </>
      )}
    </div>
  );
}
