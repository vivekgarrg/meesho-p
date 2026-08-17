import React, { useState, useEffect, useCallback } from "react";
import { API, C, S, btn, Tag, fmt, useIsMobile } from "../../App";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import InventoryIcon from "@mui/icons-material/Inventory2Outlined";
import { CircularProgress } from "@mui/material";
import { field, scrollRow, Metric } from "./TeamTasksShared";
import { ProductDetailDialog } from "./ProductDetailDialog";

function NewProductForm({ onCancel, onCreate }) {
  const isMobile = useIsMobile();
  const [name, setName] = useState("");
  const [parentSkuId, setParentSkuId] = useState("");
  const [size, setSize] = useState("");
  const [weight, setWeight] = useState("");
  const [description, setDescription] = useState("");
  const [parentSkus, setParentSkus] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`${API}/parent-prices/`).then(r => r.ok ? r.json() : null)
      .then(d => setParentSkus(d?.results || [])).catch(() => {});
  }, []);

  const submit = async () => {
    if (!name.trim()) return setErr("Give the product a name.");
    if (!parentSkuId.trim()) return setErr("Pick or type a parent SKU.");
    const isExisting = parentSkus.some((p) => p.item_id === parentSkuId.trim());
    const body = {
      name: name.trim(), size, weight, description,
      ...(isExisting ? { parent_sku_item_id: parentSkuId.trim() } : { parent_sku_name: parentSkuId.trim() }),
    };
    const e = await onCreate(body);
    if (e) setErr(e);
  };

  return (
    <div style={{ ...S.card, borderTop: `4px solid ${C.orange}`, padding: isMobile ? 15 : 22 }}>
      <div style={{ ...S.cardTitle, marginBottom: 14 }}>New product</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <div>
          <label style={S.label}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={field(isMobile)}
            placeholder="e.g. Brass Kalash" />
        </div>
        <div>
          <label style={S.label}>Parent SKU</label>
          <input list="new-product-parent-skus" value={parentSkuId}
            onChange={(e) => setParentSkuId(e.target.value)} style={field(isMobile, { fontFamily: "monospace" })}
            placeholder="Pick existing, or type a new one" />
          <datalist id="new-product-parent-skus">
            {parentSkus.map((p) => <option key={p.item_id} value={p.item_id} />)}
          </datalist>
        </div>
        <div>
          <label style={S.label}>Size</label>
          <input value={size} onChange={(e) => setSize(e.target.value)} style={field(isMobile)}
            placeholder="e.g. Medium" />
        </div>
        <div>
          <label style={S.label}>Weight</label>
          <input value={weight} onChange={(e) => setWeight(e.target.value)} style={field(isMobile)}
            placeholder="e.g. 250g" />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={S.label}>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
            style={field(isMobile, { resize: "vertical" })} />
        </div>
      </div>
      {err && (
        <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: C.redLight,
          border: `1px solid ${C.redBorder}`, color: C.red, fontSize: 13, fontWeight: 600 }}>{err}</div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={submit} style={{ ...btn("primary", "md"), flex: isMobile ? 1 : "none" }}>
          Create — add photos next
        </button>
        <button onClick={onCancel} style={{ ...btn("ghost", "md"), flex: isMobile ? 1 : "none" }}>Cancel</button>
      </div>
    </div>
  );
}

function ProductCard({ product, onOpen }) {
  const cover = (product.photos || [])[0];
  return (
    <div onClick={onOpen} style={{ ...S.card, padding: 0, overflow: "hidden", cursor: "pointer",
      display: "flex", flexDirection: "column" }}>
      <div style={{ width: "100%", aspectRatio: "1.4", background: C.gray100,
        display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {cover ? (
          <img src={cover.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <InventoryIcon style={{ fontSize: 34, color: C.gray300 }} />
        )}
      </div>
      <div style={{ padding: 13, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.gray900, lineHeight: 1.3 }}>{product.name}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Tag variant="blue" fontSize={10}>{product.parent_sku_item_id}</Tag>
          {(product.size || product.weight) && (
            <Tag variant="gray" fontSize={10}>{[product.size, product.weight].filter(Boolean).join(" · ")}</Tag>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          marginTop: 4, fontSize: 12 }}>
          <span style={{ color: C.gray500 }}>{product.sku_count} SKU{product.sku_count === 1 ? "" : "s"}</span>
          <span style={{ fontFamily: "monospace", fontWeight: 800, color: C.green }}>{fmt(product.total_paid)}</span>
        </div>
        {product.pending_count > 0 && (
          <div style={{ fontSize: 11, fontWeight: 700, color: C.amber }}>
            {product.pending_count} waiting for review
          </div>
        )}
      </div>
    </div>
  );
}

export function ProductsPanel({ isAdmin, busy, setBusy, setMsg, post }) {
  const isMobile = useIsMobile();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (search.trim()) p.set("search", search.trim());
      const res = await fetch(`${API}/products/?${p}`);
      const d = await res.json();
      setProducts(d.results || []);
    } finally { setLoading(false); }
  }, [search]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const totals = React.useMemo(() => products.reduce((acc, p) => ({
    product_count: acc.product_count + 1,
    sku_count: acc.sku_count + (p.sku_count || 0),
    total_paid: acc.total_paid + Number(p.total_paid || 0),
    pending_value: acc.pending_value + Number(p.pending_value || 0),
  }), { product_count: 0, sku_count: 0, total_paid: 0, pending_value: 0 }), [products]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 0 }}>
          <SearchIcon style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
            fontSize: 17, color: C.gray400, pointerEvents: "none" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products / parent SKU…"
            style={field(isMobile, { paddingLeft: 34, width: "100%", boxSizing: "border-box" })} />
        </div>
        {isAdmin && (
          <button onClick={() => setCreating(c => !c)}
            style={{ ...btn("primary", "sm"), padding: isMobile ? "10px 14px" : undefined, flexShrink: 0 }}>
            <AddIcon style={{ fontSize: 16, verticalAlign: "-4px" }} />&nbsp;New product
          </button>
        )}
      </div>

      {products.length > 0 && (
        <div style={scrollRow}>
          <Metric label="products" value={totals.product_count} accent={C.blue} />
          <Metric label="SKUs generated" value={totals.sku_count} accent={C.gray700} />
          <Metric label="total paid" value={totals.total_paid} accent={C.green} money />
          <Metric label="pending" value={totals.pending_value} accent={C.orange} money />
        </div>
      )}

      {creating && isAdmin && (
        <NewProductForm onCancel={() => setCreating(false)}
          onCreate={async (body) => {
            const { data, error } = await post(`${API}/products/`, body);
            if (error) return error;
            setMsg({ type: "success", text: "Product created." });
            setCreating(false); fetchProducts();
            setOpenId(data.id);
            return null;
          }} />
      )}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <CircularProgress style={{ color: C.orange }} />
        </div>
      ) : products.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: 40, color: C.gray400, fontSize: 13.5 }}>
          {isAdmin ? "No products yet — create one and link a bulk listing batch to it."
                   : "No products yet."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 150 : 200}px, 1fr))`, gap: 12 }}>
          {products.map((p) => (
            <ProductCard key={p.id} product={p} onOpen={() => setOpenId(p.id)} />
          ))}
        </div>
      )}

      {openId != null && (
        <ProductDetailDialog productId={openId} isAdmin={isAdmin} busy={busy} setBusy={setBusy}
          setMsg={setMsg} post={post} onClose={() => setOpenId(null)} onChanged={fetchProducts} />
      )}
    </div>
  );
}
