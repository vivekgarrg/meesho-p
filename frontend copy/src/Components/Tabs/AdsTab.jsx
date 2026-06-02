export function AdsTab() {
    const [data, setData] = useState(null);
    useEffect(() => { fetch(`${API}/ads/summary/`).then(r => r.json()).then(setData); }, []);
    if (!data) return <div style={{ textAlign: "center", padding: 60, color: C.gray400 }}>Loading…</div>;
  
    const items = [
      { label: "Ads Cost (total)", value: data.ads_total, color: C.orange, icon: "📣" },
      { label: "Ads GST", value: data.ads_gst, color: C.amber, icon: "🏛" },
      { label: "TCS Deducted", value: data.tcs_total, color: C.blue, icon: "📋" },
      { label: "TDS Deducted", value: data.tds_total, color: C.blue, icon: "📋" },
      { label: "Commission (incl. GST)", value: data.commission_total, color: C.red, icon: "%" },
      { label: "Gold Platform Fee", value: data.gold_fee_total, color: C.amber, icon: "⭐" },
      { label: "Mall Platform Fee", value: data.mall_fee_total, color: C.amber, icon: "🏪" },
      { label: "Shipping Charges", value: data.shipping_total, color: C.orange, icon: "🚚" },
      { label: "Return Shipping", value: data.return_shipping_total, color: C.red, icon: "↩" },
      { label: "Warehousing", value: data.warehousing_total, color: C.gray500, icon: "🏭" },
      { label: "Comp / Recovery", value: data.compensation_recovery_total, color: C.blue, icon: "💼" },
    ];
  
    const totalDeducted = items.reduce((a, i) => a + Math.abs(Number(i.value || 0)), 0);
    const pieData = items.filter(i => Math.abs(Number(i.value || 0)) > 0.01).map(i => ({ name: i.label, value: Math.abs(Number(i.value || 0)) }));
  
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Hero */}
        <div style={{
          background: `linear-gradient(135deg, ${C.redLight} 0%, ${C.white} 70%)`,
          border: `1px solid ${C.redBorder}`, borderRadius: 14,
          padding: "24px 28px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16,
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>TOTAL DEDUCTIONS THIS PERIOD</p>
            <p style={{ fontSize: 40, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: C.red }}>{fmt(totalDeducted)}</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Referral Income (credit)</p>
            <p style={{ fontSize: 28, fontWeight: 800, color: C.green, fontFamily: "monospace" }}>{fmt(data.referral_income)}</p>
          </div>
        </div>
  
        {/* Cards grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          {items.map(item => (
            <div key={item.label} style={{
              background: C.white, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: "14px 16px", borderLeft: `4px solid ${item.color}`,
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}>
              <p style={{ fontSize: 11, color: C.gray400, marginBottom: 5 }}>{item.icon} {item.label}</p>
              <p style={{ fontSize: 18, fontWeight: 700, color: C.gray800, fontFamily: "monospace" }}>{fmt(item.value)}</p>
            </div>
          ))}
        </div>
  
        {/* Charts */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={S.card}>
            <p style={S.cardTitle}>Deduction Distribution</p>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="48%" outerRadius={92} dataKey="value" paddingAngle={2}
                  label={({ percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={{ stroke: C.gray300 }}>
                  {pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Legend iconSize={10} formatter={(v) => <span style={{ fontSize: 11, color: C.gray600 }}>{v}</span>} />
                <Tooltip contentStyle={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8 }} formatter={fmt} />
              </PieChart>
            </ResponsiveContainer>
          </div>
  
          <div style={S.card}>
            <p style={S.cardTitle}>Ads Campaigns</p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={S.th}>Campaign ID</th>
                    <th style={S.th}>Date</th>
                    <th style={{ ...S.th, textAlign: "right" }}>Total Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.ads_by_campaign || []).map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? C.white : C.gray50 }}>
                      <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>{r.campaign_id || "—"}</td>
                      <td style={{ ...S.td, color: C.gray500 }}>{r.deduction_date || "—"}</td>
                      <td style={{ ...S.td, textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: C.red }}>{fmt(r.cost)}</td>
                    </tr>
                  ))}
                  {(data.ads_by_campaign || []).length === 0 && (
                    <tr><td colSpan={3} style={{ ...S.td, textAlign: "center", color: C.gray400, padding: 24 }}>No ad campaigns</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }