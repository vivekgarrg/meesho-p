import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { API, C, S, btn } from "../../App";
import { CircularProgress } from "@mui/material";

/**
 * Packed count per courier for a packing day — what goes out with each
 * courier's pickup — printable on a 4×6 inch label: a summary label for the
 * day, and one label per courier with a hand-over line to sign.
 */

const fmtDay = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—");
const nowText = () => new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const platformName = (p) => (p === "flipkart" ? "Flipkart" : p === "meesho" ? "Meesho" : "All platforms");

const PRINT_CSS = `
  #courier-print { display: none; }
  @media print {
    /* Only the labels, at their real size: the rest of the app is taken out of
       the layout (not just hidden), so nothing makes the printer shrink to fit. */
    html, body { width: 4in !important; min-width: 0 !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
    body > *:not(#courier-print) { display: none !important; }
    #courier-print { display: block !important; }
  }
  .cs-page {
    width: 4in; height: 6in; box-sizing: border-box; padding: 0.22in; overflow: hidden;
    page-break-after: always; break-after: page; font-family: Arial, Helvetica, sans-serif; color: #000;
    display: flex; flex-direction: column; background: #fff;
  }
  .cs-page:last-child { page-break-after: auto; break-after: auto; }
  .cs-head { border-bottom: 3px solid #000; padding-bottom: 6px; margin-bottom: 8px; }
  .cs-title { font-size: 20px; font-weight: 900; letter-spacing: 0.5px; }
  .cs-sub { font-size: 11.5px; margin-top: 2px; }
  .cs-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .cs-table th { text-align: left; border-bottom: 2px solid #000; padding: 4px 2px; font-size: 11px; text-transform: uppercase; }
  .cs-table td { border-bottom: 1px solid #999; padding: 5px 2px; font-weight: 700; }
  .cs-table td.n, .cs-table th.n { text-align: right; }
  .cs-total { margin-top: auto; border: 3px solid #000; border-radius: 6px; padding: 8px 10px; display: flex; justify-content: space-between; align-items: baseline; }
  .cs-big { font-size: 96px; font-weight: 900; line-height: 1; text-align: center; margin: 6px 0 2px; }
  .cs-courier { font-size: 30px; font-weight: 900; text-align: center; text-transform: uppercase; word-break: break-word; line-height: 1.1; }
  .cs-sign { margin-top: auto; font-size: 12px; }
  .cs-sign div { border-bottom: 1px solid #000; height: 26px; margin-bottom: 6px; display: flex; align-items: flex-end; }
  .cs-foot { font-size: 9.5px; margin-top: 6px; color: #333; }
`;

