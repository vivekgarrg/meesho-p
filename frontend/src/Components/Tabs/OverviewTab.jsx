import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import { AppBarChart } from "../Charts/AppBarChart";
import { AppLineChart } from "../Charts/AppLineChart";
import { AppPieChart } from "../Charts/AppPieChart";
import { API, C, fmt, btn, Tag } from "../../App";
import { useDateFilter } from "../../contexts/DateFilterContext";

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  card: {
    background: "#fff",
    border: "1px solid #E2E8F0",
    borderRadius: 16,
    padding: "20px 22px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  },
  mono: { fontFamily: "monospace" },
  label: { fontSize: 11, fontWeight: 700, color: "#94A3B8", letterSpacing: "0.07em", textTransform: "uppercase" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────
function fmtMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}
function fmtShort(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
}
function monthToRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { date_from: `${ym}-01`, date_to: `${ym}-${String(last).padStart(2, "0")}` };
}
const pct2 = (n, d) => d > 0 ? (n / d * 100).toFixed(1) : "0.0";

// ─────────────────────────────────────────────────────────────────────────────
// Reusable primitive components
// ─────────────────────────────────────────────────────────────────────────────

/** Wrapper card with optional title and accent bar */
function SectionCard({ title, children, accent, style }) {
  return (
    <div style={{ ...T.card, ...style }}>
      {accent && <div style={{ height: 3, background: accent, borderRadius: "12px 12px 0 0", margin: "-20px -22px 16px" }} />}
      {title && (
        <p style={{ ...T.label, marginBottom: 14 }}>{title}</p>
      )}
      {children}
    </div>
  );
}

/** Single key metric — large number + label + optional sub text */
function KPICard({ label, value, sub, color, icon, accent, style }) {
  return (
    <div style={{
      ...T.card,
      borderTop: `3px solid ${accent || color || C.blue}`,
      flex: "1 1 180px", minWidth: 0,
      position: "relative",
      overflow: "hidden",
      ...style,
    }}>
      <div style={{ position: "absolute", right: -12, top: -12, width: 60, height: 60, borderRadius: "50%", background: accent || color || C.blue, opacity: 0.06 }} />
      {icon && <div style={{ fontSize: 18, marginBottom: 6 }}>{icon}</div>}
      <p style={{ ...T.label, marginBottom: 6 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 800, ...T.mono, color: color || C.gray800, lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: C.gray400, marginTop: 5 }}>{sub}</p>}
    </div>
  );
}

/** Row: label on left, value on right — for lists inside cards */
function StatRow({ label, value, color, bold, sub, borderless, badge }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "7px 0",
      borderBottom: borderless ? "none" : "1px solid #F1F5F9",
    }}>
      <span style={{ fontSize: 12, color: C.gray500 }}>{label}</span>
      <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 8 }}>
        {badge && (
          <span style={{ fontSize: 10, fontWeight: 700, background: C.gray100, color: C.gray500, padding: "1px 7px", borderRadius: 20 }}>{badge}</span>
        )}
        <div>
          <span style={{ fontFamily: "monospace", fontWeight: bold ? 800 : 700, fontSize: 13, color: color || C.gray800 }}>{value}</span>
          {sub && <span style={{ fontSize: 10, color: C.gray400, display: "block" }}>{sub}</span>}
        </div>
      </div>
    </div>
  );
}

