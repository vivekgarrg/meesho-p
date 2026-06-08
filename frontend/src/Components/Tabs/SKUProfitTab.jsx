import React,{ useState, useEffect } from "react";
import { API, C, fmt, S, SKUTable, StatCard, btn } from "../../App";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

// ── SKU detail modal (monthly drill-down) ─────────────────────────────────────

function SKUDetailModal({ sku, months, onClose }) {
  const [monthlyData, setMonthlyData] = useState([]);
  const [loading, setLoading] = useState(true);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Fetch each month in parallel
  useEffect(() => {
    setLoading(true);
    const fetches = months.map(m => {
      const range = monthToRange(m);
      return fetch(`${API}/profit/?${new URLSearchParams(range)}`)
        .then(r => r.json())
        .then(d => {
          const raw = (d.sku_wise_profit || {})[sku.sku_id] || {};
          return {
            month: m,
            delivered_profit:       Number(raw.delivered_profit       || 0),
            return_loss:            Number(raw.return_loss            || 0),
            rto_loss:               Number(raw.rto_loss               || 0),
            claims_total:           Number(raw.claims_total           || 0),
            delivered_purchase_cost: Number(raw.delivered_purchase_cost || 0),
            delivered_count:  raw.delivered_count  || 0,
            return_count:     raw.return_count     || 0,
            rto_count:        raw.rto_count        || 0,
            claims_count:     raw.claims_count     || 0,
            order_count:      raw.order_count      || 0,
            net_profit: Number(raw.net_profit ?? (Number(raw.delivered_profit || 0) + Number(raw.return_loss || 0))),
          };
        })
        .catch(() => ({
          month: m, delivered_profit: 0, return_loss: 0, rto_loss: 0,
          claims_total: 0, delivered_purchase_cost: 0,
          delivered_count: 0, return_count: 0, rto_count: 0,
          claims_count: 0, order_count: 0, net_profit: 0,
        }));
    });
    Promise.all(fetches).then(results => {
      setMonthlyData(results.sort((a, b) => a.month.localeCompare(b.month)));
      setLoading(false);
    });
  }, []); // eslint-disable-line

  const zero = { net_profit: 0, delivered_profit: 0, return_loss: 0, rto_loss: 0,
    claims_total: 0, delivered_purchase_cost: 0,
    delivered_count: 0, return_count: 0, rto_count: 0, claims_count: 0, order_count: 0 };
  const totals = monthlyData.reduce((acc, m) => ({
    net_profit:              acc.net_profit              + m.net_profit,
    delivered_profit:        acc.delivered_profit        + m.delivered_profit,
    return_loss:             acc.return_loss             + m.return_loss,
    rto_loss:                acc.rto_loss                + m.rto_loss,
    claims_total:            acc.claims_total            + m.claims_total,
    delivered_purchase_cost: acc.delivered_purchase_cost + m.delivered_purchase_cost,
    delivered_count:         acc.delivered_count         + m.delivered_count,
    return_count:            acc.return_count            + m.return_count,
    rto_count:               acc.rto_count               + m.rto_count,
    claims_count:            acc.claims_count            + m.claims_count,
    order_count:             acc.order_count             + m.order_count,
  }), zero);

  const fmtMonthLabel = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
  };

  const chartData = monthlyData.map(m => ({
    month: fmtMonthLabel(m.month),
    "Delivered Profit": m.delivered_profit,
    "Return Loss":      m.return_loss,
    "RTO Loss":         m.rto_loss,
    "Claims":           m.claims_total,
    delivered: m.delivered_count,
    returns:   m.return_count,
    rto:       m.rto_count,
  }));

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        zIndex: 1000, display: "flex", alignItems: "flex-start",
        justifyContent: "center", padding: "32px 20px", overflowY: "auto",
      }}
    >
      <div style={{
        background: C.white, borderRadius: 16, width: "100%", maxWidth: 940,
        boxShadow: "0 25px 60px rgba(0,0,0,0.3)",
        display: "flex", flexDirection: "column", marginBottom: 32,
      }}>
        {/* Header */}
        <div style={{
          padding: "18px 24px", borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: C.gray50, borderRadius: "16px 16px 0 0", flexWrap: "wrap", gap: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "monospace", fontSize: 15, color: C.orange, fontWeight: 700, background: C.orangeLight, padding: "4px 10px", borderRadius: 6 }}>
              {sku.sku_id}
            </span>
            <span style={{ fontSize: 12, color: C.gray500 }}>
              Unit Price: <strong style={{ fontFamily: "monospace", color: C.gray800 }}>{fmt(sku.one_unit_price)}</strong>
            </span>
            <span style={{ fontSize: 12, color: C.gray400 }}>·</span>
            <span style={{ fontSize: 12, color: C.gray400 }}>{months.length} months analyzed</span>
          </div>
          <button onClick={onClose} style={{
            background: C.gray100, border: "none", cursor: "pointer",
            fontSize: 12, color: C.gray600, padding: "7px 14px",
            borderRadius: 8, fontWeight: 700,
          }}>✕ Close</button>
        </div>

        {/* Body */}
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
              <p style={{ color: C.gray600, fontWeight: 600 }}>Loading {months.length} months of data…</p>
              <p style={{ fontSize: 12, color: C.gray400, marginTop: 4 }}>Fetching monthly breakdown for {sku.sku_id}</p>
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                <StatCard label="Net P&L"          value={totals.net_profit}              accent={totals.net_profit >= 0 ? C.green : C.red} icon="💹" sub={`${totals.order_count} total orders`} />
                <StatCard label="Delivered Profit"  value={totals.delivered_profit}        accent={C.green}   icon="✅" sub={`${totals.delivered_count} delivered`} />
                <StatCard label="Return Loss"        value={totals.return_loss}             accent={C.red}     icon="📉" sub={`${totals.return_count} returns`} />
                <StatCard label="RTO Loss"           value={totals.rto_loss}                accent={C.amber}   icon="↩" sub={`${totals.rto_count} RTO`} />
                <StatCard label="Claims"             value={totals.claims_total}            accent={C.blue}    icon="🔖" sub={`${totals.claims_count} claims`} />
                <StatCard label="Purchase Cost"      value={totals.delivered_purchase_cost} accent={C.gray500} icon="🛒" sub="delivered orders" />
              </div>

              {/* Financial P&L per month */}
              <div style={S.card}>
                <p style={S.cardTitle}>Monthly Financial Performance</p>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.gray100} />
                    <XAxis dataKey="month" tick={{ fill: C.gray500, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: C.gray400, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }}
                      formatter={(v, name) => [fmt(v), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Bar dataKey="Delivered Profit" fill={C.green} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Return Loss"      fill={C.red}   radius={[3, 3, 0, 0]} />
                    <Bar dataKey="RTO Loss"         fill={C.amber} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Claims"           fill={C.blue}  radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Order volume per month */}
              <div style={S.card}>
                <p style={S.cardTitle}>Monthly Order Volume</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.gray100} />
                    <XAxis dataKey="month" tick={{ fill: C.gray500, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: C.gray400, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Bar dataKey="delivered" name="Delivered" fill={C.green} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="returns"   name="Returns"   fill={C.red}   radius={[3, 3, 0, 0]} />
                    <Bar dataKey="rto"       name="RTO"       fill={C.amber} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export function SKUAnalysisTab() {
  const [allData,     setAllData]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [view,        setView]        = useState("all");
  const [selectedSKU, setSelectedSKU] = useState(null);

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
        const prepared = Object.keys(raw).map(key => {
          const r = raw[key];
          return {
            sku_id: key,
            ...r,
            net_profit: Number(r.net_profit ?? (
              Number(r.delivered_profit || 0) +
              Number(r.return_loss || 0) +
              Number(r.rto_loss || 0)
            )),
          };
        });
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

  const totalNet             = allData.reduce((a, s) => a + s.net_profit, 0);
  const totalDeliveredProfit = allData.reduce((a, s) => a + Number(s.delivered_profit || 0), 0);
  const totalReturnLoss      = allData.reduce((a, s) => a + Number(s.return_loss || 0), 0);
  const totalRTOLoss         = allData.reduce((a, s) => a + Number(s.rto_loss || 0), 0);
  const totalClaims          = allData.reduce((a, s) => a + Number(s.claims_total || 0), 0);
  const totalDelivered       = allData.reduce((a, s) => a + (s.delivered_count || 0), 0);
  const totalReturns         = allData.reduce((a, s) => a + (s.return_count || 0), 0);
  const totalRTO             = allData.reduce((a, s) => a + (s.rto_count || 0), 0);
  const totalCancelled       = allData.reduce((a, s) => a + (s.cancelled_count || 0), 0);
  const bestSKU              = profitRows[0];
  const worstSKU             = lossRows[0];

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
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            <StatCard label="Net P&L"            value={totalNet}             accent={totalNet >= 0 ? C.green : C.red} icon="💹" sub={`${allData.length} mapped SKUs`} />
            <StatCard label="Delivered Profit"   value={totalDeliveredProfit} accent={C.green} icon="✅" sub={`${totalDelivered} delivered`} />
            <StatCard label="Return Loss"        value={totalReturnLoss}      accent={C.red}   icon="📉" sub={`${totalReturns} returns`} />
            <StatCard label="RTO Loss"           value={totalRTOLoss}         accent={C.amber} icon="↩" sub={`${totalRTO} RTO`} />
            <StatCard label="Claims Received"    value={totalClaims}          accent={C.blue}  icon="🔖" sub={`${allData.reduce((a,s)=>a+(s.claims_count||0),0)} claimed`} />
            {totalCancelled > 0 && <StatCard label="Cancelled" value={null} sub={`${totalCancelled} cancelled`} accent={C.gray400} icon="✕" />}
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
            <SKUTable data={viewData} mode={view} onRowClick={setSelectedSKU} />
          </div>
        </>
      )}

      {/* Monthly drill-down modal */}
      {selectedSKU && (
        <SKUDetailModal sku={selectedSKU} months={months} onClose={() => setSelectedSKU(null)} />
      )}
    </div>
  );
}
