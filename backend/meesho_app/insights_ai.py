"""
AI analysis for Business Insights, written by Claude.

The statistics in insights.py find the individual signals; what they can't do
is read them together — notice that the SKU with the worst returns is also the
one whose claims get rejected and whose shipping charge just went up, decide
which three things matter most this week, or answer "why is my profit down?"
in plain words. That is what the model is asked to do here.

What the model sees is the Insights output itself, trimmed to the parts that
carry meaning (SKU codes, product names, ₹ figures, rates, counts). No customer
names, phone numbers or addresses are sent — the data never had them at this
level. It is told to use only these numbers, so every claim it makes can be
checked against the page underneath.

The call goes straight to the Anthropic Messages API over HTTPS with
`requests` (already a dependency), forcing a single tool call so the reply
comes back as structured JSON rather than prose to be parsed.
"""

import hashlib
import json

import requests
from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

API_VERSION = "2023-06-01"
TIMEOUT = 100   # gunicorn allows 120s per request

SYSTEM = """You are a sharp, practical e-commerce analyst working for a small Indian seller on Meesho \
(they sell brass/copper pooja items, kitchenware and similar). You are given the output of their \
Business Insights page: profit figures, per-SKU performance, return/RTO/claim outliers, demand changes, \
claim tickets (including rejected claims, whose product cost is a real loss), and checks on Meesho's \
payment sheets.

Rules:
- Use ONLY the numbers given. Never invent figures, SKUs or causes you can't support from the data; \
when you infer a likely cause, say "likely" and say what in the data points to it.
- Money is in Indian rupees: write ₹ and Indian digit grouping (₹1,23,456).
- Write in simple, direct English a busy owner can act on — short sentences, no jargon. Name the SKU \
or product every time.
- Prioritise by money: what costs or could earn the most comes first.
- Connect signals across sections (e.g. a SKU with high returns AND rejected claims AND a shipping-charge \
jump). That cross-reading is your main value; don't just repeat single cards.
- "true_profit" = net profit minus the product cost of rejected claims; use it when judging whether the \
business is really profitable.
- Rates are on settled orders; recent periods are partly unsettled — mention it when it matters."""

REPORT_TOOL = {
    "name": "report_insights",
    "description": "Return the analysis of the seller's business for this period.",
    "input_schema": {
        "type": "object",
        "properties": {
            "verdict": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "enum": ["healthy", "watch", "at_risk"]},
                    "headline": {"type": "string", "description": "One sentence: is the business making money and where it stands."},
                    "summary": {"type": "string", "description": "3–5 sentences: profit after rejected claims, what drove it vs last period, the biggest risk."},
                },
                "required": ["status", "headline", "summary"],
            },
            "priorities": {
                "type": "array", "maxItems": 7,
                "description": "The most valuable actions, biggest money first.",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "detail": {"type": "string", "description": "What the data shows and exactly what to do."},
                        "impact_rupees": {"type": "number", "description": "Rough ₹ at stake or to gain over a month; 0 if unknown."},
                        "skus": {"type": "array", "items": {"type": "string"}},
                        "area": {"type": "string", "enum": ["returns", "rto", "claims", "pricing", "demand", "payments", "stock", "ads", "other"]},
                        "urgency": {"type": "string", "enum": ["today", "this_week", "this_month"]},
                    },
                    "required": ["title", "detail", "impact_rupees", "skus", "area", "urgency"],
                },
            },
            "patterns": {
                "type": "array", "maxItems": 5,
                "description": "Connections across signals the individual cards don't show.",
                "items": {"type": "object", "properties": {"title": {"type": "string"}, "detail": {"type": "string"}},
                          "required": ["title", "detail"]},
            },
            "payment_findings": {
                "type": "array", "maxItems": 5,
                "description": "Anything unusual in Meesho's payments and whether/how to dispute it.",
                "items": {"type": "object", "properties": {"title": {"type": "string"}, "detail": {"type": "string"},
                                                           "what_to_do": {"type": "string"}},
                          "required": ["title", "detail", "what_to_do"]},
            },
            "claims_view": {"type": "string", "description": "2–4 sentences on claims: losses from rejections, what gets rejected and how to win more. Say so if no claims sheet is uploaded."},
            "growth_ideas": {
                "type": "array", "maxItems": 4,
                "items": {"type": "object", "properties": {"title": {"type": "string"}, "detail": {"type": "string"}},
                          "required": ["title", "detail"]},
            },
            "watch_next": {"type": "array", "maxItems": 4, "items": {"type": "string"},
                           "description": "Things to check again next week."},
        },
        "required": ["verdict", "priorities", "patterns", "payment_findings", "claims_view", "growth_ideas", "watch_next"],
    },
}


def ai_available():
    return bool(settings.ANTHROPIC_API_KEY)


# ── what the model sees ──────────────────────────────────────────────────────

def _pick(row, keys):
    return {k: row.get(k) for k in keys if row.get(k) not in (None, "", [])}


