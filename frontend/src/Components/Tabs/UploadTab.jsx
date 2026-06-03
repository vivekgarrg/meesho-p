import { useState } from "react";
import { API, btn, C, S } from "../../App";

export function UploadTab({orders}) {
    const [dragging, setDragging] = useState(false);
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState(null);
    const isOrdersUpload = orders ?? false;
  
    const handleFile = async (file) => {
      if (!file) return;
      setLoading(true); setMsg(null);
      const fd = new FormData(); fd.append("file", file);
      try {
        const res = await fetch(isOrdersUpload ? `${API}/upload-orders/` : `${API}/upload/`, { method: "POST", body: fd });
        const d = await res.json();
       
        if (res.ok) setMsg({ type: "ok", data: isOrdersUpload ? d : d.results });
        else setMsg({ type: "err", text: d.error || "Upload failed" });
      } catch(err)
      { 
        setMsg({ type: "err", text: "Network error — is Django running on port 8000?" }); 
        console.error(err, "~err")
        }
      setLoading(false);
    };
  
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
          style={{
            border: `2px dashed ${dragging ? C.orange : C.gray300}`,
            borderRadius: 16, padding: "52px 32px", textAlign: "center",
            background: dragging ? C.orangeLight : C.gray50,
            transition: "all 0.2s", cursor: "pointer",
          }}
        >
          <div style={{ fontSize: 52, marginBottom: 14 }}>📊</div>
          <p style={{ fontSize: 17, fontWeight: 600, color: C.gray700, marginBottom: 6 }}>Drop Meesho {isOrdersUpload ? "CSV" : "Excel"} report here</p>
          <p style={{ fontSize: 13, color: C.gray400, marginBottom: 22 }}>{isOrdersUpload ? "Orders*.csv" : "SP_ORDER_ADS_REFERRAL_PAYMENT_FILE_*.xlsx"}</p>
          <label style={{ ...btn("primary"), display: "inline-block", cursor: "pointer" }}>
            {loading ? "Uploading…" : "Choose File"}
            <input type="file" accept={isOrdersUpload ? ".csv" : ".xlsx,.xls"} style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} disabled={loading} />
          </label>
  
          {msg && msg.type === "ok" && (
            <div style={{ marginTop: 24, background: C.greenLight, border: `1px solid ${C.greenBorder}`, borderRadius: 10, padding: 16, textAlign: "left" }}>
              <p style={{ color: C.green, fontWeight: 700, marginBottom: 8 }}>✓ Upload successful — data injected into DB</p>
              {Object?.entries(msg.data).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${C.greenBorder}`, fontSize: 13 }}>
                  <span style={{ color: C.gray600, fontWeight: 600 }}>{k} {isOrdersUpload && `: ${v}`}</span>
                  {!isOrdersUpload && <span style={{ color: C.green, fontFamily: "monospace" }}>{Object.entries(v).map(([kk, vv]) => `${kk}: ${vv}`).join(", ")}</span>}
                </div>
              ))}
            </div>
          )}
          {msg && msg.type === "err" && (
            <div style={{ marginTop: 16, background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: 8, padding: "10px 14px" }}>
              <p style={{ color: C.red, fontSize: 13 }}>❌ {msg.text}</p>
            </div>
          )}
        </div>
  
        {/* Mapping table */}
      {!isOrdersUpload &&  <div style={S.card}>
          <p style={S.cardTitle}>Excel Sheet → MySQL Table Mapping</p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={S.th}>Excel Sheet</th>
                <th style={S.th}>MySQL Table</th>
                <th style={S.th}>Primary Key</th>
                <th style={S.th}>Behaviour on Re-upload</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Order Payments", "order_payments", "sub_order_no", "Update existing rows (safe to re-upload)"],
                ["Ads Cost", "ads_cost", "id (auto-increment)", "Always inserts new rows"],
                ["Referral Payments", "referral_payments", "reward_id", "Update existing rows"],
                ["Compensation & Recovery", "compensation_recovery", "id (auto-increment)", "Always inserts new rows"],
              ].map(([a, b, c, d_], i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? C.white : C.gray50 }}>
                  <td style={{ ...S.td, color: C.orange, fontWeight: 600 }}>{a}</td>
                  <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>{b}</td>
                  <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12, color: C.blue }}>{c}</td>
                  <td style={{ ...S.td, color: C.gray500 }}>{d_}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      </div>
    );
  }