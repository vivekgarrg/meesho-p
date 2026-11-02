import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";
import { Photo } from "./OrderScanTab";
import { readCodes } from "../../lib/readCodes";
import { compressVideo } from "../../lib/videoCompress";

/*
 * Raise Return Claim — a Meesho return claim (Support → Returns → e.g. "Items
 * missing") raised from the portal, on the return's own business's account.
 *
 *   1. Photograph the reverse waybill: its AWB is read off the photo and finds
 *      the return — the business, sub-order, product — every field filled in,
 *      each one still editable.
 *   2. Photograph the packet's barcode (its id is read off it), and the product.
 *   3. Add the unpacking video: it is compressed under Meesho's 22 MB cap here,
 *      in the browser, before it's sent.
 *   4. Choose what the claim is for and describe it; Meesho checks each field as
 *      it's filled, as its own form does. Raise it — the ticket comes back here.
 *
 * Photos and the video are stored with Meesho as soon as the business is known,
 * so raising the claim at the end is quick.
 */

const REMEMBER = "meesho-return-claim";
const remembered = () => { try { return JSON.parse(localStorage.getItem(REMEMBER) || "{}"); } catch { return {}; } };
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

// The form's fields this page fills itself; any other field the claim type asks for is shown as Meesho describes it.
const SLOTS = {
  waybill: { key: "product_reverse_way_bill_link", label: "Reverse waybill", hint: "The return label — its AWB is read off the photo", accept: "image/*" },
  packet: { key: "barcode_image_link", label: "Packet barcode", hint: "The packet's barcode — its id is read off the photo", accept: "image/*" },
  product: { key: "product_image_link", label: "Product received", hint: "What came back in the packet", accept: "image/*" },
  video: { key: "product_openingvideo_link", label: "Unpacking video", hint: "Any size — compressed under 22 MB here", accept: "video/*" },
};
const SLOT_BY_KEY = Object.fromEntries(Object.entries(SLOTS).map(([slot, s]) => [s.key, slot]));
const AUTO_KEYS = new Set(["sub_order_number", "awb_number", "barcode_id", "ticket_desc", "callback_number", ...Object.keys(SLOT_BY_KEY)]);
const FILE_TYPES = ["img_file", "action_img_file", "video_file", "file"];

async function api(path, opts = {}) {
  const res = await fetch(`${API}/return-claim/${path}`, opts).catch(() => null);
  if (!res) return { ok: false, data: { error: "Couldn't reach the server — check the internet connection." } };
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
const postJson = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function Field({ label, required, children, check, hint }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: C.gray600 }}>{label}{required ? <span style={{ color: C.red }}> *</span> : null}</span>
      {children}
      {hint && <span style={{ fontSize: 11.5, color: C.gray500 }}>{hint}</span>}
      {check?.busy && <span style={{ fontSize: 12, color: C.gray500 }}>Checking with Meesho…</span>}
      {check && !check.busy && (check.ok
        ? <span style={{ fontSize: 12, fontWeight: 700, color: "#15803D" }}>✓ Meesho accepts it</span>
        : <span style={{ fontSize: 12, fontWeight: 700, color: C.red }}>✕ {check.message || "Meesho didn't accept it"}</span>)}
    </label>
  );
}

