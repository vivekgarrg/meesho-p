import React, { useEffect, useMemo, useState } from "react";
import { C, S, btn, fmt, StatCard, SectionHeader, useIsMobile } from "../../App";
import { useBusiness } from "../../contexts/BusinessContext";
import { useDateFilter } from "../../contexts/DateFilterContext";
import { AppBarChart } from "../Charts/AppBarChart";
import { AppPieChart } from "../Charts/AppPieChart";

/*
 * COMBINED DASHBOARD
 *
 * Every other analytics tab is scoped to whichever business is active in the
 * sidebar switcher (see BusinessContext / lib/apiBase.js) — this is the one
 * screen that deliberately isn't. It fetches profit/ directly per business id
 * (bypassing the shared API_BASE) for however many businesses the seller ticks
 * below, and rolls the numbers up three ways:
 *   1. Headline + cost totals — plain sums, since each business's own cost
 *      settings (transport deduction, packaging policy, …) are already baked
 *      into the numbers profit/ returns for it.
 *   2. Order-outcome mix (delivered/returned/RTO/claim/exchange) as a pie.
 *   3. Every SKU across every selected business, flattened into one list —
 *      the "which SKUs are actually losing money" view nothing else in the
 *      app shows across more than one business at a time.
 */

const SELECTION_KEY = "combined_dashboard_business_ids";

