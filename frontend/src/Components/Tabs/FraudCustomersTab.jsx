import React, { useState, useEffect, useCallback } from "react";
import { API, C, S, btn, Tag, SectionHeader } from "../../App";

// ── Helpers ───────────────────────────────────────────────────────────────────
function RiskBadge({ level }) {
  const cfg = {
    high:   { bg: C.redLight,   fg: C.red,    border: C.redBorder,   label: "⚠ High Risk" },
    medium: { bg: C.amberLight, fg: C.amber,  border: "#FDE68A",     label: "⚡ Medium"   },
    low:    { bg: C.greenLight, fg: C.green,  border: C.greenBorder, label: "✓ Low"       },
  };
  const c = cfg[level] || cfg.low;
  return (
    <span style={{
      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: c.bg, color: c.fg, border: `1px solid ${c.border}`, whiteSpace: "nowrap",
    }}>{c.label}</span>
  );
}

function RateMeter({ rate }) {
  const pct   = Math.round(rate * 100);
  const color = rate >= 0.75 ? C.red : rate >= 0.40 ? C.amber : C.green;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 110 }}>
      <div style={{ flex: 1, height: 6, background: C.gray200, borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 36, textAlign: "right", fontFamily: "monospace" }}>
        {pct}%
      </span>
    </div>
  );
}

