import React, { useState, useEffect, useRef, useCallback } from "react";
import { API, C, S, btn, SectionHeader, Tag } from "../../App";
import DownloadIcon from "@mui/icons-material/Download";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import InventoryIcon from "@mui/icons-material/Inventory";
import SearchIcon from "@mui/icons-material/Search";
import SaveIcon from "@mui/icons-material/Save";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { CircularProgress, Tooltip } from "@mui/material";

const PAGE_SIZE = 50;

function StatPill({ label, value, accent }) {
  return (
    <div style={{
      background: C.white, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "14px 22px",
      borderTop: `3px solid ${accent}`,
      display: "flex", flexDirection: "column", gap: 4, minWidth: 140,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</span>
      <span style={{ fontSize: 26, fontWeight: 800, color: C.gray800, fontFamily: "monospace" }}>{value ?? "—"}</span>
    </div>
  );
}

export function MeeshoInventoryTab() {
  const [items, setItems]           = useState([]);
  const [total, setTotal]           = useState(0);
  const [lowCount, setLowCount]     = useState(0);
  const [loading, setLoading]       = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [activeTab, setActiveTab]   = useState("low"); // "all" | "low"
  const [search, setSearch]         = useState("");
  const [page, setPage]             = useState(1);
  const [uploadMsg, setUploadMsg]   = useState(null); // {type, text}
  const [edits, setEdits]           = useState({});   // {id: value}
  const [savedIds, setSavedIds]     = useState(new Set());
  const fileRef                     = useRef();
  const [dragging, setDragging]     = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeTab === "low") params.set("low_stock", "1");
      if (search.trim())       params.set("q", search.trim());
      const res  = await fetch(`${API}/meesho-inventory/?${params}`);
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total ?? 0);
      setLowCount(data.low_stock_count ?? 0);
    } finally {
      setLoading(false);
    }
  }, [activeTab, search]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setPage(1); }, [activeTab, search]);

  const handleFile = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    setUploadMsg(null);
    try {
      const res  = await fetch(`${API}/meesho-inventory/upload/`, { method: "POST", body: form });
      const data = await res.json();
      if (data.success) {
        setUploadMsg({ type: "success", text: `Uploaded — ${data.created} new, ${data.updated} updated, ${data.skipped} skipped.` });
        setEdits({});
        setSavedIds(new Set());
        fetchData();
      } else {
        setUploadMsg({ type: "error", text: data.error || "Upload failed." });
      }
    } catch {
      setUploadMsg({ type: "error", text: "Network error during upload." });
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    const pending = Object.entries(edits).map(([id, val]) => ({
      id: Number(id),
      seller_stock_count: val === "" ? null : Number(val),
    }));
    if (!pending.length) return;
    setSaving(true);
    try {
      const res  = await fetch(`${API}/meesho-inventory/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending),
      });
      const data = await res.json();
      setSavedIds(prev => {
        const next = new Set(prev);
        pending.forEach(p => next.add(p.id));
        return next;
      });
      setEdits({});
      setUploadMsg({ type: "success", text: `Saved ${data.updated} stock update(s).` });
      fetchData();
    } catch {
      setUploadMsg({ type: "error", text: "Failed to save changes." });
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    window.location.href = `${API}/meesho-inventory/download/`;
  };

  // Pagination slice
  const pageItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));

  const stockColor = (n) => {
    if (n === 0)   return C.red;
    if (n < 20)    return "#E11D48";
    if (n < 50)    return C.amber;
    if (n < 100)   return "#D97706";
    return C.green;
  };

  const pendingCount = Object.keys(edits).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <InventoryIcon style={{ color: C.orange, fontSize: 22 }} />
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.gray800 }}>Meesho Inventory</h1>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {pendingCount > 0 && (
            <button onClick={handleSave} disabled={saving} style={btn("success", "md")}>
              {saving ? <CircularProgress size={14} style={{ color: "#fff" }} /> : <SaveIcon style={{ fontSize: 16 }} />}
              &nbsp;Save {pendingCount} change{pendingCount !== 1 ? "s" : ""}
            </button>
          )}
          <button onClick={handleDownload} style={btn("ghostOrange", "md")}>
            <DownloadIcon style={{ fontSize: 16 }} />&nbsp;Download Excel
          </button>
        </div>
      </div>

      {/* ── Upload card ── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? C.orange : C.gray200}`,
          borderRadius: 14, padding: "28px 20px",
          background: dragging ? C.orangeLight : C.gray50,
          textAlign: "center", cursor: "pointer",
          transition: "border-color 0.15s, background 0.15s",
        }}
      >
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files[0])} />
        {uploading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <CircularProgress size={20} style={{ color: C.orange }} />
            <span style={{ color: C.gray500, fontSize: 14 }}>Uploading…</span>
          </div>
        ) : (
          <>
            <UploadFileIcon style={{ fontSize: 36, color: C.gray300, marginBottom: 6 }} />
            <p style={{ fontSize: 14, fontWeight: 600, color: C.gray600 }}>Drop Meesho Inventory Excel here, or click to browse</p>
            <p style={{ fontSize: 12, color: C.gray400, marginTop: 4 }}>Supports .xlsx / .xls / .csv — matches Meesho stock upload format</p>
          </>
        )}
      </div>

      {/* ── Upload message ── */}
      {uploadMsg && (
        <div style={{
          padding: "12px 18px", borderRadius: 10, fontSize: 13, fontWeight: 500,
          background: uploadMsg.type === "success" ? C.greenLight : C.redLight,
          color:      uploadMsg.type === "success" ? C.green       : C.red,
          border: `1px solid ${uploadMsg.type === "success" ? C.greenBorder : C.redBorder}`,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          {uploadMsg.type === "success"
            ? <CheckCircleIcon style={{ fontSize: 18 }} />
            : <WarningAmberIcon style={{ fontSize: 18 }} />}
          {uploadMsg.text}
          <button onClick={() => setUploadMsg(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16 }}>×</button>
        </div>
      )}

      {/* ── Stats ── */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <StatPill label="Total Products"   value={total}    accent={C.orange} />
        <StatPill label="Low Stock (<100)" value={lowCount} accent={C.amber} />
        <StatPill label="Zero Stock"       value={items.filter(i => i.system_stock_count === 0).length || (activeTab === "all" ? undefined : undefined)} accent={C.red} />
      </div>

      {/* ── Tab switcher + search ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 4, background: C.gray100, borderRadius: 10, padding: 4 }}>
          {[
            { id: "low", label: `⚠ Low Stock (<100)`, count: lowCount },
            { id: "all", label: "All Products",        count: total },
          ].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              ...btn(activeTab === t.id ? "primary" : "ghost", "sm"),
              borderRadius: 8,
              background: activeTab === t.id ? C.orange : "transparent",
              color:      activeTab === t.id ? "#fff"   : C.gray600,
              border: "none",
            }}>
              {t.label}&nbsp;
              <span style={{
                background: activeTab === t.id ? "rgba(255,255,255,0.25)" : C.gray200,
                color: activeTab === t.id ? "#fff" : C.gray500,
                borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700,
              }}>{t.count}</span>
            </button>
          ))}
        </div>

        <div style={{ position: "relative", minWidth: 260 }}>
          <SearchIcon style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 18, color: C.gray400 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search catalog / product / style…"
            style={{ ...S.inp, paddingLeft: 34 }}
          />
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
            <CircularProgress style={{ color: C.orange }} />
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["#", "Catalog", "Product / Style ID", "Variation", "Stock Type", "System Stock", "Your Stock Count"].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageItems.length === 0 ? (
                    <tr><td colSpan={7} style={{ ...S.td, textAlign: "center", padding: 48, color: C.gray400 }}>
                      {total === 0 ? "No inventory data — upload a Meesho inventory sheet to get started" : "No results matching your search"}
                    </td></tr>
                  ) : pageItems.map((item, idx) => {
                    const globalIdx = (page - 1) * PAGE_SIZE + idx;
                    const rowBg     = globalIdx % 2 === 0 ? C.white : C.gray50;
                    const sysStock  = item.system_stock_count ?? 0;
                    const editVal   = edits[item.id];
                    const isSaved   = savedIds.has(item.id);
                    const hasEdit   = editVal !== undefined;
                    const displaySeller = hasEdit ? editVal : (item.seller_stock_count ?? "");

                    return (
                      <tr key={item.id} style={{ background: rowBg }}>
                        <td style={{ ...S.td, color: C.gray400, fontSize: 11, width: 40 }}>{item.serial_no}</td>

                        {/* Catalog */}
                        <td style={{ ...S.td, maxWidth: 180 }}>
                          <div style={{ fontWeight: 600, color: C.gray700, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170 }}
                            title={item.catalog_name}>
                            {item.catalog_name}
                          </div>
                          <div style={{ fontSize: 10, color: C.gray400, fontFamily: "monospace" }}>{item.catalog_id}</div>
                        </td>

                        {/* Product / Style */}
                        <td style={{ ...S.td, maxWidth: 260 }}>
                          <div style={{ fontSize: 12, color: C.gray700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 250 }}
                            title={item.product_name}>
                            {item.product_name}
                          </div>
                          <div style={{ fontSize: 10, fontFamily: "monospace", color: C.orange, background: C.orangeLight, display: "inline-block", padding: "1px 5px", borderRadius: 4, marginTop: 2 }}>
                            {item.style_id}
                          </div>
                        </td>

                        {/* Variation */}
                        <td style={S.td}>
                          <Tag variant="gray">{item.variation || "Free Size"}</Tag>
                        </td>

                        {/* Stock type */}
                        <td style={S.td}>
                          <Tag variant={item.stock_type === "IN_STOCK" ? "green" : item.stock_type === "OUT_OF_STOCK" ? "red" : "gray"}>
                            {item.stock_type}
                          </Tag>
                        </td>

                        {/* System stock */}
                        <td style={S.td}>
                          <span style={{
                            fontFamily: "monospace", fontWeight: 700, fontSize: 14,
                            color: stockColor(sysStock),
                          }}>
                            {sysStock.toLocaleString()}
                          </span>
                          {sysStock < 100 && (
                            <WarningAmberIcon style={{ fontSize: 14, color: C.amber, marginLeft: 4, verticalAlign: "middle" }} />
                          )}
                        </td>

                        {/* Editable seller stock */}
                        <td style={{ ...S.td, width: 160 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input
                              type="number"
                              min={0}
                              value={displaySeller}
                              placeholder="—"
                              onChange={e => {
                                setEdits(prev => ({ ...prev, [item.id]: e.target.value }));
                                setSavedIds(prev => { const s = new Set(prev); s.delete(item.id); return s; });
                              }}
                              style={{
                                ...S.inp, width: 90, padding: "6px 10px", fontSize: 13,
                                fontFamily: "monospace", fontWeight: 600,
                                borderColor: hasEdit ? C.orange : C.gray200,
                                background: hasEdit ? C.orangeLight : C.white,
                              }}
                            />
                            {isSaved && !hasEdit && (
                              <Tooltip title="Saved">
                                <CheckCircleIcon style={{ fontSize: 16, color: C.green }} />
                              </Tooltip>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {items.length > PAGE_SIZE && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderTop: `1px solid ${C.gray100}` }}>
                <span style={{ fontSize: 12, color: C.gray400 }}>
                  {Math.min((page - 1) * PAGE_SIZE + 1, items.length)}–{Math.min(page * PAGE_SIZE, items.length)} of {items.length}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setPage(p => p - 1)} disabled={page === 1} style={{ ...btn("ghost", "sm"), opacity: page === 1 ? 0.4 : 1 }}>← Prev</button>
                  <span style={{ fontSize: 12, color: C.gray500, padding: "0 6px", alignSelf: "center" }}>Page {page} / {totalPages}</span>
                  <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages} style={{ ...btn("ghost", "sm"), opacity: page >= totalPages ? 0.4 : 1 }}>Next →</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Sticky save bar ── */}
      {pendingCount > 0 && (
        <div style={{
          position: "fixed", bottom: 24, right: 32,
          background: C.orange, color: "#fff",
          borderRadius: 14, padding: "14px 24px",
          boxShadow: "0 8px 24px rgba(109,40,217,0.35)",
          display: "flex", alignItems: "center", gap: 14, zIndex: 999,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{pendingCount} unsaved change{pendingCount !== 1 ? "s" : ""}</span>
          <button onClick={handleSave} disabled={saving} style={{
            background: "#fff", color: C.orange, border: "none",
            borderRadius: 8, padding: "7px 18px", fontWeight: 700,
            cursor: "pointer", fontSize: 13, fontFamily: "inherit",
          }}>
            {saving ? "Saving…" : "Save All"}
          </button>
          <button onClick={() => setEdits({})} style={{
            background: "rgba(255,255,255,0.15)", color: "#fff", border: "none",
            borderRadius: 8, padding: "7px 12px", cursor: "pointer",
            fontSize: 13, fontFamily: "inherit",
          }}>Discard</button>
        </div>
      )}
    </div>
  );
}
