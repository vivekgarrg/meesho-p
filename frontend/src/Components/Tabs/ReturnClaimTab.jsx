import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { API, C, S, btn, Tag, useIsMobile } from "../../App";
import { CircularProgress } from "@mui/material";
import { Photo } from "./OrderScanTab";
import { readCodes } from "../../lib/readCodes";

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
 * Photos and the video start going to the server as soon as they're picked (in
 * small pieces) and keep going while the next return is filled in. "Raise
 * claim" only queues it: the background worker compresses a big video, sends
 * every file and the return's POD to Meesho, and raises the ticket — retrying
 * if Meesho is busy, and saying so (here, and on Telegram) if it fails.
 */

const REMEMBER = "meesho-return-claim";
const remembered = () => { try { return JSON.parse(localStorage.getItem(REMEMBER) || "{}"); } catch { return {}; } };
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

// The form's fields this page fills itself; any other field the claim type asks for is shown as Meesho describes it.
const SLOTS = {
  waybill: { key: "product_reverse_way_bill_link", label: "Reverse waybill", hint: "The return label — its AWB is read off the photo", accept: "image/*" },
  packet: { key: "barcode_image_link", label: "Packet barcode", hint: "The packet's barcode — its id is read off the photo", accept: "image/*" },
  product: { key: "product_image_link", label: "Product received", hint: "What came back in the packet", accept: "image/*" },
  video: { key: "product_openingvideo_link", label: "Unpacking video", hint: "Any size — over 24 MB it's compressed here first", accept: "video/*" },
};
const SLOT_BY_KEY = Object.fromEntries(Object.entries(SLOTS).map(([slot, s]) => [s.key, slot]));
const AUTO_KEYS = new Set(["sub_order_number", "awb_number", "barcode_id", "ticket_desc", "callback_number", ...Object.keys(SLOT_BY_KEY)]);
const FILE_TYPES = ["img_file", "action_img_file", "video_file", "file"];

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(`${API}/return-claim/${path}`, opts);
  } catch {
    return { ok: false, status: 0, data: { error: navigator.onLine === false
      ? "This phone is offline — reconnect and try again."
      : "The connection dropped before the server answered — try again." } };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.error && !data.detail) {
    data.error = res.status === 413 ? "The server refused a file that big."
      : res.status === 524 || res.status === 504 ? "The server took too long to answer — try again."
        : `The server answered HTTP ${res.status} — try again.`;
  }
  return { ok: res.ok, status: res.status, data: { ...data, error: data.error || data.detail } };
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ── Uploads that carry on in the background ─────────────────────────────────
// Each file goes to the server in small pieces (each retried on its own) and
// keeps going after the claim is queued and the form is cleared for the next
// return; the claim's worker picks the files up once they're all there.
const uploads = new Map();                 // upload id → {id, name, size, progress, state: "sending" | "done" | "error", error}
const watchers = new Set();
const told = () => watchers.forEach((f) => f());
const pendingUploads = () => [...uploads.values()].filter((u) => u.state === "sending");
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (pendingUploads().length) { e.preventDefault(); e.returnValue = ""; }
  });
}
function useUploads() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); watchers.add(f); return () => { watchers.delete(f); }; }, []);
  return uploads;
}

