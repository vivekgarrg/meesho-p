import React, { useState, useEffect, useCallback } from "react";
import { API, C, S, btn, fmt, useIsMobile } from "../../App";
import ChecklistIcon from "@mui/icons-material/Checklist";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import { ProductsPanel } from "./ProductsPanel";
import { LegacyListingsPanel } from "./LegacyListingsPanel";
import { ReturnClaimsPanel } from "./ReturnClaimsPanel";
import { WalletPanel } from "./WalletPanel";

const VIEWS = [
  { k: "products", l: "Products" },
  { k: "legacy",   l: "Legacy listings" },
  { k: "claims",   l: "Return claims" },
];

export function TeamTasksTab() {
  const isMobile = useIsMobile();
  const [isAdmin, setIsAdmin] = useState(false);
  const [wallet, setWallet] = useState(null);
  const [productTotals, setProductTotals] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [view, setView] = useState("products");
  const [walletOpen, setWalletOpen] = useState(false);

  const fetchWallet = useCallback(async () => {
    try {
      const res = await fetch(`${API}/wallet/`);
      if (res.ok) {
        const d = await res.json();
        setWallet(d);
        setIsAdmin(!!d.is_admin);
      }
    } catch { /* header chip just stays stale */ }
  }, []);

  // Product-level totals for the wallet panel's summary strip — "how many
  // SKUs generated, how much paid, how much still owed" across every
  // product, not just the ledger. Refetched alongside the wallet since the
  // same actions (approving a SKU) move both.
  const fetchProductTotals = useCallback(async () => {
    try {
      const res = await fetch(`${API}/products/`);
      if (!res.ok) return;
      const d = await res.json();
      const rows = d.results || [];
      setProductTotals(rows.reduce((acc, p) => ({
        product_count: acc.product_count + 1,
        sku_count: acc.sku_count + (p.sku_count || 0),
        total_paid: acc.total_paid + Number(p.total_paid || 0),
        pending_value: acc.pending_value + Number(p.pending_value || 0),
      }), { product_count: 0, sku_count: 0, total_paid: 0, pending_value: 0 }));
    } catch { /* summary strip just stays stale */ }
  }, []);

  useEffect(() => { fetchWallet(); fetchProductTotals(); }, [fetchWallet, fetchProductTotals]);

  /**
   * The one write path every panel shares. Returns {data} or {error} rather
   * than throwing, so a panel decides how to react (which message, whether to
   * refetch its own list) — but every successful write refreshes the wallet
   * here, since approving a SKU or a claim can credit it from any panel.
   */
  const post = useCallback(async (url, body, method = "POST") => {
    setBusy(true);
    try {
      const opts = { method };
      if (body !== null && body !== undefined) {
        opts.headers = { "Content-Type": "application/json" };
        opts.body = JSON.stringify(body);
      }
      const res = await fetch(url, opts);
      if (res.status === 204) { fetchWallet(); fetchProductTotals(); return { data: {} }; }
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return { error: d.error || "That didn't work." };
      fetchWallet(); fetchProductTotals();
      return { data: d };
    } catch { return { error: "Network error." }; }
    finally { setBusy(false); }
  }, [fetchWallet, fetchProductTotals]);

  const pending = wallet?.totals?.pending ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <ChecklistIcon style={{ color: C.orange, fontSize: 21 }} />
            <h1 style={{ fontSize: isMobile ? 17 : 19, fontWeight: 800, color: C.gray800 }}>Team Tasks</h1>
          </div>
          <p style={{ fontSize: 12, color: C.gray400, marginTop: 3 }}>
            {isAdmin ? "Products, listings and claims — review, pay, and track the wallet"
                     : "Your products, claims and what you've earned"}
          </p>
        </div>
        <button onClick={() => setWalletOpen((w) => !w)}
          style={{ ...btn(walletOpen ? "ghostOrange" : "ghost", "sm"),
            padding: isMobile ? "10px 14px" : undefined }}>
          <AccountBalanceWalletIcon style={{ fontSize: 15, verticalAlign: "-3px" }} />
          &nbsp;{isAdmin ? "Wallets" : "Wallet"} · {fmt(pending)}
        </button>
      </div>

      {msg && (
        <div style={{ padding: "11px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: msg.type === "success" ? C.greenLight : C.redLight,
          color: msg.type === "success" ? C.green : C.red,
          border: `1px solid ${msg.type === "success" ? C.greenBorder : C.redBorder}`,
          display: "flex", alignItems: "center", gap: 8 }}>
          {msg.type === "success" ? <CheckCircleIcon style={{ fontSize: 17 }} /> : <ErrorOutlineIcon style={{ fontSize: 17 }} />}
          <span style={{ flex: 1 }}>{msg.text}</span>
          <button onClick={() => setMsg(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16 }}>×</button>
        </div>
      )}

      {walletOpen && (
        <WalletPanel wallet={wallet} isAdmin={isAdmin} busy={busy} post={post}
          refresh={fetchWallet} setMsg={setMsg} productTotals={productTotals} />
      )}

      {/* ── View switcher ──────────────────────────────────────────────────── */}
      <div style={{ display: "inline-flex", background: C.gray100, borderRadius: 11, padding: 3,
        border: `1px solid ${C.border}`, alignSelf: "flex-start", flexWrap: "wrap" }}>
        {VIEWS.map((v) => (
          <button key={v.k} onClick={() => setView(v.k)}
            style={{ border: "none", cursor: "pointer", fontFamily: "inherit",
              background: view === v.k ? C.white : "transparent",
              color: view === v.k ? C.gray800 : C.gray500,
              fontWeight: view === v.k ? 800 : 600, fontSize: 12.5,
              padding: isMobile ? "9px 14px" : "6px 15px", borderRadius: 9, whiteSpace: "nowrap",
              boxShadow: view === v.k ? "0 1px 3px rgba(0,0,0,0.10)" : "none" }}>
            {v.l}
          </button>
        ))}
      </div>

      {/* ── Active panel ───────────────────────────────────────────────────── */}
      {view === "products" && (
        <ProductsPanel isAdmin={isAdmin} busy={busy} setBusy={setBusy} setMsg={setMsg} post={post} />
      )}
      {view === "legacy" && (
        <LegacyListingsPanel isAdmin={isAdmin} busy={busy} setMsg={setMsg} post={post} />
      )}
      {view === "claims" && (
        <ReturnClaimsPanel isAdmin={isAdmin} busy={busy} setBusy={setBusy} setMsg={setMsg} post={post} />
      )}
    </div>
  );
}