function SummaryLabel({ data }) {
  return (
    <div className="cs-page">
      <div className="cs-head">
        <div className="cs-title">PACKED SUMMARY</div>
        <div className="cs-sub"><b>Packing day {fmtDay(data.date)}</b> (12 pm – 12 pm) · {platformName(data.platform)}</div>
        <div className="cs-sub">{data.businesses.map((b) => b.name).join(", ")}</div>
      </div>
      <table className="cs-table">
        <thead><tr><th>Courier</th><th className="n">Packed</th><th className="n">Pcs</th></tr></thead>
        <tbody>
          {data.couriers.map((c) => (
            <tr key={c.courier}><td>{c.courier}</td><td className="n">{c.packed}</td><td className="n">{c.pieces}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="cs-total">
        <span style={{ fontSize: 16, fontWeight: 900 }}>TOTAL PACKED</span>
        <span style={{ fontSize: 40, fontWeight: 900 }}>{data.total.packed}</span>
      </div>
      <div className="cs-foot">{data.total.pieces} pieces · {data.total.dispatched} marked dispatched · printed {nowText()} by {data.printed_by}</div>
    </div>
  );
}

function CourierLabel({ data, c }) {
  return (
    <div className="cs-page">
      <div className="cs-head">
        <div className="cs-sub"><b>HAND-OVER · {fmtDay(data.date)}</b> · {platformName(data.platform)}</div>
      </div>
      <div className="cs-courier">{c.courier}</div>
      <div className="cs-big">{c.packed}</div>
      <div style={{ textAlign: "center", fontSize: 15, fontWeight: 800 }}>PARCELS PACKED</div>
      <div style={{ textAlign: "center", fontSize: 12, marginTop: 4 }}>{c.pieces} pieces · {c.dispatched} dispatched</div>
      {c.by_business.length > 1 && (
        <table className="cs-table" style={{ marginTop: 10 }}>
          <tbody>{c.by_business.map((b) => <tr key={b.business}><td>{b.business}</td><td className="n">{b.packed}</td></tr>)}</tbody>
        </table>
      )}
      {c.by_business.length === 1 && <div style={{ textAlign: "center", fontSize: 12, marginTop: 6 }}>{c.by_business[0].business}</div>}
      <div className="cs-sign">
        <div>Handed over by:</div>
        <div>Received by ({c.courier}):</div>
        <div>Parcels counted: ______ &nbsp; Time: ______</div>
      </div>
      <div className="cs-foot">Scanned {fmtTime(c.first)} – {fmtTime(c.last)} · printed {nowText()}</div>
    </div>
  );
}

export function CourierSummary({ platform, day, compact }) {
  const [date, setDate] = useState(day || "");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [printJob, setPrintJob] = useState(null);   // which labels to print

  useEffect(() => { if (day) setDate(day); }, [day]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ platform });
      if (date) p.set("date", date);
      const res = await fetch(`${API}/order-scan/courier-summary/?${p}`);
      if (res.ok) {
        const d = await res.json();
        setData(d);
        if (!date) setDate(d.date);
      }
    } finally { setLoading(false); }
  }, [date, platform]);
  useEffect(() => { load(); }, [load]);

  // Print on a 4×6 inch page, then clear the job.
  useEffect(() => {
    if (!printJob) return undefined;
    const style = document.createElement("style");
    style.innerHTML = "@page { size: 4in 6in; margin: 0; }";
    document.head.appendChild(style);
    const done = () => setPrintJob(null);
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => window.print(), 200);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); style.remove(); };
  }, [printJob]);

  const couriers = data?.couriers || [];
  const print = (what) => setPrintJob(what);
  const pages = !printJob || !data ? null : (
    <>
      {(printJob === "all" || printJob === "summary") && <SummaryLabel data={data} />}
      {couriers.filter((c) => printJob === "all" || printJob === "couriers" || printJob === `c:${c.courier}`)
        .map((c) => <CourierLabel key={c.courier} data={data} c={c} />)}
    </>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{PRINT_CSS}</style>
      {createPortal(<div id="courier-print">{pages}</div>, document.body)}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontSize: compact ? 16 : 18, fontWeight: 900, color: C.gray900 }}>Packed by courier</div>
          <div style={{ fontSize: 12.5, color: C.gray500 }}>Packing day runs 12 pm to 12 pm · {platformName(platform)}{data?.businesses?.length > 1 ? ` · ${data.businesses.length} businesses` : ""}</div>
        </div>
        <input type="date" value={date} max={data?.current_day} onChange={(e) => setDate(e.target.value)} style={{ ...S.inp, width: "auto" }} />
        <button onClick={load} style={btn("ghost", "sm")}>Refresh</button>
      </div>

      {loading && !data ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><CircularProgress style={{ color: C.orange }} /></div>
      ) : !couriers.length ? (
        <div style={{ ...S.card, textAlign: "center", padding: 36, color: C.gray400, fontSize: 13 }}>Nothing packed on {fmtDay(date)} yet.</div>
      ) : (
        <>
          <div style={{ ...S.card, padding: "16px 18px", display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", borderTop: `3px solid ${C.orange}` }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.gray500 }}>Total packed · {fmtDay(data.date)}</div>
              <div style={{ fontSize: 40, fontWeight: 900, color: C.gray900, lineHeight: 1.1 }}>{data.total.packed}</div>
              <div style={{ fontSize: 12.5, color: C.gray500 }}>{data.total.pieces} pieces · {data.total.dispatched} dispatched</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
              <button onClick={() => print("all")} style={btn("primary", "md")}>🖨 Print all (4×6)</button>
              <button onClick={() => print("summary")} style={btn("ghost", "md")}>Summary label</button>
              <button onClick={() => print("couriers")} style={btn("ghost", "md")}>One label per courier</button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 230px), 1fr))", gap: 12 }}>
            {couriers.map((c) => (
              <div key={c.courier} style={{ ...S.card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.gray800 }}>🚚 {c.courier}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 34, fontWeight: 900, color: C.gray900, lineHeight: 1 }}>{c.packed}</span>
                  <span style={{ fontSize: 12.5, color: C.gray500 }}>packed · {c.pieces} pcs</span>
                </div>
                <div style={{ fontSize: 12, color: C.gray500 }}>
                  {c.dispatched} dispatched · scanned {fmtTime(c.first)} – {fmtTime(c.last)}
                </div>
                {c.by_business.length > 1 && (
                  <div style={{ fontSize: 12, color: C.gray600 }}>{c.by_business.map((b) => `${b.business} ${b.packed}`).join(" · ")}</div>
                )}
                <button onClick={() => print(`c:${c.courier}`)} style={{ ...btn("ghost", "sm"), alignSelf: "flex-start", marginTop: 4 }}>🖨 Print label</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
