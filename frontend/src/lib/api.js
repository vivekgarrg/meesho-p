import { PAGE_SIZE } from "./helper";

export const API_BASE = "/api";

function buildQuery(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v !== null && v !== undefined) q.set(k, v);
  });
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const api = {
  // ── Payments (OrderPayment / settlements) ─────────────────────────
  payments({ page = 1, pageSize = PAGE_SIZE, status = "", sku = "", dateFrom = "", dateTo = "" } = {}) {
    return fetch(
      `${API_BASE}/orders/${buildQuery({ page, page_size: pageSize, status, sku, date_from: dateFrom, date_to: dateTo })}`
    ).then((r) => r.json());
  },

  // ── Full Orders (Order model — full lifecycle) ─────────────────────
  orders({ page = 1, pageSize = PAGE_SIZE, status = "", sku = "", dateFrom = "", dateTo = "" } = {}) {
    return fetch(
      `${API_BASE}/full-orders/${buildQuery({ page, page_size: pageSize, status, sku, date_from: dateFrom, date_to: dateTo })}`
    ).then((r) => r.json());
  },

  ordersAnalytics({ dateFrom = "", dateTo = "" } = {}) {
    return fetch(
      `${API_BASE}/full-orders/analytics/${buildQuery({ date_from: dateFrom, date_to: dateTo })}`
    ).then((r) => r.json());
  },

  // ── Dashboard (Orders + Payments joined) ─────────────────────────
  dashboard({ dateFrom = "", dateTo = "" } = {}) {
    return fetch(
      `${API_BASE}/dashboard/${buildQuery({ date_from: dateFrom, date_to: dateTo })}`
    ).then((r) => r.json());
  },

  // ── Profit / Overview ────────────────────────────────────────────
  profit() {
    return fetch(`${API_BASE}/profit/`).then((r) => r.json());
  },

  statusBreakdown() {
    return fetch(`${API_BASE}/orders/status-breakdown/`).then((r) => r.json());
  },
};
