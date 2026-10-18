import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import CircularProgress from "@mui/material/CircularProgress";
import { API, C, S, useIsMobile } from "../../App";

/**
 * Listing Hub — one place for listing managers to list a product anywhere.
 *
 * Search a product (parent) or any SKU id → see its photos (download one or
 * all), the price to list at (recommended from cost + fees + returns, or the
 * price someone has set), every detail typed into its earlier Meesho /
 * Flipkart listing sheets (each with a copy button), its SKU ids, and its past
 * listings — with buttons that open Bulk Listing ready for this product.
 * Backend: meesho_app/listing_hub.py.
 */

const GUIDE_KEY = "listingHub.guideHidden";
const TARGET_KEY = "listingHub.target";
const PLATFORMS = [
  { key: "meesho", label: "Meesho", color: "#9F2089" },
  { key: "flipkart", label: "Flipkart", color: "#2874F0" },
];

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const rupees = (v) => (v == null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")}`);
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

// ── small building blocks ────────────────────────────────────────────────────

function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback((text, ok = true) => {
    setToast({ text, ok });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  const node = toast && (
    <div role="status" style={{ position: "fixed", left: "50%", bottom: "calc(24px + env(safe-area-inset-bottom, 0px))", transform: "translateX(-50%)",
      zIndex: 2000, background: toast.ok ? C.gray800 : C.red, color: C.white, padding: "10px 18px", borderRadius: 999,
      fontSize: 13, fontWeight: 700, boxShadow: "0 8px 24px rgba(0,0,0,.18)", maxWidth: "90vw" }}>
      {toast.text}
    </div>
  );
  return [show, node];
}

async function copyText(text, toast, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} ✓`);
  } catch {
    toast("Couldn't copy — select the text and copy it by hand.", false);
  }
}

async function download(url, fallbackName, toast) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast(d.error || `Download failed (${res.status}).`, false);
      return null;
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const name = (cd.match(/filename="([^"]+)"/) || [])[1] || fallbackName;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return res;
  } catch {
    toast("Network error during download.", false);
    return null;
  }
}

function Btn({ children, onClick, kind = "secondary", disabled, title, small }) {
  const styles = {
    primary: { background: C.orange, color: C.white, border: `1px solid ${C.orange}` },
    secondary: { background: C.white, color: C.gray700, border: `1px solid ${C.gray200}` },
    ghost: { background: "transparent", color: C.orange, border: "1px solid transparent" },
  }[kind];
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{ ...styles, borderRadius: 10, padding: small ? "5px 10px" : "9px 14px", fontSize: small ? 12 : 13, fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, whiteSpace: "nowrap",
        display: "inline-flex", alignItems: "center", gap: 6 }}>
      {children}
    </button>
  );
}

function CopyBtn({ text, toast, label = "Copy", what }) {
  return <Btn small kind="secondary" onClick={() => copyText(text, toast, what)} title="Copy to clipboard">⧉ {label}</Btn>;
}

function Chip({ children, color = C.gray600, bg = C.gray100 }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color, background: bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{children}</span>;
}

function Card({ children, style }) {
  return <div style={{ ...S.card, padding: 16, ...style }}>{children}</div>;
}

// ── the how-to guide ─────────────────────────────────────────────────────────

const STEPS = [
  { icon: "🔍", title: "Find the product",
    text: "Type the product (parent) name or any SKU id in the search box. Brand-new product not there? Ask an admin to add it on SKU Pricing first — with its cost price and a photo — so it can be found and priced." },
  { icon: "🖼️", title: "Get the photos",
    text: "Open Photos. Download all as one ZIP, or one by one. No photos yet? Upload them on SKU Pricing → Upload photos (or the Quadrant Cropper) and they show up here." },
  { icon: "💰", title: "Decide the price",
    text: "Open Price. Use the price marked “List at” — the price an admin set, or else the recommended one, worked out from cost, Meesho/Flipkart fees and how often this product comes back. Don't list below the break-even price." },
  { icon: "📋", title: "Copy the details",
    text: "Open Saved listings. Every Meesho / Flipkart sheet and extension template saved for this product is there, grouped by category — HSN, weight, material, MRP, description — each with a copy button. Fix anything marked in red before reusing it." },
  { icon: "🚀", title: "Create the listing",
    text: "Press “Create Meesho listing” or “Create Flipkart listing” — Bulk Listing opens with this product already chosen. “Start from this listing” copies the previous sheet so only the new SKU ids need checking. Generate the sheet and upload it on the marketplace panel." },
  { icon: "✅", title: "After it goes live",
    text: "New SKU ids join this product automatically once the listing is approved. Search the product again to check its SKU ids, and give the admin the new SKU ids if anything looks missing." },
];

function Guide({ onHide, compact }) {
  return (
    <Card style={{ border: `1px solid ${C.orangeBorder}`, background: `linear-gradient(180deg, ${C.orangeLight} 0%, ${C.white} 70%)` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 800, color: C.gray800 }}>How to list a product — 6 steps</p>
          <p style={{ fontSize: 12, color: C.gray500 }}>Follow these in order for every new listing. You can open this guide again any time.</p>
        </div>
        <Btn small onClick={onHide}>Hide guide</Btn>
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10,
        gridTemplateColumns: compact ? "1fr" : "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {STEPS.map((s, i) => (
          <li key={s.title} style={{ display: "flex", gap: 10, background: C.white, border: `1px solid ${C.gray100}`, borderRadius: 12, padding: 12 }}>
            <span style={{ flex: "0 0 30px", height: 30, borderRadius: 999, background: C.orange, color: C.white, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: C.gray800 }}>{s.icon} {s.title}</p>
              <p style={{ fontSize: 12, color: C.gray600, lineHeight: 1.5, marginTop: 2 }}>{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

// ── search & results ─────────────────────────────────────────────────────────

const NO_SHEET = "No listing sheet yet";

function ProductCard({ p, onOpen }) {
  return (
    <button onClick={() => onOpen(p.item_id)}
      style={{ ...S.card, padding: 0, overflow: "hidden", textAlign: "left", cursor: "pointer",
        border: `1px solid ${p.paused ? C.amberBorder : C.gray100}`, display: "flex", flexDirection: "column", opacity: p.paused ? 0.8 : 1 }}>
      <div style={{ aspectRatio: "1 / 1", background: C.gray50, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" }}>
        {p.image_url
          ? <img src={p.image_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <span style={{ fontSize: 30, color: C.gray300 }}>📦</span>}
        {p.paused && (
          <span style={{ position: "absolute", top: 8, left: 8, background: C.amber, color: C.white, fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "2px 9px" }}>⏸ Paused</span>
        )}
      </div>
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: C.gray800, wordBreak: "break-word" }}>{p.item_id}</span>
        {p.matched_sku && <span style={{ fontSize: 11, color: C.orange, wordBreak: "break-all" }}>matches SKU {p.matched_sku}</span>}
        <span style={{ fontSize: 11.5, color: C.gray500 }}>
          {p.sku_count} SKU{p.sku_count === 1 ? "" : "s"}{p.photo_count ? ` · 📷 ${p.photo_count} uploaded` : ""}
          {p.saved_prices?.meesho ? ` · ${rupees(p.saved_prices.meesho)}` : ""}
        </span>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {!p.priced && <Chip color={C.red} bg={C.redLight}>No cost price</Chip>}
          {PLATFORMS.map((pl) => p.listed_on.includes(pl.key) && <Chip key={pl.key} color={pl.color} bg={`${pl.color}14`}>{pl.label} ✓</Chip>)}
          {(p.categories || []).map((c) => <Chip key={c} color={C.gray600} bg={C.gray100}>🏷 {c}</Chip>)}
        </div>
      </div>
    </button>
  );
}

/**
 * Admins: saved listings no product claims yet, each with its best-guess
 * products. `forItem` ranks them for one product and links straight to it.
 */
function LinkPanel({ forItem, onClose, onLinked, toast }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);
  const [picking, setPicking] = useState({});   // object key -> typed product name
  const [options, setOptions] = useState({});   // object key -> search results

  const load = useCallback(() => {
    const q = forItem ? `?${new URLSearchParams({ for: forItem })}` : "";
    fetch(`${API}/listing-hub/unlinked/${q}`).then((r) => r.json()).then((d) => setRows(d.results || [])).catch(() => setRows([]));
  }, [forItem]);
  useEffect(() => { load(); }, [load]);

  const link = async (row, item) => {
    setBusy(`${row.kind}-${row.object_id}`);
    try {
      const res = await fetch(`${API}/listing-hub/link/`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: row.kind, object_id: row.object_id, id: item }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast(d.error || "Couldn't link it.", false); return; }
      toast(`Linked to ${d.linked} ✓`);
      setRows((rs) => rs.filter((r) => !(r.kind === row.kind && r.object_id === row.object_id)));
      onLinked?.();
    } finally {
      setBusy(null);
    }
  };
  const search = async (key, text) => {
    setPicking((p) => ({ ...p, [key]: text }));
    if (text.trim().length < 2) { setOptions((o) => ({ ...o, [key]: [] })); return; }
    const d = await fetch(`${API}/listing-hub/search/?${new URLSearchParams({ q: text })}`).then((r) => r.json()).catch(() => ({}));
    setOptions((o) => ({ ...o, [key]: (d.results || []).slice(0, 6).map((x) => x.item_id) }));
  };

  return (
    <Card style={{ border: `1.5px solid ${C.orangeBorder}`, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 800, color: C.gray800 }}>{forItem ? `Link a saved listing to “${forItem}”` : "Listings not linked to any product"}</p>
          <p style={{ fontSize: 12, color: C.gray500, maxWidth: 640, lineHeight: 1.5 }}>
            These listing sheets and extension templates don't say which product they're for, so they don't show on any product.
            Link each to its product — the best guesses are shown first.
          </p>
        </div>
        <Btn small onClick={onClose}>Close</Btn>
      </div>
      {rows == null ? <CircularProgress size={22} style={{ color: C.orange }} /> : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: C.green, fontWeight: 700 }}>✓ Every saved listing is linked to a product.</p>
      ) : rows.map((r) => {
        const key = `${r.kind}-${r.object_id}`;
        const pl = PLATFORMS.find((x) => x.key === r.platform) || PLATFORMS[0];
        return (
          <div key={key} style={{ border: `1px solid ${C.gray100}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Chip color={pl.color} bg={`${pl.color}14`}>{r.kind === "template" ? "Extension template" : `${pl.label} sheet`}</Chip>
              <span style={{ fontSize: 13, fontWeight: 800, color: C.gray800, wordBreak: "break-all" }}>{r.name}</span>
              <span style={{ fontSize: 12, color: C.gray500 }}>{r.category} · {fmtDate(r.created_at)}</span>
            </div>
            {r.sku_ids?.length > 0 && <p style={{ fontSize: 11.5, color: C.gray500, wordBreak: "break-all" }}>SKU ids: {r.sku_ids.join(", ")}</p>}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {forItem && <Btn small kind="primary" disabled={busy === key} onClick={() => link(r, forItem)}>Link to {forItem}</Btn>}
              {!forItem && r.suggestions.map((s) => (
                <Btn key={s.item_id} small kind="primary" disabled={busy === key} onClick={() => link(r, s.item_id)}>Link to {s.item_id}</Btn>
              ))}
              {!forItem && (
                <span style={{ position: "relative" }}>
                  <input value={picking[key] || ""} onChange={(e) => search(key, e.target.value)} placeholder="…or type another product"
                    style={{ ...S.inp, padding: "6px 10px", fontSize: 12.5, width: 210, border: `1px solid ${C.gray200}` }} />
                  {(options[key] || []).length > 0 && (
                    <span style={{ position: "absolute", top: "100%", left: 0, zIndex: 5, background: C.white, border: `1px solid ${C.gray200}`,
                      borderRadius: 10, boxShadow: "0 8px 20px rgba(0,0,0,.1)", display: "flex", flexDirection: "column", minWidth: 210 }}>
                      {options[key].map((o) => (
                        <button key={o} onClick={() => link(r, o)} style={{ textAlign: "left", padding: "8px 10px", border: "none", background: "none", cursor: "pointer", fontSize: 12.5 }}>{o}</button>
                      ))}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function SearchView({ onOpen, toast }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [paused, setPaused] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [linking, setLinking] = useState(false);
  const [tick, setTick] = useState(0);

  const params = useCallback((extra = {}) => {
    const p = new URLSearchParams({ q });
    if (category) p.set("category", category);
    if (paused) p.set("status", "paused");
    Object.entries(extra).forEach(([k, v]) => p.set(k, v));
    return p;
  }, [q, category, paused]);

  useEffect(() => {
    let off = false;
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`${API}/listing-hub/search/?${params()}`)
        .then((r) => r.json())
        .then((d) => { if (!off) setData(d); })
        .catch(() => { if (!off) setData({ results: [], total: 0, error: true }); })
        .finally(() => { if (!off) setLoading(false); });
    }, 250);
    return () => { off = true; clearTimeout(t); };
  }, [params, tick]);

  const loadMore = async () => {
    setMore(true);
    try {
      const d = await fetch(`${API}/listing-hub/search/?${params({ offset: data.results.length })}`).then((r) => r.json());
      setData((cur) => ({ ...cur, results: [...cur.results, ...(d.results || [])] }));
    } finally {
      setMore(false);
    }
  };

  // With no search and no category picked, show the products grouped by the
  // category their listing sheets were saved under.
  const grouped = !q && !category && !paused;
  const groups = useMemo(() => {
    if (!grouped || !data) return [];
    const by = new Map();
    for (const c of data.categories || []) by.set(c.label, []);
    for (const p of data.results || []) {
      for (const c of (p.categories?.length ? p.categories : [NO_SHEET])) {
        if (!by.has(c)) by.set(c, []);
        by.get(c).push(p);
      }
    }
    return [...by.entries()].filter(([, items]) => items.length);
  }, [grouped, data]);

  const chip = (on) => ({
    padding: "8px 14px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", minHeight: 38,
    border: `1.5px solid ${on ? C.orange : C.gray200}`, background: on ? C.orange : C.white, color: on ? C.white : C.gray600,
  });
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 170px), 1fr))", gap: 12 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", fontSize: 18, color: C.gray400 }}>🔍</span>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products"
          placeholder="Search by product (parent) name or SKU id…"
          style={{ width: "100%", boxSizing: "border-box", padding: "16px 16px 16px 46px", fontSize: 16, borderRadius: 14,
            border: `2px solid ${C.orange}`, outline: "none", background: C.white, color: C.gray800, boxShadow: "0 4px 14px rgba(0,0,0,.05)" }} />
      </div>

      {data?.is_admin && data.unlinked_sheets > 0 && !linking && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap",
          background: C.amberLight, border: `1px solid ${C.amberBorder}`, borderRadius: 12, padding: "10px 14px" }}>
          <span style={{ fontSize: 13, color: "#92400E", fontWeight: 600 }}>
            {data.unlinked_sheets === 1 ? "1 saved listing sheet isn't" : `${data.unlinked_sheets} saved listing sheets aren't`} linked to any product, so {data.unlinked_sheets === 1 ? "its" : "their"} details don't show anywhere.
          </span>
          <Btn small kind="primary" onClick={() => setLinking(true)}>Link them</Btn>
        </div>
      )}
      {linking && <LinkPanel onClose={() => setLinking(false)} onLinked={() => setTick((t) => t + 1)} toast={toast} />}

      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2, alignItems: "center" }}>
        <button style={chip(!category && !paused)} onClick={() => { setCategory(""); setPaused(false); }}>All categories</button>
        {(data?.categories || []).map((c) => (
          <button key={c.label} style={chip(category === c.label)} onClick={() => { setCategory(category === c.label ? "" : c.label); setPaused(false); }}>
            {c.label === NO_SHEET ? "📭 " : "🏷 "}{c.label} · {c.count}
          </button>
        ))}
        {data?.is_admin && data.paused_count > 0 && (
          <button style={{ ...chip(paused), ...(paused ? {} : { borderColor: C.amberBorder, color: "#92400E" }) }}
            onClick={() => { setPaused(!paused); setCategory(""); }}>⏸ Paused · {data.paused_count}</button>
        )}
      </div>

      {data?.skus_without_parent?.length > 0 && (
        <p style={{ fontSize: 12.5, color: C.amber, background: C.amberLight, borderRadius: 10, padding: "8px 12px" }}>
          These SKU ids match but aren't under any product yet: <b>{data.skus_without_parent.join(", ")}</b>. Ask an admin to link them on SKU Pricing → SKU Link.
        </p>
      )}
      <p style={{ fontSize: 12, color: C.gray500 }}>
        {loading ? "Searching…" : paused ? `${data?.total ?? 0} paused product(s) — hidden from listing managers`
          : q ? `${data?.total ?? 0} product(s) match “${q}”${category ? ` in ${category}` : ""}`
            : category ? `${data?.total ?? 0} product(s) in ${category}` : `${data?.total ?? 0} products, grouped by listing category`}
      </p>
      {!loading && data?.results?.length === 0 && (
        <Card style={{ textAlign: "center", color: C.gray500, fontSize: 13 }}>
          Nothing found. Check the spelling, try part of the name or SKU id, or ask an admin to add the product on SKU Pricing.
        </Card>
      )}

      {grouped ? groups.map(([label, items]) => (
        <section key={label} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
            <h3 style={{ fontSize: 15, fontWeight: 900, color: C.gray800 }}>{label === NO_SHEET ? "📭" : "🏷"} {label}
              <span style={{ fontSize: 12, fontWeight: 700, color: C.gray400 }}> · {(data.categories.find((c) => c.label === label) || {}).count ?? items.length}</span></h3>
            <Btn small kind="ghost" onClick={() => setCategory(label)}>See all in {label} →</Btn>
          </div>
          <div style={grid}>{items.slice(0, 12).map((p) => <ProductCard key={`${label}-${p.id}`} p={p} onOpen={onOpen} />)}</div>
        </section>
      )) : (
        <div style={grid}>{(data?.results || []).map((p) => <ProductCard key={p.id} p={p} onOpen={onOpen} />)}</div>
      )}
      {data && data.results.length < data.total && (
        <div style={{ textAlign: "center" }}><Btn onClick={loadMore} disabled={more}>{more ? "Loading…" : `Show more (${data.total - data.results.length} left)`}</Btn></div>
      )}
    </div>
  );
}

