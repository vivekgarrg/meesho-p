import React, { useState } from 'react'
import { C, fmt, S, Tag } from '../../App'

export default function TableData({ mainKey, data, dataKey, color = "amber", profit = false, showTotalData: show, claims }) {
    const [showTotalData, setTotalData] = useState(false);

    const handleMouseOver = () => {
        if (show) {
            setTotalData(true)
        }
    }
    const handleMouseLeave = () => {
        setTotalData(false)
    }

    const capitalKey = dataKey.toUpperCase();
    const profitLossKey = profit ? "profit" : "loss";

    const claimData = claims ? `CLAIMS SETTLED : ${fmt(data?.["claims_settled"] ?? 0)}` : `TOTAL ${capitalKey} : ${data?.[dataKey] ?? 0}`


    return (
        <td style={{ ...S.td, textAlign: "right", position: "relative" }} onMouseEnter={handleMouseOver} onMouseLeave={handleMouseLeave}>
            <div
                style={{
                    minWidth: "auto",
                    maxWidth: "500%",
                    height: "auto",
                    padding: "1rem",
                    border: `1px solid ${C.blueLight}`,
                    boxShadow: `2px 5px 3px ${C.gray300}`,
                    borderRadius: "8px",
                    position: "absolute",
                    right: "50%",
                    top: "50%",
                    display: showTotalData ? "flex" : "none",
                    alignItems: "center", justifyContent: "center",
                    flexDirection: "column",
                    borderTopRightRadius: "0%",
                    gap: 8,
                    backgroundColor: C.surface,
                    zIndex: 1000,
                }}>
                <Tag variant={"a"}> {claimData}</Tag>
                <Tag variant={"g"}> {capitalKey} : {mainKey ?? 0}</Tag>
                <Tag variant={"c"}>PACKAGING COST : {fmt(data?.[`${dataKey}_packaging_cost`] ?? 0)}</Tag>
                <Tag variant={"d"}>PURCHASE COST : {fmt(data?.[`${dataKey}_purchase_cost`] ?? 0)}</Tag>
                <Tag variant={"f"}>QUANTITY : {data?.[`${dataKey}_quantity`] ?? 0}</Tag>
                <div style={{ margin: "8px 0px", width: "100%", border: `1px solid ${C.gray300}` }}></div>

                <Tag variant={profit ? "b" : "e"}>{profitLossKey.toLocaleUpperCase()} : {fmt(data?.[`${dataKey}_${profitLossKey}`] ?? 0)}</Tag>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>

                <Tag variant={mainKey > 0 ? color : "gray"}>{mainKey} {capitalKey}</Tag>
                {mainKey > 0 && (
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: C?.[color], fontWeight: 600 }}>
                        {fmt(data?.[`${dataKey}_${profitLossKey}`])}
                    </span>
                )}
            </div>
        </td>
    )
}