SKU_KEYS = ("sku", "product_name", "parent", "orders", "settled", "returns", "rto", "claims", "return_rate",
            "rto_rate", "claim_rate", "net_profit", "profit_per_order", "delivered_profit", "return_loss")


def build_context(data):
    """The Insights output, trimmed to what an analyst needs — small enough to
    send every time, and nothing personal."""
    if data.get("empty"):
        return {"empty": True}
    c = data.get("claims") or {}
    p = data.get("payments") or {}
    ctx = {
        "period": data["period"],
        "settled_share_pct": data.get("settled_share"),
        "business_average_rates_pct": data.get("baseline"),
        "kpis": [{k: x[k] for k in ("label", "current", "previous", "change", "change_unit")} for x in data["kpis"]],
        "flagged_by_statistics": [_pick(h, ("severity", "title", "why", "impact")) for h in data["highlights"][:25]],
        "top_performers": [_pick(r, SKU_KEYS + ("profit_share", "prev_net_profit")) for r in data["top_performers"][:8]],
        "hidden_gems": [_pick(r, SKU_KEYS) for r in data["hidden_gems"][:5]],
        "rising_products": [_pick(r, ("sku", "skus", "orders", "prev_orders", "profit_per_order")) for r in data["rising"][:8]],
        "falling_products": [_pick(r, ("sku", "skus", "orders", "prev_orders", "prev_profit_per_order")) for r in data["falling"][:8]],
        "high_returns": [_pick(r, SKU_KEYS + ("rate", "baseline", "excess", "money_at_stake", "top_reasons")) for r in data["high_returns"][:8]],
        "high_rto": [_pick(r, SKU_KEYS + ("rate", "baseline", "excess", "money_at_stake")) for r in data["high_rto"][:8]],
        "high_claims": [_pick(r, SKU_KEYS + ("rate", "baseline", "claim_loss")) for r in data["high_claims"][:5]],
        "loss_makers": [_pick(r, SKU_KEYS + ("main_cause",)) for r in data["loss_makers"][:8]],
        "return_spikes": [_pick(r, ("sku", "return_rate", "prev_return_rate", "settled")) for r in data["return_spikes"][:5]],
        "unusual_days": [d for d in data["daily"] if d.get("anomaly")][:6],
        "states_with_high_rto": [s for s in data["states"] if s.get("flag")][:6],
        "claims": ({"uploaded": False} if not c.get("uploaded") else {
            "uploaded": True,
            "true_profit": c.get("true_profit"),
            "this_period": c["period"], "previous_period": c["previous"], "all_time": c["all_time"],
            "by_issue": c["by_issue"][:8],
            "by_sku": c["by_sku"][:8],
            "top_rejection_reasons": c["top_rejection_reasons"][:6],
            "reopenable_count": len(c["reopenable"]), "reopenable_value": c["reopenable_value"],
            "earliest_reopen_deadline": c["reopenable"][0]["reopen_by"] if c["reopenable"] else None,
        }),
        "payments": None if not p else {
            "period": p["period"], "this_period": p["summary"], "previous_period": p["previous"],
            "checks": [{**_pick(x, ("title", "severity", "count", "amount", "detail")), "examples": x["rows"][:6]}
                       for x in p["checks"]],
            "adjustment_types": p["adjustments"][:12],
            "meesho_share_of_price_pct": p.get("fee_share"),
        },
    }
    return ctx


