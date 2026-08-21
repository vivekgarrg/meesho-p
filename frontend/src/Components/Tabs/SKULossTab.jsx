import { useEffect, useState } from "react";
import { API, C, S, SKUTable, StatCard, fmt } from "../../App";
import { AppBarChart } from "../Charts/AppBarChart";


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
            <AppBarChart
              dataset={chartData}
              indexKey="sku_id"
              series={[{ dataKey: "net_profit", label: "Net P&L", color: C.red }]}
              height={220}
              valueFormatter={fmt}
            />
          </div>
        )}
  
        <div style={S.card}>
          <SKUTable data={data} mode="loss" />
        </div>
      </div>
    );
  }