// ── product page sections ────────────────────────────────────────────────────

function PhotosSection({ data, toast }) {
  const [zipBusy, setZipBusy] = useState(false);
  const [check, setCheck] = useState(null);      // { byN: {n: result}, broken } | "running"
  const id = data.parent.item_id;
  const photos = data.photos;

  // Check every link once when the photos open, so a broken one is obvious.
  const runCheck = useCallback(async () => {
    setCheck("running");
    try {
      const d = await fetch(`${API}/listing-hub/photos/check/?${new URLSearchParams({ id })}`).then((r) => r.json());
      setCheck({ byN: Object.fromEntries((d.results || []).map((r) => [r.n, r])), broken: d.broken || 0 });
    } catch {
      setCheck(null);
    }
  }, [id]);
  useEffect(() => { if (photos.length) runCheck(); }, [photos.length, runCheck]);

  if (!photos.length) {
    return (
      <Card style={{ textAlign: "center", color: C.gray500, fontSize: 13, lineHeight: 1.6 }}>
        No photos found — none uploaded, none in its storage folder, and none in its saved listings.
        Upload them on <b>SKU Pricing → this product → Upload photos</b> (or with the Quadrant Cropper) and they'll appear here.
        {data.photo_note && <div style={{ color: C.amber, marginTop: 6 }}>{data.photo_note}</div>}
      </Card>
    );
  }
  const zip = async () => {
    setZipBusy(true);
    const res = await download(`${API}/listing-hub/photos.zip?${new URLSearchParams({ id })}`, `${id}-photos.zip`, toast);
    setZipBusy(false);
    if (res) {
      const missing = Number(res.headers.get("X-Photos-Missing") || 0);
      toast(missing ? `Downloaded — ${missing} photo(s) couldn't be fetched` : "All photos downloaded ✓", !missing);
    }
  };
  const sources = photos.reduce((m, p) => m.set(p.source, (m.get(p.source) || 0) + 1), new Map());
  const broken = check && check !== "running" ? photos.filter((p) => check.byN[p.n]?.ok === false) : [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Btn kind="primary" onClick={zip} disabled={zipBusy}>{zipBusy ? "Preparing ZIP…" : `⬇ Download all ${photos.length} photos (ZIP)`}</Btn>
        <CopyBtn text={photos.filter((p) => check?.byN?.[p.n]?.ok !== false).map((p) => p.url).join("\n")} toast={toast}
          label="Copy working photo links" what="Photo links copied" />
        <Btn small onClick={runCheck} disabled={check === "running"}>{check === "running" ? "Checking links…" : "↻ Check photo links"}</Btn>
      </div>
      <p style={{ fontSize: 12, color: C.gray500 }}>
        From: {[...sources.entries()].map(([s, n]) => `${s} (${n})`).join(" · ")}
      </p>
      {data.photo_note && <p style={{ fontSize: 12, color: C.amber }}>{data.photo_note}</p>}
      {check && check !== "running" && (
        broken.length ? (
          <div style={{ background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: 12, padding: "10px 14px", color: C.red, fontSize: 13, fontWeight: 600 }}>
            {broken.length} photo link{broken.length === 1 ? " doesn't" : "s don't"} open — marked in red below. Don't use them in a new listing;
            re-upload those photos on SKU Pricing if they're needed.
          </div>
        ) : (
          <p style={{ fontSize: 12.5, color: C.green, fontWeight: 700 }}>✓ All {photos.length} photo links open.</p>
        )
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 160px), 1fr))", gap: 10 }}>
        {photos.map((p) => {
          const res = check && check !== "running" ? check.byN[p.n] : null;
          const bad = res?.ok === false;
          return (
            <div key={p.n} style={{ border: `${bad ? 2 : 1}px solid ${bad ? C.red : C.gray100}`, borderRadius: 12, overflow: "hidden", background: C.white }}>
              <a href={p.url} target="_blank" rel="noreferrer" style={{ display: "block", aspectRatio: "1 / 1", background: C.gray50, position: "relative" }}>
                <img src={p.url} alt={`Photo ${p.n}`} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: bad ? 0.35 : 1 }} />
                <span style={{ position: "absolute", top: 6, left: 6, background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 11, fontWeight: 800, borderRadius: 6, padding: "1px 6px" }}>{p.n}</span>
                {res && (
                  <span style={{ position: "absolute", top: 6, right: 6, borderRadius: 999, fontSize: 11, fontWeight: 800, padding: "1px 7px",
                    background: res.ok ? C.green : res.ok === false ? C.red : C.gray400, color: C.white }}>
                    {res.ok ? "✓" : res.ok === false ? "Broken" : "?"}
                  </span>
                )}
              </a>
              <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 10.5, color: C.gray400, fontWeight: 700 }}>{p.source}</span>
                {res && !res.ok && res.reason && <span style={{ fontSize: 11, color: bad ? C.red : C.gray500, lineHeight: 1.35 }}>{res.reason}</span>}
                <div style={{ display: "flex", gap: 6 }}>
                  <Btn small disabled={bad} onClick={() => download(`${API}/listing-hub/photo/?${new URLSearchParams({ id, n: p.n })}`, `${id}-${p.n}.jpg`, toast)}>⬇ Save</Btn>
                  <CopyBtn text={p.url} toast={toast} label="Link" what="Photo link copied" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PricePlatform({ platform, entry, item, toast, onSaved, unitCost }) {
  const [price, setPrice] = useState("");
  const [mrp, setMrp] = useState("");
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState(false);
  const meta = PLATFORMS.find((p) => p.key === platform);
  const listAt = entry.saved?.price ?? entry.recommended;
  const profit = entry.saved ? entry.saved.expected_profit : entry.profit_at_recommended;
  const w = entry.working;

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API}/listing-hub/price/`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item, platform, price, mrp }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast(d.error || "Couldn't save the price.", false); return; }
      toast(`${meta.label} price saved ✓`);
      setPrice(""); setMrp("");
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    await fetch(`${API}/listing-hub/price/`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item, platform }) });
    toast("Back to the recommended price");
    onSaved();
  };

  return (
    <Card style={{ borderTop: `4px solid ${meta.color}`, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: meta.color }}>{meta.label}</span>
        {entry.saved ? <Chip color={C.green} bg={C.greenLight}>Price set{entry.saved.updated_by ? ` by ${entry.saved.updated_by}` : ""}</Chip>
          : <Chip color={C.blue} bg={C.blueLight}>Recommended</Chip>}
      </div>
      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.06em", textTransform: "uppercase" }}>List at</p>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 34, fontWeight: 900, color: C.gray800, fontFamily: "monospace" }}>{rupees(listAt)}</span>
          <CopyBtn text={String(Math.round(listAt))} toast={toast} what="Price copied" />
        </div>
        {entry.saved?.mrp && <p style={{ fontSize: 12.5, color: C.gray600 }}>MRP {rupees(entry.saved.mrp)}</p>}
        <p style={{ fontSize: 13, color: profit >= 0 ? C.green : C.red, fontWeight: 700, marginTop: 2 }}>
          ≈ {rupees(profit)} profit per order {profit < 0 ? "(a loss)" : ""}
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
        <div style={{ background: C.gray50, borderRadius: 10, padding: "8px 10px" }}>
          <p style={{ fontSize: 10.5, color: C.gray400, fontWeight: 700 }}>RECOMMENDED</p>
          <p style={{ fontSize: 15, fontWeight: 800, fontFamily: "monospace" }}>{rupees(entry.recommended)}</p>
        </div>
        <div style={{ background: C.redLight, borderRadius: 10, padding: "8px 10px" }}>
          <p style={{ fontSize: 10.5, color: C.red, fontWeight: 700 }}>NEVER BELOW</p>
          <p style={{ fontSize: 15, fontWeight: 800, fontFamily: "monospace", color: C.red }}>{rupees(entry.breakeven)}</p>
        </div>
        {entry.current_selling_price != null && (
          <div style={{ background: C.gray50, borderRadius: 10, padding: "8px 10px" }}>
            <p style={{ fontSize: 10.5, color: C.gray400, fontWeight: 700 }}>SELLING TODAY</p>
            <p style={{ fontSize: 15, fontWeight: 800, fontFamily: "monospace" }}>{rupees(entry.current_selling_price)}</p>
            <p style={{ fontSize: 10.5, color: C.gray500 }}>≈ {rupees(entry.profit_at_current)} / order</p>
          </div>
        )}
      </div>
      {entry.note && <p style={{ fontSize: 11.5, color: C.amber, lineHeight: 1.5 }}>{entry.note}</p>}

      <button onClick={() => setWhy((v) => !v)} style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 700, color: C.orange, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
        {why ? "Hide" : "How is this worked out?"}
      </button>
      {why && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.gray600, lineHeight: 1.7 }}>
          <li>Cost per unit (item + GST + packaging + loss buffer): <b>{rupees(unitCost)}</b></li>
          <li>{meta.label} pays you about <b>₹{w.payout_per_rupee} for every ₹1</b> of price{w.payout_offset ? <>, then <b>₹{Math.abs(w.payout_offset)}</b> {w.payout_offset < 0 ? "less" : "more"}</> : null} (from {w.fee_rows.toLocaleString()} delivered orders)</li>
          <li>Out of {w.orders_seen.toLocaleString()} orders of {w.rates_from}: <b>{w.delivered_pct}%</b> delivered, <b>{w.return_pct}%</b> returned, <b>{w.rto_pct}%</b> RTO</li>
          <li>Each return costs about <b>{rupees(Math.abs(w.loss_per_return))}</b>{w.loss_per_rto ? <>, each RTO <b>{rupees(Math.abs(w.loss_per_rto))}</b></> : null}</li>
          <li>Recommended = the price that leaves <b>{rupees(entry.target_profit)}</b> per order after all that, rounded up to end in 9</li>
        </ul>
      )}

      <div style={{ borderTop: `1px solid ${C.gray100}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: C.gray600 }}>Set your own price</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price ₹" aria-label={`${meta.label} price`}
            style={{ ...S.inp, width: 100, padding: "8px 10px", border: `1px solid ${C.gray200}` }} />
          <input inputMode="decimal" value={mrp} onChange={(e) => setMrp(e.target.value)} placeholder="MRP ₹ (optional)" aria-label={`${meta.label} MRP`}
            style={{ ...S.inp, width: 130, padding: "8px 10px", border: `1px solid ${C.gray200}` }} />
          <Btn kind="primary" onClick={save} disabled={busy || !price}>{busy ? "Saving…" : "Save"}</Btn>
          {entry.saved && <Btn kind="ghost" onClick={clear}>Use recommended</Btn>}
        </div>
        {price && Number(price) > 0 && entry.breakeven && Number(price) < entry.breakeven && (
          <p style={{ fontSize: 12, color: C.red, fontWeight: 600 }}>That's below break-even — every order would lose money on average.</p>
        )}
      </div>
    </Card>
  );
}

