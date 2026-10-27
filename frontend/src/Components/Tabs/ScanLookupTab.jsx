import React, { useState, useEffect, useRef, useCallback } from "react";
import { API, C, S, btn, Tag } from "../../App";
import { BarcodeScanner } from "../shared/BarcodeScanner";
import { PlatformToggle, useLabelPlatform } from "../PlatformToggle";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import { CircularProgress } from "@mui/material";

/*
 * Listing lookup — scan an AWB (or type an order number) and see the listing
 * behind it: photo, parent SKU and SKU, the bill of materials (every master item
 * that goes into it, with its photo, quantity and price), prices, the other
 * SKUs under the same parent, and where the order stands.
 *
 * It only reads — a lookup is not a scan and records nothing on the desk.
 * One column on a phone, photo + details side by side on a wide screen.
 */

const rupees = (n) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const SHIP = {
  SHIPPED:     { label: "Shipped", tag: "green" },
  NOT_SHIPPED: { label: "Not shipped yet", tag: "amber" },
  CANCELLED:   { label: "Cancelled", tag: "red" },
  UNKNOWN:     { label: "No marketplace status yet", tag: "gray" },
  RETURNED:    { label: "Returned (RTO)", tag: "orange" },
};
const SCAN = { SCANNED: "Scanned", PACKED: "Packed", DISPATCHED: "Dispatched", ON_HOLD: "On hold", ISSUE: "Problem", CANCELLED: "Cancelled" };

function Picture({ url, size = 64, radius = 10, onClick }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const fluid = typeof size === "string";
  const box = {
    width: size, height: fluid ? "auto" : size, aspectRatio: fluid ? "1 / 1" : undefined, borderRadius: radius, flexShrink: 0, overflow: "hidden", background: C.gray50,
    border: `1px solid ${C.gray200}`, display: "flex", alignItems: "center", justifyContent: "center",
    color: C.gray400, fontSize: fluid ? 28 : Math.max(14, size * 0.38), padding: 0, cursor: onClick && url && !broken ? "zoom-in" : "default",
  };
  const body = !url || broken ? <span aria-label="No photo">📦</span>
    : <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
  return onClick && url && !broken
    ? <button type="button" onClick={onClick} aria-label="Enlarge photo" className="sl-btn" style={box}>{body}</button>
    : <div style={box}>{body}</div>;
}

