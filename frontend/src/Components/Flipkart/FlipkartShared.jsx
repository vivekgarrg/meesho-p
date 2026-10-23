import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API, C, S, fmt } from '../../shared';
import { useDateFilter } from '../../contexts/DateFilterContext';
import { PlatformToggle, PLATFORMS } from '../PlatformToggle';

/*
 * Pieces shared by every Flipkart panel (Overview, SKU Analysis, Payments,
 * Orders). Each of those tabs keeps its Meesho view untouched and adds a
 * "Flipkart" view beside it — withPlatformSplit is the one place that decides
 * which of the two renders, so the choice lives in the URL (?platform=flipkart)
 * and a link to the Flipkart view can be shared or bookmarked.
 */

export const FLIPKART_COLOR = PLATFORMS.flipkart.color;

export function usePlatformParam() {
  const [params, setParams] = useSearchParams();
  const platform = params.get('platform') === 'flipkart' ? 'flipkart' : 'meesho';
  const setPlatform = (next) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next === 'flipkart') out.set('platform', 'flipkart');
        else out.delete('platform');
        // Status / view vocabularies differ per marketplace; a stale one would
        // filter the other platform's list to nothing.
        out.delete('status');
        out.delete('view');
        return out;
      },
      { replace: true },
    );
  return [platform, setPlatform];
}

/** A tab that shows the Meesho view by default and the Flipkart view under ?platform=flipkart. */
export function withPlatformSplit(MeeshoView, FlipkartView) {
  return function PlatformSplit() {
    const [platform, setPlatform] = usePlatformParam();
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <PlatformToggle platform={platform} onChange={setPlatform} />
        </div>
        {platform === 'flipkart' ? <FlipkartView /> : <MeeshoView />}
      </div>
    );
  };
}

/**
 * GET a business-scoped Flipkart endpoint, scoped to the global period filter.
 * Keeps the previous result on screen while the next one loads, so paging and
 * filtering don't flash an empty table.
 */
export function useFlipkartApi(path, params = {}) {
  const { range } = useDateFilter();
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([path, params, range, tick]);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    const q = new URLSearchParams();
    if (range.date_from) q.set('date_from', range.date_from);
    if (range.date_to) q.set('date_to', range.date_to);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== '' && v != null) q.set(k, v);
    });
    fetch(`${API}${path}?${q}`, { signal: ctrl.signal })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error || d?.detail || `Request failed (${r.status})`);
        return d;
      })
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((e) => {
        if (e.name !== 'AbortError') setState({ data: null, loading: false, error: e.message });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}

/** "from=…&to=…" for the existing per-SKU endpoint, which takes the period as a query string. */
export function useDateQuery() {
  const { range } = useDateFilter();
  const q = new URLSearchParams();
  if (range.date_from) q.set('date_from', range.date_from);
  if (range.date_to) q.set('date_to', range.date_to);
  return q.toString();
}

// ── Order-report statuses ─────────────────────────────────────────────────────

export const ORDER_STATUS_META = {
  DELIVERED: { label: 'Delivered', color: '#059669', light: '#ECFDF5', border: '#A7F3D0' },
  RETURNED: { label: 'Returned', color: '#E11D48', light: '#FFF1F2', border: '#FECDD3' },
  RETURN_REQUESTED: { label: 'Return requested', color: '#D97706', light: '#FFFBEB', border: '#FDE68A' },
  CANCELLED: { label: 'Cancelled', color: '#64748B', light: '#F1F5F9', border: '#CBD5E1' },
  READY_TO_SHIP: { label: 'Ready to ship', color: '#2563EB', light: '#EFF6FF', border: '#BFDBFE' },
};

// Payment-group outcomes (what the settlement says happened to the order).
export const GROUP_STATUS_META = {
  DELIVERED: ORDER_STATUS_META.DELIVERED,
  RETURN: { label: 'Customer return', color: '#E11D48', light: '#FFF1F2', border: '#FECDD3' },
  RTO: { label: 'RTO (courier return)', color: '#7C3AED', light: '#F5F3FF', border: '#DDD6FE' },
};

const FALLBACK_META = { label: 'Unknown', color: '#94A3B8', light: '#F8FAFC', border: '#E2E8F0' };

export function StatusBadge({ status, metaMap = ORDER_STATUS_META }) {
  const m = metaMap[status] || { ...FALLBACK_META, label: status || FALLBACK_META.label };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 20,
        background: m.light,
        color: m.color,
        border: `1px solid ${m.border}`,
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: '0.03em',
        whiteSpace: 'nowrap',
      }}
    >
      {m.label}
    </span>
  );
}