function PriceSection({ data, toast, target, setTarget, reload }) {
  const pr = data.pricing;
  const [draft, setDraft] = useState(String(target ?? pr.default_target));
  if (!pr.priced) {
    return (
      <Card style={{ background: C.redLight, border: `1px solid ${C.redBorder}`, color: C.red, fontSize: 13, lineHeight: 1.6 }}>
        <b>This product has no cost price yet.</b> A selling price can't be worked out without it. Ask an admin to add the cost on
        SKU Pricing, then come back — don't list it until then.
      </Card>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: C.gray700 }}>Profit you want per order:</span>
        <span style={{ fontWeight: 700 }}>₹</span>
        <input inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Target profit per order"
          style={{ ...S.inp, width: 80, padding: "7px 10px", border: `1px solid ${C.gray200}` }} />
        <Btn small kind="primary" onClick={() => { const v = Number(draft); if (Number.isFinite(v) && v >= 0) setTarget(v); else toast("Enter a number", false); }}>Recalculate</Btn>
        <span style={{ fontSize: 11.5, color: C.gray400 }}>Default is 20% of cost ({rupees(pr.default_target)}). Cost per unit: <b>{rupees(pr.unit_cost)}</b></span>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 12 }}>
        {PLATFORMS.map((pl) => (
          <PricePlatform key={pl.key} platform={pl.key} entry={pr.platforms[pl.key]} item={data.parent.item_id}
            toast={toast} onSaved={reload} unitCost={pr.unit_cost} />
        ))}
      </div>
    </div>
  );
}