def _hash(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()


def context_hash(data):
    """Fingerprint of exactly what would be sent to the model. The Insights
    page carries it, so looking up a saved report needs no recomputation."""
    return _hash({"model": settings.ANTHROPIC_MODEL, "ctx": build_context(data)})


# ── the API call ─────────────────────────────────────────────────────────────

class AIError(Exception):
    pass


def _call(payload):
    try:
        r = requests.post(f"{settings.ANTHROPIC_BASE_URL}/v1/messages", json=payload, timeout=TIMEOUT, headers={
            "x-api-key": settings.ANTHROPIC_API_KEY,
            "anthropic-version": API_VERSION,
            "content-type": "application/json",
        })
    except requests.RequestException as exc:
        raise AIError(f"Couldn't reach the AI service ({exc.__class__.__name__}). Try again in a minute.") from exc
    if r.status_code != 200:
        try:
            msg = r.json().get("error", {}).get("message", "")
        except ValueError:
            msg = r.text[:200]
        if r.status_code == 401:
            msg = "The ANTHROPIC_API_KEY on the server was rejected — check it in the env file."
        elif r.status_code == 429:
            msg = "The AI service is busy or the account's limit was reached. Try again shortly."
        raise AIError(msg or f"AI request failed (HTTP {r.status_code}).")
    return r.json()


def generate_report(context):
    body = _call({
        "model": settings.ANTHROPIC_MODEL,
        "max_tokens": 4000,
        "system": SYSTEM,
        "tools": [REPORT_TOOL],
        "tool_choice": {"type": "tool", "name": "report_insights"},
        "messages": [{"role": "user", "content":
                      "Here is this period's Business Insights data as JSON. Analyse it and report.\n\n"
                      + json.dumps(context, default=str, ensure_ascii=False)}],
    })
    block = next((b for b in body.get("content", []) if b.get("type") == "tool_use"), None)
    if not block:
        raise AIError("The AI reply came back in an unexpected shape. Try again.")
    usage = body.get("usage", {})
    return block["input"], usage.get("input_tokens", 0), usage.get("output_tokens", 0)


def answer_question(context, question, history=()):
    messages = []
    for turn in list(history)[-6:]:
        if turn.get("role") in ("user", "assistant") and turn.get("content"):
            messages.append({"role": turn["role"], "content": str(turn["content"])[:4000]})
    first = ("Business Insights data for the period, as JSON:\n\n" + json.dumps(context, default=str, ensure_ascii=False)
             + "\n\nAnswer my questions using only this data. Keep answers short (under 200 words), use ₹, "
               "name SKUs, and end with the one action I should take. If the data can't answer it, say what "
               "would be needed.")
    messages = [{"role": "user", "content": first},
                {"role": "assistant", "content": "Understood — I'll answer from this data only."}] + messages
    messages.append({"role": "user", "content": question[:1000]})
    body = _call({"model": settings.ANTHROPIC_MODEL, "max_tokens": 900, "system": SYSTEM, "messages": messages})
    text = "".join(b.get("text", "") for b in body.get("content", []) if b.get("type") == "text").strip()
    if not text:
        raise AIError("The AI returned an empty answer. Try rephrasing.")
    return text


# ── endpoints ────────────────────────────────────────────────────────────────

def _not_configured():
    return Response({"available": False,
                     "message": "AI analysis isn't switched on for this server. Add ANTHROPIC_API_KEY to the "
                                "server's env file and restart to enable it."})


def _load(request, business_id):
    from .insights import build_insights
    from .permissions import get_authorized_business
    business = get_authorized_business(request, business_id)
    src = request.data if request.method == "POST" else request.GET
    data = build_insights(business, src.get("date_from", ""), src.get("date_to", ""), request)
    return business, data


def _out(rep, cached, stale=False):
    return Response({"available": True, "cached": cached, "stale": stale, "report": rep.report,
                     "model": rep.model_name, "created_at": rep.created_at})


@api_view(["GET", "POST"])
def insights_ai_report(request, business_id):
    """GET ?hash=&date_from=&date_to=: the saved report for these exact numbers
    (by the page's hash), else the latest one for the same period marked stale,
    else none. Never calls the model and never recomputes.
    POST: reuse the saved report or write one now; {"refresh": true} always
    writes a new one."""
    from .models import InsightAIReport
    from .permissions import get_authorized_business

    if not ai_available():
        return _not_configured()
    if request.method == "GET":
        business = get_authorized_business(request, business_id)
        digest = request.GET.get("hash", "")
        hit = InsightAIReport.objects.filter(business=business, data_hash=digest).first() if digest else None
        if hit:
            return _out(hit, True)
        latest = InsightAIReport.objects.filter(business=business, date_from=request.GET.get("date_from") or None,
                                                date_to=request.GET.get("date_to") or None).first() \
            if request.GET.get("date_from") and request.GET.get("date_to") else None
        if latest:
            return _out(latest, True, stale=True)
        return Response({"available": True, "report": None})

    business, data = _load(request, business_id)
    if data.get("empty"):
        return Response({"available": True, "report": None, "message": data.get("message")})
    context = build_context(data)
    digest = _hash({"model": settings.ANTHROPIC_MODEL, "ctx": context})
    period = data["period"]
    stored = InsightAIReport.objects.filter(business=business, data_hash=digest).first()
    if stored and not request.data.get("refresh"):
        return _out(stored, True)

    try:
        report, tin, tout = generate_report(context)
    except AIError as exc:
        return Response({"available": True, "error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    rep = InsightAIReport.objects.create(
        business=business, date_from=period["date_from"], date_to=period["date_to"], data_hash=digest,
        model_name=settings.ANTHROPIC_MODEL, report=report, input_tokens=tin, output_tokens=tout,
        created_by=request.user if request.user.is_authenticated else None)
    return _out(rep, False)


@api_view(["POST"])
def insights_ai_ask(request, business_id):
    """Free-form question about the period, answered from the same data."""
    if not ai_available():
        return _not_configured()
    question = (request.data.get("question") or "").strip()
    if not question:
        return Response({"error": "Type a question first."}, status=status.HTTP_400_BAD_REQUEST)
    _business, data = _load(request, business_id)
    if data.get("empty"):
        return Response({"answer": data.get("message")})
    try:
        answer = answer_question(build_context(data), question, request.data.get("history") or [])
    except AIError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    return Response({"answer": answer})