/** One photo / the video: pick or take it, see it, and where its upload stands. */
function Slot({ slot, state, onPick, onRetry, isMobile }) {
  const s = SLOTS[slot];
  const input = useRef(null);
  const st = state || {};
  const tone = st.status === "uploaded" ? C.green : st.status === "error" ? C.red : st.file ? C.orange : C.gray300;
  return (
    <div style={{ border: `2px ${st.file ? "solid" : "dashed"} ${tone}`, borderRadius: 14, padding: 10, display: "flex", gap: 10,
      alignItems: "center", background: C.white, minWidth: 0 }}>
      <button type="button" onClick={() => input.current?.click()} aria-label={`${st.file ? "Change" : "Add"} ${s.label}`}
        style={{ width: isMobile ? 64 : 72, height: isMobile ? 64 : 72, flexShrink: 0, borderRadius: 10, border: `1px solid ${C.gray200}`,
          background: C.gray50, cursor: "pointer", overflow: "hidden", padding: 0, fontSize: 26 }}>
        {st.preview && slot !== "video" ? <img src={st.preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : slot === "video" ? "🎬" : "📷"}
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: C.gray900 }}>{s.label} <span style={{ color: C.red }}>*</span></div>
        <div style={{ fontSize: 12, color: C.gray500 }}>{st.file ? `${st.file.name} · ${mb(st.file.size)}` : s.hint}</div>
        {st.stage && <div style={{ fontSize: 12, fontWeight: 700, color: C.gray600, marginTop: 2 }}>{st.stage}</div>}
        {st.progress != null && st.status === "compressing" && (
          <div style={{ height: 6, borderRadius: 99, background: C.gray100, overflow: "hidden", marginTop: 4 }}>
            <div style={{ height: "100%", width: `${Math.round(st.progress * 100)}%`, background: C.orange, transition: "width .2s" }} />
          </div>
        )}
        {st.status === "uploaded" && <div style={{ fontSize: 12, fontWeight: 800, color: "#15803D" }}>✓ With Meesho</div>}
        {st.status === "error" && (
          <div style={{ fontSize: 12, fontWeight: 700, color: C.red }}>✕ {st.error}{" "}
            <button type="button" onClick={onRetry} style={{ ...btn("ghost", "sm"), padding: "1px 8px" }}>Try again</button></div>
        )}
      </div>
      <input ref={input} type="file" accept={s.accept} capture={slot === "video" ? undefined : "environment"} hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPick(f); }} />
    </div>
  );
}