function FieldList({ fields, toast }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))", gap: 8 }}>
      {fields.map((f) => (
        <div key={f.key} style={{ display: "flex", alignItems: "flex-start", gap: 8, border: `1px solid ${C.gray100}`, borderRadius: 10, padding: "8px 10px", background: C.white }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 10.5, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.04em" }}>{f.label}</p>
            <p style={{ fontSize: 13, color: C.gray800, wordBreak: "break-word", whiteSpace: "pre-wrap", maxHeight: 140, overflow: "auto" }}>{f.value}</p>
          </div>
          <CopyBtn text={f.value} toast={toast} label="" what={`${f.label} copied`} />
        </div>
      ))}
    </div>
  );
}

const MATCHED = {
  linked: ["Linked by an admin", C.blue, C.blueLight],
  "made for it": ["Made for this product", C.green, C.greenLight],
  "SKU ids": ["Found by its SKU ids", C.gray600, C.gray100],
  "name / SKU id": ["Matched by name / SKU id", C.gray600, C.gray100],
};
const LEVEL = { error: [C.red, C.redLight, "✗"], warning: [C.amber, C.amberLight, "⚠"], info: [C.blue, C.blueLight, "ℹ"] };

function ListingCard({ l, toast, goCreate, isAdmin, onUnlink, open, setOpen }) {
  const pl = PLATFORMS.find((p) => p.key === l.platform) || PLATFORMS[0];
  const [mt, mc, mb] = MATCHED[l.matched_by] || [l.matched_by, C.gray600, C.gray100];
  const asText = (fields) => fields.map((f) => `${f.label}: ${f.value}`).join("\n");
  const errors = l.issues.filter((i) => i.level === "error").length;
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 12, borderLeft: `4px solid ${errors ? C.red : pl.color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
        <button onClick={() => setOpen(!open)} style={{ textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", minWidth: 0, flex: "1 1 260px" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <Chip color={pl.color} bg={`${pl.color}14`}>{l.kind === "template" ? "Extension template" : `${pl.label} sheet`}</Chip>
            <Chip>🏷 {l.category_short}</Chip>
            <Chip color={mc} bg={mb}>{mt}</Chip>
            {errors > 0 && <Chip color={C.red} bg={C.redLight}>{errors} problem{errors === 1 ? "" : "s"}</Chip>}
          </div>
          <p style={{ fontSize: 14, fontWeight: 800, color: C.gray800, marginTop: 6, wordBreak: "break-all" }}>{l.filename}</p>
          <p style={{ fontSize: 12, color: C.gray500 }}>
            {fmtDate(l.created_at)}{l.skus.length ? ` · ${l.skus.length} SKU${l.skus.length === 1 ? "" : "s"}` : ""} · {l.fields.length} details
            <span style={{ color: C.orange, fontWeight: 700 }}> · {open ? "Hide ▲" : "Show details ▼"}</span>
          </p>
        </button>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <CopyBtn text={asText(l.fields)} toast={toast} label="Copy all" what="All details copied" />
          {l.kind === "sheet" && <Btn small onClick={() => download(`${API}/bulk-listing/batches/${l.id}/download/`, l.filename, toast)}>⬇ Sheet</Btn>}
          {l.kind === "sheet" && l.platform === "meesho" && <Btn small kind="primary" onClick={() => goCreate("meesho", l.id, l.filename)}>Start from this</Btn>}
          {l.kind === "template" && l.source_url && <a href={l.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 700, color: C.blue, alignSelf: "center" }}>Open form ↗</a>}
          {isAdmin && l.matched_by === "linked" && <Btn small kind="ghost" onClick={() => onUnlink(l)}>Unlink</Btn>}
        </div>
      </div>

      {l.issues.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {l.issues.map((i, k) => {
            const [c, bg, icon] = LEVEL[i.level] || LEVEL.info;
            return <div key={k} style={{ background: bg, color: c, borderRadius: 10, padding: "7px 11px", fontSize: 12.5, fontWeight: 600, lineHeight: 1.45 }}>{icon} {i.text}</div>;
          })}
        </div>
      )}
      {l.issues.length === 0 && <p style={{ fontSize: 12.5, color: C.green, fontWeight: 700 }}>✓ No problems found in this listing.</p>}

      {open && (
        <>
          <FieldList fields={l.fields} toast={toast} />
          {l.skus.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: C.gray700 }}>Per SKU</p>
              {l.skus.map((s) => (
                <div key={s.sku_id} style={{ border: `1px solid ${C.gray100}`, borderRadius: 12, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: C.gray700, wordBreak: "break-all" }}>{s.sku_id}</span>
                    <span style={{ fontSize: 11.5, color: s.image_count ? C.gray500 : C.red, fontWeight: 700 }}>{s.image_count} photo{s.image_count === 1 ? "" : "s"}</span>
                  </div>
                  {s.images.length > 0 && (
                    <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
                      {s.images.map((u, k) => (
                        <a key={k} href={u} target="_blank" rel="noreferrer" style={{ flex: "0 0 56px", height: 56, borderRadius: 8, overflow: "hidden", background: C.gray50, border: `1px solid ${C.gray100}` }}>
                          <img src={u} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        </a>
                      ))}
                    </div>
                  )}
                  {s.fields.length > 0 && <FieldList fields={s.fields} toast={toast} />}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function ListingsSection({ data, toast, goCreate, reload }) {
  const [openId, setOpenId] = useState(() => (data.listings[0] ? `${data.listings[0].kind}-${data.listings[0].id}` : null));
  const [cat, setCat] = useState("");
  const [linking, setLinking] = useState(false);
  const product = data.product;
  const productFields = product ? [
    ["name", "Product name", product.name], ["size", "Size", product.size], ["weight", "Weight", product.weight],
    ["hsn", "HSN code", product.hsn_code], ["description", "Description", product.description],
  ].filter(([, , v]) => v).map(([key, label, value]) => ({ key, label, value })) : [];
  const cats = [...new Set(data.listings.map((l) => l.category_short))];
  const shown = data.listings.filter((l) => !cat || l.category_short === cat);

  const unlink = async (l) => {
    const res = await fetch(`${API}/listing-hub/link/`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: l.kind, object_id: l.id, id: null }) });
    if (res.ok) { toast("Unlinked"); reload(); } else toast("Couldn't unlink it.", false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {productFields.length > 0 && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <p style={{ fontSize: 14, fontWeight: 800, color: C.gray800 }}>Product info</p>
            <div style={{ display: "flex", gap: 6 }}>
              {product.drive_link && <a href={product.drive_link} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 700, color: C.blue }}>Open Drive folder ↗</a>}
              <CopyBtn text={productFields.map((f) => `${f.label}: ${f.value}`).join("\n")} toast={toast} label="Copy all" what="Product info copied" />
            </div>
          </div>
          <FieldList fields={productFields} toast={toast} />
        </Card>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {cats.length > 1 && ["", ...cats].map((c) => (
            <button key={c || "all"} onClick={() => setCat(c)}
              style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                border: `1.5px solid ${cat === c ? C.orange : C.gray200}`, background: cat === c ? C.orangeLight : C.white, color: cat === c ? C.orange : C.gray600 }}>
              {c ? `🏷 ${c}` : `All · ${data.listings.length}`}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {data.is_admin && <Btn small onClick={() => setLinking((v) => !v)}>🔗 Link a saved listing</Btn>}
          <Btn small kind="primary" onClick={() => goCreate("meesho")} disabled={!data.pricing.priced}>＋ New Meesho listing</Btn>
          <Btn small kind="primary" onClick={() => goCreate("flipkart")} disabled={!data.pricing.priced}>＋ New Flipkart listing</Btn>
        </div>
      </div>
      {linking && <LinkPanel forItem={data.parent.item_id} toast={toast} onClose={() => setLinking(false)} onLinked={reload} />}

      {data.listings.length === 0 ? (
        <Card style={{ fontSize: 13, color: C.gray500, lineHeight: 1.6 }}>
          No saved listings for this product yet — no Bulk Listing sheet or extension template is linked to it.
          {data.is_admin ? " If an older sheet belongs to it, use “Link a saved listing”." : " If one should be here, ask an admin to link it."}
        </Card>
      ) : shown.map((l) => {
        const key = `${l.kind}-${l.id}`;
        return <ListingCard key={key} l={l} toast={toast} goCreate={goCreate} isAdmin={data.is_admin} onUnlink={unlink}
          open={openId === key} setOpen={(v) => setOpenId(v ? key : null)} />;
      })}
    </div>
  );
}

function SkuSection({ data, toast }) {
  const skus = data.skus;
  if (!skus.length) {
    return <Card style={{ color: C.gray500, fontSize: 13 }}>No SKU ids under this product yet. They're added when a listing of it is approved, or by an admin on SKU Pricing → SKU Link.</Card>;
  }
  const hasTask = skus.some((s) => s.task);
  const heads = ["SKU id", "Orders", "Last order", ...(hasTask ? ["Listed at", "MRP", "HSN", "Task"] : []), ""];
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <p style={{ fontSize: 13, color: C.gray600 }}>{skus.length} SKU id{skus.length === 1 ? "" : "s"} — most-sold first{hasTask ? " · prices from Team Tasks listings" : ""}</p>
        <CopyBtn text={skus.map((s) => s.sku_id).join("\n")} toast={toast} label="Copy all SKU ids" what="SKU ids copied" />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{heads.map((h, i) => <th key={i} style={{ ...S.th, textAlign: i === 0 ? "left" : "right", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
          <tbody>
            {skus.map((s, i) => (
              <tr key={s.sku_id} style={{ background: i % 2 ? C.gray50 : C.white }}>
                <td style={{ ...S.td, fontWeight: 700, wordBreak: "break-all" }}>{s.sku_id}</td>
                <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{s.orders.toLocaleString()}</td>
                <td style={{ ...S.td, textAlign: "right", whiteSpace: "nowrap" }}>{fmtDate(s.last_order)}</td>
                {hasTask && <>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{s.task?.listing_price != null ? rupees(s.task.listing_price) : "—"}</td>
                  <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace" }}>{s.task?.mrp != null ? rupees(s.task.mrp) : "—"}</td>
                  <td style={{ ...S.td, textAlign: "right" }}>{s.task?.hsn_code || "—"}</td>
                  <td style={{ ...S.td, textAlign: "right" }}>{s.task ? <Chip color={s.task.status === "APPROVED" ? C.green : s.task.status === "REJECTED" ? C.red : C.amber}
                    bg={s.task.status === "APPROVED" ? C.greenLight : s.task.status === "REJECTED" ? C.redLight : C.amberLight}>{(s.task.status || "").toLowerCase()}</Chip> : "—"}</td>
                </>}
                <td style={{ ...S.td, textAlign: "right" }}><CopyBtn text={s.sku_id} toast={toast} label="" what="SKU id copied" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PauseControl({ data, toast, reload, onCancel }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (paused) => {
    setBusy(true);
    try {
      const res = await fetch(`${API}/listing-hub/pause/`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: data.parent.item_id, paused, note }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast(d.error || "Couldn't change it.", false); return; }
      toast(paused ? "Paused — listing managers won't see it now" : "Resumed — visible to listing managers again");
      setNote(""); reload();
    } finally {
      setBusy(false);
    }
  };
  if (!data.is_admin) return null;
  if (data.paused) {
    return (
      <div style={{ background: C.amberLight, border: `1.5px solid ${C.amberBorder}`, borderRadius: 14, padding: "12px 16px",
        display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "#92400E", lineHeight: 1.5 }}>
          <b>⏸ Paused for listing</b> — listing managers can't see this product in the hub.
          <div style={{ fontSize: 12 }}>{data.paused.by ? `By ${data.paused.by} · ` : ""}{fmtDate(data.paused.at)}{data.paused.note ? ` · “${data.paused.note}”` : ""}</div>
        </div>
        <Btn kind="primary" disabled={busy} onClick={() => send(false)}>▶ Resume listing</Btn>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", background: C.gray50, borderRadius: 12, padding: 10 }}>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why? e.g. out of stock, price under review (optional)"
        style={{ ...S.inp, flex: "1 1 240px", padding: "8px 10px", border: `1px solid ${C.gray200}` }} />
      <Btn kind="primary" disabled={busy} onClick={() => send(true)}>⏸ Pause listing</Btn>
      <Btn small kind="ghost" onClick={onCancel}>Cancel</Btn>
    </div>
  );
}

const TABS = [
  { key: "photos", label: "🖼️ Photos" },
  { key: "price", label: "💰 Price" },
  { key: "listings", label: "📋 Saved listings" },
  { key: "skus", label: "🏷️ SKU ids" },
];

function ProductView({ item, onBack, toast }) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("photos");
  const [target, setTarget] = useState(() => {
    const v = Number(safeGet(TARGET_KEY));
    return Number.isFinite(v) && safeGet(TARGET_KEY) ? v : null;
  });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const [pauseOpen, setPauseOpen] = useState(false);

  useEffect(() => {
    let off = false;
    setError(null);
    const params = new URLSearchParams({ id: item });
    if (target != null) params.set("target", target);
    fetch(`${API}/listing-hub/product/?${params}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `Couldn't load (${r.status})`); return d; })
      .then((d) => { if (!off) setData(d); })
      .catch((e) => { if (!off) setError(e.message); });
    return () => { off = true; };
  }, [item, target, tick]);

  const reload = () => setTick((x) => x + 1);
  const saveTarget = (v) => { setTarget(v); safeSet(TARGET_KEY, String(v)); };
  const goCreate = (platform, batchId, filename) => {
    const q = new URLSearchParams({ parent: item, platform });
    if (batchId) { q.set("duplicate", batchId); if (filename) q.set("filename", filename); }
    navigate(`/bulk-listing?${q}`);
  };

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div><Btn onClick={onBack}>← All products</Btn></div>
        <Card style={{ color: C.red }}>{error}</Card>
      </div>
    );
  }
  if (!data) {
    return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><CircularProgress style={{ color: C.orange }} /></div>;
  }
  const p = data.parent;
  const listAt = data.pricing.priced ? (data.pricing.platforms.meesho.saved?.price ?? data.pricing.platforms.meesho.recommended) : null;
  const platformsListed = [...new Set(data.listings.map((l) => l.platform))];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <Btn onClick={onBack}>← All products</Btn>
        {data.is_admin && !data.paused && !pauseOpen && <Btn onClick={() => setPauseOpen(true)}>⏸ Pause listing</Btn>}
      </div>
      {(data.paused || pauseOpen) && <PauseControl data={data} toast={toast} onCancel={() => setPauseOpen(false)}
        reload={() => { setPauseOpen(false); reload(); }} />}

      <Card style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ width: isMobile ? 88 : 120, height: isMobile ? 88 : 120, borderRadius: 14, overflow: "hidden", background: C.gray50, flex: "0 0 auto",
          display: "flex", alignItems: "center", justifyContent: "center" }}>
          {p.image_url ? <img src={p.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 36 }}>📦</span>}
        </div>
        <div style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 20, fontWeight: 900, color: C.gray800, wordBreak: "break-word" }}>{p.item_id}</h2>
            <CopyBtn text={p.item_id} toast={toast} label="" what="Product name copied" />
          </div>
          {data.product?.name && data.product.name !== p.item_id && <p style={{ fontSize: 13, color: C.gray500 }}>{data.product.name}</p>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Chip>{data.skus.length} SKU ids</Chip>
            <Chip>{data.photos.length} photos</Chip>
            <Chip>{data.listings.length} saved listing{data.listings.length === 1 ? "" : "s"}</Chip>
            {data.issue_count > 0 && <Chip color={C.red} bg={C.redLight}>{data.issue_count} listing problem{data.issue_count === 1 ? "" : "s"}</Chip>}
            {listAt != null && <Chip color={C.green} bg={C.greenLight}>Meesho: list at {rupees(listAt)}</Chip>}
            {!data.pricing.priced && <Chip color={C.red} bg={C.redLight}>No cost price — don't list yet</Chip>}
            {PLATFORMS.map((pl) => platformsListed.includes(pl.key) && <Chip key={pl.key} color={pl.color} bg={`${pl.color}14`}>On {pl.label} ✓</Chip>)}
            {(data.categories || []).map((c) => <Chip key={c}>🏷 {c}</Chip>)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn kind="primary" onClick={() => goCreate("meesho")} disabled={!data.pricing.priced}>＋ Create Meesho listing</Btn>
          <Btn kind="primary" onClick={() => goCreate("flipkart")} disabled={!data.pricing.priced}>＋ Create Flipkart listing</Btn>
        </div>
      </Card>

      <div role="tablist" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            style={{ padding: "9px 14px", borderRadius: 12, fontSize: 13, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap",
              border: `1.5px solid ${tab === t.key ? C.orange : C.gray200}`, background: tab === t.key ? C.orange : C.white,
              color: tab === t.key ? C.white : C.gray600 }}>
            {t.label}{t.key === "listings" ? ` · ${data.listings.length}` : ""}
            {t.key === "listings" && data.issue_count > 0 && <span style={{ marginLeft: 6, color: tab === t.key ? C.white : C.red }}>⚠</span>}
          </button>
        ))}
      </div>

      {tab === "photos" && <PhotosSection data={data} toast={toast} />}
      {tab === "price" && <PriceSection data={data} toast={toast} target={target} setTarget={saveTarget} reload={reload} />}
      {tab === "listings" && <ListingsSection data={data} toast={toast} goCreate={goCreate} reload={reload} />}
      {tab === "skus" && <SkuSection data={data} toast={toast} />}
    </div>
  );
}

