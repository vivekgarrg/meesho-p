def status_wise_summary(order_wise_profit, status):
    summary = {}
    summary["order_count"] = sum(v.get(f"{status}_count",  0) for v in order_wise_profit.values())
    summary["packaging_cost"] = sum(v.get(f"{status}_packaging_cost",  0) for v in order_wise_profit.values())
    summary["purchase_cost"] = sum(v.get(f"{status}_purchase_cost",  0) for v in order_wise_profit.values())
    summary["final_item_cost"] = sum(v.get(f"{status}_final_purchase_cost",  0) for v in order_wise_profit.values())
    summary["tax_cost"] = sum(v.get(f"{status}_tax_cost",  0) for v in order_wise_profit.values())
    summary["total_settlement"] = sum(v.get(f"{status}_total_settlement",  0) for v in order_wise_profit.values())
    summary["net_profit_loss"]  = sum(v.get(f"{status}_profit",  0) or v.get(f"{status}_loss",  0) for v in order_wise_profit.values())
    return summary
    

# ── Meesho's HTML-in-a-CSV problem ───────────────────────────────────────────
# Claim rejection reasons in the supplier-panel ticket export are HTML fragments
# ("<p>Dear Supplier,<br><br>..."). Lives here rather than in views or
# serializers because both need it and importing either from the other would be
# a cycle.
import re as _re

_HTML_TAG_RE = _re.compile(r"<[^>]+>")
_ENTITIES = {
    "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
    "&quot;": '"', "&#39;": "'", "&rsquo;": "'",
}


def strip_html(text):
    """Keep the words, drop the markup, collapse the whitespace."""
    if not text:
        return ""
    cleaned = _HTML_TAG_RE.sub(" ", str(text))
    for entity, char in _ENTITIES.items():
        cleaned = cleaned.replace(entity, char)
    return " ".join(cleaned.split())
