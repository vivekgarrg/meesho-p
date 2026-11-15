import React from "react";
import { useSearchParams } from "react-router-dom";
import { C } from "../../shared";

/*
 * Sub-tabs of one page, kept in the URL (?<param>=<key>) so a tab can be linked,
 * bookmarked and survives a reload. The first tab is the default and leaves the
 * URL clean. Only the open tab is rendered, so only its data is fetched.
 */

export function useTabParam(param, keys) {
  const [params, setParams] = useSearchParams();
  const asked = params.get(param);
  const value = keys.includes(asked) ? asked : keys[0];
  const setValue = (next) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next === keys[0]) out.delete(param);
        else out.set(param, next);
        return out;
      },
      { replace: true },
    );
  return [value, setValue];
}

/**
 * tabs: [{ key, label, icon?, count?, color?, hidden? }]. A hidden tab isn't shown
 * (e.g. the user has no access to it) and can't be chosen.
 */
export function SubTabs({ tabs, value, onChange, right, style }) {
  const shown = tabs.filter((t) => !t.hidden);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", ...style }}>
      <div
        role="tablist"
        style={{
          display: "flex", gap: 4, padding: 4, borderRadius: 12, background: C.gray100,
          overflowX: "auto", maxWidth: "100%", WebkitOverflowScrolling: "touch",
        }}
      >
        {shown.map((t) => {
          const on = t.key === value;
          const color = t.color || C.orange;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              type="button"
              onClick={() => onChange(t.key)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                padding: "7px 14px", border: "none", borderRadius: 9, cursor: "pointer",
                fontSize: 13, fontWeight: on ? 800 : 600, fontFamily: "inherit",
                background: on ? "#fff" : "transparent",
                color: on ? color : C.gray500,
                boxShadow: on ? "0 1px 3px rgba(15,23,42,0.12)" : "none",
              }}
            >
              {t.icon && <span aria-hidden>{t.icon}</span>}
              {t.label}
              {t.count != null && (
                <span
                  style={{
                    minWidth: 20, padding: "1px 6px", borderRadius: 99, fontSize: 11, fontWeight: 800,
                    background: on ? color : C.gray200, color: on ? "#fff" : C.gray600,
                  }}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}

/** A page made of sub-tabs: the bar, then the open tab's own component. */
export function TabbedPage({ param = "section", tabs, right, header }) {
  const visible = tabs.filter((t) => !t.hidden);
  const [value, setValue] = useTabParam(param, visible.map((t) => t.key));
  const current = visible.find((t) => t.key === value);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {header}
      {(visible.length > 1 || right) && <SubTabs tabs={visible} value={value} onChange={setValue} right={right} />}
      <React.Suspense fallback={<TabLoading />}>
        {current && <current.Component key={current.key} />}
      </React.Suspense>
    </div>
  );
}

function TabLoading() {
  return <div style={{ padding: 40, textAlign: "center", color: C.gray400, fontSize: 13, fontWeight: 600 }}>Loading…</div>;
}