// ── the page ─────────────────────────────────────────────────────────────────

export function ListingHubTab() {
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const item = params.get("product");
  // Shown on the search screen until dismissed; on a product page only when asked for.
  const [guide, setGuide] = useState(() => safeGet(GUIDE_KEY) !== "1" && !params.get("product"));
  const [toast, toastNode] = useToast();

  const hideGuide = () => { setGuide(false); safeSet(GUIDE_KEY, "1"); };
  const open = (id) => { setParams({ product: id }); setGuide(false); window.scrollTo?.(0, 0); };
  const back = () => setParams({});

  const header = useMemo(() => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
      <div>
        <h2 style={{ fontSize: 19, fontWeight: 900, color: C.gray800 }}>Listing Hub</h2>
        <p style={{ fontSize: 12.5, color: C.gray500, maxWidth: 680, lineHeight: 1.5 }}>
          Everything you need to list a product on Meesho or Flipkart — photos, the price to list at, every detail from earlier
          listings and its SKU ids — in one place.
        </p>
      </div>
      {!guide && <Btn onClick={() => setGuide(true)}>❓ How to use</Btn>}
    </div>
  ), [guide]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {header}
      {guide && <Guide onHide={hideGuide} compact={isMobile} />}
      {item ? <ProductView key={item} item={item} onBack={back} toast={toast} /> : <SearchView onOpen={open} toast={toast} />}
      {toastNode}
    </div>
  );
}