// ── Block / Unblock confirmation modal ───────────────────────────────────────
function BlockModal({ customer, onConfirm, onClose }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const handleConfirm = async () => {
    setSaving(true);
    await onConfirm(reason);
    setSaving(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: C.white, borderRadius: 16, width: "100%", maxWidth: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", overflow: "hidden" }}>
        <div style={{ padding: "18px 24px 14px", background: C.redLight, borderBottom: `1px solid ${C.redBorder}` }}>
          <h3 style={{ fontSize: 16, fontWeight: 800, color: C.red }}>🚫 Block Customer</h3>
          <p style={{ fontSize: 12, color: "#B91C1C", marginTop: 3 }}>
            This customer will be flagged every time their label is parsed.
          </p>
        </div>
        <div style={{ padding: "18px 24px" }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: C.gray700, marginBottom: 4 }}>{customer.customer_name}</p>
          <p style={{ fontSize: 12, color: C.gray400, marginBottom: 16 }}>
            {[customer.customer_city, customer.customer_state, customer.customer_pincode].filter(Boolean).join(", ")}
          </p>
          <label style={S.label}>Reason for blocking (optional)</label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. High RTO rate, suspected fraud…"
            rows={3}
            style={{ ...S.inp, resize: "vertical", fontFamily: "inherit" }}
          />
        </div>
        <div style={{ padding: "10px 24px 18px", display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btn("ghost")}>Cancel</button>
          <button onClick={handleConfirm} disabled={saving}
            style={{ ...btn("danger"), opacity: saving ? 0.6 : 1 }}>
            {saving ? "Blocking…" : "Confirm Block"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Tab ─────────────────────────────────────────────────────────────────
export function FraudCustomersTab() {
  const [suspects,    setSuspects]    = useState([]);
  const [blocked,     setBlocked]     = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [riskFilter,  setRiskFilter]  = useState("all");
  const [searchQ,     setSearchQ]     = useState("");
  const [minOrders,   setMinOrders]   = useState(2);
  const [blockTarget, setBlockTarget] = useState(null); // customer row to block
  const [activeView,  setActiveView]  = useState("suspects"); // "suspects" | "blocked"

  const loadSuspects = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ min_orders: minOrders, ...(riskFilter !== "all" && { risk: riskFilter }) });
    try {
      const r = await fetch(`${API}/fraud-customers/?${params}`);
      if (r.ok) setSuspects((await r.json()).results || []);
    } finally { setLoading(false); }
  }, [minOrders, riskFilter]);

  const loadBlocked = useCallback(async () => {
    const r = await fetch(`${API}/blocked-customers/`);
    if (r.ok) setBlocked((await r.json()).results || []);
  }, []);

  useEffect(() => { loadSuspects(); loadBlocked(); }, [loadSuspects, loadBlocked]);

  const handleBlock = async (customer, reason) => {
    await fetch(`${API}/blocked-customers/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name:    customer.customer_name,
        customer_pincode: customer.customer_pincode,
        customer_city:    customer.customer_city,
        customer_state:   customer.customer_state,
        reason,
      }),
    });
    setBlockTarget(null);
    // Refresh both lists
    await Promise.all([loadSuspects(), loadBlocked()]);
  };

  const handleUnblock = async (id) => {
    if (!window.confirm("Unblock this customer?")) return;
    await fetch(`${API}/blocked-customers/${id}/`, { method: "DELETE" });
    await Promise.all([loadSuspects(), loadBlocked()]);
  };

  const filtered = suspects.filter(s => {
    if (!searchQ) return true;
    const q = searchQ.toLowerCase();
    return s.customer_name.toLowerCase().includes(q) ||
           s.customer_pincode.includes(q) ||
           s.customer_city?.toLowerCase().includes(q);
  });

  // KPI counts
  const highCount   = suspects.filter(s => s.risk_level === "high").length;
  const medCount    = suspects.filter(s => s.risk_level === "medium").length;
  const blockedCount = blocked.length;

  const TabBtn = ({ id, label }) => (
    <button onClick={() => setActiveView(id)} style={{
      padding: "7px 18px", borderRadius: 8, border: "none", cursor: "pointer",
      fontFamily: "inherit", fontSize: 13, fontWeight: activeView === id ? 700 : 500,
      background: activeView === id ? C.orangeLight : "transparent",
      color: activeView === id ? C.orange : C.gray500,
      transition: "all 0.15s",
    }}>{label}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {blockTarget && (
        <BlockModal
          customer={blockTarget}
          onConfirm={(reason) => handleBlock(blockTarget, reason)}
          onClose={() => setBlockTarget(null)}
        />
      )}

      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800, marginBottom: 3 }}>🚨 Fraud Customers</h1>
        <p style={{ fontSize: 13, color: C.gray400 }}>
          Customers with high RTO rates or claims. Block them to get a warning on future label uploads.
        </p>
      </div>

      {/* KPI strip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        {[
          { label: "High Risk",      value: highCount,    accent: C.red,   icon: "⚠" },
          { label: "Medium Risk",    value: medCount,     accent: C.amber, icon: "⚡" },
          { label: "Total Suspects", value: suspects.length, accent: C.blue, icon: "👥" },
          { label: "Blocked",        value: blockedCount, accent: C.gray700, icon: "🚫" },
        ].map(k => (
          <div key={k.label} style={{ ...S.card, borderTop: `3px solid ${k.accent}`, minWidth: "max-content" }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8, whiteSpace: "nowrap" }}>
              {k.icon} {k.label}
            </p>
            <p style={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: k.accent, whiteSpace: "nowrap" }}>
              {k.value}
            </p>
          </div>
        ))}
      </div>

      {/* View toggle */}
      <div style={{ display: "flex", background: C.gray100, borderRadius: 10, padding: 3, width: "fit-content" }}>
        <TabBtn id="suspects" label="🔍 Suspect Analysis" />
        <TabBtn id="blocked"  label={`🚫 Blocked Customers (${blockedCount})`} />
      </div>

      {/* ── Suspects view ── */}
      {activeView === "suspects" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Filter bar */}
          <div style={{ ...S.card, padding: "14px 20px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={searchQ} onChange={e => setSearchQ(e.target.value)}
              placeholder="🔍 Search name, pincode, city…"
              style={{ ...S.inp, width: 240, fontSize: 12 }}
            />
            <div style={{ width: 1, height: 24, background: C.gray200 }} />
            <span style={{ fontSize: 12, color: C.gray500, fontWeight: 600 }}>Risk:</span>
            {["all", "high", "medium", "low"].map(r => (
              <button key={r} onClick={() => setRiskFilter(r)} style={{
                padding: "5px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                fontWeight: riskFilter === r ? 700 : 400, fontFamily: "inherit",
                background: riskFilter === r
                  ? r === "all" ? C.gray700 : r === "high" ? C.red : r === "medium" ? C.amber : C.green
                  : C.white,
                color: riskFilter === r ? C.white : C.gray600,
                border: `1px solid ${riskFilter === r
                  ? r === "all" ? C.gray700 : r === "high" ? C.red : r === "medium" ? C.amber : C.green
                  : C.gray300}`,
              }}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
            <div style={{ width: 1, height: 24, background: C.gray200 }} />
            <label style={{ fontSize: 12, color: C.gray500, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              Min orders:
              <select value={minOrders} onChange={e => setMinOrders(Number(e.target.value))}
                style={{ ...S.inp, width: 70, fontSize: 12, padding: "5px 8px" }}>
                {[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {loading && <span style={{ fontSize: 12, color: C.gray400 }}>Calculating…</span>}
          </div>

          {/* Risk scoring legend */}
          <div style={{ ...S.card, padding: "12px 18px", background: "#FFFBEB", borderColor: "#FDE68A" }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              How risk is calculated
            </p>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 12, color: C.gray600 }}>
              <span><strong style={{ color: C.red }}>High Risk</strong> — RTO rate ≥ 75% OR ≥ 3 claims</span>
              <span><strong style={{ color: C.amber }}>Medium Risk</strong> — RTO rate ≥ 40% OR ≥ 1 claim</span>
              <span><strong style={{ color: C.green }}>Low Risk</strong> — below thresholds</span>
              <span style={{ color: C.gray400 }}>Only customers with ≥ {minOrders} orders are shown</span>
            </div>
          </div>

          {/* Suspects table */}
          <div style={S.card}>
            <SectionHeader title="Customer Risk Analysis" count={filtered.length} />
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Customer", "Location", "Orders", "Delivered", "RTO", "RTO Rate", "Claims", "Risk", "Action"].map(h => (
                      <th key={h} style={{ ...S.th, textAlign: ["Orders", "Delivered", "RTO", "Claims"].includes(h) ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s, i) => {
                    const rowBg = s.is_blocked
                      ? "#FFF5F5"
                      : s.risk_level === "high"
                        ? "#FFF8F8"
                        : i % 2 === 0 ? C.white : C.gray50;
                    return (
                      <tr key={`${s.customer_name}-${s.customer_pincode}`}
                        style={{ background: rowBg }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#F8F0FF")}
                        onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                      >
                        <td style={S.td}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ fontWeight: 700, color: C.gray800, fontSize: 13 }}>{s.customer_name}</span>
                            {s.is_blocked && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: C.red, background: C.redLight, padding: "1px 7px", borderRadius: 20, width: "fit-content" }}>
                                🚫 BLOCKED
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ ...S.td, fontSize: 12 }}>
                          <div style={{ color: C.gray600 }}>{s.customer_city || "—"}</div>
                          <div style={{ color: C.gray400, fontSize: 11 }}>{s.customer_state} {s.customer_pincode}</div>
                        </td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>{s.total_orders}</td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: C.green }}>{s.delivered}</td>
                        <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", color: s.rto > 0 ? C.red : C.gray300, fontWeight: s.rto > 0 ? 700 : 400 }}>{s.rto}</td>
                        <td style={S.td}><RateMeter rate={s.rto_rate} /></td>
                        <td style={{ ...S.td, textAlign: "right" }}>
                          {s.claim_count > 0
                            ? <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.red, background: C.redLight, padding: "2px 8px", borderRadius: 12 }}>{s.claim_count}</span>
                            : <span style={{ color: C.gray300, fontFamily: "monospace" }}>0</span>}
                        </td>
                        <td style={S.td}><RiskBadge level={s.risk_level} /></td>
                        <td style={S.td}>
                          {s.is_blocked ? (
                            <span style={{ fontSize: 12, color: C.gray400, fontStyle: "italic" }}>Blocked</span>
                          ) : (
                            <button
                              onClick={() => setBlockTarget(s)}
                              style={{ ...btn("danger", "sm"), padding: "4px 12px", fontSize: 11 }}
                            >🚫 Block</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ ...S.td, textAlign: "center", padding: 52, color: C.gray400 }}>
                        {suspects.length === 0
                          ? "No customer data yet — upload labels first to track order history."
                          : "No customers match the current filter."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Blocked customers view ── */}
      {activeView === "blocked" && (
        <div style={S.card}>
          <SectionHeader title="Blocked Customers" count={blocked.length} />

          {blocked.length === 0 ? (
            <div style={{ textAlign: "center", padding: 52, color: C.gray400 }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
              <p>No blocked customers. Block a customer from the Suspect Analysis tab.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Customer", "Location", "Pincode", "Reason", "Blocked On", "Action"].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {blocked.map((bc, i) => {
                    const rowBg = i % 2 === 0 ? C.white : C.gray50;
                    return (
                      <tr key={bc.id} style={{ background: rowBg }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#FFF5F5")}
                        onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                      >
                        <td style={{ ...S.td, fontWeight: 700, color: C.gray800 }}>{bc.customer_name}</td>
                        <td style={{ ...S.td, fontSize: 12, color: C.gray500 }}>
                          {[bc.customer_city, bc.customer_state].filter(Boolean).join(", ") || "—"}
                        </td>
                        <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>{bc.customer_pincode}</td>
                        <td style={{ ...S.td, fontSize: 12, color: C.gray500, maxWidth: 240 }}>
                          {bc.reason || <span style={{ color: C.gray300, fontStyle: "italic" }}>No reason given</span>}
                        </td>
                        <td style={{ ...S.td, fontSize: 12, color: C.gray500, whiteSpace: "nowrap" }}>
                          {new Date(bc.blocked_at).toLocaleDateString("en-IN")}
                        </td>
                        <td style={S.td}>
                          <button
                            onClick={() => handleUnblock(bc.id)}
                            style={{ ...btn("ghost", "sm"), padding: "4px 12px", fontSize: 11, color: C.green, borderColor: C.greenBorder }}
                          >✓ Unblock</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Info callout */}
      <div style={{ ...S.card, padding: "14px 20px", background: C.gray50 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
          How blocking works
        </p>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", fontSize: 12, color: C.gray600 }}>
          {[
            { icon: "📋", text: "Customer identity = Name + Pincode (as printed on Meesho labels)" },
            { icon: "🏷", text: "When you upload a labels PDF, any blocked customer in that batch is flagged immediately" },
            { icon: "📦", text: "Label Orders table shows a red BLOCKED badge on their rows" },
            { icon: "✓",  text: "Unblocking is reversible — the customer goes back to normal" },
          ].map(item => (
            <div key={item.text} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