/** Progress bar for rates */
function RateBar({ label, pct, count, color }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: C.gray600, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 800, color }}>
          {pct}% <span style={{ fontSize: 10, fontWeight: 400, color: C.gray400 }}>({count})</span>
        </span>
      </div>
      <div style={{ height: 7, borderRadius: 99, background: "#F1F5F9", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: color, borderRadius: 99, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

/** A step in the profit formula */
function FormulaStep({ sign, label, value, color, note, bold, divider }) {
  return (
    <>
      {divider && <div style={{ height: 1, background: "#E2E8F0", margin: "10px 0" }} />}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 0" }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: color || C.gray500, width: 16, flexShrink: 0, fontFamily: "monospace", marginTop: 1 }}>{sign}</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 12, color: C.gray600, fontWeight: bold ? 700 : 400 }}>{label}</span>
          {note && <span style={{ display: "block", fontSize: 10, color: C.gray400, marginTop: 1 }}>{note}</span>}
        </div>
        <span style={{ fontFamily: "monospace", fontWeight: bold ? 800 : 700, fontSize: bold ? 15 : 13, color: color || C.gray800 }}>{fmt(value)}</span>
      </div>
    </>
  );
}

/** Status outcome card — shows count + net for one order type */
function OutcomeCard({ icon, label, count, rate, rateColor, netLabel, net, netColor, subStats }) {
  // Layout note: this used to be a single flex row with the status name on the
  // left and the net profit on the right. Once the cards narrowed, neither side
  // could shrink and they overlapped — "DELIVERED" ran straight into the amount.
  // Now the two labels share a header row of their own and the two figures sit
  // on the row beneath, so they can never collide at any card width.
  return (
    <div style={{
      ...T.card, flex: "1 1 210px", minWidth: 0, padding: "14px 16px",
      borderLeft: `4px solid ${rateColor}`,
    }}>
      {/* Row 1 — the two captions */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <p style={{
          fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: "uppercase",
          letterSpacing: "0.06em", minWidth: 0, overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {icon} {label}
        </p>
        <p style={{
          fontSize: 10, color: C.gray400, marginLeft: "auto",
          whiteSpace: "nowrap", flexShrink: 0,
        }}>
          {netLabel}
        </p>
      </div>

      {/* Row 2 — the two figures */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
        <p style={{
          fontSize: 24, fontWeight: 800, fontFamily: "monospace", color: rateColor,
          lineHeight: 1.05, minWidth: 0,
        }}>
          {Number(count || 0).toLocaleString()}
        </p>
        <p style={{
          fontSize: 15, fontWeight: 800, fontFamily: "monospace", color: netColor,
          marginLeft: "auto", whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1.05,
        }}>
          {fmt(net)}
        </p>
      </div>

      <p style={{ fontSize: 11, color: C.gray400, marginBottom: 8, whiteSpace: "nowrap" }}>
        orders · {rate}%
      </p>

      {subStats && subStats.map(({ label: sl, value: sv, color: sc }) => (
        <div key={sl} style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          gap: 8, padding: "3px 0", borderTop: "1px solid #F8FAFC",
        }}>
          <span style={{ fontSize: 11, color: C.gray400, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {sl}
          </span>
          <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 600, color: sc || C.gray600, whiteSpace: "nowrap", flexShrink: 0 }}>
            {sv}
          </span>
        </div>
      ))}
    </div>
  );
}


/** Settlement by status compact table */
function SettlementTable({ rows, total }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ background: "#F8FAFC" }}>
          {["Status", "Orders", "Gross Settlement", "Item Cost", "Net P&L"].map((h, i) => (
            <th key={h} style={{
              padding: "7px 12px", textAlign: i <= 1 ? "left" : "right",
              fontSize: 10, fontWeight: 700, color: C.gray500, textTransform: "uppercase",
              letterSpacing: "0.05em", borderBottom: "2px solid #E2E8F0",
            }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ icon, label, count, gross, cost, net, netColor }, i) => (
          <tr key={label} style={{ borderBottom: i < rows.length - 1 ? "1px solid #F1F5F9" : "2px solid #E2E8F0" }}>
            <td style={{ padding: "8px 12px" }}>
              <span style={{ marginRight: 6 }}>{icon}</span>
              <span style={{ fontWeight: 600, color: C.gray700 }}>{label}</span>
            </td>
            <td style={{ padding: "8px 12px", fontFamily: "monospace", color: C.gray500 }}>{count.toLocaleString()}</td>
            <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", color: C.gray700 }}>{fmt(gross)}</td>
            <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", color: cost < 0 ? C.red : C.gray300 }}>{cost !== 0 ? fmt(cost) : "—"}</td>
            <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: netColor }}>{fmt(net)}</td>
          </tr>
        ))}
        <tr style={{ background: "#F8FAFC" }}>
          <td style={{ padding: "9px 12px", fontWeight: 800, color: C.gray800, fontSize: 13 }}>Total</td>
          <td style={{ padding: "9px 12px", fontFamily: "monospace", fontWeight: 700, color: C.gray600 }}>{total.count.toLocaleString()}</td>
          <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.gray700 }}>{fmt(total.gross)}</td>
          <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: C.red }}>{fmt(total.cost)}</td>
          <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: total.net >= 0 ? C.green : C.red }}>{fmt(total.net)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Group of payment deduction metrics */
function DeductionRow({ label, value, pct, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F1F5F9" }}>
      <span style={{ fontSize: 12, color: C.gray600 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color }}>{fmt(value)}</span>
        {pct !== undefined && (
          <span style={{ background: "#F1F5F9", color: C.gray600, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, minWidth: 46, textAlign: "center" }}>{pct}%</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main tab
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Packaging actually charged to profit, and the switch that decides it.
 *
 * A box is consumed the moment an order is packed, so whether a return or an
 * RTO should still carry that cost is the owner's call rather than something
 * the data can answer — which is why the policy is edited right next to the
 * number it moves.
 */
function PackagingCard({ profit, settings, onSave, saving }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(null);

  const charged = settings?.packaging_statuses || profit?.packaging_statuses || [];
  const current = picked ?? charged;
  const sold    = Number(profit?.total_packaging_cost ?? 0);
  const back    = Number(profit?.total_packaging_cost_for_returns ?? 0);
  const all     = Number(profit?.total_packaging_cost_all ?? sold + back);

  const toggle = (v) =>
    setPicked((p) => {
      const base = p ?? charged;
      return base.includes(v) ? base.filter((x) => x !== v) : [...base, v];
    });

  const dirty = picked && (picked.length !== charged.length
    || picked.some((v) => !charged.includes(v)));

  return (
    <SectionCard title="Packaging Cost" accent={C.orange}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 26, fontWeight: 800, fontFamily: "monospace",
          color: C.gray800, letterSpacing: "-0.02em" }}>{fmt(all)}</span>
        <span style={{ fontSize: 11, color: C.gray400 }}>deducted from profit this period</span>
      </div>

      <div style={{ marginTop: 12 }}>
        <StatRow label="📦 On orders that sold" value={fmt(sold)} color={C.gray600}
          sub="delivered · exchange · claim" />
        <StatRow label="↩ On orders that came back" value={fmt(back)}
          color={back > 0 ? C.red : C.gray400}
          sub={back > 0 ? "returns · RTO — the box went out and was lost"
                        : "not charged — turn on Returned / RTO below to include"} borderless />
      </div>

      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${C.gray200}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.gray400,
            textTransform: "uppercase", letterSpacing: "0.07em" }}>Charged on</span>
          {(settings?.available_statuses || []).map((s) => (
            <Tag key={s.value} variant={current.includes(s.value) ? "green" : "gray"} fontSize={10.5}>
              {current.includes(s.value) ? "✓ " : ""}{s.label}
            </Tag>
          ))}
          <button onClick={() => { setOpen((o) => !o); setPicked(null); }}
            style={{ ...btn("ghost", "sm"), marginLeft: "auto" }}>
            {open ? "Close" : "Change"}
          </button>
        </div>

        {open && (
          <div style={{ marginTop: 10, padding: 12, borderRadius: 10,
            background: C.orangeLight, border: `1px solid ${C.orangeBorder}` }}>
            <div style={{ fontSize: 11.5, color: C.gray600, marginBottom: 9, lineHeight: 1.6 }}>
              Pick the outcomes whose packaging you want subtracted. This is a judgement
              about your business — the numbers can't decide it for you.
            </div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {(settings?.available_statuses || []).map((s) => (
                <button key={s.value} onClick={() => toggle(s.value)}
                  style={btn(current.includes(s.value) ? "primary" : "ghost", "sm")}>
                  {current.includes(s.value) ? "✓ " : ""}{s.label}
                </button>
              ))}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11,
              fontSize: 12.5, color: C.gray700, cursor: "pointer" }}>
              <input type="checkbox" checked={!!settings?.exchange_uses_two_packets}
                onChange={(e) => onSave({ exchange_uses_two_packets: e.target.checked })} />
              An exchange uses two boxes (it ships out twice)
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button disabled={saving || !dirty}
                onClick={() => onSave({ packaging_statuses: current }).then(() => setPicked(null))}
                style={{ ...btn("primary", "sm"), opacity: dirty ? 1 : 0.5 }}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setPicked(null)} style={btn("ghost", "sm")}>Reset</button>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/**
 * The GST position: tax collected on what sold, less tax already paid on the
 * stock that sold. The difference is what actually has to be handed over.
 */
function TaxCard({ profit, settings, onSave, saving }) {
  const g = profit?.gst_summary;
  if (!g) return null;
  const out = Number(g.output_gst || 0);
  const inp = Number(g.input_gst || 0);
  const due = Number(g.net_payable || 0);
  const owing = due >= 0;

  return (
    <SectionCard title="GST Position" accent={owing ? C.red : C.green}>
      <p style={{ fontSize: 11, color: C.gray400, marginBottom: 12, lineHeight: 1.7 }}>
        Counted on the {g.orders_counted?.toLocaleString("en-IN")} orders that actually
        sold — delivered and exchange. A return never transferred goods, so no output
        tax arises on it.
      </p>

      <FormulaStep sign="+" label="GST collected on sales" value={out} color={C.red}
        note={`on ${fmt(g.output_base)} of taxable sales`} />
      <FormulaStep sign="−" label="GST already paid on purchases" value={inp} color={C.green}
        note={`on ${fmt(g.input_base)} of stock that sold`} />
      <FormulaStep sign="=" label={owing ? "To pay the government" : "Input credit carried forward"}
        value={Math.abs(due)} color={owing ? C.red : C.green} bold divider />

      <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8,
        background: "#F8FAFC", border: "1px dashed #E2E8F0" }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8,
          fontSize: 11.5, color: C.gray600, cursor: "pointer", lineHeight: 1.6 }}>
          <input type="checkbox" style={{ marginTop: 2 }} disabled={saving}
            checked={!!settings?.sale_price_includes_gst}
            onChange={(e) => onSave({ sale_price_includes_gst: e.target.checked })} />
          <span>
            My Meesho sale prices already include GST.
            <span style={{ display: "block", color: C.gray400, marginTop: 2 }}>
              On: a ₹340 sale at 5% carries ₹16.19 of tax inside it. Off: ₹17.00 is added
              on top. Meesho's own field is <i>listing price incl. taxes</i>, so leaving
              this on is almost always right.
            </span>
          </span>
        </label>
      </div>
    </SectionCard>
  );
}

