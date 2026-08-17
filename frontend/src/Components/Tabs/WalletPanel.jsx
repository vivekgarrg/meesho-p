import React from "react";
import { API, C, S, btn, useIsMobile } from "../../App";
import { Money, Metric, scrollRow } from "./TeamTasksShared";

/**
 * The per-worker wallet ledger, plus a totals strip carrying the
 * "products listed / paid / balance" summary the redesign asked for.
 */
export function WalletPanel({ wallet, isAdmin, productTotals, busy, post, refresh, setMsg }) {
  const isMobile = useIsMobile();
  if (!wallet) return null;

  const adjust = async (userId, username) => {
    const raw = window.prompt(`Adjust ${username}'s balance by how much? Use a minus for a deduction.`, "");
    if (!raw) return;
    const note = window.prompt("Why? (recorded against the entry)", "");
    if (!note) { setMsg({ type: "error", text: "An adjustment needs a reason." }); return; }
    const { error } = await post(`${API}/wallet/adjust/`, { user_id: userId, amount: raw, note });
    if (error) setMsg({ type: "error", text: error });
    else { setMsg({ type: "success", text: `Adjusted ${username}'s balance.` }); refresh(); }
  };

  const settle = async (userId, username) => {
    if (!window.confirm(`Mark everything outstanding for ${username} as paid?`)) return;
    const method = window.prompt("How was it paid? (UPI / cash / bank)", "UPI") || "";
    const ref = window.prompt("Reference / UTR (optional)", "") || "";
    const { error } = await post(`${API}/wallet/settle/`, { user_id: userId, method, reference: ref });
    if (error) setMsg({ type: "error", text: error });
    else { setMsg({ type: "success", text: `Settled ${username}'s balance.` }); refresh(); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {productTotals && (
        <div style={{ ...S.card, borderTop: `4px solid ${C.blue}`, padding: isMobile ? 15 : 22 }}>
          <div style={{ ...S.cardTitle, marginBottom: 12 }}>Products, at a glance</div>
          <div style={scrollRow}>
            <Metric label="products" value={productTotals.product_count} accent={C.blue} />
            <Metric label="SKUs generated" value={productTotals.sku_count} accent={C.gray700} />
            <Metric label="total paid" value={productTotals.total_paid} accent={C.green} money />
            <Metric label="pending" value={productTotals.pending_value} accent={C.orange} money />
          </div>
        </div>
      )}

      <div style={{ ...S.card, borderTop: `4px solid ${C.green}`, padding: isMobile ? 15 : 22 }}>
        <div style={{ ...S.cardTitle, marginBottom: 12 }}>{isAdmin ? "Wallets" : "My wallet"}</div>
        <div style={{ ...scrollRow, marginBottom: 14 }}>
          <Metric label="earned" value={wallet.totals.earned} accent={C.green} money />
          <Metric label="paid out" value={wallet.totals.settled} accent={C.gray500} money />
          <Metric label="still owed" value={wallet.totals.pending} accent={C.orange} money />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead><tr>{["Worker", "Earned", "Paid", "Owed", ""].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {wallet.per_user.map((u, i) => (
                <tr key={u.user_id} style={{ background: i % 2 ? C.gray50 : C.white }}>
                  <td style={{ ...S.td, fontWeight: 700 }}>{u.username}</td>
                  <td style={S.td}><Money value={u.earned} /></td>
                  <td style={S.td}><Money value={u.settled} muted /></td>
                  <td style={S.td}><Money value={u.pending} /></td>
                  <td style={S.td}>
                    {isAdmin && (
                      <span style={{ display: "flex", gap: 6 }}>
                        {u.pending > 0 && (
                          <button onClick={() => settle(u.user_id, u.username)} disabled={busy} style={btn("ghost", "sm")}>
                            Mark paid
                          </button>
                        )}
                        <button onClick={() => adjust(u.user_id, u.username)} disabled={busy} style={btn("ghost", "sm")}>
                          Adjust
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {wallet.per_user.length === 0 && (
                <tr><td colSpan={5} style={{ ...S.td, textAlign: "center", padding: 24, color: C.gray400 }}>
                  Nothing earned yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