// ── Layout atoms ──────────────────────────────────────────────────────────────

export const HIDDEN_AMOUNT = '₹ ••••••';

export function Section({ title, subtitle, children, style }) {
  return (
    <div style={{ ...S.card, ...style }}>
      {title && <p style={{ ...S.cardTitle, marginBottom: subtitle ? 4 : 15 }}>{title}</p>}
      {subtitle && <p style={{ fontSize: 11, color: C.gray400, marginBottom: 14 }}>{subtitle}</p>}
      {children}
    </div>
  );
}

export function Kpi({ label, value, sub, color, accent, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        ...S.card,
        padding: '16px 18px',
        borderTop: `3px solid ${accent || color || C.blue}`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <p style={{ fontSize: 10.5, fontWeight: 700, color: C.gray400, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </p>
      <p style={{ fontSize: 21, fontWeight: 800, fontFamily: 'monospace', color: color || C.gray800, lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: C.gray400, marginTop: 5 }}>{sub}</p>}
    </div>
  );
}

/** A row of KPI tiles: equal-width columns, so a short last row doesn't stretch its tiles. */
export function KpiRow({ children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>{children}</div>
  );
}

export function Signed({ value, hidden }) {
  if (hidden) return <span style={{ color: C.gray300, letterSpacing: '0.12em' }}>{HIDDEN_AMOUNT}</span>;
  if (value === null || value === undefined) return <span style={{ color: C.gray300 }}>—</span>;
  const n = Number(value);
  return (
    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: n < 0 ? C.red : n > 0 ? C.green : C.gray400 }}>
      {n > 0 ? '+' : ''}
      {fmt(n)}
    </span>
  );
}

export function EmptyState({ icon = '🛍️', title, children }) {
  return (
    <div style={{ ...S.card, textAlign: 'center', padding: '48px 24px' }}>
      <p style={{ fontSize: 38, marginBottom: 8 }}>{icon}</p>
      <p style={{ fontSize: 15, fontWeight: 800, color: C.gray800, marginBottom: 6 }}>{title}</p>
      <p style={{ fontSize: 12.5, color: C.gray500, maxWidth: 460, margin: '0 auto', lineHeight: 1.55 }}>{children}</p>
    </div>
  );
}

export function ErrorNote({ message }) {
  return (
    <p style={{ fontSize: 12, fontWeight: 600, color: C.red, background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: 8, padding: '8px 12px' }}>
      ⚠ {message}
    </p>
  );
}

export function Pager({ page, pageSize, total, onPage }) {
  if (total <= pageSize) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const btn = (disabled) => ({
    padding: '6px 14px',
    borderRadius: 8,
    border: `1px solid ${C.gray200}`,
    background: C.white,
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    fontFamily: 'inherit',
  });
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderTop: `1px solid ${C.gray100}` }}>
      <span style={{ fontSize: 12, color: C.gray400 }}>
        {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total.toLocaleString('en-IN')}
      </span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} style={btn(page <= 1)}>← Prev</button>
        <span style={{ fontSize: 12, color: C.gray500 }}>{page} / {pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} style={btn(page >= pages)}>Next →</button>
      </div>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ ...S.inp, fontSize: 12, minWidth: 240, width: 'auto' }}
    />
  );
}

/** Debounce a fast-changing value (a search box) before it becomes a request. */
export function useDebounced(value, ms = 350) {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

export function PillFilter({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const active = value === o.value;
        const color = o.color || C.gray700;
        return (
          <button
            key={o.value || 'all'}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              padding: '5px 14px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              background: active ? color : C.white,
              color: active ? '#fff' : color,
              border: `1px solid ${active ? color : C.gray200}`,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