export function OverviewTab() {
  const navigate = useNavigate();
  const { range: activeRange, label: filterLabel } = useDateFilter();
  const [profit, setProfit] = useState(null);
  const [dash, setDash] = useState(null);
  const [settings, setSettings] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const qs = Object.keys(activeRange).length ? `?${new URLSearchParams(activeRange)}` : "";
    Promise.all([
      fetch(`${API}/profit/${qs}`,    { signal: ctrl.signal }).then(r => r.json()),
      fetch(`${API}/dashboard/${qs}`, { signal: ctrl.signal }).then(r => r.json()),
      fetch(`${API}/cost-settings/`,  { signal: ctrl.signal }).then(r => r.ok ? r.json() : null)
        .catch(() => null),
    ]).then(([p, d, s]) => { setProfit(p); setDash(d); if (s) setSettings(s); setLoading(false); })
      .catch(e => { if (e.name !== "AbortError") setLoading(false); });
    return () => ctrl.abort();
  }, [JSON.stringify(activeRange), reloadKey]); // eslint-disable-line

  // Profit is computed on read, so a policy change has to re-pull it — the
  // packaging and GST figures move the moment the setting does.
  const saveSettings = async (patch) => {
    setSavingSettings(true);
    try {
      const res = await fetch(`${API}/cost-settings/`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        setSettings(await res.json());
        setReloadKey((k) => k + 1);
      }
    } finally { setSavingSettings(false); }
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const netProfit = Number(profit?.net_revenue ?? 0);
  const pos = netProfit >= 0;
  const { order_stats, payment_stats, join_stats, unsettled } = dash || {};

  const matchRate = join_stats?.match_rate ?? 0;
  const netSettle = payment_stats?.total_settlement ?? 0;
  const totalSale = payment_stats?.total_sale ?? 0;
  const settleEff = totalSale > 0 ? ((netSettle / totalSale) * 100).toFixed(1) : "—";


  const returnSummary = profit?.order_summary?.return_summary;
  const deliveredSummary = profit?.order_summary?.delivered_summary
  const rtoSummary = profit?.order_summary?.rto_summary
  const otherSummary = profit?.order_summary?.unknown_summary
  const exchangedSummary = profit?.order_summary?.exchanged_summary
  const claimSummary = profit?.order_summary?.claim_summary

  const claimNet = Number(claimSummary?.total_settlement);
  const exchangeNet = Number(exchangedSummary?.total_settlement ?? 0);
  const nTotal = profit?.order_count

  const nDel = deliveredSummary?.order_count ?? 0
  const nRet = returnSummary?.order_count ?? 0
  const nRTO = rtoSummary?.order_count ?? 0
  const nExchange = exchangedSummary?.order_count ?? 0
  const nClaim = claimSummary?.order_count ?? 0
  const nOther = otherSummary?.order_count ?? 0

  const nDelProfitLoss = deliveredSummary?.net_profit_loss ?? 0
  const nRetProfitLoss = returnSummary?.net_profit_loss ?? 0
  const nRTOProfitLoss = rtoSummary?.net_profit_loss ?? 0
  const nExchangeProfitLoss = exchangedSummary?.net_profit_loss ?? 0
  const nClaimProfitLoss = claimSummary?.net_profit_loss ?? 0
  const nOtherProfitLoss = otherSummary?.net_profit_loss ?? 0

  const delRate = pct2(nDel, nTotal);
  const retRate = pct2(nRet, nTotal);
  const rtoRate = pct2(nRTO, nTotal);
  const exchangeRate = pct2(nExchange, nTotal);
  const claimRate = pct2(nClaim, nTotal);
  const otherRate = pct2(nOther, nTotal);

  const shipped = profit?.shipped_summary ?? {};
  const taxSummary = profit?.tax_summary ?? {};
  const grossRev = profit?.gross_revenue ?? 0;
  const tcsAmt = profit?.total_tcs ?? 0;
  const tdsAmt = profit?.total_tds ?? 0;
  const commAmt = profit?.total_commission_paid ?? 0;
  const tcsPct = pct2(tcsAmt, grossRev);
  const tdsPct = pct2(tdsAmt, grossRev);
  const commPct = pct2(commAmt, grossRev);
  const totalDeductPct = taxSummary.total_deduction_rate_pct?.toFixed(2) ?? "0.00";

  const matchPieData = [
    { id: 0, value: join_stats?.matched_count ?? 0, label: "Matched", color: C.green },
    { id: 1, value: join_stats?.unmatched_count ?? 0, label: "Unmatched", color: C.amber },
  ].filter(d => d.value > 0);

  const deductionPieData = [
    { label: "Commission", value: Math.abs(Number(commAmt)) },
    { label: "Ads Cost", value: Math.abs(Number(profit?.total_ads_cost)) },
    { label: "TCS", value: Math.abs(Number(tcsAmt)) },
    { label: "TDS", value: Math.abs(Number(tdsAmt)) },
    { label: "Shipping", value: Math.abs(Number(profit?.total_shipping_cost)) },
  ].filter(d => d.value > 0.01);

  const timelineData = (() => {
    if (!dash) return [];
    const map = {};
    (dash.payment_stats?.daily || []).forEach(({ payment_date, count }) => {
      const d = String(payment_date);
      if (!map[d]) map[d] = { date: d, settlements: 0, orders: 0 };
      map[d].settlements = count;
    });
    (dash.order_stats?.daily || []).forEach(({ order_date, count }) => {
      const d = String(order_date);
      if (!map[d]) map[d] = { date: d, settlements: 0, orders: 0 };
      map[d].orders = count;
    });
    return Object.values(map).sort((a, b) => a.date > b.date ? 1 : -1);
  })();




  // The sub-labels below used to assert "settlement − packaging" whatever the
  // policy said. They now read it, so the wording can't promise a deduction the
  // business has switched off.
  const pkgOn = (key) =>
    (settings?.packaging_statuses || profit?.packaging_statuses || []).includes(key);
  const pkgNote = (key, base) =>
    pkgOn(key) ? `${base} − packaging` : `${base} · packaging not charged`;

  // Derived amounts for settlement table
  const delGross = Number(deliveredSummary?.total_settlement || 0)
  const delCost = -Number(deliveredSummary?.final_item_cost || 0);
  const retNet = Number(returnSummary?.total_settlement || 0);
  const rtoNet = Number(rtoSummary?.total_settlement || 0);
  const otherNet = Number(otherSummary?.total_settlement || 0);

  // RETURN/RTO carry no item cost — the goods came back — but they do carry
  // packaging once the business turns it on, so the cost column has to read the
  // charge that was actually applied rather than assume zero.
  const retPkgCost = -Number(returnSummary?.final_item_cost || 0);
  const rtoPkgCost = -Number(rtoSummary?.final_item_cost || 0);
  const retGross = retNet;   // = Meesho return settlement before deduction
  const rtoGross = rtoNet;   // = Meesho RTO settlement before deduction
  // EXCHANGE: net = settlement − 2×packaging; gross = settlement = net + 2×pkg
  const exchPkgCost = -Number(exchangedSummary?.final_item_cost || 0);
  const exchGross = exchangeNet;
  // CLAIM: net = settlement − item_cost; packaging NOT deducted
  const claimCost = -Number(claimSummary?.final_item_cost || 0);
  const claimGross = claimNet;  // = settlement

  const totalGross = delGross + retGross + rtoGross + exchGross + claimGross + otherNet;
  const totalCost = delCost + exchPkgCost + claimCost + retPkgCost + rtoPkgCost;

  const settlementRows = [
    { icon: "✅", label: "Delivered", count: nDel, gross: delGross, cost: delCost, rate: delRate, net: deliveredSummary?.net_profit_loss, netColor: C.green },
    { icon: "↩", label: "Return", count: nRet, gross: retGross, cost: retPkgCost, net: returnSummary?.net_profit_loss, rate: retRate, netColor: returnSummary?.net_profit_loss >= 0 ? C.gray600 : C.red },
    { icon: "🔄", label: "RTO", count: nRTO, gross: rtoGross, cost: rtoPkgCost, net: rtoNet, rate: rtoRate, netColor: rtoNet >= 0 ? C.gray600 : C.amber },
    { icon: "🔁", label: "Exchanged", count: nExchange, gross: exchGross, cost: exchPkgCost, rate: exchangeRate, net: nExchangeProfitLoss, netColor: nExchangeProfitLoss >= 0 ? C.gray600 : C.blue },
    { icon: "⚠", label: "Claim", count: nClaim, gross: claimGross, cost: claimCost, net: nClaimProfitLoss, rate: claimRate, netColor: nClaimProfitLoss >= 0 ? C.gray600 : "#7C3AED" },
    { icon: "⊘", label: "Unknown", count: nOther, gross: otherNet, cost: 0, net: otherNet, rate: otherRate, netColor: otherNet >= 0 ? C.gray600 : C.red },
  ];

  const statusIcons = {
    DELIVERED: { icon: "✅", color: C.green },
    RETURN: { icon: "↩", color: C.red },
    RTO: { icon: "🔄", color: C.orange },
    EXCHANGED: { icon: "🔁", color: C.amber },
    CLAIM: { icon: "⚠", color: C.blue },
    UNKNOWN: { icon: "⊘", color: C.gray400 }
  }

  const orders_summary_cards_data = profit?.order_summary;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 0", gap: 14 }}>
          <CircularProgress color="primary" />
          <span style={{ fontSize: 13, color: C.gray400 }}>Loading overview…</span>
        </div>
      )}

      {!loading && profit && <>

        {/* ── 2. Hero banner ─────────────────────────────────────────────── */}
        <div style={{
          ...T.card,
          background: `linear-gradient(135deg, ${pos ? "#ECFDF5" : "#FFF1F2"} 0%, #fff 65%)`,
          border: `1.5px solid ${pos ? C.greenBorder : C.redBorder}`,
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          flexWrap: "wrap", gap: 24, padding: "24px 28px",
        }}>
          {/* Left: main P&L */}
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.12em", marginBottom: 8, textTransform: "uppercase" }}>
              Net P&L — {filterLabel}
            </p>
            <p style={{ fontSize: 48, fontWeight: 900, fontFamily: "monospace", color: pos ? C.green : C.red, lineHeight: 1, letterSpacing: "-0.03em" }}>
              {pos ? "+" : ""}{fmt(netProfit)}
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <span style={{
                background: pos ? C.greenLight : C.redLight, color: pos ? C.green : C.red,
                border: `1px solid ${pos ? C.greenBorder : C.redBorder}`,
                fontSize: 11, fontWeight: 700, padding: "3px 12px", borderRadius: 20,
              }}>{pos ? "✅ Profitable" : "❌ In Loss"}</span>
              <span style={{ background: "#F8FAFC", color: C.gray600, border: "1px solid #E2E8F0", fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: 20 }}>
                {(profit.order_count ?? 0).toLocaleString()} settled orders
              </span>
              <span style={{ background: "#FFF7ED", color: C.amber, border: "1px solid #FDE68A", fontSize: 11, fontWeight: 600, padding: "3px 12px", borderRadius: 20 }}>
                {profit.ads_campaigns ?? 0} ad campaigns
              </span>
            </div>
          </div>
          {/* Right: key secondary metrics */}
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            {[
              { label: "Gross Revenue", value: fmt(profit.gross_revenue), color: C.gray800 },
              { label: "Net Settlement", value: fmt(profit.total_settled), color: C.green },
              { label: "Order Net P&L", value: fmt(profit?.net_profit_loss), color: Number(profit?.net_profit_loss) >= 0 ? C.green : C.red },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign: "right" }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 5 }}>{label}</p>
                <p style={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace", color }}>{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── 3. Shipped in-transit warning ──────────────────────────────── */}
        {shipped.count > 0 && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 14,
            background: "#FFFBEB", border: "1.5px dashed #F59E0B",
            borderRadius: 12, padding: "14px 20px",
          }}>
            <span style={{ fontSize: 24, flexShrink: 0 }}>🚚</span>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: C.amber, marginBottom: 4 }}>
                {shipped.count} orders SHIPPED — excluded from P&L until settled
              </p>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: C.gray500 }}>Expected settlement: <strong style={{ fontFamily: "monospace" }}>{fmt(shipped.settlement_paid)}</strong></span>
                <span style={{ fontSize: 12, color: C.gray500 }}>If delivered: <strong style={{ fontFamily: "monospace", color: Number(shipped.expected_profit) >= 0 ? C.green : C.red }}>{fmt(shipped.expected_profit)}</strong></span>
                <span style={{ fontSize: 12, color: C.gray500 }}>Expected sale: <strong style={{ fontFamily: "monospace" }}>{fmt(shipped.expected_sale)}</strong></span>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {
            // `Object.keys(undefined)` throws — the optional chain after the call
            // guarded the wrong thing, so a profit response without
            // order_summary took the whole page down.
            Object.keys(orders_summary_cards_data || {}).map(key => {
              const title = key.split("_")[0].toLocaleUpperCase();
              const data = orders_summary_cards_data?.[key] || {};
              const color = data.net_profit_loss > 0 ? C.green : C.red
              const row = settlementRows.find(obj => obj.label.toLowerCase() === title.toLocaleLowerCase())
              const cardColor = row?.netColor;
              return (
                <OutcomeCard
                  key={key}
                  icon={row?.icon} label={title} count={data.order_count} rate={row?.rate} rateColor={cardColor}
                  netLabel="Net Profit" net={Number(data.net_profit_loss || 0)} netColor={color}
                  subStats={[
                    { label: "Gross settlement", value: fmt(data.total_settlement ?? 0) },
                    { label: "Item cost (all-in)", value: fmt(data.final_item_cost ?? 0), color: C.red },
                    { label: "  └ incl. purchase", value: fmt(data.purchase_cost ?? 0), color: C.gray400 },
                    { label: "  └ incl. pkg", value: fmt(data.packaging_cost ?? 0), color: C.gray400 },
                    { label: "  └ incl. GST", value: fmt(data.tax_cost ?? 0), color: C.gray400 },
                  ]}
                />
              )
            })
          }
        </div>

        {/* ── 5. Two-column: Profit Formula + P&L Summary ──────────────────── */}
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>

          {/* Profit formula */}
          <SectionCard title="Profit Formula" style={{ flex: "1 1 340px", minWidth: 0 }}>
            <p style={{ fontSize: 11, color: C.gray400, marginBottom: 14, lineHeight: 1.7 }}>
              Commission / TCS / TDS / Shipping are already deducted by Meesho inside the settlement — not subtracted again here.
            </p>
            <FormulaStep sign="+" label={`Net Settlement`} value={profit.total_settled} color={C.green}
              note="Total Settlement" />

            <FormulaStep sign="-" label={`Purchase Cost`} value={profit.total_purchase_cost} color={C.red}
              note="total items purchased with gst and packaging cost included" />

            {Number(profit.total_other || 0) !== 0 && (
              <FormulaStep sign="±" label={`Other — ${nOther} orders`} value={profit.total_other}
                color={Number(profit.total_other) >= 0 ? C.gray600 : C.red}
                note="cancelled / affiliate fee / manual pickup" />
            )}
            <FormulaStep sign="=" label="Order Net P&L" value={profit.net_profit_loss}
              color={Number(profit.net_profit_loss) >= 0 ? C.green : C.red} bold divider />
            <FormulaStep sign="−" label="Ads Spend" value={profit.total_ads_cost} color={C.orange}
              note="ad campaigns — always a cost" />
            <FormulaStep sign="±" label="Compensation / Recovery" value={profit.total_compensation_recovery}
              color={Number(profit.total_compensation_recovery) >= 0 ? C.blue : C.red} />
            <FormulaStep sign="+" label="Referral Income" value={profit.total_referral_income} color={C.green} />
            {/* Transportation is a business-level overhead. Shown whenever there
                are charges, so the figure is never invisible: deducted when the
                business has the switch on, listed for information when it doesn't. */}
            {Number(profit.total_transport_charges || 0) !== 0 && (
              profit.transport_charges_deducted ? (
                <FormulaStep sign="−" label="Transportation Charges" value={profit.total_transport_charges}
                  color={C.orange} note="daily transport recorded under Expenses" />
              ) : (
                <FormulaStep sign="·" label="Transportation Charges (not deducted)"
                  value={profit.total_transport_charges} color={C.gray400}
                  note="turn on 'Deduct transportation charges' in Business Profile to subtract this" />
              )
            )}
            <FormulaStep sign="=" label="NET P&L (Final)" value={netProfit}
              color={pos ? C.green : C.red} bold divider />



            <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "#F8FAFC", border: "1px dashed #E2E8F0" }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: C.gray300, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                Cost Breakdown (already inside item_price — info only)
              </p>
              <div style={{ display: "flex", gap: 16 }}>
                <div>
                  <p style={{ fontSize: 10, color: C.gray400, marginBottom: 2 }}>📦 Packaging</p>
                  <p style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: C.gray600 }}>{fmt(profit.total_packaging_cost_all ?? profit.total_packaging_cost ?? 0)}</p>
                </div>
                <div>
                  <p style={{ fontSize: 10, color: C.gray400, marginBottom: 2 }}>🏷️ GST on Items</p>
                  <p style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: C.gray600 }}>{fmt(profit.total_tax_cost ?? 0)}</p>
                </div>
                <div>
                  <p style={{ fontSize: 10, color: C.gray400, marginBottom: 2 }}>📦+🏷️ Combined</p>
                  <p style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: C.gray600 }}>{fmt((profit.total_packaging_cost_all ?? profit.total_packaging_cost ?? 0) + (profit.total_tax_cost ?? 0))}</p>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* P&L columns */}
          <div style={{ flex: "1 1 380px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Order P&L Breakdown */}
            <SectionCard title="Order P&L Breakdown">
              <StatRow label={`✅ Delivered (${nDel})`} value={fmt(nDelProfitLoss)} color={C.green} sub="settlement − item_cost×qty" />
              <StatRow label={`↩ Return pure (${nRet}) · ${retRate}%`} value={fmt(nRetProfitLoss)} color={retNet >= 0 ? C.gray600 : C.red} sub={pkgNote("RETURN", "item back, no claim")} />
              <StatRow label={`🔄 RTO pure (${nRTO}) · ${rtoRate}%`} value={fmt(nRTOProfitLoss)} color={rtoNet >= 0 ? C.gray600 : C.amber} sub={pkgNote("RTO", "item back, no claim")} />
              {nExchange > 0 && <StatRow label={`🔁 Exchange (${nExchange}) · ${exchangeRate}%`} value={fmt(nExchangeProfitLoss)} color={exchangeNet >= 0 ? C.gray600 : C.blue} sub={pkgOn("EXCHANGE") ? (settings?.exchange_uses_two_packets ? "settlement − item cost − 2×packaging" : "settlement − item cost − packaging") : "settlement − item cost · packaging not charged"} />}
              <StatRow label={`⚠ Claim (${nClaim}) · ${claimRate}%`} value={fmt(nClaimProfitLoss)} color={nClaimProfitLoss >= 0 ? C.gray600 : "#7C3AED"} sub="settlement − item_cost (claim-first)" />
              <StatRow label={`⊘ Other · ${nOther} orders`} value={fmt(profit.nOtherProfitLoss || 0)} color={nOtherProfitLoss >= 0 ? C.gray600 : C.red} sub="cancelled / affiliate fee / manual pickup" />
            </SectionCard>
          </div>
        </div>

        {/* ── 5b. What the business itself costs and owes ─────────────────── */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 340px", minWidth: 0 }}>
            <PackagingCard profit={profit} settings={settings}
              onSave={saveSettings} saving={savingSettings} />
          </div>
          <div style={{ flex: "1 1 380px", minWidth: 0 }}>
            <TaxCard profit={profit} settings={settings}
              onSave={saveSettings} saving={savingSettings} />
          </div>
        </div>

        {/* ── 6. Settlement by status table ──────────────────────────────── */}
        <SectionCard title="Settlement by Order Status">
          <SettlementTable
            rows={settlementRows}
            total={{ count: nDel + nRet + nRTO + nExchange + nClaim + nOther, gross: totalGross, cost: totalCost, net: Number(profit.net_profit_loss) }}
          />
        </SectionCard>

        {/* ── 7. Meesho Deductions ───────────────────────────────────────── */}
        {(() => {
          const deductItems = [
            {
              icon: "🏷️", label: "Commission incl. GST",
              desc: "Meesho's platform fee on each sale",
              value: commAmt, pct: commPct,
              accent: "#F59E0B", bg: "#FFFBEB", border: "#FDE68A",
            },
            {
              icon: "🏛️", label: "TCS — Tax Collected at Source",
              desc: "Govt-mandated 1% TCS on marketplace sales",
              value: tcsAmt, pct: tcsPct,
              accent: "#64748B", bg: "#F8FAFC", border: "#E2E8F0",
            },
            {
              icon: "🏛️", label: "TDS — Tax Deducted at Source",
              desc: "TDS deducted by Meesho before payout",
              value: tdsAmt, pct: tdsPct,
              accent: "#64748B", bg: "#F8FAFC", border: "#E2E8F0",
            },
            {
              icon: "🚚", label: "Shipping Charges",
              desc: "Forward / reverse logistics charged to account",
              value: profit.total_shipping_cost, pct: null,
              accent: "#D97706", bg: "#FFFBEB", border: "#FDE68A",
            },
            {
              icon: "📢", label: "Ads Spend",
              desc: "Smart Store / Performance ads cost",
              value: profit.total_ads_cost, pct: null,
              accent: "#DC2626", bg: "#FFF1F2", border: "#FECDD3",
              bold: true,
            },
            {
              icon: "🤝", label: "Affiliate Fee",
              desc: "Influencer / affiliate partner payouts",
              value: profit.total_affiliate_fee, pct: null,
              accent: "#DC2626", bg: "#FFF1F2", border: "#FECDD3",
            },
          ];
          const totalMeeshoDeduct = Number(commAmt) + Number(tcsAmt) + Number(tdsAmt);
          const netSettle = Number(profit.net_settlement_revenue ?? profit.total_settled ?? 0);
          const claimPos = claimNet >= 0;

          // Revenue waterfall steps
          const shippingAmt = Number(profit.total_shipping_cost || 0);
          const waterfallSteps = [
            { label: "Gross Revenue", value: grossRev, color: "#1E3A5F", bg: "#EFF6FF", arrow: false },
            { label: "− Commission + GST", value: -Math.abs(commAmt), color: "#D97706", bg: "#FFFBEB", arrow: true },
            { label: "− TCS + TDS", value: -(Math.abs(tcsAmt) + Math.abs(tdsAmt)), color: "#64748B", bg: "#F8FAFC", arrow: true },
            { label: "− Shipping", value: -Math.abs(shippingAmt), color: "#D97706", bg: "#FFFBEB", arrow: true },
            { label: "= Net Settlement", value: netSettle, color: netSettle >= 0 ? "#059669" : "#DC2626", bg: netSettle >= 0 ? "#ECFDF5" : "#FFF1F2", arrow: true, bold: true },
          ].filter(s => s.value !== 0 || s.bold);

          return (
            <div style={{ ...T.card, padding: "0 0 0 0", overflow: "hidden" }}>
              {/* Section header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "16px 22px 14px", borderBottom: "1px solid #F1F5F9",
                background: "linear-gradient(135deg,#FFFBEB 0%,#fff 100%)",
              }}>
                <div>
                  <p style={{ ...T.label, color: "#D97706", marginBottom: 4 }}>Meesho Deductions</p>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>
                    Amounts already deducted by Meesho before paying you
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
                    Total Platform Deductions
                  </p>
                  <p style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 22, color: "#DC2626" }}>
                    {fmt(totalMeeshoDeduct)}
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#94A3B8", marginLeft: 8 }}>{totalDeductPct}% of gross</span>
                  </p>
                </div>
              </div>

              <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>

                {/* ── Left: deduction rows ─────────────────────────────── */}
                <div style={{ flex: "1 1 340px", minWidth: 0, padding: "16px 22px" }}>
                  {deductItems.map(({ icon, label, desc, value, pct, accent, bg, border, bold }) => {
                    const v = Number(value || 0);
                    const barW = grossRev > 0 && v !== 0 ? Math.min(Math.abs(v) / Math.abs(grossRev) * 100, 100) : 0;
                    return (
                      <div key={label} style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "10px 12px", marginBottom: 6, borderRadius: 10,
                        background: v !== 0 ? bg : "#F8FAFC",
                        border: `1px solid ${v !== 0 ? border : "#E2E8F0"}`,
                        opacity: v === 0 ? 0.55 : 1,
                      }}>
                        {/* Icon */}
                        <div style={{
                          width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                          background: "#fff", border: `1.5px solid ${border}`,
                          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
                        }}>{icon}</div>
                        {/* Label + bar */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                            <span style={{ fontSize: 13, fontWeight: bold ? 800 : 600, color: "#334155", whiteSpace: "nowrap" }}>{label}</span>
                            {v === 0 && <span style={{ fontSize: 10, fontWeight: 700, color: "#CBD5E1", background: "#F8FAFC", padding: "1px 7px", borderRadius: 20 }}>nil</span>}
                          </div>
                          <p style={{ fontSize: 11, color: "#94A3B8", marginBottom: barW > 0 ? 5 : 0 }}>{desc}</p>
                          {barW > 0 && (
                            <div style={{ height: 4, borderRadius: 99, background: "#E2E8F0" }}>
                              <div style={{ width: `${barW}%`, height: "100%", background: accent, borderRadius: 99, transition: "width 0.6s ease" }} />
                            </div>
                          )}
                        </div>
                        {/* Value + pct */}
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <p style={{ fontFamily: "monospace", fontWeight: bold ? 900 : 700, fontSize: 14, color: v === 0 ? "#CBD5E1" : accent }}>
                            {v === 0 ? "—" : fmt(v)}
                          </p>
                          {pct !== null && v !== 0 && (
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 20,
                              background: "#fff", color: accent, border: `1px solid ${border}`,
                            }}>{pct}%</span>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Total strip */}
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    marginTop: 10, padding: "12px 14px", borderRadius: 10,
                    background: "#FFF1F2", border: "1.5px solid #FECDD3",
                  }}>
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 700, color: "#DC2626", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                        Total Platform Cut (Comm + TCS + TDS)
                      </p>
                      <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>subtracted by Meesho from your gross settlement</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 18, color: "#DC2626" }}>{fmt(totalMeeshoDeduct)}</p>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8" }}>{totalDeductPct}%</span>
                    </div>
                  </div>
                </div>

                {/* ── Divider ─────────────────────────────────────────── */}
                <div style={{ width: 1, background: "#F1F5F9", flexShrink: 0, alignSelf: "stretch" }} />

                {/* ── Right: Revenue waterfall + Claims ───────────────── */}
                <div style={{ flex: "0 1 280px", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

                  {/* Revenue waterfall */}
                  <div>
                    <p style={{ ...T.label, marginBottom: 12 }}>Revenue Waterfall</p>
                    {waterfallSteps.map(({ label, value, color, bg, arrow, bold: bld }, idx) => (
                      <div key={label}>
                        {arrow && (
                          <div style={{ display: "flex", justifyContent: "center", margin: "2px 0" }}>
                            <span style={{ fontSize: 14, color: "#CBD5E1" }}>↓</span>
                          </div>
                        )}
                        <div style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "8px 12px", borderRadius: 8, background: bg,
                          border: `1.5px solid ${bld ? color + "44" : "#E2E8F0"}`,
                        }}>
                          <span style={{ fontSize: 12, fontWeight: bld ? 700 : 500, color: bld ? color : "#64748B" }}>{label}</span>
                          <span style={{ fontFamily: "monospace", fontWeight: bld ? 900 : 700, fontSize: bld ? 16 : 13, color }}>
                            {value > 0 && idx > 0 ? "+" : ""}{fmt(value)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Claims card */}
                  <div style={{
                    borderRadius: 12, padding: "14px 16px",
                    background: claimPos ? "#F0FDF4" : "#F5F3FF",
                    border: `1.5px solid ${claimPos ? "#A7F3D0" : "#DDD6FE"}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <p style={{ fontSize: 10, fontWeight: 700, color: claimPos ? "#059669" : "#7C3AED", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                        ⚠ Claim Orders
                      </p>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                        background: claimPos ? "#D1FAE5" : "#EDE9FE",
                        color: claimPos ? "#065F46" : "#5B21B6",
                      }}>{claimRate}% of settled</span>
                    </div>
                    <p style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 26, color: claimPos ? "#059669" : "#7C3AED", lineHeight: 1, marginBottom: 6 }}>
                      {claimPos ? "+" : ""}{fmt(claimNet)}
                    </p>
                    <div style={{ height: 1, background: claimPos ? "#A7F3D0" : "#DDD6FE", margin: "10px 0" }} />
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div>
                        <p style={{ fontSize: 10, color: "#94A3B8", marginBottom: 2 }}>Orders</p>
                        <p style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 16, color: "#334155" }}>{nClaim.toLocaleString()}</p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <p style={{ fontSize: 10, color: "#94A3B8", marginBottom: 2 }}>Item cost deducted</p>
                        <p style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 16, color: "#DC2626" }}>−{fmt(Math.abs(claimCost))}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── 8. Rates + Order health ─────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>

          {/* Order outcome rates */}
          <SectionCard title="Order Outcome Rates" style={{ flex: "1 1 260px", minWidth: 0 }}>
            <RateBar label="✅ Delivery Rate" pct={delRate} count={nDel} color={C.green} />
            <RateBar label="↩ Pure Return Rate" pct={retRate} count={nRet} color={C.red} />
            <RateBar label="🔄 Pure RTO Rate" pct={rtoRate} count={nRTO} color={C.amber} />
            {nExchange > 0 && <RateBar label="🔁 Exchange Rate" pct={exchangeRate} count={nExchange} color={C.blue} />}
            <RateBar label="⚠ Claim Rate" pct={claimRate} count={nClaim} color="#7C3AED" />
            <p style={{ fontSize: 11, color: C.gray400, marginTop: 6, lineHeight: 1.6 }}>
              Based on {nTotal.toLocaleString()} settled orders. Claim-first: any order with a claim payment is classified as CLAIM, not return/RTO.
            </p>
          </SectionCard>

          {/* Operations KPIs */}
          <SectionCard title="Operations" style={{ flex: "1 1 340px", minWidth: 0 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[
                { label: "Orders Settled", value: (profit.order_count ?? 0).toLocaleString(), sub: `${profit.orders_with_price ?? 0} with price`, accent: C.blue },
                { label: "Missing Price", value: (profit.orders_missing_price ?? 0).toLocaleString(), sub: "SKUs without pricing", accent: C.amber },
                { label: "Pure Returns", value: nRet.toLocaleString(), sub: "no claim taken", accent: C.red },
                { label: "Claim Orders", value: nClaim.toLocaleString(), sub: fmt(claimNet), accent: "#7C3AED" },
                { label: "Ad Campaigns", value: (profit.ads_campaigns ?? 0).toLocaleString(), sub: `${profit.adjustment_count ?? 0} adj. rows`, accent: C.orange },
                { label: "Referral Count", value: (profit.referral_count ?? 0).toLocaleString(), sub: fmt(profit.total_referral_income ?? 0), accent: C.green },
              ].map(({ label, value, sub, accent }) => (
                <div key={label} style={{ flex: "1 1 130px", minWidth: 0, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 14px", borderLeft: `3px solid ${accent}` }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</p>
                  <p style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: accent }}>{value}</p>
                  {sub && <p style={{ fontSize: 11, color: C.gray400, marginTop: 3 }}>{sub}</p>}
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        {/* ── 9. Payment deductions + Match rate ─────────────────────────── */}
        {dash && (
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>

            {/* Match donut */}
            <SectionCard title="Payment–Order Match Rate" style={{ flex: "0 0 240px" }}>
              {matchPieData.length > 0 && (
                <AppPieChart data={matchPieData} height={160} showLegend />
              )}
              <div style={{ textAlign: "center", marginTop: 8 }}>
                <p style={{ fontSize: 28, fontWeight: 900, fontFamily: "monospace", color: matchRate >= 80 ? C.green : C.amber }}>{matchRate}%</p>
                <p style={{ fontSize: 11, color: C.gray400 }}>{join_stats?.matched_count ?? 0} linked payments</p>
              </div>
            </SectionCard>

            {/* Payment deduction breakdown */}
            <SectionCard title="Payment Deductions Breakdown" style={{ flex: "1 1 300px", minWidth: 0 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {[
                  { label: "Total Sale Amount", value: payment_stats?.total_sale, color: C.green },
                  { label: "Net Settlement", value: payment_stats?.total_settlement, color: netSettle >= 0 ? C.green : C.red },
                  { label: "Commission (incl. GST)", value: payment_stats?.total_commission, color: C.orange },
                  { label: "TCS Deducted", value: payment_stats?.total_tcs, color: C.gray500 },
                  { label: "TDS Deducted", value: payment_stats?.total_tds, color: C.gray500 },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ flex: "1 1 140px", minWidth: 0, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 14px" }}>
                    <p style={{ fontSize: 11, color: C.gray400, marginBottom: 5 }}>{label}</p>
                    <p style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace", color }}>{fmt(value)}</p>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Data health KPIs */}
            <SectionCard title="Data Health" style={{ flex: "0 0 220px" }}>
              <StatRow label="Settled Payments" value={(payment_stats?.total ?? 0).toLocaleString()} sub="payment rows" />
              <StatRow label="Orders Tracked" value={(order_stats?.total ?? 0).toLocaleString()} sub="order records" />
              <StatRow label="Unmatched Payments" value={(join_stats?.unmatched_count ?? 0).toLocaleString()} color={C.amber} />
              <StatRow label="Net Settlement" value={fmt(netSettle)} color={netSettle >= 0 ? C.green : C.red} />
              <StatRow label="Settlement Efficiency" value={`${settleEff}%`} color={C.orange} sub="settlement ÷ sale" borderless />
            </SectionCard>
          </div>
        )}

        {/* ── 10. Unsettled quick link ─────────────────────────────────────── */}
        {unsettled && (
          <div
            // Unsettled tab reads the same global period filter, so no need to pass it via URL.
            onClick={() => navigate("/unsettled")}
            style={{
              ...T.card, display: "flex", alignItems: "center", gap: 20, cursor: "pointer",
              background: "#FFF1F2", border: "1.5px solid #FECDD3", padding: "16px 22px",
            }}
          >
            <span style={{ fontSize: 28 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 3 }}>
                {(unsettled.count ?? 0).toLocaleString()} Unsettled Orders
              </p>
              <p style={{ fontSize: 12, color: C.gray500 }}>
                {unsettled.total_value ? `At-risk value: ${fmt(unsettled.total_value)}` : "No payment record"}
              </p>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.red }}>View details →</span>
          </div>
        )}

        {/* ── 11. Deduction pie + Daily activity chart ─────────────────────── */}
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {deductionPieData.length > 0 && (
            <SectionCard title="Deduction Split" style={{ flex: "0 0 340px" }}>
              <AppPieChart data={deductionPieData} height={230} showLegend valueFormatter={fmt} />
            </SectionCard>
          )}
          {timelineData.length > 0 && (
            <SectionCard title="Daily Settlement Activity" style={{ flex: "1 1 320px", minWidth: 0 }}>
              <p style={{ fontSize: 11, color: C.gray400, marginBottom: 10 }}>
                Settlements per day vs orders placed. Gap = pending settlement.
              </p>
              <AppLineChart
                dataset={timelineData}
                indexKey="date"
                series={[
                  { dataKey: "settlements", label: "Settlements", color: C.green },
                  { dataKey: "orders", label: "Orders Placed", color: C.blue },
                ]}
                maxTicks={15}
                height={230}
              />
            </SectionCard>
          )}
        </div>

        {/* ── 12. Orders + Payments by status bar charts ──────────────────── */}
        {dash && order_stats?.by_status?.length > 0 && (
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <SectionCard title="Orders by Lifecycle Status" style={{ flex: "1 1 300px", minWidth: 0 }}>
              <AppBarChart
                dataset={order_stats.by_status}
                indexKey="reason_for_credit_entry"
                series={[{ dataKey: "count", label: "Orders", color: C.blue }]}
                height={200}
              />
            </SectionCard>
            <SectionCard title="Payments by Settlement Status" style={{ flex: "1 1 300px", minWidth: 0 }}>
              <AppBarChart
                dataset={payment_stats.by_status}
                indexKey="live_order_status"
                series={[{ dataKey: "count", label: "Payments", color: C.blue }]}
                height={200}
              />
            </SectionCard>
          </div>
        )}

        {/* ── 13. Payout CSV Reconciliation ──────────────────────────────── */}
        {profit?.payout_breakdown?.length > 0 && (
          <SectionCard title="Payout Reconciliation — compare with Meesho payout summary CSV">
            <p style={{ fontSize: 11, color: C.gray400, marginBottom: 12, lineHeight: 1.7 }}>
              Raw per-status settlement amounts from your uploaded payment data for this period.
              Compare these numbers directly to your Meesho payout summary CSV.
              If counts or amounts differ, upload the missing payment Excel files for this month.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#F8FAFC" }}>
                  {["Type", "Orders in DB", "Settlement (DB)", "Return Shipping", "Note"].map((h, i) => (
                    <th key={h} style={{
                      padding: "7px 12px", textAlign: i <= 1 ? "left" : "right",
                      fontSize: 10, fontWeight: 700, color: C.gray500, textTransform: "uppercase",
                      letterSpacing: "0.05em", borderBottom: "2px solid #E2E8F0",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {profit.payout_breakdown.map((row, i) => {
                  const isAdj = row.type.startsWith("Adj:");
                  const isClaim = row.type === "Claims Accepted";
                  const color = isClaim ? "#7C3AED" : isAdj ? C.amber : C.gray700;
                  return (
                    <tr key={row.type} style={{ borderBottom: "1px solid #F1F5F9", background: isClaim ? "#F5F3FF" : isAdj ? "#FFFBEB" : "white" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600, color }}>{row.type}</td>
                      <td style={{ padding: "8px 12px", fontFamily: "monospace", color: C.gray600 }}>{(row.count || 0).toLocaleString()}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: row.settlement >= 0 ? C.gray700 : C.red }}>{fmt(row.settlement)}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", color: (row.return_shipping || 0) < 0 ? C.red : C.gray300 }}>
                        {row.return_shipping ? fmt(row.return_shipping) : "—"}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontSize: 11, color: C.gray400 }}>
                        {isClaim ? `Claims amount: ${fmt(row.claims_amount)}` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "#FFF7ED", border: "1px solid #FDE68A" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, marginBottom: 4 }}>
                If your Meesho CSV shows higher claim counts or missing charges (MANUAL_PICKUP, Affiliate Fee):
              </p>
              <p style={{ fontSize: 11, color: C.gray600, lineHeight: 1.7 }}>
                Upload the complete payment Excel for this period — Meesho often processes claim payments in batches across multiple weeks.
                Each weekly Excel file may contain rows not yet in your DB.
              </p>
            </div>
          </SectionCard>
        )}

      </>}

      {!loading && !profit && (
        <Alert severity="info" sx={{ borderRadius: 3 }}>
          No data for this period — try a different month or All Time.
        </Alert>
      )}
    </div>
  );
}