/** Start sending a file. Resolves with its upload id once the server has said yes; the pieces follow in the background. */
async function beginUpload(business, file) {
  const start = await postJson("upload/start/", { business_id: business, name: file.name, size: file.size,
    content_type: file.type || "application/octet-stream" });
  if (!start.ok) throw new Error(start.data.error || "Couldn't start sending the file.");
  const { upload_id: id, chunk_size: size } = start.data;
  const u = { id, name: file.name, size: file.size, progress: 0, state: "sending", error: null };
  uploads.set(id, u);
  told();
  (async () => {
    const parts = Math.max(1, Math.ceil(file.size / size));
    try {
      for (let i = 0; i < parts; i++) {
        let r;
        for (let attempt = 0; attempt < 6; attempt++) {
          const fd = new FormData();
          fd.append("index", String(i));
          fd.append("file", file.slice(i * size, (i + 1) * size), "blob");
          // eslint-disable-next-line no-await-in-loop
          r = await api(`upload/${id}/chunk/`, { method: "POST", body: fd });
          if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429)) break;
          // eslint-disable-next-line no-await-in-loop
          await sleep(Math.min(30000, 1000 * 2 ** attempt));
        }
        if (!r.ok) throw new Error(r.data.error || "Part of the file didn't get through.");
        u.progress = (i + 1) / parts;
        told();
      }
      let fin;
      for (let attempt = 0; attempt < 5; attempt++) {
        // eslint-disable-next-line no-await-in-loop
        fin = await postJson(`upload/${id}/finish/`, { parts, send: false });
        if (fin.ok || fin.status === 400) break;
        // eslint-disable-next-line no-await-in-loop
        await sleep(2000 * (attempt + 1));
      }
      if (!fin.ok) throw new Error(fin.data.error || "Couldn't finish sending the file.");
      u.state = "done";
    } catch (e) {
      u.state = "error";
      u.error = e.message;
    }
    told();
  })();
  return id;
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
function Slot({ slot, state, onPick, onRetry, isMobile, up }) {
  const s = SLOTS[slot];
  const input = useRef(null);
  const st = state || {};
  const failed = st.status === "error" || up?.state === "error";
  const done = up?.state === "done";
  const tone = done ? C.green : failed ? C.red : st.file ? C.orange : C.gray300;
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
        {up?.state === "sending" && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.gray600, marginTop: 2 }}>Sending to the server… {Math.round(up.progress * 100)}% — you can fill in the rest</div>
            <div style={{ height: 6, borderRadius: 99, background: C.gray100, overflow: "hidden", marginTop: 4 }}>
              <div style={{ height: "100%", width: `${Math.round(up.progress * 100)}%`, background: C.orange, transition: "width .2s" }} />
            </div>
          </>
        )}
        {done && <div style={{ fontSize: 12, fontWeight: 800, color: "#15803D" }}>✓ On the server — sent to Meesho with the claim</div>}
        {failed && (
          <div style={{ fontSize: 12, fontWeight: 700, color: C.red }}>✕ {st.error || up?.error}{" "}
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
  const live = useUploads();
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
  const [extraFiles, setExtraFiles] = useState({});      // {field key: [upload ids]} — further photos a claim type asks for
  const [queuedNote, setQueuedNote] = useState(null);
  const [force, setForce] = useState({ on: false, reason: "" });   // raise although a claim already exists
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const business = ret?.business_id;

  const loadClaims = useCallback(() => { api("").then((r) => r.ok && setClaims(r.data.claims || [])); }, []);
  useEffect(() => { loadClaims(); }, [loadClaims]);
  const inFlight = claims.some((c) => ["QUEUED", "WORKING", "RETRYING", "SENDING"].includes(c.status));
  useEffect(() => {
    if (!inFlight) return undefined;
    const t = setInterval(loadClaims, 8000);
    return () => clearInterval(t);
  }, [inFlight, loadClaims]);
  const retry = async (c) => {
    const r = await postJson(`${c.id}/retry/`, {});
    if (!r.ok) window.alert(r.data.error || "Couldn't queue it again.");
    loadClaims();
  };

  const setSlot = (slot, patch) => setSlots((s) => ({ ...s, [slot]: { ...(s[slot] || {}), ...patch } }));

  // ── The return ──────────────────────────────────────────────────────────
  const find = useCallback(async (codes) => {
    const list = (Array.isArray(codes) ? codes : [codes]).map((c) => String(c || "").trim()).filter(Boolean);
    if (!list.length) return;
    setFinding(true); setFindMsg(null);
    const r = await api(`lookup/?${list.map((c) => `code=${encodeURIComponent(c)}`).join("&")}`);
    setFinding(false);
    if (!r.ok) {
      setFindMsg({ ok: false, text: r.data.error || r.data.detail
        || `The search didn't answer (HTTP ${r.status || "—"}) — reload the page; if it stays, the server may still be updating.` });
      return;
    }
    const x = r.data.return;
    setRet(x);
    setCode(x.awb || r.data.matched_code);
    setInfo({ sub_order_number: x.sub_order_no || "", awb_number: x.awb || r.data.matched_code });
    setPacket((p) => p || x.packet_id || "");
    if (x.damaged && x.damage_note) setDesc((d) => d || `Packet received damaged / tampered: ${x.damage_note}`);
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
      // Nothing is pre-chosen — except a packet Return Scan already flagged damaged, which starts as tampered.
      const tampered = r.data.fields.find((f) => f.key === "packet_state")?.options?.find((o) => /tamper/i.test(o.value));
      if (ret?.damaged && tampered) {
        setValues((v) => ({ packet_state: tampered.value, ...v }));
        setLabels((l) => ({ packet_state: tampered.label, ...l }));
      }
    });
  }, [business, sub]);

  // ── Photos and the video ────────────────────────────────────────────────
  // Each starts going to the server as soon as the business is known; the claim's worker sends it on to Meesho.
  const upload = useCallback(async (slot, file) => {
    setSlot(slot, { status: "uploading", error: null, uploadId: null });
    try {
      const id = await beginUpload(business, file);
      setSlot(slot, { uploadId: id });
    } catch (e) {
      setSlot(slot, { status: "error", error: e.message });
    }
  }, [business]);

  useEffect(() => {
    if (!business) return;
    Object.entries(slots).forEach(([slot, st]) => { if (st.status === "ready" && st.ready) upload(slot, st.ready); });
  }, [business, slots, upload]);

  const pick = async (slot, file) => {
    const preview = slot === "video" ? null : URL.createObjectURL(file);
    setSlot(slot, { file, preview, error: null, ready: null, uploadId: null, status: slot === "video" ? "ready" : "reading", stage: null });
    if (slot === "video") {
      setSlot("video", { ready: file, stage: file.size > 22 * 1048576 ? "Compressed on the server, in the background" : null });
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
    Object.keys(SLOT_BY_KEY).forEach((k) => { delete v[k]; });
    if (Array.isArray(v.attachments) && !v.attachments.length) delete v.attachments;
    return v;
  };
  const filesOf = () => {
    const f = {};
    Object.entries(SLOTS).forEach(([slot, sd]) => { if (slots[slot]?.uploadId) f[sd.key] = [slots[slot].uploadId]; });
    Object.entries(extraFiles).forEach(([key, ids]) => { if (ids.length) f[key] = ids; });
    return f;
  };
  const shown = fields || [];
  const vals = allValues();
  const files = filesOf();
  const missing = shown.filter((f) => f.required && !f.info && !files[f.key]
    && (Array.isArray(vals[f.key]) ? !vals[f.key].length : !vals[f.key])).map((f) => f.label);
  const failedUpload = Object.values(slots).some((st) => st.status === "error" || (st.uploadId && live.get(st.uploadId)?.state === "error"));
  const busyUploads = Object.values(slots).some((st) => st.status === "reading" || (st.status === "uploading" && !st.uploadId));
  const okContact = /\S+@\S+\.\S+/.test(contact.email) && /^\d{10}$/.test(contact.callback.replace(/\D/g, "").slice(-10));
  // A field Meesho has flagged (e.g. "Ticket … has already been raised for this issue") — Meesho would refuse the claim.
  const flagged = Object.values(checks).filter((c) => c && !c.busy && c.ok === false);
  const duplicate = ret?.duplicate;
  // Raise anyway: past a duplicate (and Meesho's own "already raised" check), with a reason that stays on the claim.
  const forcing = force.on && force.reason.trim().length >= 3;
  const ready = ret?.connected && sub && fields && !missing.length && !busyUploads && !failedUpload && okContact && !sending
    && (!flagged.length || forcing) && (!duplicate || forcing);
  const subLabel = opts?.sub_categories?.find((s) => s.id === sub)?.label || "";

  const raise = async () => {
    setSending(true); setResult(null);
    try { localStorage.setItem(REMEMBER, JSON.stringify({ email: contact.email, callback: contact.callback })); } catch { /* fine */ }
    const r = await postJson("", { business_id: business, return_id: ret.id, sub_category_id: sub, sub_category: subLabel,
      values: allValues(), files: filesOf(), labels, email: contact.email,
      ...(forcing && (duplicate || flagged.length) ? { force: true, force_reason: force.reason.trim() } : {}) });
    setSending(false);
    loadClaims();
    if (!r.ok) { setResult({ ok: false, error: r.data.error || "Couldn't queue the claim." }); return; }
    // Queued: the worker raises it. Straight on to the next return.
    setQueuedNote(`Queued ${ret.business_name}'s claim for ${ret.sub_order_no} — it's raised in the background; follow it below.`);
    reset();
  };
  const reset = () => {
    Object.values(slotsRef.current).forEach((s) => s.preview && URL.revokeObjectURL(s.preview));
    setRet(null); setCode(""); setInfo({ sub_order_number: "", awb_number: "" }); setPacket(""); setSlots({});
    setValues({}); setLabels({}); setDesc(""); setChecks({}); setResult(null); setFindMsg(null); setSub(""); setFields(null);
    setExtraFiles({});
    setForce({ on: false, reason: "" });
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

      {queuedNote && (
        <div role="status" style={{ background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, borderRadius: 12, padding: "10px 14px", color: "#166534",
          fontSize: 13.5, fontWeight: 700, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ flex: 1 }}>✓ {queuedNote}</span>
          <button onClick={() => setQueuedNote(null)} aria-label="Dismiss" style={{ ...btn("ghost", "sm"), padding: "2px 8px" }}>✕</button>
        </div>
      )}
      {pendingUploads().length > 0 && (
        <div role="status" style={{ background: "#EFF6FF", border: "1.5px solid #BFDBFE", borderRadius: 12, padding: "8px 14px", color: "#1E3A8A", fontSize: 13, fontWeight: 700 }}>
          ⏫ Sending {pendingUploads().length} file{pendingUploads().length === 1 ? "" : "s"} to the server
          ({Math.round(pendingUploads().reduce((n, u) => n + u.progress * u.size, 0) / Math.max(1, pendingUploads().reduce((n, u) => n + u.size, 0)) * 100)}%)
          — keep this page open; carry on with the next return.
        </div>
      )}

      {/* 1 · The return */}
      <div style={card}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>1 · The return</div>
        <Slot slot="waybill" state={slots.waybill} up={live.get(slots.waybill?.uploadId)} isMobile={isMobile} onPick={(f) => pick("waybill", f)} onRetry={() => slots.waybill?.ready && upload("waybill", slots.waybill.ready)} />
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
              {ret.duplicate && (
                <span role="alert" style={{ color: "#fff", background: C.red, borderRadius: 8, padding: "6px 10px", fontWeight: 800, marginTop: 4 }}>
                  ⛔ Duplicate — {ret.duplicate.why} To raise it again, tick "Raise anyway" below and say why.</span>
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
            <Slot key={slot} slot={slot} state={slots[slot]} up={live.get(slots[slot]?.uploadId)} isMobile={isMobile} onPick={(f) => pick(slot, f)}
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
                {fields.filter((f) => f.info).map((f) => <Note key={f.key} html={f.label} />)}
                {fields.filter((f) => !AUTO_KEYS.has(f.key) && !f.info).map((f) => (
                  <Field key={f.key} label={f.label} required={f.required} hint={f.hint}>
                    {f.type === "drop_down" ? (
                      <select value={values[f.key] || ""} onChange={(e) => {
                        const o = f.options.find((x) => x.value === e.target.value);
                        setValues({ ...values, [f.key]: e.target.value }); setLabels({ ...labels, [f.key]: o?.label || e.target.value });
                      }} style={{ ...inp, borderColor: values[f.key] ? C.gray200 : C.orange }}>
                        <option value="">— choose —</option>
                        {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : FILE_TYPES.includes(f.type) ? (
                      <ExtraFiles business={business} ids={extraFiles[f.key] || []} live={live}
                        onChange={(ids) => setExtraFiles((x) => ({ ...x, [f.key]: ids }))} hint={f.key === "attachments" && ret?.pod_url ? "The return's proof of delivery is attached here by itself." : ""} />
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

      {result && !result.ok && (
        <div role="alert" style={{ background: C.redLight, border: `2px solid ${C.redBorder}`, borderRadius: 14, padding: 14, color: C.red, fontWeight: 700 }}>
          ✕ {result.error}
        </div>
      )}

      {!result?.ok && ret && (
        <div style={{ position: isMobile ? "sticky" : "static", bottom: 0, background: isMobile ? C.gray50 : "transparent",
          padding: isMobile ? "8px 0 calc(8px + env(safe-area-inset-bottom))" : 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {missing.length > 0 && fields && <div style={{ fontSize: 12.5, color: C.gray600 }}>Still needed: {missing.join(", ")}</div>}
          {busyUploads && <div style={{ fontSize: 12.5, color: C.gray600 }}>Reading the photos…</div>}
          {failedUpload && <div style={{ fontSize: 12.5, color: C.red, fontWeight: 700 }}>A file didn't get through — press Try again on it.</div>}
          {(duplicate || flagged.length > 0) && (
            <div style={{ border: `1.5px solid ${force.on ? C.red : C.gray200}`, background: force.on ? C.redLight : C.white, borderRadius: 12,
              padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, fontWeight: 800, color: force.on ? C.red : C.gray700, cursor: "pointer" }}>
                <input type="checkbox" checked={force.on} onChange={(e) => setForce((f) => ({ ...f, on: e.target.checked }))} style={{ width: 18, height: 18 }} />
                Raise anyway — {duplicate ? "a claim already exists for this return" : "Meesho flagged a field"}
              </label>
              {force.on && (
                <input value={force.reason} onChange={(e) => setForce((f) => ({ ...f, reason: e.target.value }))} autoFocus
                  placeholder="Why raise it again? (kept with the claim)" aria-label="Why raise it again"
                  style={{ ...inp, borderColor: forcing ? C.gray200 : C.red }} />
              )}
              {force.on && <span style={{ fontSize: 12, color: C.gray600 }}>Meesho may still refuse a second ticket for the same issue.</span>}
            </div>
          )}
          {flagged.length > 0 && <div style={{ fontSize: 12.5, color: C.red, fontWeight: 700 }}>Meesho won't take it yet: {flagged.map((c) => c.message).filter(Boolean).join(" ")}</div>}
          <button onClick={raise} disabled={!ready} style={{ ...btn("primary", "lg"), minHeight: 52, fontSize: 16, opacity: ready ? 1 : 0.5 }}>
            {sending ? <><CircularProgress size={16} style={{ color: "#fff", marginRight: 8, verticalAlign: "-3px" }} />Queuing the claim…</>
              : forcing && (duplicate || flagged.length) ? `⚠ Raise anyway on ${ret.business_name}'s Meesho` : `📨 Raise claim on ${ret.business_name}'s Meesho`}
          </button>
        </div>
      )}

      {claims.length > 0 && (
        <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", fontWeight: 800, fontSize: 14, borderBottom: `1px solid ${C.gray100}` }}>Claims</div>
          {claims.slice(0, 50).map((c) => (
            <div key={c.id} style={{ padding: "8px 14px", borderBottom: `1px solid ${C.gray100}`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5,
              background: c.status === "FAILED" ? C.redLight : C.white }}>
              <Tag variant={{ OK: "green", FAILED: "red", RETRYING: "amber" }[c.status] || "blue"}>
                {{ OK: c.ticket ? `✓ Ticket ${c.ticket}` : "✓ Raised", FAILED: "✕ Failed", QUEUED: "Queued", WORKING: "Raising…",
                  RETRYING: `Retrying (try ${c.attempts + 1})`, SENDING: "Sending" }[c.status] || c.status}
              </Tag>
              <b>{c.business_name}</b>
              <span style={{ fontFamily: "monospace" }}>{c.sub_order_no}</span>
              <span style={{ color: C.gray600 }}>{c.sub_category}</span>
              {c.pod_attached && <Tag variant="gray">POD attached</Tag>}
              {c.forced && <span title={c.force_reason}><Tag variant="amber">Raised anyway</Tag></span>}
              {c.status !== "OK" && c.message && <span style={{ color: c.status === "FAILED" ? C.red : C.gray600, flexBasis: "100%" }}>{c.message}</span>}
              {c.status === "FAILED" && <button onClick={() => retry(c)} style={{ ...btn("ghostOrange", "sm"), padding: "2px 10px" }}>↻ Retry</button>}
              <span style={{ color: C.gray400, marginLeft: "auto" }}>{new Date(c.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{c.by ? ` · ${c.by}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A note from Meesho's form (a tip, a sample image). Its HTML is never put on the
 * page as HTML: only its text, and a sample image when it's Meesho's own.
 */
function Note({ html }) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  const text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  const img = [...doc.querySelectorAll("img")].map((i) => i.getAttribute("src") || "").find((u) => /^https:\/\/images\.meesho\.com\//.test(u));
  if (!text && !img) return null;
  return (
    <div style={{ gridColumn: "1 / -1", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "8px 12px",
      fontSize: 12.5, color: "#1E3A8A", display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span aria-hidden>ℹ️</span>
      <div style={{ minWidth: 0 }}>
        {text}
        {img && <img src={img} alt="Sample from Meesho" style={{ display: "block", maxWidth: 220, width: "100%", borderRadius: 8, marginTop: 6 }} />}
      </div>
    </div>
  );
}

/** Any further photos a claim type asks for — each sent to Meesho as it's chosen. */
function ExtraFiles({ business, ids, onChange, live, hint }) {
  const [err, setErr] = useState(null);
  const add = async (files) => {
    setErr(null);
    const got = [];
    for (const f of files) {
      try {
        // eslint-disable-next-line no-await-in-loop
        got.push(await beginUpload(business, f));
      } catch (e) {
        setErr(e.message || "Couldn't send it.");
      }
    }
    onChange([...ids, ...got]);
  };
  const sending = ids.filter((id) => live.get(id)?.state === "sending").length;
  const failed = ids.filter((id) => live.get(id)?.state === "error").length;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ ...btn("ghost", "sm"), cursor: "pointer", minHeight: 36, display: "inline-flex", alignItems: "center" }}>
        ＋ Add photos
        <input type="file" accept="image/*" multiple hidden onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; if (f.length) add(f); }} />
      </label>
      {ids.length > 0 && <span style={{ fontSize: 12.5, color: failed ? C.red : "#15803D", fontWeight: 700 }}>
        {ids.length} photo{ids.length === 1 ? "" : "s"}{sending ? ` · ${sending} sending` : ""}{failed ? ` · ${failed} failed` : ""}</span>}
      {ids.length > 0 && <button type="button" onClick={() => onChange([])} style={{ ...btn("ghost", "sm"), padding: "2px 8px" }}>Clear</button>}
      {hint && <span style={{ fontSize: 12, color: C.gray500 }}>📎 {hint}</span>}
      {err && <span style={{ fontSize: 12, color: C.red }}>{err}</span>}
    </div>
  );
}
