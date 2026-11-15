import React, { useMemo, useState } from "react";
import { C, S, fmt, useIsMobile } from "../../shared";
import { useDateFilter } from "../../contexts/DateFilterContext";
import { useFlipkartApi } from "./FlipkartShared";

/*
 * Returns → Flipkart, for the orders placed in the period picked above:
 *   how many came back and who sent them (the customer, or the courier — never
 *   delivered), the SKUs that come back most, why, and every returned item.
 * Server: flipkart_views.flipkart_returns.
 */

const KIND = {
  customer: { label: "Customer return", color: "#E11D48", bg: "#FFF1F2" },
  courier: { label: "Courier return", color: "#7C3AED", bg: "#F5F3FF" },
  unknown: { label: "Not known yet", color: C.gray500, bg: C.gray100 },
};
const n = (v) => Number(v || 0).toLocaleString("en-IN");
const day = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—");
const nice = (r) => String(r || "").replace(/_/g, " ").replace(/\b([a-z])/g, (m) => m.toUpperCase());
const rateColor = (r) => (r == null ? C.gray400 : r >= 30 ? C.red : r >= 15 ? "#B45309" : "#15803D");

function Tile({ label, value, sub, color }) {
  return (
    <div style={{ ...S.card, padding: "14px 16px", borderTop: `4px solid ${color}`, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.gray600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: C.gray900, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.gray500, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Kind({ kind }) {
  const k = KIND[kind] || KIND.unknown;
  return <span style={{ fontSize: 11.5, fontWeight: 800, color: k.color, background: k.bg, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>{k.label}</span>;
}

/** Kept, sent back by the customer, brought back by the courier — one bar. */
function SplitBar({ kept, customer, courier }) {
  const total = kept + customer + courier;
  if (!total) return <div style={{ height: 8, borderRadius: 4, background: C.gray100 }} />;
  const w = (v) => `${(100 * v) / total}%`;
  return (
    <div role="img" aria-label={`${kept} kept, ${customer} customer returns, ${courier} courier returns`}
      style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: C.gray100, gap: kept && (customer || courier) ? 2 : 0 }}>
      {kept > 0 && <span style={{ width: w(kept), background: "#86EFAC" }} />}
      {customer > 0 && <span style={{ width: w(customer), background: KIND.customer.color }} />}
      {courier > 0 && <span style={{ width: w(courier), background: KIND.courier.color }} />}
    </div>
  );
}

export function FlipkartReturns() {
  const mobile = useIsMobile();
  const { label } = useDateFilter();
  const { data: d, loading, error, reload } = useFlipkartApi("/flipkart-returns/");
  const [kind, setKind] = useState("all");
  const [q, setQ] = useState("");
  const [showAllSkus, setShowAllSkus] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (d?.returns || []).filter((r) =>
      (kind === "all" || (kind === "coming" ? r.status === "RETURN_REQUESTED" : r.kind === kind))
      && (!needle || [r.sku, r.title, r.order_id, r.order_item_id, r.return_id, r.tracking_id, r.reason].some((v) => String(v || "").toLowerCase().includes(needle))));
  }, [d, kind, q]);

  if (error) return <div role="alert" style={{ ...S.card, color: C.red, fontWeight: 700 }}>✕ {error} <button onClick={reload} style={{ marginLeft: 8 }}>Retry</button></div>;
  if (!d) return <div style={{ padding: 60, textAlign: "center", color: C.gray400, fontWeight: 600 }}>{loading ? "Loading Flipkart returns…" : ""}</div>;

  const t = d.totals;
  const skus = d.by_sku.filter((s) => s.returns > 0);
  const shownSkus = showAllSkus ? skus : skus.slice(0, 10);
  const maxReason = Math.max(1, ...d.reasons.map((r) => r.count));
  const chips = [
    ["all", `All · ${t.returns}`], ["customer", `Customer · ${t.customer}`], ["courier", `Courier · ${t.courier}`],
    ["coming", `On the way back · ${t.return_requested}`],
  ];

  if (!t.items) {
    return <div style={{ ...S.card, padding: 28, textAlign: "center", color: C.gray500 }}>No Flipkart orders for {label}. They're read from Seller Hub, or uploaded on Upload Data.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0, opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
      <div style={{ fontSize: 13, color: C.gray500 }}>
        Flipkart orders placed in <b style={{ color: C.gray700 }}>{label}</b> · {n(t.items)} items. A return counts against the order's period; ones Flipkart is still bringing back are included.
      </div>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: mobile ? "repeat(2, minmax(0, 1fr))" : "repeat(5, minmax(0, 1fr))" }}>
        <Tile label="Customer return %" value={t.customer_rate == null ? "—" : `${t.customer_rate}%`} color={rateColor(t.customer_rate)}
          sub={`${n(t.customer)} of ${n(t.delivered + t.customer)} that reached a customer`} />
        <Tile label="All returns" value={n(t.returns)} color={C.red} sub={`${t.return_rate ?? "—"}% of ${n(t.delivered + t.returns)} that ended`} />
        <Tile label="Courier returns" value={n(t.courier)} color={KIND.courier.color} sub="never delivered (RTO)" />
        <Tile label="On the way back" value={n(t.return_requested)} color="#B45309" sub={`${n(t.return_cancelled)} return${t.return_cancelled === 1 ? "" : "s"} cancelled`} />
        <Tile label="Returns' payments" value={fmt(t.returns_net)} color={t.returns_net < 0 ? C.red : "#15803D"} sub="what Flipkart paid on them, net" />
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: mobile ? "1fr" : "minmax(0, 3fr) minmax(0, 2fr)", alignItems: "start" }}>
        {/* Worst SKUs */}
        <section style={{ ...S.card, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.gray100}` }}>
            <div style={{ fontWeight: 900, fontSize: 15, color: C.gray900 }}>SKUs that come back most</div>
            <div style={{ fontSize: 12, color: C.gray500 }}>
              Worst return % first (SKUs with fewer than {d.min_ended} ended items last) · <span style={{ color: "#16A34A" }}>■</span> kept{" "}
              <span style={{ color: KIND.customer.color }}>■</span> customer <span style={{ color: KIND.courier.color }}>■</span> courier
            </div>
          </div>
          {skus.length === 0 ? <div style={{ padding: 20, color: C.gray500, fontSize: 13 }}>No returns in {label}.</div> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: C.gray50, color: C.gray500, fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>
                    <th style={{ textAlign: "left", padding: "8px 16px" }}>SKU</th>
                    <th style={{ textAlign: "left", padding: 8, minWidth: 140 }}>Kept · returned</th>
                    <th style={{ textAlign: "right", padding: 8 }}>Return %</th>
                    <th style={{ textAlign: "right", padding: "8px 16px" }}>Payments</th>
                  </tr>
                </thead>
                <tbody>
                  {shownSkus.map((s) => (
                    <tr key={s.sku} style={{ borderTop: `1px solid ${C.gray100}`, opacity: s.enough ? 1 : 0.65 }}>
                      <td style={{ padding: "9px 16px", maxWidth: 260 }}>
                        <div style={{ fontFamily: "monospace", fontWeight: 800, color: C.gray900 }}>{s.sku}</div>
                        <div style={{ fontSize: 11.5, color: C.gray500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={s.title}>{s.title}</div>
                      </td>
                      <td style={{ padding: 8 }}>
                        <SplitBar kept={s.delivered} customer={s.customer} courier={s.returns - s.customer} />
                        <div style={{ fontSize: 11.5, color: C.gray500, marginTop: 3 }}>{s.delivered} kept · {s.customer} customer · {s.returns - s.customer} courier</div>
                      </td>
                      <td style={{ padding: 8, textAlign: "right", fontWeight: 900, fontSize: 15, color: rateColor(s.return_rate), fontVariantNumeric: "tabular-nums" }}>
                        {s.return_rate == null ? "—" : `${s.return_rate}%`}
                      </td>
                      <td style={{ padding: "8px 16px", textAlign: "right", fontFamily: "monospace", color: s.returns_net < 0 ? C.red : C.gray600 }}>{fmt(s.returns_net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {skus.length > 10 && (
                <button onClick={() => setShowAllSkus(!showAllSkus)} style={{ margin: 12, border: "none", background: "none", color: "#2874F0", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                  {showAllSkus ? "Show the worst 10" : `Show all ${skus.length} SKUs`}
                </button>
              )}
            </div>
          )}
        </section>

        {/* Reasons */}
        <section style={{ ...S.card, padding: 16 }}>
          <div style={{ fontWeight: 900, fontSize: 15, color: C.gray900 }}>Why they come back</div>
          <div style={{ fontSize: 12, color: C.gray500, marginBottom: 10 }}>Flipkart's reason, and its detail</div>
          {d.reasons.length === 0 ? <div style={{ fontSize: 13, color: C.gray500 }}>No returns in {label}.</div> : d.reasons.slice(0, 12).map((r) => (
            <div key={r.reason} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
                <span style={{ fontWeight: 700, color: r.reason === "Not given" ? C.gray400 : C.gray800 }}>{nice(r.reason)}</span>
                <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{r.count}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: C.gray100, marginTop: 3 }}>
                <div style={{ width: `${(100 * r.count) / maxReason}%`, height: "100%", borderRadius: 3, background: r.reason === "Not given" ? C.gray300 : "#2874F0" }} />
              </div>
              {r.subs.length > 0 && (
                <div style={{ fontSize: 11.5, color: C.gray500, marginTop: 3 }}>{r.subs.map((x) => `${nice(x.sub)} · ${x.count}`).join("  ·  ")}</div>
              )}
            </div>
          ))}
        </section>
      </div>

      {/* Every returned item */}
      <section style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.gray100}` }}>
          <div style={{ fontWeight: 900, fontSize: 15, color: C.gray900, marginRight: "auto" }}>Returned items</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {chips.map(([k, l]) => (
              <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
                style={{ border: `1px solid ${kind === k ? "#2874F0" : C.gray200}`, background: kind === k ? "#2874F0" : "#fff", color: kind === k ? "#fff" : C.gray600,
                  borderRadius: 999, padding: "5px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
            ))}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, order, return id, tracking…" aria-label="Search returns"
            style={{ ...S.inp, width: mobile ? "100%" : 280 }} />
        </div>
        {rows.length === 0 ? <div style={{ padding: 20, color: C.gray500, fontSize: 13 }}>Nothing matches.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: C.gray50, color: C.gray500, fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>
                  {["Item", "Who", "Reason", "Ordered", "Delivered", "Return", "Courier", "Payments"].map((h, i) => (
                    <th key={h} style={{ textAlign: i === 7 ? "right" : "left", padding: "8px 12px", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.order_item_id} style={{ borderTop: `1px solid ${C.gray100}` }}>
                    <td style={{ padding: "8px 12px", maxWidth: 260 }}>
                      <div style={{ fontFamily: "monospace", fontWeight: 800 }}>{r.sku}{r.quantity > 1 ? ` × ${r.quantity}` : ""}</div>
                      <div style={{ fontSize: 11, color: C.gray500, fontFamily: "monospace" }}>{r.order_id}</div>
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <Kind kind={r.kind} />
                      {r.status === "RETURN_REQUESTED" && <div style={{ fontSize: 11, color: "#B45309", fontWeight: 700, marginTop: 3 }}>on the way back</div>}
                    </td>
                    <td style={{ padding: "8px 12px", maxWidth: 220 }}>
                      <div style={{ fontWeight: 700, color: r.reason ? C.gray800 : C.gray400 }}>{r.reason ? nice(r.reason) : "Not given"}</div>
                      {r.sub_reason && r.sub_reason !== r.reason && <div style={{ fontSize: 11, color: C.gray500 }}>{nice(r.sub_reason)}</div>}
                    </td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{day(r.order_date)}</td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap", color: r.delivery_date ? C.gray700 : C.gray400 }}>{r.delivery_date ? day(r.delivery_date) : "never"}</td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{day(r.return_date)}</td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                      <div>{r.courier || "—"}</div>
                      {r.tracking_id && <div style={{ fontSize: 11, color: C.gray500, fontFamily: "monospace" }}>{r.tracking_id}</div>}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", whiteSpace: "nowrap", color: r.net == null ? C.gray400 : r.net < 0 ? C.red : C.gray700 }}>
                      {r.net == null ? "not paid yet" : fmt(r.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.listed < t.returns && <div style={{ padding: 12, fontSize: 12, color: C.gray500 }}>The newest {d.listed} of {t.returns} — pick a shorter period above to see the rest.</div>}
          </div>
        )}
      </section>
    </div>
  );
}