function loadSelection() {
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Fields worth adding up across businesses. net_revenue (not net_profit_loss)
// is the true bottom line — the backend has already folded ads spend,
// referral income, compensation/recovery and (where the business's own
// settings call for it) transport charges into it per business.
const SUM_FIELDS = [
  "net_revenue",
  "gross_revenue",
  "total_settled",
  "total_ads_cost",
  "total_commission_paid",
  "total_tcs",
  "total_tds",
  "total_packaging_cost_all",
  "total_shipping_cost",
  "total_claims",
  "order_count",
  "total_pure_returns",
  "total_rto_count",
  "total_claim_count",
];

function aggregateTotals(rows) {
  const totals = Object.fromEntries(SUM_FIELDS.map((k) => [k, 0]));
  rows.forEach((r) => {
    if (!r) return;
    SUM_FIELDS.forEach((k) => {
      totals[k] += Number(r[k]) || 0;
    });
  });
  return totals;
}

// order_summary.<key>.order_count per business — same shape profit/ has
// always returned, just summed across whichever businesses are selected.
const OUTCOME_KEYS = [
  { key: "delivered_summary", label: "Delivered", color: C.green },
  { key: "return_summary", label: "Returned", color: C.red },
  { key: "rto_summary", label: "RTO", color: C.amber },
  { key: "claim_summary", label: "Claim", color: "#7C3AED" },
  { key: "exchanged_summary", label: "Exchange", color: C.blue },
  { key: "unknown_summary", label: "Other", color: C.gray400 },
];

function aggregateOutcomes(rows) {
  const totals = Object.fromEntries(OUTCOME_KEYS.map((o) => [o.key, 0]));
  rows.forEach((r) => {
    if (!r?.order_summary) return;
    OUTCOME_KEYS.forEach((o) => {
      totals[o.key] += Number(r.order_summary[o.key]?.order_count) || 0;
    });
  });
  return totals;
}

// Every SKU from every loaded business's sku_wise_profit, flattened into one
// list and tagged with which business it belongs to — two businesses using
// the same SKU code are still two different rows here, deliberately never
// merged, since they're two different products in two different catalogues.
function aggregateSkuRows(loadedBusinesses, results) {
  const rows = [];
  loadedBusinesses.forEach((b) => {
    const skuMap = results[b.id]?.sku_wise_profit || {};
    Object.entries(skuMap).forEach(([skuId, v]) => {
      if (!skuId || skuId === "__unattributed__") return;
      rows.push({
        sku_id: skuId,
        business: b.name,
        businessId: b.id,
        net_profit: Number(v.net_profit) || 0,
        order_count: Number(v.order_count) || 0,
        delivered_count: Number(v.delivered_count) || 0,
        return_count: Number(v.return_count) || 0,
        rto_count: Number(v.rto_count) || 0,
        one_unit_price: Number(v.one_unit_price) || 0,
      });
    });
  });
  return rows;
}

export function CombinedDashboardTab() {
  const isMobile = useIsMobile();
  const { businesses } = useBusiness();
  const { range, label: filterLabel } = useDateFilter();

  const [selected, setSelected] = useState(() => {
    const stored = loadSelection();
    const validStored = stored?.filter((id) => businesses.some((b) => b.id === id));
    if (validStored?.length) return new Set(validStored);
    return new Set(businesses.map((b) => b.id));
  });

  // A business added or removed after the page first loaded shouldn't leave
  // the selection referencing an id that no longer exists, or stuck empty.
  useEffect(() => {
    setSelected((prev) => {
      const validIds = new Set(businesses.map((b) => b.id));
      const kept = [...prev].filter((id) => validIds.has(id));
      if (kept.length === prev.size) return prev;
      return new Set(kept.length ? kept : businesses.map((b) => b.id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businesses.map((b) => b.id).join(",")]);

  useEffect(() => {
    localStorage.setItem(SELECTION_KEY, JSON.stringify([...selected]));
  }, [selected]);

  const toggleBusiness = (id) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const [results, setResults] = useState({}); // business id -> profit/ response
  const [failedIds, setFailedIds] = useState([]);
  const [loading, setLoading] = useState(false);

  const selectedIds = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);

  useEffect(() => {
    if (!selectedIds.length) {
      setResults({});
      setFailedIds([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const qs = Object.keys(range).length ? `?${new URLSearchParams(range)}` : "";
    Promise.allSettled(
      selectedIds.map((id) =>
        fetch(`/api/business/${id}/profit/${qs}`, { signal: ctrl.signal }).then((r) => {
          if (!r.ok) throw new Error(`business ${id} failed`);
          return r.json();
        })
      )
    ).then((outcomes) => {
      const nextResults = {};
      const nextFailed = [];
      outcomes.forEach((outcome, i) => {
        const id = selectedIds[i];
        if (outcome.status === "fulfilled") nextResults[id] = outcome.value;
        else nextFailed.push(id);
      });
      setResults(nextResults);
      setFailedIds(nextFailed);
      setLoading(false);
    });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(","), JSON.stringify(range)]);

  const loadedBusinesses = businesses.filter((b) => selected.has(b.id) && results[b.id]);
  const loadedData = loadedBusinesses.map((b) => results[b.id]);

  const totals = useMemo(() => aggregateTotals(loadedData), [loadedData]);
  const outcomes = useMemo(() => aggregateOutcomes(loadedData), [loadedData]);
  const skuRows = useMemo(() => aggregateSkuRows(loadedBusinesses, results), [loadedBusinesses, results]);
  const taxWithheld = totals.total_tcs + totals.total_tds;

  const compareRows = loadedBusinesses
    .map((b) => ({ business: b, data: results[b.id] }))
    .sort((a, b) => (b.data.net_revenue ?? 0) - (a.data.net_revenue ?? 0));

  const failedBusinesses = businesses.filter((b) => failedIds.includes(b.id));
  const hasData = loadedBusinesses.length > 0;

  const cardGridCols = isMobile ? "1fr 1fr" : "repeat(auto-fit, minmax(170px, 1fr))";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 20 }}>🧩</span>
          <h1 style={{ fontSize: isMobile ? 17 : 19, fontWeight: 800, color: C.gray800 }}>Combined Dashboard</h1>
        </div>
        <p style={{ fontSize: 12, color: C.gray400, marginTop: 3, maxWidth: 680 }}>
          Profit, loss, order outcomes and SKU-level detail — rolled up across every business you tick
          below, instead of the one active in the sidebar. Respects the period filter above ({filterLabel}).
        </p>
      </div>

      <BusinessPicker
        businesses={businesses}
        selected={selected}
        onToggle={toggleBusiness}
        onSelectAll={() => setSelected(new Set(businesses.map((b) => b.id)))}
        onSelectNone={() => setSelected(new Set())}
      />

      {failedBusinesses.length > 0 && (
        <div
          style={{
            padding: "10px 14px", borderRadius: 10, fontSize: 12.5, marginTop: -10,
            background: C.amberLight, border: `1px solid ${C.amberBorder}`, color: C.amber,
          }}
        >
          Couldn't load {failedBusinesses.map((b) => b.name).join(", ")} — nothing below includes{" "}
          {failedBusinesses.length === 1 ? "it" : "them"}.
        </div>
      )}

      {businesses.length > 0 && selected.size === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: 36, color: C.gray400, fontSize: 13 }}>
          Tick at least one business above to see its numbers.
        </div>
      ) : loading && !hasData ? (
        <div style={{ ...S.card, textAlign: "center", padding: 36, color: C.gray400, fontSize: 13 }}>
          Loading {selected.size} business{selected.size === 1 ? "" : "es"}…
        </div>
      ) : (
        <>
          {loading && <div style={{ fontSize: 11.5, color: C.gray400, marginTop: -14 }}>Refreshing…</div>}

          {/* ── Headline ──────────────────────────────────────────────────── */}
          <section>
            <SectionHeader title="Headline" />
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
              <StatCard label="Net Profit / Loss" value={totals.net_revenue} icon="📈" />
              <StatCard label="Gross Revenue" value={totals.gross_revenue} icon="💰" accent={C.blue} />
              <StatCard label="Net Settled" value={totals.total_settled} icon="🏦" accent={C.blue} />
              <StatCard label="Orders" value={null} sub={totals.order_count.toLocaleString("en-IN")} icon="📦" accent={C.gray600} />
            </div>
          </section>

          {/* ── Costs & deductions ───────────────────────────────────────── */}
          <section>
            <SectionHeader title="Costs & Deductions" />
            <div style={{ display: "grid", gridTemplateColumns: cardGridCols, gap: 12 }}>
              <StatCard label="Ads Spend" value={-totals.total_ads_cost} icon="📣" accent={C.orange} />
              <StatCard label="Commission Paid" value={-totals.total_commission_paid} icon="₹" accent={C.orange} />
              <StatCard label="Tax Withheld (TCS+TDS)" value={-taxWithheld} icon="🧾" accent={C.orange} />
              <StatCard label="Packaging Cost" value={-totals.total_packaging_cost_all} icon="🎁" accent={C.orange} />
              <StatCard label="Shipping Cost" value={-totals.total_shipping_cost} icon="🚚" accent={C.orange} />
              <StatCard label="Claims" value={-totals.total_claims} sub={`${totals.total_claim_count.toLocaleString("en-IN")} claim(s)`} icon="⚠" accent={C.red} />
            </div>
          </section>

          {/* ── Order outcomes ───────────────────────────────────────────── */}
          <section>
            <SectionHeader title="Order Outcomes" />
            <div style={S.card}>
              <OutcomesSection outcomes={outcomes} isMobile={isMobile} />
            </div>
          </section>

          {/* ── By business ───────────────────────────────────────────────── */}
          <section>
            <SectionHeader title="By Business" count={compareRows.length} />
            <div style={{ ...S.card, display: "flex", flexDirection: "column", gap: 16 }}>
              {compareRows.length > 1 && (
                <AppBarChart
                  dataset={compareRows.map((r) => ({ business: r.business.name, net_revenue: r.data.net_revenue }))}
                  indexKey="business"
                  series={[{ dataKey: "net_revenue", label: "Net P&L" }]}
                  diverging
                  height={Math.max(160, compareRows.length * 40)}
                  layout="horizontal"
                  valueFormatter={fmt}
                />
              )}
              <CompareTable rows={compareRows} />
            </div>
          </section>

          {/* ── SKU analytics ─────────────────────────────────────────────── */}
          <section>
            <SectionHeader title="SKU Analytics — Where the Profit and Loss Is" count={skuRows.length} />
            <SkuAnalyticsSection rows={skuRows} isMobile={isMobile} />
          </section>
        </>
      )}
    </div>
  );
}

function BusinessPicker({ businesses, selected, onToggle, onSelectAll, onSelectNone }) {
  if (businesses.length === 0) {
    return (
      <div style={{ ...S.card, fontSize: 12.5, color: C.gray400 }}>No businesses on this account yet.</div>
    );
  }
  return (
    <div style={S.card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <p style={{ ...S.cardTitle, marginBottom: 0 }}>
          {selected.size} of {businesses.length} business{businesses.length === 1 ? "" : "es"} selected
        </p>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onSelectAll} style={btn("ghost", "sm")}>Select all</button>
          <button onClick={onSelectNone} style={btn("ghost", "sm")}>Clear</button>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {businesses.map((b) => {
          const on = selected.has(b.id);
          return (
            <button
              key={b.id}
              onClick={() => onToggle(b.id)}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "7px 12px", borderRadius: 20, fontSize: 12.5, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
                background: on ? C.orangeLight : C.white,
                color: on ? C.orange : C.gray500,
                border: `1.5px solid ${on ? C.orangeBorder : C.gray200}`,
                transition: "background 0.14s, border-color 0.14s, color 0.14s",
              }}
            >
              <span
                style={{
                  width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, color: "#fff",
                  background: on ? C.orange : "transparent",
                  border: `1.5px solid ${on ? C.orange : C.gray300}`,
                }}
              >
                {on ? "✓" : ""}
              </span>
              {b.name}
            </button>
          );
        })}
      </div>
      {businesses.length === 1 && (
        <p style={{ fontSize: 11, color: C.gray400, marginTop: 8 }}>
          Only one business on this account right now — this page will show the same numbers as
          Overview until there's a second one to combine.
        </p>
      )}
    </div>
  );
}

