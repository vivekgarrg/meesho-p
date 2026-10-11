/**
 * Generic-but-careful merge of the same endpoint's JSON from 2+ businesses
 * into one, for tabs that want to show combined numbers when the global
 * "Combined" toggle is on and 2+ businesses are ticked (see
 * CombinedViewContext). The goal is a merged object with the *same shape* as
 * a single business's response, so a tab's existing rendering code needs no
 * changes — only its data-fetching effect does.
 *
 * Numbers are summed. Plain arrays of primitives (e.g. `packaging_statuses`,
 * `missing_sku`) are concatenated and deduped — read as "every status/SKU
 * this applies to across the businesses shown", which stays honest even when
 * two businesses' policies differ (business A charging packaging on RETURN
 * only and B also on RTO correctly shows both, since the merged cost total
 * already reflects each business's own policy; hiding either from the label
 * would be the misleading move). Arrays of objects (e.g. `by_status`,
 * `payout_breakdown`) are grouped by their first string-valued field —
 * "DELIVERED" from business A adds to "DELIVERED" from business B, rather
 * than becoming two separate rows. Plain objects recurse key by key.
 * Scalar booleans/strings (e.g. `sale_price_includes_gst`) are a genuine
 * single on/off *setting*, not data — kept from the first business, never
 * merged or voted on.
 *
 * `identityKeyedPaths` names the dot-paths whose nested object is keyed by an
 * arbitrary id (a SKU code, say) rather than a fixed schema — those must
 * NEVER be key-merged: two businesses' same-spelled SKU are two different
 * products, not one to add together. Each business's entries are kept
 * distinct instead, tagged with which business they came from (`_business`,
 * `_business_id`) and their original id (`_sku_id` etc., since the merged
 * dict's own key becomes `${business.id}::${originalKey}` to stay unique).
 */
export function mergeBusinessJson(responses, businesses, { identityKeyedPaths = [] } = {}) {
  const idSet = new Set(identityKeyedPaths);

  function mergeAt(path, values) {
    const present = values.filter((v) => v !== null && v !== undefined);
    if (present.length === 0) return values[0];
    if (idSet.has(path)) return mergeIdentityKeyed(values);
    if (present.every((v) => typeof v === "number")) return present.reduce((a, b) => a + b, 0);
    if (present.every((v) => Array.isArray(v))) return mergeArrays(path, present);
    if (present.every((v) => typeof v === "object" && !Array.isArray(v))) return mergeObjects(path, present);
    return present[0]; // strings/booleans/mixed types — a setting, keep the first
  }

  function mergeObjects(path, objs) {
    const keys = new Set(objs.flatMap((o) => Object.keys(o)));
    const out = {};
    for (const k of keys) out[k] = mergeAt(path ? `${path}.${k}` : k, objs.map((o) => o[k]));
    return out;
  }

  function groupKeyField(obj) {
    return Object.keys(obj).find((k) => typeof obj[k] === "string");
  }

  function mergeArrays(path, arrays) {
    const flat = arrays.flat();
    if (flat.length === 0) return [];
    if (typeof flat[0] !== "object" || flat[0] === null) return [...new Set(flat)];
    const field = groupKeyField(flat[0]);
    if (!field) return flat; // no obvious group key — can't merge safely, keep every row as-is
    const groups = new Map();
    for (const row of flat) {
      const key = row[field];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return [...groups.values()].map((rows) => mergeObjects(path, rows));
  }

  function mergeIdentityKeyed(dicts) {
    const out = {};
    dicts.forEach((dict, i) => {
      const business = businesses[i];
      Object.entries(dict || {}).forEach(([id, row]) => {
        const key = dicts.length > 1 ? `${business?.id ?? i}::${id}` : id;
        out[key] = { ...row, _sku_id: id, _business: business?.name, _business_id: business?.id };
      });
    });
    return out;
  }

  return mergeObjects("", responses);
}

/** profit/ response, merged — with the two real percentages it carries
 * recomputed from the merged totals rather than summed/averaged. */
export function mergeProfitResponses(responses, businesses) {
  const merged = mergeBusinessJson(responses, businesses, { identityKeyedPaths: ["sku_wise_profit"] });
  if (merged.tax_summary) {
    const comm = Math.abs(Number(merged.total_commission_paid || 0));
    const tcs = Math.abs(Number(merged.total_tcs || 0));
    const tds = Math.abs(Number(merged.total_tds || 0));
    const shipping = Math.abs(Number(merged.total_shipping_cost || 0));
    const gross = Number(merged.gross_revenue || 0);
    merged.tax_summary.total_deduction_rate_pct = gross > 0 ? ((comm + tcs + tds + shipping) / gross) * 100 : 0;
  }
  return merged;
}

/** dashboard/ response, merged — join_stats.match_rate recomputed the same way. */
export function mergeDashboardResponses(responses, businesses) {
  const merged = mergeBusinessJson(responses, businesses, {});
  if (merged.join_stats) {
    const matched = Number(merged.join_stats.matched_count || 0);
    const unmatched = Number(merged.join_stats.unmatched_count || 0);
    const total = matched + unmatched;
    merged.join_stats.match_rate = total > 0 ? Number(((matched / total) * 100).toFixed(1)) : 0;
  }
  return merged;
}
