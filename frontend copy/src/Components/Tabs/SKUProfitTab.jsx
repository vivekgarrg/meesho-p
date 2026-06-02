import { useState, useEffect } from "react";
import { API, C, fmt, S, SKUTable, StatCard } from "../../App";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function SKUProfitTab({summary}) {
    const [data, setData] = useState([]);
    const [unmapped, setUnmapped] = useState([]);
    const [loading, setLoading] = useState(false);
  
    useEffect(() => {
      Promise.all([
        fetch(`${API}/profit/`).then(r => r.json()),
      ]).then(([skus]) => {
        const profitData = skus.sku_wise_profit;
        const prepareData  = Object.keys(profitData).map((key)=>({
          sku_id : key,
          net_profit: profitData[key]["profit"] + profitData[key]["loss"],
          ...profitData[key],
        }))
  
        setData(prepareData.sort((a,b) =>   b.net_profit - a.net_profit) ?? []);
        setLoading(false);
      });
    }, []);
  
    if (loading) return <div style={{ textAlign: "center", padding: 60, color: C.gray400 }}>Loading…</div>;
  
    const totalProfit = data.reduce((a, s) => a + s.net_profit, 0);
    const topSKU = data[0];
    const chartData = data.slice(0, 10);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
          <StatCard label="Total Profit (mapped SKUs)" value={totalProfit} accent={C.green} icon="✅" />
          <StatCard label="Profitable SKUs" value={null} accent={C.green} sub={`${data.filter((a) => a.net_profit > 0).length} SKUs earning profit`} icon="🏷" />
          {topSKU && <StatCard label="Best Performing SKU" value={topSKU.net_profit} accent={C.orange} sub={topSKU.sku_id} icon="🏆" />}
          {/* <StatCard label="Unmapped SKUs" value={null} accent={C.amber} sub={`${unmapped.length} have no pricing`} icon="⚠️" /> */}
        </div>
  
        {chartData.length > 0 && (
          <div style={S.card}>
            <p style={S.cardTitle}>Top 10 SKUs by Net Profit</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.gray100} />
                <XAxis dataKey="sku_id" tick={{ fill: C.gray500, fontSize: 10 }} angle={-30} textAnchor="end" interval={0} tickLine={false} />
                <YAxis tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }} formatter={(v) => fmt(v)} />
                <Bar dataKey="net_profit" radius={[5, 5, 0, 0]} fill={C.green} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
  
        <div style={S.card}>
          <SKUTable data={data} mode="profit" />
        </div>
  
        {unmapped.length > 0 && (
          <div style={{ ...S.card, borderColor: C.orangeBorder, background: C.orangeLight }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: C.orange, marginBottom: 10 }}>
              ⚠️ {unmapped.length} SKUs in orders have no pricing — excluded from profit calculation
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {unmapped.map(u => (
                <span key={u.supplier_sku} title={u.product_name || ""} style={{
                  background: C.white, border: `1px solid ${C.orangeBorder}`,
                  borderRadius: 6, padding: "3px 9px", fontSize: 12, color: C.orange, fontFamily: "monospace",
                }}>{u.supplier_sku}</span>
              ))}
            </div>
            <p style={{ fontSize: 11, color: C.amber, marginTop: 8 }}>Go to ⚙️ SKU Pricing tab to add prices.</p>
          </div>
        )}
      </div>
    );
  }