export function ReturnClaimTab() {
  const isMobile = useIsMobile();
  const [params] = useSearchParams();
  const mem = remembered();

  const [code, setCode] = useState(params.get("code") || "");
  const [ret, setRet] = useState(null);
  const [finding, setFinding] = useState(false);
  const [findMsg, setFindMsg] = useState(null);
  const [info, setInfo] = useState({ sub_order_number: "", awb_number: "" });
  const [packet, setPacket] = useState("");
  const [slots, setSlots] = useState({});
  const [opts, setOpts] = useState(null);
  const [optsErr, setOptsErr] = useState(null);
  const [sub, setSub] = useState("");
  const [fields, setFields] = useState(null);
  const [values, setValues] = useState({});
  const [labels, setLabels] = useState({});
  const [desc, setDesc] = useState("");
  const [checks, setChecks] = useState({});
  const [contact, setContact] = useState({ email: mem.email || "", callback: mem.callback || "" });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [claims, setClaims] = useState([]);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const business = ret?.business_id;

  const loadClaims = useCallback(() => { api("").then((r) => r.ok && setClaims(r.data.claims || [])); }, []);
  useEffect(() => { loadClaims(); }, [loadClaims]);

  const setSlot = (slot, patch) => setSlots((s) => ({ ...s, [slot]: { ...(s[slot] || {}), ...patch } }));

  // ── The return ──────────────────────────────────────────────────────────
  const find = useCallback(async (codes) => {
    const list = (Array.isArray(codes) ? codes : [codes]).map((c) => String(c || "").trim()).filter(Boolean);
    if (!list.length) return;
    setFinding(true); setFindMsg(null);
    const r = await api(`lookup/?${list.map((c) => `code=${encodeURIComponent(c)}`).join("&")}`);
    setFinding(false);
    if (!r.ok) { setFindMsg({ ok: false, text: r.data.error || "No return found." }); return; }
    const x = r.data.return;
    setRet(x);
    setCode(x.awb || r.data.matched_code);
    setInfo({ sub_order_number: x.sub_order_no || "", awb_number: x.awb || r.data.matched_code });
    setPacket((p) => p || x.packet_id || "");
    setFindMsg({ ok: true, text: `Found — ${x.business_name}'s return.` });
  }, []);
  useEffect(() => { if (params.get("code")) find(params.get("code")); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // The business's claim types, once the return (and so the business) is known.
  useEffect(() => {
    if (!business) return;
    setOpts(null); setOptsErr(null);
    api(`options/?business_id=${business}`).then((r) => (r.ok ? setOpts(r.data) : setOptsErr(r.data.error || "Couldn't read Meesho's claim types.")));
  }, [business]);
  useEffect(() => {
    if (!business || !sub) { setFields(null); return; }
    setFields(null);
    api(`options/?business_id=${business}&sub=${encodeURIComponent(sub)}`).then((r) => {
      if (!r.ok) { setOptsErr(r.data.error || "Couldn't read the claim form."); return; }
      setFields(r.data.fields);
      // Each drop-down starts on its first choice, as Meesho's form does.
      const first = {};
      r.data.fields.filter((f) => f.type === "drop_down" && f.options?.length).forEach((f) => { first[f.key] = f.options[0].value; });
      setValues((v) => ({ ...first, ...v }));
    });
  }, [business, sub]);

  // ── Photos and the video ────────────────────────────────────────────────
  const upload = useCallback(async (slot, file) => {
    setSlot(slot, { status: "uploading", stage: "Sending to Meesho…", error: null });
    const fd = new FormData();
    fd.append("business_id", String(business));
    fd.append("file", file);
    const r = await api("upload/", { method: "POST", body: fd });
    if (r.ok) setSlot(slot, { status: "uploaded", url: r.data.url, stage: null });
    else setSlot(slot, { status: "error", error: r.data.error || "Upload failed.", stage: null });
  }, [business]);

  // Anything ready and not sent yet goes to Meesho as soon as the business is known.
  useEffect(() => {
    if (!business) return;
    Object.entries(slots).forEach(([slot, st]) => { if (st.status === "ready" && st.ready) upload(slot, st.ready); });
  }, [business, slots, upload]);

  const pick = async (slot, file) => {
    const preview = slot === "video" ? null : URL.createObjectURL(file);
    setSlot(slot, { file, preview, url: null, error: null, ready: null, status: slot === "video" ? "compressing" : "reading", progress: 0, stage: null });
    if (slot === "video") {
      try {
        const small = await compressVideo(file, {
          onProgress: (p) => setSlot("video", { progress: p }),
          onStage: (t) => setSlot("video", { stage: t }),
        });
        setSlot("video", { ready: small, status: "ready", stage: small === file ? "Already under 22 MB" : `Compressed to ${mb(small.size)}` });
      } catch (e) {
        setSlot("video", { status: "error", error: e.message || "Couldn't compress this video." });
      }
      return;
    }
    if (slot === "waybill" || slot === "packet") {
      const codes = await readCodes(file, { text: slot === "waybill", onStage: (t) => setSlot(slot, { stage: t }) }).catch(() => []);
      if (slot === "waybill") {
        if (codes.length) await find(codes);
        else setFindMsg({ ok: false, text: "Couldn't read the AWB off the photo — type it below." });
      } else {
        const awb = (info.awb_number || code || "").toUpperCase();
        const id = codes.find((c) => c !== awb && c !== info.sub_order_number);
        if (id) setPacket(id);
      }
      setSlot(slot, { stage: codes.length ? `Read: ${codes.slice(0, 2).join(", ")}` : "Nothing readable — type it below" });
    }
    setSlot(slot, { ready: file, status: "ready" });
  };

  // ── Meesho's checks, as its form makes them ─────────────────────────────
  const check = useCallback(async (key, keys, vals) => {
    if (!business || !sub) return;
    setChecks((c) => ({ ...c, [key]: { busy: true } }));
    const r = await postJson("validate/", { business_id: business, sub_category_id: sub, values: vals, keys });
    setChecks((c) => ({ ...c, [key]: r.ok ? r.data : { ok: false, message: r.data.error } }));
  }, [business, sub]);
  useEffect(() => {
    if (!fields || !info.sub_order_number) return undefined;
    const t = setTimeout(() => check("sub_order_number", ["sub_order_number"], { sub_order_number: info.sub_order_number }), 400);
    return () => clearTimeout(t);
  }, [fields, info.sub_order_number, check]);
  useEffect(() => {
    if (!fields || !info.awb_number || !info.sub_order_number) return undefined;
    const t = setTimeout(() => check("awb_number", ["sub_order_number", "awb_number"], info), 600);
    return () => clearTimeout(t);
  }, [fields, info, check]);
  useEffect(() => {
    if (!fields || !packet) return undefined;
    const t = setTimeout(() => check("barcode_id", ["barcode_id"], { barcode_id: packet }), 600);
    return () => clearTimeout(t);
  }, [fields, packet, check]);

  // ── Raising it ──────────────────────────────────────────────────────────
  const allValues = () => {
    const v = { ...values, ...info, barcode_id: packet, ticket_desc: desc, callback_number: contact.callback.replace(/\D/g, "").slice(-10) };
    Object.entries(SLOTS).forEach(([slot, s]) => { if (slots[slot]?.url) v[s.key] = [slots[slot].url]; });
    return v;
  };
  const shown = fields || [];
  const vals = allValues();
  const missing = shown.filter((f) => f.required && (Array.isArray(vals[f.key]) ? !vals[f.key].length : !vals[f.key])).map((f) => f.label);
  const busyUploads = Object.values(slots).some((s) => ["reading", "compressing", "uploading"].includes(s.status));
  const okContact = /\S+@\S+\.\S+/.test(contact.email) && /^\d{10}$/.test(contact.callback.replace(/\D/g, "").slice(-10));
  const ready = ret?.connected && sub && fields && !missing.length && !busyUploads && okContact && !sending;
  const subLabel = opts?.sub_categories?.find((s) => s.id === sub)?.label || "";

  const raise = async () => {
    setSending(true); setResult(null);
    try { localStorage.setItem(REMEMBER, JSON.stringify({ email: contact.email, callback: contact.callback })); } catch { /* fine */ }
    const r = await postJson("", { business_id: business, return_id: ret.id, sub_category_id: sub, sub_category: subLabel,
      values: allValues(), labels, email: contact.email });
    setSending(false);
    setResult(r.ok ? { ok: true, ...r.data.claim } : { ok: false, error: r.data.error || "Meesho refused it." });
    loadClaims();
  };
  const reset = () => {
    Object.values(slotsRef.current).forEach((s) => s.preview && URL.revokeObjectURL(s.preview));
    setRet(null); setCode(""); setInfo({ sub_order_number: "", awb_number: "" }); setPacket(""); setSlots({});
    setValues({}); setLabels({}); setDesc(""); setChecks({}); setResult(null); setFindMsg(null); setSub(""); setFields(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const card = { ...S.card, padding: isMobile ? 12 : 16, display: "flex", flexDirection: "column", gap: 12 };
  const grid = { display: "grid", gap: 10, gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))" };
  const inp = { ...S.inp, minHeight: 44, fontSize: 15, width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 980 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.gray900, margin: 0 }}>Raise return claim</h1>
        <p style={{ fontSize: 13, color: C.gray500, margin: "4px 0 0" }}>
          Photograph the return's waybill — the return and its business are found from it, and the claim is raised on that business's Meesho account.
        </p>
      </div>

      {/* 1 · The return */}
      <div style={card}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>1 · The return</div>
        <Slot slot="waybill" state={slots.waybill} isMobile={isMobile} onPick={(f) => pick("waybill", f)} onRetry={() => slots.waybill?.ready && upload("waybill", slots.waybill.ready)} />
        <form onSubmit={(e) => { e.preventDefault(); find(code); }} style={{ display: "flex", gap: 8 }}>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="…or type the AWB / sub-order / packet id"
            aria-label="AWB, sub-order or packet id" style={{ ...inp, fontFamily: "monospace", flex: 1 }} />
          <button type="submit" disabled={finding || !code.trim()} style={{ ...btn("primary", "md"), minWidth: 90 }}>
            {finding ? <CircularProgress size={16} style={{ color: "#fff" }} /> : "Find"}
          </button>
        </form>
        {findMsg && <div role="status" style={{ fontSize: 13, fontWeight: 700, color: findMsg.ok ? "#15803D" : C.red }}>{findMsg.ok ? "✓ " : "✕ "}{findMsg.text}</div>}
        {ret && (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: C.gray50, borderRadius: 12, padding: 10 }}>
            <Photo url={ret.image_url} fallback={ret.image_fallback_url} size={64} />
            <div style={{ minWidth: 0, flex: 1, fontSize: 13, color: C.gray700, display: "flex", flexDirection: "column", gap: 2 }}>
              <div><Tag variant="blue">{ret.business_name}</Tag>{" "}{ret.type_of_return && <Tag variant={/rto/i.test(ret.type_of_return) ? "red" : "amber"}>{ret.type_of_return}</Tag>}</div>
              <b style={{ fontFamily: "monospace", color: C.gray900, wordBreak: "break-all" }}>{ret.sku}{ret.variation ? ` · ${ret.variation}` : ""} ×{ret.qty || 1}</b>
              {ret.product_name && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ret.product_name}</span>}
              <span>{[ret.courier, ret.delivered_date && `delivered ${ret.delivered_date}`].filter(Boolean).join(" · ")}</span>
              {ret.return_reason && <span style={{ color: C.gray500 }}>{ret.return_reason}{ret.detailed_return_reason ? ` — ${ret.detailed_return_reason}` : ""}</span>}
              {!ret.connected && <span style={{ color: C.red, fontWeight: 700 }}>✕ {ret.business_name}'s Meesho account isn't connected — connect it under Meesho → Settings.</span>}
              {ret.claims?.some((c) => c.status === "OK") && (
                <span style={{ color: "#B45309", fontWeight: 700 }}>⚠ A claim was already raised for this order: {ret.claims.filter((c) => c.status === "OK")
                  .map((c) => `${c.sub_category || "claim"}${c.ticket ? ` (${c.ticket})` : ""}`).join(", ")}</span>
              )}
            </div>
          </div>
        )}
        {ret && (
          <div style={grid}>
            <Field label="Sub order number" required check={checks.sub_order_number}>
              <input value={info.sub_order_number} onChange={(e) => setInfo({ ...info, sub_order_number: e.target.value.trim() })} style={{ ...inp, fontFamily: "monospace" }} />
            </Field>
            <Field label="AWB number" required check={checks.awb_number}>
              <input value={info.awb_number} onChange={(e) => setInfo({ ...info, awb_number: e.target.value.trim().toUpperCase() })} style={{ ...inp, fontFamily: "monospace" }} />
            </Field>
          </div>
        )}
      </div>

      {/* 2 · Photos and video */}
      <div style={card}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>2 · Photos and the unpacking video</div>
        <div style={grid}>
          {["packet", "product", "video"].map((slot) => (
            <Slot key={slot} slot={slot} state={slots[slot]} isMobile={isMobile} onPick={(f) => pick(slot, f)}
              onRetry={() => (slots[slot]?.ready ? upload(slot, slots[slot].ready) : null)} />
          ))}
        </div>
        <Field label="Packet ID" required check={checks.barcode_id} hint="Read off the packet's barcode photo — correct it if it's wrong">
          <input value={packet} onChange={(e) => setPacket(e.target.value.trim().toUpperCase())} placeholder="e.g. RMSP035065945" style={{ ...inp, fontFamily: "monospace" }} />
        </Field>
        {!business && Object.keys(slots).length > 0 && <div style={{ fontSize: 12.5, color: C.gray500 }}>They're sent to Meesho once the return is found.</div>}
      </div>

      {/* 3 · The claim */}
      <div style={card}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>3 · The claim</div>
        {!ret ? <div style={{ fontSize: 13, color: C.gray500 }}>Find the return first.</div> : optsErr ? (
          <div style={{ fontSize: 13, color: C.red, fontWeight: 700 }}>✕ {optsErr}</div>
        ) : !opts ? <CircularProgress size={20} style={{ color: C.orange }} /> : (
          <>
            <Field label="What is the claim for?" required>
              <select value={sub} onChange={(e) => { setSub(e.target.value); setChecks({}); }} style={{ ...inp, fontWeight: 800, borderColor: sub ? C.gray200 : C.orange }}>
                <option value="">— choose —</option>
                {opts.sub_categories.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
            {sub && !fields && <CircularProgress size={20} style={{ color: C.orange }} />}
            {fields && (
              <div style={grid}>
                {fields.filter((f) => !AUTO_KEYS.has(f.key)).map((f) => (
                  <Field key={f.key} label={f.label} required={f.required} hint={f.hint}>
                    {f.type === "drop_down" ? (
                      <select value={values[f.key] || ""} onChange={(e) => {
                        const o = f.options.find((x) => x.value === e.target.value);
                        setValues({ ...values, [f.key]: e.target.value }); setLabels({ ...labels, [f.key]: o?.label || e.target.value });
                      }} style={inp}>
                        {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : FILE_TYPES.includes(f.type) ? (
                      <ExtraFiles business={business} urls={values[f.key] || []} onChange={(urls) => setValues((v) => ({ ...v, [f.key]: urls }))} />
                    ) : f.type === "text_area" ? (
                      <textarea rows={3} value={values[f.key] || ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} style={{ ...inp, resize: "vertical" }} />
                    ) : (
                      <input value={values[f.key] || ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} style={inp} />
                    )}
                  </Field>
                ))}
              </div>
            )}
            <Field label="Description" required>
              <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What's wrong with this return — e.g. 2 of 3 items missing"
                style={{ ...inp, resize: "vertical" }} />
            </Field>
            <div style={grid}>
              <Field label="Callback number" required>
                <input inputMode="numeric" value={contact.callback} onChange={(e) => setContact({ ...contact, callback: e.target.value })} placeholder="10 digits" style={inp} />
              </Field>
              <Field label="Email for Meesho's reply" required>
                <input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} style={inp} />
              </Field>
            </div>
          </>
        )}
      </div>

      {result && (result.ok ? (
        <div role="status" style={{ background: C.greenLight, border: `2px solid ${C.greenBorder}`, borderRadius: 14, padding: 14, color: "#166534" }}>
          <div style={{ fontSize: 17, fontWeight: 900 }}>✓ Claim raised on Meesho for {result.business_name}</div>
          <div style={{ marginTop: 4 }}>{result.message}</div>
          <button onClick={reset} style={{ ...btn("primary", "md"), marginTop: 10 }}>Next return</button>
        </div>
      ) : (
        <div role="alert" style={{ background: C.redLight, border: `2px solid ${C.redBorder}`, borderRadius: 14, padding: 14, color: C.red, fontWeight: 700 }}>
          ✕ {result.error}
        </div>
      ))}

      {!result?.ok && ret && (
        <div style={{ position: isMobile ? "sticky" : "static", bottom: 0, background: isMobile ? C.gray50 : "transparent",
          padding: isMobile ? "8px 0 calc(8px + env(safe-area-inset-bottom))" : 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {missing.length > 0 && fields && <div style={{ fontSize: 12.5, color: C.gray600 }}>Still needed: {missing.join(", ")}</div>}
          {busyUploads && <div style={{ fontSize: 12.5, color: C.gray600 }}>Waiting for the photos / video to finish…</div>}
          <button onClick={raise} disabled={!ready} style={{ ...btn("primary", "lg"), minHeight: 52, fontSize: 16, opacity: ready ? 1 : 0.5 }}>
            {sending ? <><CircularProgress size={16} style={{ color: "#fff", marginRight: 8, verticalAlign: "-3px" }} />Raising the claim…</>
              : `📨 Raise claim on ${ret.business_name}'s Meesho`}
          </button>
        </div>
      )}

      {claims.length > 0 && (
        <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", fontWeight: 800, fontSize: 14, borderBottom: `1px solid ${C.gray100}` }}>Claims raised lately</div>
          {claims.slice(0, 30).map((c) => (
            <div key={c.id} style={{ padding: "8px 14px", borderBottom: `1px solid ${C.gray100}`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
              <Tag variant={c.status === "OK" ? "green" : c.status === "FAILED" ? "red" : "blue"}>{c.status === "OK" ? (c.ticket ? `Ticket ${c.ticket}` : "Raised") : c.status === "FAILED" ? "Refused" : "Sending"}</Tag>
              <b>{c.business_name}</b>
              <span style={{ fontFamily: "monospace" }}>{c.sub_order_no}</span>
              <span style={{ color: C.gray600 }}>{c.sub_category}</span>
              {c.status === "FAILED" && <span style={{ color: C.red, flexBasis: "100%" }}>{c.message}</span>}
              <span style={{ color: C.gray400, marginLeft: "auto" }}>{new Date(c.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{c.by ? ` · ${c.by}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Any further photos a claim type asks for — each sent to Meesho as it's chosen. */
function ExtraFiles({ business, urls, onChange }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const add = async (files) => {
    setBusy(true); setErr(null);
    const got = [];
    for (const f of files) {
      const fd = new FormData();
      fd.append("business_id", String(business));
      fd.append("file", f);
      // eslint-disable-next-line no-await-in-loop
      const r = await api("upload/", { method: "POST", body: fd });
      if (r.ok) got.push(r.data.url); else setErr(r.data.error || "Upload failed.");
    }
    setBusy(false);
    onChange([...urls, ...got]);
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ ...btn("ghost", "sm"), cursor: "pointer", minHeight: 36, display: "inline-flex", alignItems: "center" }}>
        {busy ? "Sending…" : "＋ Add photos"}
        <input type="file" accept="image/*" multiple hidden onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; if (f.length) add(f); }} />
      </label>
      {urls.length > 0 && <span style={{ fontSize: 12.5, color: "#15803D", fontWeight: 700 }}>✓ {urls.length} with Meesho</span>}
      {urls.length > 0 && <button type="button" onClick={() => onChange([])} style={{ ...btn("ghost", "sm"), padding: "2px 8px" }}>Clear</button>}
      {err && <span style={{ fontSize: 12, color: C.red }}>{err}</span>}
    </div>
  );
}
