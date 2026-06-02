import { useEffect, useState } from "react";
import { API, C, S, SKUTable, StatCard } from "../../App";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";


export function SKULossTab() {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
  
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
  
        setData(prepareData.sort((a,b) => a.net_profit - b.net_profit  ) ?? []);
        setLoading(false);
      });
    }, []);
  
    if (loading) return <div style={{ textAlign: "center", padding: 60, color: C.gray400 }}>Loading…</div>;
  
    const totalLoss = data.reduce((a, s) => a + s.loss, 0);
    const worstSKU = data[0];
    const chartData = data.slice(0, 10);
  
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
          <StatCard label="Total Loss (mapped SKUs)" value={totalLoss} accent={C.red} icon="📉" />
          <StatCard label="Loss-making SKUs" value={null} accent={C.red} sub={`${data.filter((a)=> a.loss < 0).length} SKUs in loss`} icon="🏷" />
          {worstSKU && <StatCard label="Worst Performing SKU" value={worstSKU.net_profit} accent={C.red} sub={worstSKU.sku_id} icon="⚠️" />}
          <StatCard label="Avg Loss Per SKU" value={data.length > 0 ? totalLoss / data.filter((a)=> a.loss < 0).length : 0} accent={C.orange} icon="📊" />
        </div>
  
        {chartData.length > 0 && (
          <div style={S.card}>
            <p style={S.cardTitle}>Top 10 Loss-making SKUs</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.gray100} />
                <XAxis dataKey="sku_id" tick={{ fill: C.gray500, fontSize: 10 }} angle={-30} textAnchor="end" interval={0} tickLine={false} />
                <YAxis tick={{ fill: C.gray400, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }} formatter={(v) => fmt(v)} />
                <Bar dataKey="net_profit" radius={[5, 5, 0, 0]} fill={C.red} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
  
        <div style={S.card}>
          <SKUTable data={data} mode="loss" />
        </div>
      </div>
    );
  }