function CompareTable({ rows }) {
  if (!rows.length) {
    return <p style={{ fontSize: 12.5, color: C.gray400 }}>No data for the selected businesses yet.</p>;
  }
  const cols = [
    { key: "net_revenue", label: "Net P&L" },
    { key: "gross_revenue", label: "Gross Revenue" },
    { key: "order_count", label: "Orders", count: true },
    { key: "total_pure_returns", label: "Returns", count: true },
    { key: "total_rto_count", label: "RTO", count: true },
    { key: "total_ads_cost", label: "Ads Spend", cost: true },
  ];
  const totals = rows.reduce((acc, { data }) => {
    cols.forEach((c) => { acc[c.key] = (acc[c.key] || 0) + (Number(data[c.key]) || 0); });
    return acc;
  }, {});

  const thR = { ...S.th, textAlign: "right" };
  const tdR = { ...S.td, textAlign: "right", fontFamily: "monospace" };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={S.th}>Business</th>
            {cols.map((c) => <th key={c.key} style={thR}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ business, data }, i) => (
            <tr key={business.id} style={{ background: i % 2 ? C.gray50 : C.white }}>
              <td style={{ ...S.td, fontWeight: 700 }}>{business.name}</td>
              {cols.map((c) => {
                const v = Number(data[c.key]) || 0;
                const display = c.count ? v.toLocaleString("en-IN") : fmt(c.cost ? -v : v);
                const color = c.count ? C.gray700 : (c.cost ? C.red : (v >= 0 ? C.green : C.red));
                return <td key={c.key} style={{ ...tdR, color, fontWeight: c.key === "net_revenue" ? 700 : 500 }}>{display}</td>;
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: `2px solid ${C.border}` }}>
            <td style={{ ...S.td, fontWeight: 800 }}>Total</td>
            {cols.map((c) => {
              const v = totals[c.key] || 0;
              const display = c.count ? v.toLocaleString("en-IN") : fmt(c.cost ? -v : v);
              const color = c.count ? C.gray800 : (c.cost ? C.red : (v >= 0 ? C.green : C.red));
              return <td key={c.key} style={{ ...tdR, color, fontWeight: 800 }}>{display}</td>;
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function OutcomesSection({ outcomes, isMobile }) {
  const total = OUTCOME_KEYS.reduce((s, o) => s + outcomes[o.key], 0);
  const pieData = OUTCOME_KEYS
    .map((o) => ({ id: o.label, label: o.label, value: outcomes[o.key], color: o.color }))
    .filter((d) => d.value > 0);

  if (total === 0) {
    return <p style={{ fontSize: 12.5, color: C.gray400 }}>No settled orders in this period.</p>;
  }

  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
      <div style={{ width: isMobile ? "100%" : 200, flexShrink: 0 }}>
        <AppPieChart data={pieData} height={200} valueFormatter={(v) => v.toLocaleString("en-IN")} />
      </div>
      <div style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        {OUTCOME_KEYS.filter((o) => outcomes[o.key] > 0).map((o) => {
          const count = outcomes[o.key];
          const pct = total ? ((count / total) * 100).toFixed(1) : "0.0";
          return (
            <div key={o.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: o.color, flexShrink: 0 }} />
              <span style={{ flex: 1, color: C.gray700 }}>{o.label}</span>
              <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.gray800 }}>{count.toLocaleString("en-IN")}</span>
              <span style={{ fontSize: 11, color: C.gray400, width: 44, textAlign: "right" }}>{pct}%</span>
            </div>
          );
        })}
        <p style={{ fontSize: 11, color: C.gray400, marginTop: 4 }}>{total.toLocaleString("en-IN")} settled orders total.</p>
      </div>
    </div>
  );
}

function truncate(str, max) {
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

/** SKU + business, bounded to a fixed total length regardless of how long
 * either half is — a long business name shouldn't be able to blow out the
 * chart's fixed axis margin any more than a long SKU code can. */
function skuChartLabel(sku, business) {
  return truncate(`${truncate(sku, 16)} (${business})`, 28);
}

function SkuAnalyticsSection({ rows, isMobile }) {
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  const lossSkus = useMemo(
    () => rows.filter((r) => r.net_profit < 0).sort((a, b) => a.net_profit - b.net_profit),
    [rows]
  );
  const profitSkus = useMemo(
    () => rows.filter((r) => r.net_profit > 0).sort((a, b) => b.net_profit - a.net_profit),
    [rows]
  );
  const totalLoss = lossSkus.reduce((s, r) => s + r.net_profit, 0);
  const worstSku = lossSkus[0];

  const q = search.trim().toLowerCase();
  const filteredLoss = q
    ? lossSkus.filter((r) => r.sku_id.toLowerCase().includes(q) || r.business.toLowerCase().includes(q))
    : lossSkus;
  const VISIBLE_CAP = 20;
  const visibleLoss = showAll ? filteredLoss : filteredLoss.slice(0, VISIBLE_CAP);

  if (rows.length === 0) {
    return (
      <div style={{ ...S.card, fontSize: 12.5, color: C.gray400 }}>
        No priced SKUs found for the selected businesses in this period.
      </div>
    );
  }

  const lossChartData = lossSkus.slice(0, 10).map((r) => ({
    label: skuChartLabel(r.sku_id, r.business),
    net_profit: r.net_profit,
  }));
  const profitChartData = profitSkus.slice(0, 10).map((r) => ({
    label: skuChartLabel(r.sku_id, r.business),
    net_profit: r.net_profit,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <StatCard label="SKUs Tracked" value={null} sub={rows.length.toLocaleString("en-IN")} icon="🏷" accent={C.gray600} />
        <StatCard label="Loss-Making SKUs" value={null} sub={lossSkus.length.toLocaleString("en-IN")} icon="📉" accent={C.red} />
        <StatCard label="Total Loss (from those)" value={totalLoss} accent={C.red} icon="💸" />
        {worstSku && (
          <StatCard label="Worst SKU" value={worstSku.net_profit} accent={C.red} icon="⚠️" sub={`${worstSku.sku_id} · ${worstSku.business}`} />
        )}
      </div>

      {(lossChartData.length > 0 || profitChartData.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
          {lossChartData.length > 0 && (
            <div style={S.card}>
              <p style={S.cardTitle}>Top {lossChartData.length} Loss-Making SKUs</p>
              <AppBarChart
                dataset={lossChartData}
                indexKey="label"
                series={[{ dataKey: "net_profit", label: "Net P&L", color: C.red }]}
                layout="horizontal"
                height={Math.max(160, lossChartData.length * 30)}
                valueFormatter={fmt}
              />
            </div>
          )}
          {profitChartData.length > 0 && (
            <div style={S.card}>
              <p style={S.cardTitle}>Top {profitChartData.length} Profit-Making SKUs</p>
              <AppBarChart
                dataset={profitChartData}
                indexKey="label"
                series={[{ dataKey: "net_profit", label: "Net P&L", color: C.green }]}
                layout="horizontal"
                height={Math.max(160, profitChartData.length * 30)}
                valueFormatter={fmt}
              />
            </div>
          )}
        </div>
      )}

      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          <p style={{ ...S.cardTitle, marginBottom: 0 }}>
            All loss-making SKUs — worst first ({filteredLoss.length})
          </p>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU or business…"
            style={{ ...S.inp, width: 220, fontSize: 12 }}
          />
        </div>
        {filteredLoss.length === 0 ? (
          <p style={{ fontSize: 12.5, color: C.gray400 }}>
            {lossSkus.length === 0 ? "No SKUs are running at a loss — nice." : "No matches for that search."}
          </p>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={S.th}>SKU</th>
                    <th style={S.th}>Business</th>
                    <th style={{ ...S.th, textAlign: "right" }}>Net P&L</th>
                    <th style={{ ...S.th, textAlign: "right" }}>Orders</th>
                    <th style={{ ...S.th, textAlign: "right" }}>Delivered</th>
                    <th style={{ ...S.th, textAlign: "right" }}>Returns</th>
                    <th style={{ ...S.th, textAlign: "right" }}>RTO</th>
                    <th style={{ ...S.th, textAlign: "right" }}>Unit Price</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLoss.map((r, i) => (
                    <tr key={`${r.businessId}-${r.sku_id}`} style={{ background: i % 2 ? C.gray50 : C.white }}>
                      <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 700, color: C.orange }}>{r.sku_id}</td>
                      <td style={S.td}>{r.business}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.red }}>{fmt(r.net_profit)}</td>
                      <td style={{ ...S.td, textAlign: "right" }}>{r.order_count.toLocaleString("en-IN")}</td>
                      <td style={{ ...S.td, textAlign: "right" }}>{r.delivered_count.toLocaleString("en-IN")}</td>
                      <td style={{ ...S.td, textAlign: "right" }}>{r.return_count.toLocaleString("en-IN")}</td>
                      <td style={{ ...S.td, textAlign: "right" }}>{r.rto_count.toLocaleString("en-IN")}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{fmt(r.one_unit_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredLoss.length > VISIBLE_CAP && (
              <div style={{ textAlign: "center", marginTop: 10 }}>
                <button onClick={() => setShowAll((s) => !s)} style={btn("ghost", "sm")}>
                  {showAll ? "Show fewer" : `Show all ${filteredLoss.length}`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