function Card({ title, right, children, pad = 16 }) {
  return (
    <section style={{ ...S.card, padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${C.gray100}`, background: C.gray50 }}>
        <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: C.gray800 }}>{title}</h2>
        {right}
      </div>
      <div style={{ padding: pad }}>{children}</div>
    </section>
  );
}

function Fact({ label, value, mono }) {
  if (value == null || value === "") return null;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: C.gray900, wordBreak: "break-word", fontFamily: mono ? "monospace" : "inherit" }}>{value}</div>
    </div>
  );
}

function Lightbox({ photos, index, onClose, onMove }) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") onMove(1); if (e.key === "ArrowLeft") onMove(-1); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, onMove]);
  const p = photos[index];
  if (!p) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Photo" onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(0,0,0,.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <img src={p.url} alt="" style={{ maxWidth: "100%", maxHeight: "86vh", objectFit: "contain", borderRadius: 8 }} onClick={(e) => e.stopPropagation()} />
      <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 8 }} onClick={(e) => e.stopPropagation()}>
        {photos.length > 1 && <>
          <button className="sl-btn" onClick={() => onMove(-1)} style={btn("ghost", "md")} aria-label="Previous photo">←</button>
          <button className="sl-btn" onClick={() => onMove(1)} style={btn("ghost", "md")} aria-label="Next photo">→</button>
        </>}
        <button className="sl-btn" onClick={onClose} style={btn("primary", "md")}>Close</button>
      </div>
    </div>
  );
}

function BillOfMaterials({ components, pricing }) {
  const total = components.reduce((n, c) => n + (c.line_total || 0), 0);
  const unpriced = components.some((c) => c.unit_price == null);
  return (
    <Card title="Bill of materials" right={<span style={{ fontSize: 12.5, fontWeight: 700, color: C.gray500 }}>{components.length} item{components.length === 1 ? "" : "s"}</span>} pad={0}>
      {components.map((c, idx) => (
        <div key={c.master_id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 16px", borderTop: idx ? `1px solid ${C.gray100}` : "none" }}>
          <Picture url={c.image_url} size={56} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.gray900, overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
            <div style={{ fontSize: 13, color: C.gray600, marginTop: 2 }}>
              <b style={{ fontFamily: "monospace", color: C.orange }}>{c.quantity}×</b> {c.unit_price != null ? `${rupees(c.unit_price)} each` : "price not set"}
            </div>
            {c.notes && <div style={{ fontSize: 12, color: C.gray500, marginTop: 2 }}>{c.notes}</div>}
          </div>
          <div style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 16, color: C.gray900, whiteSpace: "nowrap" }}>{rupees(c.line_total)}</div>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 16px", borderTop: `2px solid ${C.gray200}`, background: C.gray50 }}>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: C.gray700 }}>Item price from master list{unpriced ? " (some prices missing)" : ""}</span>
        <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 18, color: C.gray900 }}>{rupees(total)}</span>
      </div>
      {pricing?.item_price != null && Math.abs(pricing.item_price - total) > 0.01 && (
        <div style={{ padding: "8px 16px", fontSize: 12.5, color: "#92400E", background: C.amberLight }}>
          The parent's saved item price is {rupees(pricing.item_price)} — it differs from this total.
        </div>
      )}
    </Card>
  );
}

function Result({ data, onSku }) {
  const [zoom, setZoom] = useState(null);
  const { order, parent, components, photos, siblings, pricing } = data;
  const hero = parent?.image_url || photos[0]?.url || null;
  const gallery = [...new Set([hero, ...photos.map((p) => p.url)].filter(Boolean))].map((url) => ({ url }));
  const ship = SHIP[order.ship_status] || null;
  const move = useCallback((d) => setZoom((z) => (z == null ? z : (z + d + gallery.length) % gallery.length)), [gallery.length]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Who is this — the first thing to read */}
      <section style={{ ...S.card, padding: 16, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", borderTop: `4px solid ${C.orange}` }}>
        <Picture url={hero} size={132} radius={14} onClick={gallery.length ? () => setZoom(0) : undefined} />
        <div style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Parent SKU</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.gray900, lineHeight: 1.2, wordBreak: "break-word" }}>
              {parent ? parent.item_id : <span style={{ color: C.red }}>No parent linked</span>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: C.gray500, textTransform: "uppercase", letterSpacing: "0.05em" }}>SKU</div>
            <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 800, color: C.gray800, wordBreak: "break-all" }}>
              {data.sku || "—"} <span style={{ color: C.orange }}>×{order.qty}</span>
            </div>
          </div>
          {order.product_name && <div style={{ fontSize: 13.5, color: C.gray600 }}>{order.product_name}</div>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {ship && <Tag variant={ship.tag}>{ship.label}</Tag>}
            {order.scan_status && <Tag variant="blue">{SCAN[order.scan_status] || order.scan_status}</Tag>}
            {order.platform && <Tag variant="gray">{order.platform === "flipkart" ? "Flipkart" : "Meesho"}</Tag>}
            {!data.sku_row_found && data.sku && <Tag variant="amber">SKU not in pricing</Tag>}
          </div>
        </div>
      </section>

      {/* Details — one column on a phone, two when there is room */}
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {components.length > 0
            ? <BillOfMaterials components={components} pricing={pricing} />
            : <Card title="Bill of materials">
                <div style={{ fontSize: 14, color: C.gray600, lineHeight: 1.5 }}>
                  {parent ? "This parent isn't built from the master list yet — its price is set by hand. Add its master items on Master Pricing." : "No parent SKU, so there is no bill of materials."}
                </div>
              </Card>}
          {pricing && (
            <Card title="Price">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
                <Fact label="Item price" value={rupees(pricing.item_price)} />
                <Fact label="Tax" value={pricing.tax_percent != null ? `${pricing.tax_percent}%` : "—"} />
                <Fact label="Packaging" value={rupees(pricing.packaging_cost)} />
                <Fact label="Final price" value={rupees(pricing.final_price)} />
              </div>
              <div style={{ fontSize: 12.5, color: C.gray500, marginTop: 10 }}>
                Taken from the {pricing.source === "parent" ? "parent SKU" : "SKU's own price"}{pricing.from_master_list ? ", built from the master list" : ""}.
              </div>
            </Card>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <Card title="Order">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
              <Fact label="Order no" value={order.order_id} mono />
              <Fact label="AWB" value={order.awb} mono />
              <Fact label="Courier" value={order.courier} />
              <Fact label="Size" value={order.size} />
              <Fact label="Payment" value={order.payment_type} />
              <Fact label="Order date" value={order.order_date} />
              <Fact label="Deliver to" value={[order.customer_city, order.customer_state].filter(Boolean).join(", ")} />
              <Fact label="Business" value={order.business} />
              {order.scan_count != null && <Fact label="Scanned" value={`${order.scan_count}×`} />}
            </div>
          </Card>

          {gallery.length > 0 && (
            <Card title="Photos" right={<span style={{ fontSize: 12.5, fontWeight: 700, color: C.gray500 }}>{gallery.length}</span>}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 8 }}>
                {gallery.map((p, i) => <Picture key={p.url} url={p.url} size="100%" radius={10} onClick={() => setZoom(i)} />)}
              </div>
            </Card>
          )}

          {siblings.length > 1 && (
            <Card title="Other SKUs under this parent" right={<span style={{ fontSize: 12.5, fontWeight: 700, color: C.gray500 }}>{siblings.length}</span>}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {siblings.map((s) => (
                  <span key={s} style={{ fontFamily: "monospace", fontSize: 12.5, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
                    background: s.toLowerCase() === (data.sku || "").toLowerCase() ? C.orangeLight : C.gray100,
                    border: `1px solid ${s.toLowerCase() === (data.sku || "").toLowerCase() ? C.orange : C.gray200}`, color: C.gray800 }}>{s}</span>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
      {zoom != null && <Lightbox photos={gallery} index={zoom} onClose={() => setZoom(null)} onMove={move} />}
    </div>
  );
}

export function ScanLookupTab() {
  const [platform, setPlatform] = useLabelPlatform();
  const [typed, setTyped] = useState("");
  const [camera, setCamera] = useState(false);
  const [state, setState] = useState({ kind: "idle" });   // idle | loading | found | missing | error
  const [recent, setRecent] = useState([]);
  const input = useRef(null);
  const seq = useRef(0);

  const lookup = useCallback(async (raw) => {
    const code = (raw ?? "").trim();
    if (!code) return;
    const my = ++seq.current;
    setState({ kind: "loading", code });
    try {
      const res = await fetch(`${API}/order-scan/lookup/?${new URLSearchParams({ code, platform })}`);
      const data = await res.json().catch(() => ({}));
      if (my !== seq.current) return;
      if (!res.ok) { setState({ kind: "error", code, message: data.error || "Couldn't look that up." }); return; }
      if (!data.found) { setState({ kind: "missing", code }); navigator.vibrate?.([120, 80, 120]); return; }
      setState({ kind: "found", code, data });
      setRecent((r) => [{ code, label: data.parent?.item_id || data.sku || code }, ...r.filter((x) => x.code !== code)].slice(0, 6));
      window.scrollTo?.({ top: 0, behavior: "smooth" });
    } catch {
      if (my === seq.current) setState({ kind: "error", code, message: "Network error — try again." });
    }
  }, [platform]);

  const submit = () => { const c = typed; setTyped(""); lookup(c); };
  useEffect(() => { input.current?.focus(); }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100, margin: "0 auto", paddingBottom: 24 }}>
      <style>{`.sl-btn:focus-visible, .sl-in:focus-visible { outline: 3px solid #2563EB; outline-offset: 2px; }`}</style>
      {camera && (
        <BarcodeScanner title="Scan AWB" hint="Point at the parcel's barcode"
          onDetected={(code) => { setCamera(false); lookup(code); }} onClose={() => setCamera(false)} />
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.gray900, margin: 0 }}>Listing lookup</h1>
          <p style={{ fontSize: 13, color: C.gray500, marginTop: 3 }}>Scan a parcel's AWB to see the listing behind it — photo, parent, bill of materials and price.</p>
        </div>
        <PlatformToggle platform={platform} onChange={setPlatform} />
      </div>

      <div style={{ ...S.card, padding: 14, display: "flex", flexDirection: "column", gap: 10, position: "sticky", top: 8, zIndex: 5 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "1 1 240px", minWidth: 0 }}>
            <QrCodeScannerIcon aria-hidden style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.orange, fontSize: 24 }} />
            <input ref={input} value={typed} onChange={(e) => setTyped(e.target.value)} className="sl-in"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} enterKeyHint="search"
              placeholder="Scan or type AWB / order no…" aria-label="Scan or type an AWB or order number"
              autoComplete="off" spellCheck={false}
              style={{ ...S.inp, width: "100%", boxSizing: "border-box", minHeight: 52, fontSize: 18, fontFamily: "monospace", fontWeight: 700, padding: "12px 14px 12px 48px", background: C.orangeLight, borderColor: C.orangeBorder }} />
          </div>
          <button onClick={() => setCamera(true)} className="sl-btn" style={{ ...btn("primary", "lg"), minHeight: 52, padding: "0 20px", flex: "1 1 150px" }}>
            <QrCodeScannerIcon style={{ fontSize: 24, verticalAlign: "-6px" }} />&nbsp;Scan with camera
          </button>
        </div>
        {recent.length > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", overflowX: "auto" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.gray500, flexShrink: 0 }}>Recent:</span>
            {recent.map((r) => (
              <button key={r.code} onClick={() => lookup(r.code)} className="sl-btn"
                style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 999, border: `1px solid ${C.gray200}`, background: C.white, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: C.gray700, cursor: "pointer" }}>
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div role="status" aria-live="polite">
        {state.kind === "idle" && (
          <div style={{ ...S.card, textAlign: "center", padding: 40, color: C.gray500, fontSize: 14.5, lineHeight: 1.6 }}>
            <div style={{ fontSize: 40 }} aria-hidden>📦</div>
            Scan or type an AWB above.<br />Nothing is recorded — this only looks the parcel up.
          </div>
        )}
        {state.kind === "loading" && (
          <div style={{ display: "flex", justifyContent: "center", gap: 10, alignItems: "center", padding: 40, color: C.gray600, fontWeight: 700 }}>
            <CircularProgress size={22} style={{ color: C.orange }} /> Looking up {state.code}…
          </div>
        )}
        {state.kind === "missing" && (
          <div style={{ ...S.card, padding: 24, border: `2px solid ${C.redBorder}`, background: C.redLight }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: C.red }}>✕ Not recognised</div>
            <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 15, margin: "6px 0", wordBreak: "break-all" }}>{state.code}</div>
            <div style={{ fontSize: 14, color: C.gray700, lineHeight: 1.5 }}>No label, order or payment in the system matches this code. If the label was uploaded just now, try again — or check the code.</div>
          </div>
        )}
        {state.kind === "error" && (
          <div style={{ ...S.card, padding: 24, border: `2px solid ${C.redBorder}`, background: C.redLight, color: C.red, fontWeight: 800 }}>✕ {state.message}</div>
        )}
        {state.kind === "found" && <Result data={state.data} />}
      </div>
    </div>
  );
}
