import pandas as pd
import numpy as np
from decimal import Decimal, InvalidOperation
from django.db import transaction
from django.db.models import Sum, Count, Min, Max, ExpressionWrapper, F, DecimalField as DjDecimalField, Q as DQ
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from datetime import datetime, time
import requests as http_requests
import base64
import io
import concurrent.futures
from PIL import Image

from .models import OrderPayment, AdsCost, ReferralPayment, CompensationRecovery, FinalPrice, Order, ParentItemPrice, ParentPriceHistory, LabelOrder, PurchaseBill, PurchaseItem, BlockedCustomer, InventoryAdjustment
from .serializers import (
    OrderPaymentSerializer, AdsCostSerializer,
    ReferralPaymentSerializer, CompensationRecoverySerializer,
    FinalPriceSerializer,
    ParentItemPriceSerializer,
    ParentPriceHistorySerializer,
    OrderSerializer,
    LabelOrderSerializer,
)


def safe_decimal(val):
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    try:
        return Decimal(str(val))
    except (InvalidOperation, ValueError):
        return None


def safe_str(val):
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    return str(val).strip()


def safe_date(val):
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    try:
        return pd.to_datetime(val).date()
    except Exception:
        return None


def safe_datetime(val):
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    try:
        return pd.to_datetime(val)
    except Exception:
        return None


def safe_int(val):
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


@api_view(["POST"])
@parser_classes([MultiPartParser])
def upload_excel(request):
    """
    Upload a Meesho payment Excel file.
    Parses all 4 sheets and inserts/updates rows in the DB.
    """
    file = request.FILES.get("file")
    if not file:
        return Response({"error": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        xl = pd.ExcelFile(file)
    except Exception as e:
        return Response({"error": f"Could not read Excel file: {e}"}, status=status.HTTP_400_BAD_REQUEST)

    results = {}

    # ── 1. Order Payments ───────────────────────────────────────────────────
    if "Order Payments" in xl.sheet_names:
        df = pd.read_excel(xl, sheet_name="Order Payments", header=None, skiprows=2)
        df.columns = [
            "sub_order_no", "order_date", "dispatch_date", "product_name",
            "supplier_sku", "catalog_id", "order_source", "live_order_status",
            "product_gst_percent", "listing_price_incl_taxes", "quantity",
            "transaction_id", "payment_date", "final_settlement_amount",
            "price_type", "total_sale_amount", "total_sale_return_amount",
            "fixed_fee_revenue", "warehousing_fee", "return_premium",
            "return_premium_of_return", "meesho_commission_percentage",
            "meesho_commission_incl_gst", "meesho_gold_platform_fee",
            "meesho_mall_platform_fee", "fixed_fee_deduction",
            "warehousing_fee_deduction", "return_shipping_charge",
            "gst_compensation_prp_shipping", "shipping_charge_incl_gst",
            "other_support_service_charges", "waivers",
            "net_other_support_service_charges",
            "gst_on_net_other_support_service_charges",
            "tcs", "tds_rate_percent", "tds",
            "compensation", "claims", "recovery",
            "compensation_reason", "claims_reason", "recovery_reason",
        ]
        # Drop the formula-description row (row index 0 has letters like A, B, C...)
        df = df[df["sub_order_no"].notna()]
        df = df[~df["sub_order_no"].astype(str).str.match(r"^[A-Z\s\(\)\+\-\*\/]+$")]

        created = updated = 0
        with transaction.atomic():
            for _, row in df.iterrows():
                pk = safe_str(row["sub_order_no"])
                if not pk:
                    continue
                defaults = {
                    "order_date": safe_datetime(row.get("order_date")),
                    "dispatch_date": safe_date(row.get("dispatch_date")),
                    "product_name": safe_str(row.get("product_name")),
                    "supplier_sku": safe_str(row.get("supplier_sku")),
                    "catalog_id": safe_int(row.get("catalog_id")),
                    "order_source": safe_str(row.get("order_source")),
                    "live_order_status": safe_str(row.get("live_order_status")),
                    "product_gst_percent": safe_decimal(row.get("product_gst_percent")),
                    "listing_price_incl_taxes": safe_decimal(row.get("listing_price_incl_taxes")),
                    "quantity": safe_int(row.get("quantity")),
                    "transaction_id": safe_str(row.get("transaction_id")),
                    "payment_date": safe_date(row.get("payment_date")),
                    "final_settlement_amount": safe_decimal(row.get("final_settlement_amount")),
                    "price_type": safe_str(row.get("price_type")),
                    "total_sale_amount": safe_decimal(row.get("total_sale_amount")),
                    "total_sale_return_amount": safe_decimal(row.get("total_sale_return_amount")),
                    "fixed_fee_revenue": safe_decimal(row.get("fixed_fee_revenue")),
                    "warehousing_fee": safe_decimal(row.get("warehousing_fee")),
                    "return_premium": safe_decimal(row.get("return_premium")),
                    "return_premium_of_return": safe_decimal(row.get("return_premium_of_return")),
                    "meesho_commission_percentage": safe_decimal(row.get("meesho_commission_percentage")),
                    "meesho_commission_incl_gst": safe_decimal(row.get("meesho_commission_incl_gst")),
                    "meesho_gold_platform_fee": safe_decimal(row.get("meesho_gold_platform_fee")),
                    "meesho_mall_platform_fee": safe_decimal(row.get("meesho_mall_platform_fee")),
                    "fixed_fee_deduction": safe_decimal(row.get("fixed_fee_deduction")),
                    "warehousing_fee_deduction": safe_decimal(row.get("warehousing_fee_deduction")),
                    "return_shipping_charge": safe_decimal(row.get("return_shipping_charge")),
                    "gst_compensation_prp_shipping": safe_decimal(row.get("gst_compensation_prp_shipping")),
                    "shipping_charge_incl_gst": safe_decimal(row.get("shipping_charge_incl_gst")),
                    "other_support_service_charges": safe_decimal(row.get("other_support_service_charges")),
                    "waivers": safe_decimal(row.get("waivers")),
                    "net_other_support_service_charges": safe_decimal(row.get("net_other_support_service_charges")),
                    "gst_on_net_other_support_service_charges": safe_decimal(row.get("gst_on_net_other_support_service_charges")),
                    "tcs": safe_decimal(row.get("tcs")),
                    "tds_rate_percent": safe_decimal(row.get("tds_rate_percent")),
                    "tds": safe_decimal(row.get("tds")),
                    "compensation": safe_decimal(row.get("compensation")),
                    "claims": safe_decimal(row.get("claims")),
                    "recovery": safe_decimal(row.get("recovery")),
                    "compensation_reason": safe_str(row.get("compensation_reason")),
                    "claims_reason": safe_str(row.get("claims_reason")),
                    "recovery_reason": safe_str(row.get("recovery_reason")),
                }
                # Composite lookup: (sub_order_no, payment_date, live_order_status)
                # allows multiple rows per order (e.g. affiliate-fee adjustments
                # alongside the main delivery row).
                lookup_payment_date    = defaults.pop("payment_date")
                lookup_live_status     = defaults.pop("live_order_status")
                obj, was_created = OrderPayment.objects.update_or_create(
                    sub_order_no=pk,
                    payment_date=lookup_payment_date,
                    live_order_status=lookup_live_status,
                    defaults=defaults,
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
        results["order_payments"] = {"created": created, "updated": updated}

    # ── 2. Ads Cost ─────────────────────────────────────────────────────────
    if "Ads Cost" in xl.sheet_names:
        df = pd.read_excel(xl, sheet_name="Ads Cost", header=None, skiprows=2)
        df.columns = [
            "deduction_duration", "deduction_date", "campaign_id",
            "ad_cost", "credits_waivers_discounts",
            "ad_cost_incl_credits_waivers", "gst", "total_ads_cost",
        ]
        df = df[df["deduction_date"].notna()]
        df = df[~df["deduction_date"].astype(str).str.strip().str.startswith("No data")]

        created = skipped = 0
        with transaction.atomic():
            for _, row in df.iterrows():
                _, was_created = AdsCost.objects.update_or_create(
                    deduction_duration=safe_date(row.get("deduction_duration")),
                    deduction_date=safe_date(row.get("deduction_date")),
                    campaign_id=safe_str(row.get("campaign_id")),
                    defaults={
                        "ad_cost": safe_decimal(row.get("ad_cost")),
                        "credits_waivers_discounts": safe_decimal(row.get("credits_waivers_discounts")),
                        "ad_cost_incl_credits_waivers": safe_decimal(row.get("ad_cost_incl_credits_waivers")),
                        "gst": safe_decimal(row.get("gst")),
                        "total_ads_cost": safe_decimal(row.get("total_ads_cost")),
                    },
                )
                if was_created:
                    created += 1
                else:
                    skipped += 1
        results["ads_cost"] = {"created": created, "updated": skipped}

    # ── 3. Referral Payments ─────────────────────────────────────────────────
    if "Referral Payments" in xl.sheet_names:
        df = pd.read_excel(xl, sheet_name="Referral Payments", header=None, skiprows=2)
        df.columns = [
            "reward_id", "payment_date", "store_name",
            "reason", "net_referral_amount", "taxes_gst_tds",
        ]
        df = df[df["reward_id"].notna()]
        df = df[~df["reward_id"].astype(str).str.startswith("No data")]

        created = updated = 0
        with transaction.atomic():
            for _, row in df.iterrows():
                pk = safe_str(row["reward_id"])
                if not pk:
                    continue
                obj, was_created = ReferralPayment.objects.update_or_create(
                    reward_id=pk,
                    defaults={
                        "payment_date": safe_date(row.get("payment_date")),
                        "store_name": safe_str(row.get("store_name")),
                        "reason": safe_str(row.get("reason")),
                        "net_referral_amount": safe_decimal(row.get("net_referral_amount")),
                        "taxes_gst_tds": safe_decimal(row.get("taxes_gst_tds")),
                    },
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
        results["referral_payments"] = {"created": created, "updated": updated}

    # ── 4. Compensation and Recovery ─────────────────────────────────────────
    if "Compensation and Recovery" in xl.sheet_names:
        df = pd.read_excel(xl, sheet_name="Compensation and Recovery", header=None, skiprows=2)
        df.columns = ["date", "program_name", "reason", "amount_incl_gst"]
        df = df[df["date"].notna()]
        df = df[~df["date"].astype(str).str.startswith("No data")]

        created = 0
        with transaction.atomic():
            for _, row in df.iterrows():
                CompensationRecovery.objects.create(
                    date=safe_date(row.get("date")),
                    program_name=safe_str(row.get("program_name")),
                    reason=safe_str(row.get("reason")),
                    amount_incl_gst=safe_decimal(row.get("amount_incl_gst")),
                )
                created += 1
        results["compensation_recovery"] = {"created": created}

    return Response({"success": True, "results": results}, status=status.HTTP_201_CREATED)


def _inc(d, key, value=None):
    """Increment dict[key] by value (default 1). Skips None keys."""
    if key is None:
        return
    if key not in d:
        d[key] = 0
    if value is not None:
        d[key] += value
    else:
        d[key] += 1


# ── Order status constants ─────────────────────────────────────────────────────

# Statuses where the item was SOLD / DELIVERED → deduct item cost from settlement.
# EXCHANGE / EXCHANGED = item sold and exchanged; CLAIM = Meesho compensated for item.
# Both "Exchange" (payments sheet) and "Exchanged" (order summary) are accepted.
_DELIVERED_STATUSES = frozenset(["DELIVERED", "EXCHANGE", "EXCHANGED", "CLAIM"])

# Statuses where the item came BACK → no item cost deduction.
# Both "Return" (payments sheet) and "Returned" (order summary) are accepted.
_RETURN_STATUSES  = frozenset([
    "RETURN", "RETURNED", "RTO", "RTO_COMPLETE", "PREMIUM_RETURN", "CANCELLED",
])

# Both "Shipped" (payments sheet) and "In Transit" (order summary) are in-transit.
_SHIPPED_STATUSES = frozenset(["SHIPPED", "IN TRANSIT"])

# Canonical accumulator key mapping (DB value → frontend-visible bucket key)
_STATUS_KEY_NORM = {
    "rto_complete":   "rto",
    "premium_return": "return",
    "returned":       "return",      # order summary uses "Returned"; payments sheet uses "Return"
    "exchanged":      "exchange",    # order summary uses "Exchanged"; payments sheet uses "Exchange"
    "in transit":     "shipped",     # order summary uses "In Transit"; payments sheet uses "Shipped"
}

def _norm_key(raw_lower):
    return _STATUS_KEY_NORM.get(raw_lower, raw_lower)


# ── Row-level helpers ──────────────────────────────────────────────────────────

def _payment_date_key(row):
    """Sort key: payment_date asc, fallback to order_date, fallback to epoch."""
    import datetime as _dt
    pd = row.payment_date
    if pd is not None:
        return pd
    od = row.order_date
    return od.date() if od else _dt.date.min


def _classify_rows(payment_rows):
    """
    Split and categorise payment rows for one sub_order_no.

    Key behaviours:
      • Rows are sorted by payment_date ascending.
      • Status rows are de-duplicated by status — if Meesho sends two DELIVERED
        rows for the same order only the most-recent one is kept, preventing
        double-counting of settlement amounts.
      • adj rows (no live_order_status) are kept as-is — multiple claims
        payments for one order are all legitimate.

    Groups returned:
      main          — rows that carry a live_order_status (after dedup)
      adj           — rows without a status (claims, affiliate fees)
      shipped       — SHIPPED rows (excluded from P&L)
      non_shipped   — main rows that are NOT SHIPPED
      return_rows   — non_shipped where status is a return-type
      delivered_rows— non_shipped where status is a delivered-type
                      (DELIVERED, EXCHANGE, CLAIM)
    """
    rows = sorted(payment_rows, key=_payment_date_key)
    main_all = [r for r in rows if r.live_order_status]
    adj      = [r for r in rows if not r.live_order_status]

    # Deduplicate status rows: keep only the most-recent row per unique status.
    # (rows already sorted asc → last occurrence per status = most recent)
    _seen: dict = {}
    for r in main_all:
        _seen[r.live_order_status.upper()] = r
    main = list(_seen.values())

    shipped        = [r for r in main if r.live_order_status.upper() in _SHIPPED_STATUSES]
    non_shipped    = [r for r in main if r.live_order_status.upper() not in _SHIPPED_STATUSES]
    return_rows    = [r for r in non_shipped if r.live_order_status.upper() in _RETURN_STATUSES]
    delivered_rows = [r for r in non_shipped if r.live_order_status.upper() in _DELIVERED_STATUSES]

    return {
        "rows":           rows,
        "main":           main,
        "adj":            adj,
        "shipped":        shipped,
        "non_shipped":    non_shipped,
        "return_rows":    return_rows,
        "delivered_rows": delivered_rows,
        "is_shipped_only": bool(main) and not non_shipped,
    }


def _pick_settlement_rows(c):
    """
    Settlement precedence (status-based):
      1. Any RETURN/RTO/CANCELLED → use only return rows  (item came back)
      2. DELIVERED/EXCHANGE/CLAIM, no return → use delivered rows  (item sold)
      3. Fallback → all non-shipped rows

    Returns (settlement_rows, is_delivered).
    is_delivered=True means item cost must be deducted from settlement.
    """
    if c["return_rows"]:
        return c["return_rows"], False
    if c["delivered_rows"]:
        return c["delivered_rows"], True
    return c["non_shipped"], False


def _sum_settlement(rows):
    """Sum final_settlement_amount from status rows only.
    Adj rows (claims / affiliate) are tracked in separate fields and must NOT
    be included here — their final_settlement_amount would double-count."""
    return sum(Decimal(r.final_settlement_amount or 0) for r in rows)


def _extract_claims(adj_rows):
    """Total claims money credited from Meesho (info-only, not in P&L)."""
    total = Decimal("0")
    for r in adj_rows:
        total += Decimal(r.claims or 0)
    return total


def _affiliate_total(adj_rows):
    raw = sum(Decimal(r.final_settlement_amount or 0)
              for r in adj_rows if r.recovery_reason == "Affiliate Fee")
    return raw if raw else Decimal("0")


# ── Per-order profit formula ───────────────────────────────────────────────────

def compute_order_net(payment_rows, sku_final_price, sku_packaging_price, quantity,
                      sku_item_price=None, sku_tax_percent=None):
    """
    Pure function — no DB access.

    P&L rules:
      • DELIVERED / EXCHANGE / CLAIM status:  net = settlement − item_price × qty
      • Any adj row with claims > 0:          net = settlement − item_price × qty
        (Meesho paid a claim → seller lost the product regardless of order status)
      • RETURN / RTO with no claims:          net = return_settlement only
      • Shipped-only:                         excluded from P&L; tracked as in-transit
    """
    ZERO = Decimal("0")
    qty  = Decimal(str(quantity))

    purchase_cost  = Decimal(str(sku_item_price or 0)) * qty
    packaging_cost = Decimal(str(sku_packaging_price or 0))          # fixed per order, not × qty
    tax_cost       = purchase_cost * Decimal(str(sku_tax_percent or 0)) / Decimal("100")  # item_price × qty × tax%

    c             = _classify_rows(payment_rows)
    adj_rows      = c["adj"]
    affiliate_fees = _affiliate_total(adj_rows)
    claims         = _extract_claims(adj_rows)
    sub_order_no   = payment_rows[0].sub_order_no

    # ── Case 1: pure adjustment order (no status rows at all) ──────────────────
    if not c["main"]:
        adj_settlement    = sum(Decimal(r.final_settlement_amount or 0) for r in adj_rows)
        has_claim_payment = claims > ZERO
        if has_claim_payment:
            # Meesho paid a claim with no delivery status — item was lost; deduct cost
            net_val        = adj_settlement - purchase_cost
            ret_cost       = purchase_cost
            ret_pkg        = packaging_cost
            ret_qty        = qty
        else:
            net_val  = affiliate_fees
            ret_cost = ZERO
            ret_pkg  = ZERO
            ret_qty  = ZERO
        return {
            "net": net_val, "status": None,
            "is_delivered": has_claim_payment, "is_shipped_only": False, "is_adjustment_only": True,
            "has_claim": has_claim_payment, "claims": claims,
            "affiliate_fees": affiliate_fees, "total_settlement": adj_settlement,
            "return_shipping": ZERO, "recovery_reason": None,
            "purchase_cost": ret_cost, "packaging_cost": ret_pkg,
            "tax_cost": tax_cost if has_claim_payment else ZERO,
            "quantity": ret_qty,
            "shipped_row_settlement": ZERO, "shipped_row_sale": ZERO,
            "sub_order_no": sub_order_no,
        }

    # ── Case 2: shipped-only (in transit) — excluded from P&L ─────────────────
    if c["is_shipped_only"]:
        shipped_settlement = sum(Decimal(r.final_settlement_amount or 0) for r in c["shipped"])
        shipped_sale       = sum(Decimal(r.total_sale_amount       or 0) for r in c["shipped"])
        expected_profit    = shipped_settlement - purchase_cost
        last_shipped       = c["shipped"][-1]
        return {
            "net": ZERO, "status": last_shipped.live_order_status,
            "is_delivered": False, "is_shipped_only": True, "is_adjustment_only": False,
            "has_claim": False, "claims": ZERO,
            "affiliate_fees": ZERO, "total_settlement": ZERO,
            "return_shipping": ZERO, "recovery_reason": last_shipped.recovery_reason,
            "purchase_cost": purchase_cost, "packaging_cost": packaging_cost,
            "tax_cost": tax_cost,
            "quantity": qty,
            "shipped_row_settlement": shipped_settlement,
            "shipped_row_sale":       shipped_sale,
            "shipped_expected_profit": expected_profit,
            "sub_order_no": sub_order_no,
        }

    # ── Case 3: order has a final status ──────────────────────────────────────
    settlement_rows, is_delivered = _pick_settlement_rows(c)
    primary        = settlement_rows[-1]
    return_shipping = Decimal(primary.return_shipping_charge or 0)

    # Total settlement = status rows + ALL adj rows (claims are real money for the order)
    adj_total  = sum(Decimal(r.final_settlement_amount or 0) for r in adj_rows)
    settlement = _sum_settlement(settlement_rows) + adj_total

    # Deduct item cost if DELIVERED/EXCHANGE/CLAIM status OR if any adj row has a claim
    # (claim payment = Meesho compensated seller for the item, so cost applies regardless of status)
    has_claim_payment = claims > ZERO
    deduct_cost       = is_delivered or has_claim_payment
    net = (settlement - purchase_cost) if deduct_cost else settlement

    return {
        "net": Decimal(net), "status": primary.live_order_status,
        "is_delivered": is_delivered, "is_shipped_only": False, "is_adjustment_only": False,
        "has_claim": claims > ZERO, "claims": claims,
        "affiliate_fees": affiliate_fees, "total_settlement": settlement,
        "return_shipping": return_shipping, "recovery_reason": primary.recovery_reason,
        "purchase_cost": purchase_cost,
        "packaging_cost": packaging_cost if deduct_cost else ZERO,
        "tax_cost":       tax_cost       if deduct_cost else ZERO,
        "quantity": qty,
        "shipped_row_settlement": ZERO, "shipped_row_sale": ZERO,
        "sub_order_no": sub_order_no,
    }


# ── SKU accumulator helpers ────────────────────────────────────────────────────

def _init_sku_bucket(key, loss_or_profit, sku):
    """Zero-initialise a status bucket (delivered/return/rto) if not yet seen."""
    field = f"{key}_{loss_or_profit}"
    if sku.get(field) is None:
        sku[field]                    = 0
        sku[f"{key}_purchase_cost"]   = 0
        sku[f"{key}_packaging_cost"]  = 0
        sku[f"{key}_count"]           = 0
        sku[f"{key}_quantity"]        = 0


def _ensure_status_buckets(sku, _unique_statuses):
    """Pre-initialise the three main buckets + other_net so no KeyError later."""
    _init_sku_bucket("delivered", "profit", sku)
    _init_sku_bucket("return",    "loss",   sku)
    _init_sku_bucket("rto",       "loss",   sku)
    if sku.get("other_net") is None:
        sku["other_net"]   = 0
        sku["other_count"] = 0


def _inject_order_into_bucket(sku, result, net):
    """Write one order's financials into its status bucket."""
    status_upper = result["status"].upper() if result["status"] else ""
    raw = _norm_key(result["status"].lower())

    if status_upper in _DELIVERED_STATUSES:
        # DELIVERED, EXCHANGE, CLAIM — item was sold, cost was deducted
        _inc(sku, "delivered_profit",         net)
        _inc(sku, "delivered_purchase_cost",  result["purchase_cost"])
        _inc(sku, "delivered_packaging_cost", result["packaging_cost"])
        _inc(sku, "delivered_count")
        _inc(sku, "delivered_quantity",       result["quantity"])
    elif raw in ("return", "rto"):
        # RETURN, RTO, RTO_COMPLETE, PREMIUM_RETURN — item came back
        _inc(sku, f"{raw}_loss",              net)
        _inc(sku, f"{raw}_purchase_cost",     result["purchase_cost"])
        _inc(sku, f"{raw}_packaging_cost",    result["packaging_cost"])
        _inc(sku, f"{raw}_count")
        _inc(sku, f"{raw}_quantity",          result["quantity"])
    else:
        # CANCELLED or anything else → other
        _inc(sku, "other_net",   net)
        _inc(sku, "other_count")


# ── Per-SKU accumulator ────────────────────────────────────────────────────────

def accumulate_sku_profit(sku_id, obj, result, price_map, packaging_map, unique_statuses):
    """
    Merge one order's compute_order_net result into the sku_wise_profit dict.
    Called once per unique sub_order_no.
    """
    if sku_id not in obj:
        obj[sku_id] = {
            "order_count":    0,
            "one_unit_price": price_map[sku_id],
            "total_purchase_cost":  0,
            "settled_amount":       0,
            "affiliate_adj":        0,
            "shipped_count":        0,
            "shipped_settlement":   0,
            "shipped_sale":         0,
            "shipped_expected_profit": 0,
        }

    sku = obj[sku_id]
    net = result["net"]

    _inc(sku, "affiliate_adj", result["affiliate_fees"])
    _ensure_status_buckets(sku, unique_statuses)
    _inc(sku, "order_count")

    # ── Shipped-only: in-transit banner, excluded from P&L ────────────────────
    if result["is_shipped_only"]:
        _inc(sku, "shipped_count")
        _inc(sku, "shipped_settlement",      result["shipped_row_settlement"])
        _inc(sku, "shipped_sale",            result["shipped_row_sale"])
        _inc(sku, "shipped_expected_profit", result.get("shipped_expected_profit", 0))
        return

    # ── Pure-adjustment rows (no status at all) → "other" ─────────────────────
    if result["is_adjustment_only"]:
        _inc(sku, "other_net",      net)
        _inc(sku, "other_count")
        if result.get("has_claim"):
            _inc(sku, "claims_total", result["claims"])
            _inc(sku, "claims_count")
            _inc(sku, "total_packaging_cost", result["packaging_cost"])
            _inc(sku, "total_tax_cost",       result.get("tax_cost", 0))
            # net = adj_settlement - purchase_cost here; track the deducted cost for reconciliation
            _inc(sku, "total_deducted_cost",  result["purchase_cost"])
        return

    # ── Settled order: route to status bucket ────────────────────────────────
    _inject_order_into_bucket(sku, result, net)
    _inc(sku, "settled_amount", result["total_settlement"])
    _inc(sku, result["recovery_reason"])
    _inc(sku, "total_packaging_cost", result["packaging_cost"])
    _inc(sku, "total_tax_cost",       result.get("tax_cost", 0))
    if result.get("has_claim"):
        _inc(sku, "claims_total", result["claims"])
        _inc(sku, "claims_count")

    # Track purchase cost that was ACTUALLY DEDUCTED from settlement (delivered + claimed).
    # This includes Return/RTO+claim orders where purchase_cost was subtracted from return_loss.
    # Pure returns (no claim) never deduct cost — item came back — so exclude them.
    deduct_cost = result.get("is_delivered") or result.get("has_claim")
    if deduct_cost:
        _inc(sku, "total_deducted_cost", result["purchase_cost"])

    # ── Roll up SKU-level totals ──────────────────────────────────────────────
    sku["net_profit"] = (
        Decimal(sku.get("delivered_profit", 0)) +
        Decimal(sku.get("return_loss",      0)) +
        Decimal(sku.get("rto_loss",         0)) +
        Decimal(sku.get("other_net",        0))
    )
    # total_purchase_cost = DELIVERED-only costs.
    # Used by the frontend settlement table: delGross = total_profit + total_purchase_cost.
    # (Return/RTO+claim costs are tracked in total_deducted_cost for settlement reconciliation.)
    sku["total_purchase_cost"] = Decimal(sku.get("delivered_purchase_cost", 0))
    
    
    

@api_view(["GET"])
def available_months(request):
    """
    Returns distinct order months (YYYY-MM) newest first.
    Primary source: Order.order_date (DateField, reliable).
    Falls back to OrderPayment.order_date if Order table is empty.
    """
    dates = list(Order.objects.dates("order_date", "month", order="DESC"))
    if not dates:
        dates = list(
            OrderPayment.objects
            .exclude(order_date=None)
            .dates("order_date", "month", order="DESC")
        )
    return Response([d.strftime("%Y-%m") for d in dates])


@api_view(["GET"])
def unsettled_orders(request):
    """Orders in the Order table that have no matching OrderPayment record."""
    date_from = request.GET.get("date_from", "")
    date_to   = request.GET.get("date_to", "")
    page      = int(request.GET.get("page", 1))
    page_size = int(request.GET.get("page_size", 50))
    search    = request.GET.get("search", "")

    order_qs = Order.objects.all()
    if date_from:
        order_qs = order_qs.filter(order_date__gte=date_from)
    if date_to:
        order_qs = order_qs.filter(order_date__lte=date_to)
    if search:
        order_qs = order_qs.filter(
            DQ(sub_order_no__icontains=search) |
            DQ(sku__icontains=search) |
            DQ(product_name__icontains=search)
        )

    settled_nos = set(OrderPayment.objects.values_list("sub_order_no", flat=True).distinct())
    # Deduplicate to latest status per sub_order_no before listing
    latest_qs    = Order.latest_per_order(base_qs=order_qs)
    unsettled_qs = (
        latest_qs
        .exclude(sub_order_no__in=settled_nos)
        .exclude(reason_for_credit_entry__iexact="cancelled")
        .order_by("-order_date")
    )

    total       = unsettled_qs.count()
    total_value = unsettled_qs.aggregate(v=Sum("supplier_discounted_price"))["v"] or 0

    start = (page - 1) * page_size
    items = unsettled_qs[start: start + page_size]
    return Response({
        "total": total,
        "total_value": float(total_value),
        "page": page,
        "page_size": page_size,
        "results": OrderSerializer(items, many=True).data,
    })


@api_view(["GET"])
def payment_mismatch(request):
    """
    Bi-directional mismatch:
      - orders_no_payment: Orders in Order table with no matching OrderPayment row
      - payments_no_order: OrderPayment rows whose sub_order_no has no Order row
    """
    from collections import defaultdict

    date_from = request.GET.get("date_from", "")
    date_to   = request.GET.get("date_to",   "")
    page      = int(request.GET.get("page",      1))
    page_size = int(request.GET.get("page_size", 50))
    view      = request.GET.get("view", "orders")  # "orders" | "payments"

    # ── Orders with no payment ────────────────────────────────────────────────
    order_qs = Order.objects.all()
    if date_from:
        order_qs = order_qs.filter(order_date__gte=date_from)
    if date_to:
        order_qs = order_qs.filter(order_date__lte=date_to)

    payment_sub_nos = set(OrderPayment.objects.values_list("sub_order_no", flat=True).distinct())
    latest_orders   = Order.latest_per_order(base_qs=order_qs)
    orders_no_pay   = (
        latest_orders
        .exclude(sub_order_no__in=payment_sub_nos)
        .exclude(reason_for_credit_entry__iexact="cancelled")
        .order_by("-order_date")
    )
    onp_agg = orders_no_pay.aggregate(count=Count("sub_order_no"), total_value=Sum("supplier_discounted_price"))

    # ── Payments with no order ────────────────────────────────────────────────
    pay_qs = OrderPayment.objects.all()
    if date_from:
        pay_qs = pay_qs.filter(order_date__date__gte=date_from)
    if date_to:
        pay_qs = pay_qs.filter(order_date__date__lte=date_to)

    order_sub_nos = set(Order.objects.values_list("sub_order_no", flat=True).distinct())
    orphan_pays   = pay_qs.exclude(sub_order_no__in=order_sub_nos).order_by("-order_date")
    pno_agg       = orphan_pays.aggregate(
        count=Count("sub_order_no", distinct=True),
        total_settlement=Sum("final_settlement_amount"),
    )

    summary = {
        "orders_no_payment": {
            "count":       onp_agg["count"] or 0,
            "total_value": float(onp_agg["total_value"] or 0),
        },
        "payments_no_order": {
            "count":            pno_agg["count"] or 0,
            "total_settlement": float(pno_agg["total_settlement"] or 0),
        },
    }

    start = (page - 1) * page_size
    if view == "payments":
        total   = pno_agg["count"] or 0
        items   = orphan_pays[start: start + page_size]
        results = OrderPaymentSerializer(items, many=True).data
    else:
        total   = onp_agg["count"] or 0
        items   = orders_no_pay[start: start + page_size]
        results = OrderSerializer(items, many=True).data

    return Response({
        **summary,
        "view":      view,
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "results":   results,
    })


@api_view(["GET"])
def return_claims_detail(request):
    """
    Grouped view of all RETURN / RTO / CLAIM orders.
    Returns one summary row per sub_order_no + all sub-payment rows.
    """
    from collections import defaultdict

    date_from     = request.GET.get("date_from",  "")
    date_to       = request.GET.get("date_to",    "")
    page          = int(request.GET.get("page",      1))
    page_size     = int(request.GET.get("page_size", 30))
    search        = request.GET.get("search",    "")
    status_filter = request.GET.get("status",    "")

    RETURN_STATUSES = ["RETURN", "RETURNED", "RTO", "RTO_COMPLETE"]

    base_qs = OrderPayment.objects.all()
    if date_from:
        base_qs = base_qs.filter(order_date__date__gte=date_from)
    if date_to:
        base_qs = base_qs.filter(order_date__date__lte=date_to)

    # Find qualifying sub_order_nos (have a return/RTO status OR a claims row)
    qualifying_ids = (
        base_qs
        .filter(DQ(live_order_status__in=RETURN_STATUSES) | DQ(claims__gt=0))
        .values_list("sub_order_no", flat=True)
        .distinct()
    )

    if search:
        qualifying_ids = (
            OrderPayment.objects
            .filter(
                sub_order_no__in=qualifying_ids,
            )
            .filter(
                DQ(sub_order_no__icontains=search) |
                DQ(supplier_sku__icontains=search) |
                DQ(product_name__icontains=search)
            )
            .values_list("sub_order_no", flat=True)
            .distinct()
        )

    if status_filter == "return":
        qualifying_ids = (
            OrderPayment.objects
            .filter(sub_order_no__in=qualifying_ids, live_order_status__iregex=r"^returned?$")
            .values_list("sub_order_no", flat=True).distinct()
        )
    elif status_filter == "rto":
        qualifying_ids = (
            OrderPayment.objects
            .filter(sub_order_no__in=qualifying_ids, live_order_status__in=["RTO", "RTO_COMPLETE"])
            .values_list("sub_order_no", flat=True).distinct()
        )
    elif status_filter == "claim":
        qualifying_ids = (
            OrderPayment.objects
            .filter(sub_order_no__in=qualifying_ids, claims__gt=0)
            .values_list("sub_order_no", flat=True).distinct()
        )

    qualifying_list = list(qualifying_ids)
    total = len(qualifying_list)

    # Paginate sub_order_nos
    start          = (page - 1) * page_size
    page_sub_orders = qualifying_list[start: start + page_size]

    # Fetch all payment rows for this page's orders
    all_rows = (
        OrderPayment.objects
        .filter(sub_order_no__in=page_sub_orders)
        # payment_date sorts ascending so the Return row (latest payment) is last
        .order_by("sub_order_no", "payment_date", "live_order_status")
    )

    groups: dict = defaultdict(list)
    for row in all_rows:
        groups[row.sub_order_no].append(row)

    results = []
    for sub_order_no in page_sub_orders:
        rows = groups.get(sub_order_no, [])

        # Use the same status-based precedence as compute_order_net
        c = _classify_rows(rows)
        settlement_rows, _ = _pick_settlement_rows(c)
        # Total settlement = status rows + adj rows (claims are now in P&L for all types)
        net_settlement = sum(float(r.final_settlement_amount or 0) for r in settlement_rows + c["adj"])
        total_claims     = sum(float(r.claims or 0) for r in rows)
        total_commission = sum(float(r.meesho_commission_incl_gst or 0) for r in rows)
        total_tcs        = sum(float(r.tcs or 0) for r in rows)
        total_tds        = sum(float(r.tds or 0) for r in rows)
        total_shipping   = sum(float(r.shipping_charge_incl_gst or 0) for r in rows)

        latest_status = (settlement_rows[-1].live_order_status
                         if settlement_rows else None)
        first = rows[0] if rows else None

        results.append({
            "sub_order_no":    sub_order_no,
            "sku":             first.supplier_sku if first else None,
            "product_name":    first.product_name if first else None,
            "order_date":      str(first.order_date.date()) if first and first.order_date else None,
            "latest_status":   latest_status,
            "net_settlement":  round(net_settlement,   2),
            "total_claims":    round(total_claims,     2),
            "total_commission": round(total_commission, 2),
            "total_tcs":       round(total_tcs,        2),
            "total_tds":       round(total_tds,        2),
            "total_shipping":  round(total_shipping,   2),
            "payment_count":   len(rows),
            "rows":            OrderPaymentSerializer(rows, many=True).data,
        })

    return Response({
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "results":   results,
    })


@api_view(["GET"])
def claimed_orders(request):
    """
    Orders where Meesho paid a claim (claims > 0 in any payment row).
    Supports: date_from, date_to, page, page_size,
              status (all/return/rto), sku, view (orders/sku)
    """
    from collections import defaultdict

    date_from     = request.GET.get("date_from",  "")
    date_to       = request.GET.get("date_to",    "")
    page          = int(request.GET.get("page",      1))
    page_size     = int(request.GET.get("page_size", 30))
    status_filter = request.GET.get("status", "")   # "" / "return" / "rto"
    sku_filter    = request.GET.get("sku",    "")
    view_mode     = request.GET.get("view",   "orders")  # "orders" / "sku"

    RETURN_STATUSES = ["RETURN", "RETURNED", "RTO", "RTO_COMPLETE", "PREMIUM_RETURN"]

    base_qs = OrderPayment.objects.all()
    if date_from:
        base_qs = base_qs.filter(order_date__date__gte=date_from)
    if date_to:
        base_qs = base_qs.filter(order_date__date__lte=date_to)

    # All sub_order_nos that have at least one claims > 0 row
    claimed_qs = base_qs.filter(claims__gt=0).values_list("sub_order_no", flat=True).distinct()

    # Status filter: narrow to orders that also have the matching status row
    if status_filter == "return":
        claimed_qs = (
            OrderPayment.objects
            .filter(sub_order_no__in=claimed_qs, live_order_status__iregex=r"^returned?$")
            .values_list("sub_order_no", flat=True).distinct()
        )
    elif status_filter == "rto":
        claimed_qs = (
            OrderPayment.objects
            .filter(sub_order_no__in=claimed_qs, live_order_status__in=["RTO", "RTO_COMPLETE"])
            .values_list("sub_order_no", flat=True).distinct()
        )

    # SKU filter
    if sku_filter:
        claimed_qs = (
            OrderPayment.objects
            .filter(sub_order_no__in=claimed_qs, supplier_sku__icontains=sku_filter)
            .values_list("sub_order_no", flat=True).distinct()
        )

    claimed_list = list(claimed_qs)
    total = len(claimed_list)

    # Summary stats across ALL matching orders (not just this page)
    all_rows_qs = OrderPayment.objects.filter(sub_order_no__in=claimed_list)
    total_claim_amount = float(
        all_rows_qs.aggregate(t=Sum("claims"))["t"] or 0
    )
    return_count = (
        OrderPayment.objects
        .filter(sub_order_no__in=claimed_list, live_order_status__iregex=r"^returned?$")
        .values("sub_order_no").distinct().count()
    )
    rto_count = (
        OrderPayment.objects
        .filter(sub_order_no__in=claimed_list, live_order_status__in=["RTO", "RTO_COMPLETE"])
        .values("sub_order_no").distinct().count()
    )

    # ── SKU-wise view ─────────────────────────────────────────────────────────
    if view_mode == "sku":
        sku_map: dict = defaultdict(lambda: {
            "sku": None, "product_name": None,
            "total_claims": 0.0, "order_count": 0,
            "return_count": 0, "rto_count": 0, "other_count": 0,
        })
        # Aggregate per (sub_order_no, sku) then roll up to sku
        rows_for_agg = (
            all_rows_qs
            .values("sub_order_no", "supplier_sku", "product_name", "live_order_status", "claims")
        )
        order_sku: dict = {}   # sub_order_no → sku
        order_claims: dict = defaultdict(float)
        order_status: dict = {}  # sub_order_no → primary status
        for r in rows_for_agg:
            so = r["sub_order_no"]
            if so not in order_sku:
                order_sku[so] = r["supplier_sku"]
                sku_map[r["supplier_sku"]]["sku"] = r["supplier_sku"]
                sku_map[r["supplier_sku"]]["product_name"] = r["product_name"]
            if r["claims"]:
                order_claims[so] += float(r["claims"])
            st = (r["live_order_status"] or "").upper()
            if st in ("RETURN",):
                order_status[so] = "return"
            elif st in ("RTO", "RTO_COMPLETE"):
                if order_status.get(so) != "return":
                    order_status[so] = "rto"
            elif st and order_status.get(so) not in ("return", "rto"):
                order_status[so] = "other"

        for so, sku in order_sku.items():
            b = sku_map[sku]
            b["order_count"] += 1
            b["total_claims"] = round(b["total_claims"] + order_claims.get(so, 0), 2)
            st = order_status.get(so, "other")
            b[f"{st}_count"] += 1

        sku_rows = sorted(sku_map.values(), key=lambda x: -x["total_claims"])
        start = (page - 1) * page_size
        return Response({
            "total": len(sku_rows), "page": page, "page_size": page_size,
            "total_claim_amount": round(total_claim_amount, 2),
            "return_count": return_count, "rto_count": rto_count,
            "results": sku_rows[start: start + page_size],
        })

    # ── Order-by-order view ───────────────────────────────────────────────────
    start           = (page - 1) * page_size
    page_sub_orders = claimed_list[start: start + page_size]

    page_rows = (
        OrderPayment.objects
        .filter(sub_order_no__in=page_sub_orders)
        .order_by("sub_order_no", "payment_date", "live_order_status")
    )
    groups: dict = defaultdict(list)
    for row in page_rows:
        groups[row.sub_order_no].append(row)

    results = []
    for so in page_sub_orders:
        rows = groups.get(so, [])
        c = _classify_rows(rows)
        settlement_rows, _ = _pick_settlement_rows(c)
        net_settlement = sum(float(r.final_settlement_amount or 0) for r in settlement_rows + c["adj"])
        order_claims_total = sum(float(r.claims or 0) for r in rows)
        first = rows[0] if rows else None

        statuses = [r.live_order_status for r in rows if r.live_order_status]
        _STATUS_PREF = {"RETURN": 0, "RTO": 1, "RTO_COMPLETE": 1, "PREMIUM_RETURN": 2,
                        "DELIVERED": 3, "EXCHANGE": 4, "CLAIM": 5, "CANCELLED": 6}
        primary_status = (
            min(statuses, key=lambda s: _STATUS_PREF.get(s.upper(), 99))
            if statuses else None
        )

        results.append({
            "sub_order_no":    so,
            "sku":             first.supplier_sku if first else None,
            "product_name":    first.product_name if first else None,
            "order_date":      str(first.order_date.date()) if first and first.order_date else None,
            "primary_status":  primary_status,
            "net_settlement":  round(net_settlement, 2),
            "total_claims":    round(order_claims_total, 2),
            "quantity":        first.quantity if first else None,
            "rows":            OrderPaymentSerializer(rows, many=True).data,
        })

    return Response({
        "total":              total,
        "page":               page,
        "page_size":          page_size,
        "total_claim_amount": round(total_claim_amount, 2),
        "return_count":       return_count,
        "rto_count":          rto_count,
        "results":            results,
    })


@api_view(["GET"])
def profit_summary(request):
    """
    Calculate overall Meesho profit.
    Accepts date_from / date_to (YYYY-MM-DD).
    Filters OrderPayment via Order.order_date join; falls back to
    OrderPayment.order_date__date if Order table has no records for range.
    """
    date_from = request.GET.get("date_from", "")
    date_to   = request.GET.get("date_to", "")

    qs = OrderPayment.objects.all()

    if date_from or date_to:
        ord_qs = Order.objects.all()
        if date_from:
            ord_qs = ord_qs.filter(order_date__gte=date_from)
        if date_to:
            ord_qs = ord_qs.filter(order_date__lte=date_to)
        # Use a DB subquery — avoids loading thousands of IDs into Python memory
        if ord_qs.exists():
            qs = qs.filter(sub_order_no__in=ord_qs.values("sub_order_no"))
        else:
            # Fallback: filter OrderPayment.order_date directly (DateTimeField)
            if date_from:
                qs = qs.filter(order_date__date__gte=date_from)
            if date_to:
                qs = qs.filter(order_date__date__lte=date_to)

    # Load pricing once (include item_price + tax_percent for tax cost calculation)
    _fp_all        = list(FinalPrice.objects.only("sku_id", "final_price", "packaging_cost", "parent_id", "item_price", "tax_percent"))
    price_map      = {fp.sku_id: fp.final_price    or Decimal("0") for fp in _fp_all}
    packaging_map  = {fp.sku_id: fp.packaging_cost or Decimal("0") for fp in _fp_all}
    item_price_map = {fp.sku_id: fp.item_price     or Decimal("0") for fp in _fp_all}
    tax_map        = {fp.sku_id: fp.tax_percent    or 0            for fp in _fp_all}
    sku_parent_map = {fp.sku_id: fp.parent_id for fp in _fp_all if fp.parent_id}

    # Build date-effective price history: {parent_id: [(effective_from, final_price, packaging_cost, item_price, tax_percent), ...]}
    from collections import defaultdict
    _hist = list(
        ParentPriceHistory.objects
        .values("parent_id", "effective_from", "final_price", "packaging_cost", "item_price", "tax_percent")
        .order_by("effective_from")
    )
    _parent_histories = defaultdict(list)
    for h in _hist:
        _parent_histories[h["parent_id"]].append((
            h["effective_from"],
            h["final_price"]    or Decimal("0"),
            h["packaging_cost"] or Decimal("0"),
            h["item_price"]     or Decimal("0"),
            h["tax_percent"]    or 0,
        ))

    def get_eff_price(sku_id, order_date):
        """Return (final_price, packaging_cost, item_price, tax_percent) effective on order_date."""
        if order_date:
            if hasattr(order_date, "date"):
                order_date = order_date.date()
            pid = sku_parent_map.get(sku_id)
            if pid:
                applicable = [(d, fp, pkg, ip, tax) for d, fp, pkg, ip, tax in _parent_histories[pid] if d <= order_date]
                if applicable:
                    _, fp, pkg, ip, tax = applicable[-1]
                    return fp, pkg, ip, tax
        return (
            price_map.get(sku_id,      Decimal("0")),
            packaging_map.get(sku_id,  Decimal("0")),
            item_price_map.get(sku_id, Decimal("0")),
            tax_map.get(sku_id, 0),
        )

    # Pre-fetch distinct statuses ONCE so _ensure_status_buckets can pre-initialise keys
    unique_statuses = list(["Cancelled", "Delivered", "Return", "RTO", "Shipped", "Exchange"])

    _FIELDS = (
        "sub_order_no", "supplier_sku", "quantity",
        "final_settlement_amount", "live_order_status",
        "recovery_reason", "claims", "return_shipping_charge",
        "order_date", "payment_date",
    )

    # Group ALL payment rows by sub_order_no
    order_groups = defaultdict(list)
    for payment in qs.only(*_FIELDS):
        order_groups[payment.sub_order_no].append(payment)

    order_wise_profit   = {}
    missing_sku         = []
    orders_with_price   = 0
    orders_missing_price = 0

    for _, payments in order_groups.items():
        primary = next((p for p in payments if p.live_order_status), payments[0])
        sku = primary.supplier_sku
        qty = primary.quantity or 1

        if not sku or sku not in price_map:
            missing_sku.append(sku)
            orders_missing_price += 1
            continue

        eff_price, eff_pkg, eff_item_price, eff_tax_pct = get_eff_price(sku, primary.order_date)
        result = compute_order_net(payments, eff_price, eff_pkg, qty, eff_item_price, eff_tax_pct)
        accumulate_sku_profit(sku, order_wise_profit, result, price_map, packaging_map, unique_statuses)
        orders_with_price += 1


    missing_sku          = list(set(missing_sku))
    total_profit         = sum(Decimal(str(v.get("delivered_profit", 0) or 0)) for v in order_wise_profit.values())
    total_loss           = sum(Decimal(str(v.get("return_loss",      0) or 0)) for v in order_wise_profit.values())
    total_rto_loss       = sum(Decimal(str(v.get("rto_loss",         0) or 0)) for v in order_wise_profit.values())
    total_other          = sum(Decimal(str(v.get("other_net",        0) or 0)) for v in order_wise_profit.values())
    # total_purchase_cost: DELIVERED-only item costs.
    # The frontend settlement table uses: delGross = total_profit + total_purchase_cost
    # so this must be delivered-only to correctly back out the gross delivered settlement.
    total_purchase_cost  = sum(Decimal(str(v.get("delivered_purchase_cost",  0) or 0)) for v in order_wise_profit.values())

    # total_deducted_cost: ALL costs actually subtracted from any settlement
    # (delivered + return-with-claim + rto-with-claim + adj-only-claim orders).
    # Used for net_settlement_revenue: the true Meesho payout = order_net_pl + total_deducted_cost.
    total_deducted_cost  = sum(Decimal(str(v.get("total_deducted_cost",      0) or 0)) for v in order_wise_profit.values())

    total_packaging_cost = sum(Decimal(str(v.get("total_packaging_cost", 0) or 0)) for v in order_wise_profit.values())
    total_tax_cost       = sum(Decimal(str(v.get("total_tax_cost",       0) or 0)) for v in order_wise_profit.values())

    # Counts per outcome (for rate calculations)
    total_delivered_count = sum(v.get("delivered_count", 0) for v in order_wise_profit.values())
    total_return_count    = sum(v.get("return_count",    0) for v in order_wise_profit.values())
    total_rto_count       = sum(v.get("rto_count",       0) for v in order_wise_profit.values())
    total_other_count     = sum(v.get("other_count",     0) for v in order_wise_profit.values())

    # Shipped-only orders — in-transit, excluded from P&L; tracked via per-order accumulation
    total_shipped_count          = sum(v.get("shipped_count",          0) for v in order_wise_profit.values())
    total_shipped_profit         = sum(Decimal(str(v.get("shipped_expected_profit", 0) or 0)) for v in order_wise_profit.values())
    total_shipped_settlement_exp = sum(Decimal(str(v.get("shipped_settlement",      0) or 0)) for v in order_wise_profit.values())
    total_shipped_sale_exp       = sum(Decimal(str(v.get("shipped_sale",            0) or 0)) for v in order_wise_profit.values())

    # Aggregate affiliate fees — blank-status rows, forced negative (always a cost)
    adj_qs = qs.filter(
    (DQ(live_order_status__isnull=True) | DQ(live_order_status="")) &
    DQ(recovery_reason="Affiliate Fee")
    )
    raw_aff = adj_qs.aggregate(total=Sum("final_settlement_amount"))["total"] or Decimal("0")
    total_affiliate_fee = -abs(raw_aff)

    # Approved claims (positive claims field = money credited to supplier)
    total_claims = (
        qs.filter(claims__gt=0).aggregate(total=Sum("claims"))["total"] or Decimal("0")
    )

    ads_qs = AdsCost.objects.all()
    if date_from:
        ads_qs = ads_qs.filter(deduction_date__gte=date_from)
    if date_to:
        ads_qs = ads_qs.filter(deduction_date__lte=date_to)
    raw_ads = ads_qs.aggregate(total=Sum("total_ads_cost"))["total"] or Decimal("0")
    # Ads cost is always a deduction from seller earnings. Meesho's Excel stores it
    # as a positive spend amount. Force negative so the formula: order_net_pl + ads
    # always subtracts the ad spend regardless of how it's stored.
    ads = -abs(raw_ads)

    ref_qs = ReferralPayment.objects.all()
    if date_from:
        ref_qs = ref_qs.filter(payment_date__gte=date_from)
    if date_to:
        ref_qs = ref_qs.filter(payment_date__lte=date_to)
    referral = ref_qs.aggregate(total=Sum("net_referral_amount"))["total"] or Decimal("0")

    comp_qs = CompensationRecovery.objects.all()
    if date_from:
        comp_qs = comp_qs.filter(date__gte=date_from)
    if date_to:
        comp_qs = comp_qs.filter(date__lte=date_to)
    comp_recovery = comp_qs.aggregate(total=Sum("amount_incl_gst"))["total"] or Decimal("0")

    # SHIPPED rows are PROVISIONAL — exclude them from ALL financial aggregates.
    # Rationale:
    #   • Shipped-only orders: still in transit, payment not yet earned.
    #   • Orders that progressed SHIPPED → DELIVERED/RETURN/RTO: the final
    #     status row has the actual settlement; SHIPPED row was just a preview.
    # Adjustment rows (live_order_status NULL/empty) are claims/affiliate fees
    # and must be INCLUDED — Django's exclude() leaves NULLs in.
    settled_qs = qs.exclude(
        DQ(live_order_status__iexact="shipped") | DQ(live_order_status__iexact="in transit")
    )

    agg = settled_qs.aggregate(
        revenue=Sum("final_settlement_amount"),
        gross_revenue=Sum("total_sale_amount"),
        total_commission=Sum("meesho_commission_incl_gst"),
        total_tcs=Sum("tcs"),
        total_tds=Sum("tds"),
        total_shipping=Sum("shipping_charge_incl_gst"),
    )

    revenue          = agg["revenue"]          or Decimal("0")
    gross_revenue    = agg["gross_revenue"]    or Decimal("0")
    total_commission = agg["total_commission"] or Decimal("0")
    total_tcs        = agg["total_tcs"]        or Decimal("0")
    total_tds        = agg["total_tds"]        or Decimal("0")
    total_shipping   = agg["total_shipping"]   or Decimal("0")

    # Compute P&L from per-order SKU numbers.
    # Claims are now included in settlement for all order types, so these numbers
    # already reflect the full settlement (status rows + adj rows) per order.
    #
    # total_profit    = sum of (full_settlement − item_cost)   for DELIVERED orders
    # total_loss      = sum of full_settlement                  for RETURN orders
    # total_rto_loss  = sum of full_settlement                  for RTO orders
    # total_other     = CANCELLED / EXCHANGE / adj-only orders
    order_net_pl = total_profit + total_loss + total_rto_loss + total_other

    # net_settlement_revenue = total money Meesho actually paid across all settled orders.
    #
    # Proof: for each order, settlement = net + deducted_cost
    #   DELIVERED:        settlement = (settlement - cost) + cost           = net + cost ✓
    #   RETURN (no claim): settlement = net + 0                             = net ✓
    #   RETURN+CLAIM:      settlement = (settlement - cost) + cost          = net + cost ✓
    #   ADJ-only claim:    settlement = (settlement - cost) + cost          = net + cost ✓
    #
    # Summing over all orders: Σsettlement = order_net_pl + total_deducted_cost
    # total_purchase_cost is DELIVERED-only (for the settlement table), so use total_deducted_cost here.
    net_settlement_revenue = order_net_pl + total_deducted_cost

    # Full Net P&L = order P&L + other income/costs
    # NOTE: item_price already includes packaging and tax as an all-in purchase cost.
    # total_packaging_cost and total_tax_cost are BREAKDOWN DISPLAYS only — they are
    # already embedded in purchase_cost (item_price × qty) and must NOT be subtracted again.
    # ads is forced negative above to guarantee it always reduces profit.
    net_revenue = order_net_pl + ads + comp_recovery + referral

    # Keep raw DB aggregate as informational (includes claims adj rows) — NOT used in P&L
    raw_settlement = revenue

    # Tax summary — what % of gross revenue was withheld as tax
    total_tax_withheld = total_tcs + total_tds
    tax_rate_pct = round(float(total_tax_withheld / gross_revenue * 100), 2) if gross_revenue else 0.0
    commission_rate_pct = round(float(total_commission / gross_revenue * 100), 2) if gross_revenue else 0.0
    total_deduction_rate_pct = round(float((total_tax_withheld + total_commission) / gross_revenue * 100), 2) if gross_revenue else 0.0

    settled_order_count = total_delivered_count + total_return_count + total_rto_count + total_other_count

    return Response({
        "gross_revenue":          round(gross_revenue, 2),
        "net_settlement_revenue": round(net_settlement_revenue, 2),
        "raw_settlement":         round(raw_settlement, 2),
        "total_purchase_cost":    round(total_purchase_cost, 2),
        "total_packaging_cost":   round(total_packaging_cost, 2),
        "total_tax_cost":         round(total_tax_cost, 2),
        "total_profit":           round(total_profit, 2),
        "total_loss":             round(total_loss, 2),
        "total_rto_loss":         round(total_rto_loss, 2),
        "total_other":            round(total_other, 2),
        "order_net_pl":           round(order_net_pl, 2),
        "net_revenue":            round(net_revenue, 2),
        "sku_wise_profit":        order_wise_profit,
        "orders_with_price":      orders_with_price,
        "orders_missing_price":   orders_missing_price,
        "orders_missing_sku":     len(missing_sku),
        "missing_sku":            missing_sku,
        "total_ads_cost":               round(ads, 2),
        "total_referral_income":        round(referral, 2),
        "total_compensation_recovery":  round(comp_recovery, 2),
        "total_commission_paid":        round(total_commission, 2),
        "total_tcs":                    round(total_tcs, 2),
        "total_tds":                    round(total_tds, 2),
        "total_shipping_cost":          round(total_shipping, 2),
        "total_claims":                 round(total_claims, 2),
        "total_affiliate_fee":          round(total_affiliate_fee, 2),
        "total_pure_returns":           total_return_count,
        "total_other_count":            total_other_count,
        "total_claimed_orders":         qs.filter(claims__gt=0).values("sub_order_no").distinct().count(),
        "order_count":                  len(order_groups),
        "adjustment_count":             adj_qs.count(),
        "ads_campaigns":                ads_qs.count(),
        "referral_count":               ref_qs.count(),
        "compensation_recovery_count":  comp_qs.count(),
        # Outcome counts for rate calculation
        "total_delivered_count": total_delivered_count,
        "total_return_count":    total_return_count,
        "total_rto_count":       total_rto_count,
        "settled_order_count":   settled_order_count,
        # In-transit shipped-only orders (excluded from P&L)
        "shipped_summary": {
            "count":           total_shipped_count,
            "expected_profit": round(float(total_shipped_profit), 2),
            "settlement_paid": round(float(total_shipped_settlement_exp), 2),
            "expected_sale":   round(float(total_shipped_sale_exp), 2),
        },
        # Tax / deduction rates (% of gross revenue)
        "tax_summary": {
            "total_tax_withheld":       round(float(total_tax_withheld), 2),
            "tax_rate_pct":             tax_rate_pct,
            "commission_rate_pct":      commission_rate_pct,
            "total_deduction_rate_pct": total_deduction_rate_pct,
        },
    })


@api_view(["GET"])
def order_payments_list(request):
    page = int(request.GET.get("page", 1))
    page_size = int(request.GET.get("page_size", 50))
    status_filter = request.GET.get("status", "")
    sku_filter = request.GET.get("sku", "")
    date_from = request.GET.get("date_from", "")
    date_to = request.GET.get("date_to", "")

    qs = OrderPayment.objects.all()
    if status_filter:
        qs = qs.filter(live_order_status__iexact=status_filter)
    if sku_filter:
        qs = qs.filter(DQ(supplier_sku__icontains=sku_filter) | DQ(sub_order_no__icontains=sku_filter))
    if date_from:
        date_from = datetime.strptime(date_from, "%Y-%m-%d").date()
        qs = qs.filter(order_date__gte=datetime.combine(date_from, time.min))
    if date_to:
        date_to = datetime.strptime(date_to, "%Y-%m-%d").date()
        qs = qs.filter(order_date__lte=datetime.combine(date_to, time.max))

    total = qs.count()
    start = (page - 1) * page_size
    items = qs[start: start + page_size]
    return Response({
        "total": total,
        "page": page,
        "page_size": page_size,
        "results": OrderPaymentSerializer(items, many=True).data,
    })


@api_view(["GET"])
def ads_cost_list(request):
    qs = AdsCost.objects.all()
    return Response(AdsCostSerializer(qs, many=True).data)


@api_view(["GET"])
def referral_list(request):
    qs = ReferralPayment.objects.all()
    return Response(ReferralPaymentSerializer(qs, many=True).data)


@api_view(["GET"])
def compensation_recovery_list(request):
    qs = CompensationRecovery.objects.all()
    return Response(CompensationRecoverySerializer(qs, many=True).data)


@api_view(["GET"])
def order_status_breakdown(request):
    breakdown = (
        OrderPayment.objects
        .values("live_order_status")
        .annotate(count=Count("sub_order_no"), total_revenue=Sum("final_settlement_amount"))
        .order_by("-count")
    )
    return Response(list(breakdown))


def _compute_purchase_cost():
    """Sum final_price × quantity for orders matched by supplier_sku → sku_id."""
    price_map = {
        fp.sku_id: fp.final_price or Decimal("0")
        for fp in FinalPrice.objects.all()
    }
    total = Decimal("0")
    matched = 0
    missing = 0
    missing_list = []
    for order in OrderPayment.objects.only("supplier_sku", "quantity"):
        sku = order.supplier_sku
        qty = order.quantity or 1
        if sku and sku in price_map:
            if price_map[sku] > 0:
                total += price_map[sku] * qty
            matched += 1
        elif sku:
            missing += 1
            missing_list.append(sku)
    return total, matched, missing, list(set(missing_list))


@api_view(["GET", "POST"])
def final_price_list(request):
    if request.method == "GET":
        search = request.GET.get("search", "")
        qs = FinalPrice.objects.all()
        if search:
            qs = qs.filter(sku_id__icontains=search)
        items = qs
        return Response({
            "results": FinalPriceSerializer(items, many=True).data,
        })

    serializer = FinalPriceSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data, status=status.HTTP_201_CREATED)

@api_view(["GET", "POST"])
def parent_price_list(request):
    if request.method == "GET":
        search = request.GET.get("search", "")
        qs = ParentItemPrice.objects.all()
        if search:
            qs = qs.filter(sku_id__icontains=search)
        items = qs
        return Response({
            "results": ParentItemPriceSerializer(items, many=True).data,
        })

    serializer = ParentItemPriceSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data, status=status.HTTP_201_CREATED)



@api_view(["GET", "PUT", "PATCH", "DELETE"])
def final_price_detail(request, sku_id):
    try:
        obj = FinalPrice.objects.get(pk=sku_id)
    except FinalPrice.DoesNotExist:
        return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        return Response(FinalPriceSerializer(obj).data)

    if request.method == "DELETE":
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    partial = request.method == "PATCH"
    serializer = FinalPriceSerializer(obj, data=request.data, partial=partial)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)

@api_view(["GET", "PUT", "PATCH", "DELETE"])
def parent_price_detail(request, item_id):
    print("is there")
    try:
        obj = ParentItemPrice.objects.get(pk=item_id)
    except ParentItemPrice.DoesNotExist:
        return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        return Response(ParentItemPriceSerializer(obj).data)

    if request.method == "DELETE":
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    partial = request.method == "PATCH"
    serializer = ParentItemPriceSerializer(obj, data=request.data, partial=partial)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)

@api_view(["POST", "PUT"])
def parent_linking_to_sku(request): 
    try:
        
        if request.method == "POST":
            serializer = ParentItemPriceSerializer(data=request.data)
        else:
            obj = ParentItemPrice.objects.get(pk=request.data["item_id"])
            serializer = ParentItemPriceSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)    
        parent = serializer.save()
    except Exception as e:
        return Response(
        {
            "message": f"Not Valid Parent {e}",
            "parent_id": request.data.get("item_id")
        },
        status=status.HTTP_400_BAD_REQUEST,
    )
           
    if request.method == "PUT":
        sku_ids = request.data.get("sku_ids", "")

        sku_ids = [
            sku.strip()
            for sku in sku_ids.split(",")
            if sku.strip()
        ]
        
        updated_count = FinalPrice.objects.filter(
            sku_id__in=sku_ids
        ).update(
            parent=parent,
            item_price=parent.item_price,
            tax_percent=parent.tax_percent,
            packaging_cost=parent.packaging_cost,
            final_price=parent.final_price,
        )

        return Response(
            {
                "message": f"{updated_count} SKU(s) linked successfully",
                "parent_id": parent.item_id,
                "sku_ids": sku_ids,
            },
            status=status.HTTP_200_OK,
        )
    else:
        return Response(
            {
                "message": "Parent Created successfully",
                "parent_id": parent.item_id
            },
            status=status.HTTP_200_OK,
        )
def _sync_parent_current_price(parent_id):
    """After adding/deleting a history entry, keep ParentItemPrice + linked FinalPrices in sync."""
    history = ParentPriceHistory.objects.filter(parent_id=parent_id).order_by("-effective_from").first()
    if not history:
        return
    ParentItemPrice.objects.filter(pk=parent_id).update(
        item_price=history.item_price,
        tax_percent=history.tax_percent,
        packaging_cost=history.packaging_cost,
        final_price=history.final_price,
    )
    FinalPrice.objects.filter(parent_id=parent_id).update(
        item_price=history.item_price,
        tax_percent=history.tax_percent,
        packaging_cost=history.packaging_cost,
        final_price=history.final_price,
    )


@api_view(["GET", "POST"])
def parent_price_history_list(request, item_id):
    try:
        parent = ParentItemPrice.objects.get(pk=item_id)
    except ParentItemPrice.DoesNotExist:
        return Response({"error": "Parent not found."}, status=404)

    if request.method == "GET":
        return Response(ParentPriceHistorySerializer(parent.price_history.all(), many=True).data)

    data = request.data.copy()
    data["parent"] = item_id
    if "item_price" in data and "final_price" not in data:
        ip  = Decimal(str(data.get("item_price") or 0))
        tax = Decimal(str(data.get("tax_percent") or 0)) / 100
        pkg = Decimal(str(data.get("packaging_cost") or 0))
        data["final_price"] = str((ip + ip * tax + pkg).quantize(Decimal("0.01")))

    serializer = ParentPriceHistorySerializer(data=data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    _sync_parent_current_price(item_id)
    return Response(serializer.data, status=201)


@api_view(["DELETE"])
def parent_price_history_detail(request, item_id, pk):
    try:
        obj = ParentPriceHistory.objects.get(pk=pk, parent_id=item_id)
    except ParentPriceHistory.DoesNotExist:
        return Response({"error": "Not found."}, status=404)
    obj.delete()
    _sync_parent_current_price(item_id)
    return Response({"deleted": True})


@api_view(["GET"])
def unlinked_skus(request):
    """Return FinalPrice SKUs not linked to any parent — used for autocomplete suggestions."""
    q = request.GET.get("q", "")
    qs = FinalPrice.objects.filter(parent__isnull=True)
    if q:
        qs = qs.filter(sku_id__icontains=q)
    return Response({"results": list(qs.values("sku_id", "item_price", "final_price")[:80])})


@api_view(["POST"])
@parser_classes([MultiPartParser])
def upload_final_price(request):
    """
    Upload an Excel or CSV sheet to upsert FinalPrice rows.
    Expected columns: sku_id, item_price, tax_percent, packaging_cost, final_price
    """
    file = request.FILES.get("file")
    if not file:
        return Response({"error": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        if file.name.lower().endswith((".xlsx", ".xls")):
            df = pd.read_excel(file)
        else:
            df = pd.read_csv(file)
    except Exception as e:
        return Response({"error": f"Could not read file: {e}"}, status=status.HTTP_400_BAD_REQUEST)

    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    if "sku_id" not in df.columns:
        return Response(
            {"error": "Missing required column: sku_id"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    created = updated = skipped = 0
    with transaction.atomic():
        for _, row in df.iterrows():
            pk = safe_str(row.get("sku_id"))
            if not pk:
                skipped += 1
                continue
            defaults = {}
            for col in ("item_price", "packaging_cost", "final_price", "tax_percent"):
                if col in df.columns:
                    if col == "tax_percent" : 
                        print(row.get(col))
                        defaults[col] = safe_int(row.get(col))
                    defaults[col] = safe_decimal(row.get(col))  
            _, was_created = FinalPrice.objects.update_or_create(
                sku_id=pk, defaults=defaults
            )
            if was_created:
                created += 1
            else:
                updated += 1

    return Response(
        {"success": True, "created": created, "updated": updated, "skipped": skipped},
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@parser_classes([MultiPartParser])
def upload_orders_csv(request):
    """
    Upload Orders CSV file and create/update Order records.
    """

    file = request.FILES.get("file")

    if not file:
        return Response(
            {"error": "No file provided"},
            status=status.HTTP_400_BAD_REQUEST
        )

    try:
        df = pd.read_csv(file)
    except Exception as e:
        return Response(
            {"error": f"Unable to read CSV: {str(e)}"},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Clean column names
    df.columns = [col.strip() for col in df.columns]

    created = 0
    updated = 0

    with transaction.atomic():
        for _, row in df.iterrows():

            sub_order_no = str(row.get("Sub Order No", "")).strip()

            if not sub_order_no:
                continue

            defaults = {
                "reason_for_credit_entry": str(
                    row.get("Reason for Credit Entry", "")
                ).strip(),
                "catalog_id": int(row.get("Catalog ID"))
                if pd.notna(row.get("Catalog ID"))
                else None,
                "order_date": pd.to_datetime(
                    row.get("Order Date")
                ).date()
                if pd.notna(row.get("Order Date"))
                else None,
                "order_source": str(
                    row.get("Order source", "")
                ).strip(),
                "customer_state": str(
                    row.get("Customer State", "")
                ).strip(),
                "product_name": str(
                    row.get("Product Name", "")
                ).strip(),
                "sku": str(
                    row.get("SKU", "")
                ).strip(),
                "size": str(
                    row.get("Size", "")
                ).strip(),
                "quantity": int(row.get("Quantity", 0))
                if pd.notna(row.get("Quantity"))
                else 0,
                "supplier_listed_price": row.get(
                    "Supplier Listed Price (Incl. GST + Commission)",
                    0
                ),
                "supplier_discounted_price": row.get(
                    "Supplier Discounted Price (Incl GST and Commision)",
                    0
                ),
                "packet_id": str(
                    row.get("Packet Id", "")
                ).strip(),
            }

            # Composite lookup: (sub_order_no, status, order_date).
            # A new status change on the same order creates a new row so that
            # the full lifecycle history is preserved.
            lookup_status     = defaults.pop("reason_for_credit_entry")
            lookup_order_date = defaults.pop("order_date")
            _, was_created = Order.objects.update_or_create(
                sub_order_no=sub_order_no,
                reason_for_credit_entry=lookup_status,
                order_date=lookup_order_date,
                defaults=defaults,
            )

            if was_created:
                created += 1
            else:
                updated += 1

    return Response(
        {
            "success": True,
            "created": created,
            "updated": updated,
            "total_rows": len(df),
        },
        status=status.HTTP_201_CREATED,
    )


# ── Full Orders (Order model) ─────────────────────────────────────────────────

@api_view(["GET"])
def full_orders_list(request):
    """Paginated list of Order rows with date/status/sku filters."""
    page = int(request.GET.get("page", 1))
    page_size = int(request.GET.get("page_size", 50))
    status_filter = request.GET.get("status", "")
    sku_filter = request.GET.get("sku", "")
    date_from = request.GET.get("date_from", "")
    date_to = request.GET.get("date_to", "")

    qs = Order.objects.all()
    if status_filter:
        qs = qs.filter(reason_for_credit_entry__iexact=status_filter)
    if sku_filter:
        qs = qs.filter(sku__icontains=sku_filter)
    if date_from:
        qs = qs.filter(order_date__gte=date_from)
    if date_to:
        qs = qs.filter(order_date__lte=date_to)

    total = qs.count()
    start = (page - 1) * page_size
    items = qs[start: start + page_size]
    return Response({
        "total": total,
        "page": page,
        "page_size": page_size,
        "results": OrderSerializer(items, many=True).data,
    })


@api_view(["GET"])
def full_orders_analytics(request):
    """Aggregate stats for Order model — drives the Orders tab summary cards."""
    date_from = request.GET.get("date_from", "")
    date_to = request.GET.get("date_to", "")

    date_filtered = Order.objects.all()
    if date_from:
        date_filtered = date_filtered.filter(order_date__gte=date_from)
    if date_to:
        date_filtered = date_filtered.filter(order_date__lte=date_to)

    # Use latest status per order so lifecycle updates don't double-count
    qs = Order.latest_per_order(base_qs=date_filtered)

    by_status = list(
        qs.values("reason_for_credit_entry")
        .annotate(
            count=Count("sub_order_no", distinct=True),
            total_listed=Sum("supplier_listed_price"),
            total_discounted=Sum("supplier_discounted_price"),
        )
    )

    by_state = list(
        qs.values("customer_state")
        .annotate(count=Count("sub_order_no", distinct=True))
        .order_by("-count")[:10]
    )

    by_sku = list(
        qs.values("sku")
        .annotate(count=Count("sub_order_no", distinct=True), total_qty=Sum("quantity"))
        .order_by("-count")[:20]
    )

    daily = list(
        qs.values("order_date")
        .annotate(count=Count("sub_order_no", distinct=True))
        .order_by("order_date")
    )

    return Response({
        "total": qs.count(),
        "by_status": by_status,
        "by_state": by_state,
        "by_sku": by_sku,
        "daily": daily,
    })


@api_view(["GET"])
def dashboard_analytics(request):
    """
    Primary filter: Order.order_date (reliable DateField).
    Then join OrderPayment by sub_order_no to find settled orders.
    Unsettled = orders in date range with no matching payment.
    """
    date_from = request.GET.get("date_from", "")
    date_to   = request.GET.get("date_to", "")

    # ── Step 1: filter Orders by placement date, then deduplicate to latest ──
    date_filtered_qs = Order.objects.all()
    if date_from:
        date_filtered_qs = date_filtered_qs.filter(order_date__gte=date_from)
    if date_to:
        date_filtered_qs = date_filtered_qs.filter(order_date__lte=date_to)

    # latest_per_order ensures each sub_order_no appears once (most-recent status row)
    order_qs  = Order.latest_per_order(base_qs=date_filtered_qs)
    order_nos = set(order_qs.values_list("sub_order_no", flat=True))

    # ── Step 2: find payments for those orders ────────────────────────────────
    payment_qs = (
        OrderPayment.objects.filter(sub_order_no__in=order_nos)
        if order_nos
        else OrderPayment.objects.none()
    )

    payment_nos = set(payment_qs.values_list("sub_order_no", flat=True).distinct())
    matched     = order_nos & payment_nos
    match_rate  = round(len(matched) / len(order_nos) * 100, 1) if order_nos else 0.0

    # ── Order aggregates (on latest-per-order queryset) ───────────────────────
    order_by_status = list(
        order_qs.values("reason_for_credit_entry")
        .annotate(
            count=Count("sub_order_no", distinct=True),
            total_value=Sum("supplier_discounted_price"),
        )
    )

    order_daily = list(
        order_qs.values("order_date")
        .annotate(count=Count("sub_order_no", distinct=True))
        .order_by("order_date")
        .values("order_date", "count")
    )

    # ── Payment aggregates ────────────────────────────────────────────────────
    payment_agg = payment_qs.aggregate(
        total_settlement=Sum("final_settlement_amount"),
        total_sale=Sum("total_sale_amount"),
        total_commission=Sum("meesho_commission_incl_gst"),
        total_tcs=Sum("tcs"),
        total_tds=Sum("tds"),
        settled_count=Count("sub_order_no", distinct=True),
    )

    payment_by_status = list(
        payment_qs.values("live_order_status")
        .annotate(
            count=Count("sub_order_no", distinct=True),
            total_settlement=Sum("final_settlement_amount"),
            total_sale=Sum("total_sale_amount"),
        )
    )

    payment_daily = list(
        payment_qs.exclude(payment_date=None)
        .values("payment_date")
        .annotate(
            count=Count("sub_order_no", distinct=True),
            total=Sum("final_settlement_amount"),
        )
        .order_by("payment_date")
        .values("payment_date", "count", "total")
    )

    # ── Per-status crosswalk ──────────────────────────────────────────────────
    status_settlement = []
    for row in order_by_status:
        status_val = row["reason_for_credit_entry"]
        sub_nos = list(
            order_qs.filter(reason_for_credit_entry=status_val)
            .values_list("sub_order_no", flat=True)
        )
        agg = payment_qs.filter(DQ(sub_order_no__in=sub_nos), DQ(claims=0) | DQ(claims__isnull=True)).aggregate(
            total=Sum("final_settlement_amount"),
            
            count=Count("sub_order_no", distinct=True),
        )
        status_settlement.append({
            "status": status_val,
            "order_count": row["count"],
            "settled_count": agg["count"] or 0,
            "settlement_amount": float(agg["total"] or 0),
            "order_value": float(row["total_value"] or 0),
        })

    # ── Unsettled orders summary (latest status per order, no payment row) ────
    unsettled_qs  = order_qs.exclude(sub_order_no__in=payment_nos)
    unsettled_agg = unsettled_qs.aggregate(total_value=Sum("supplier_discounted_price"))

    return Response({
        "order_stats": {
            "total": len(order_nos),
            "by_status": order_by_status,
            "daily": order_daily,
        },
        "payment_stats": {
            "total": len(payment_nos),
            "by_status": payment_by_status,
            "daily": payment_daily,
            "total_settlement": float(payment_agg["total_settlement"] or 0),
            "total_sale": float(payment_agg["total_sale"] or 0),
            "total_commission": float(payment_agg["total_commission"] or 0),
            "total_tcs": float(payment_agg["total_tcs"] or 0),
            "total_tds": float(payment_agg["total_tds"] or 0),
            "settled_count": payment_agg["settled_count"] or 0,
        },
        "join_stats": {
            "matched_count": len(matched),
            "unmatched_count": len(order_nos) - len(matched),
            "match_rate": match_rate,
        },
        "status_settlement": status_settlement,
        "unsettled": {
            "count": unsettled_qs.count(),
            "total_value": float(unsettled_agg["total_value"] or 0),
        },
    })


# ── Meesho Labels PDF helpers ─────────────────────────────────────────────────

def _parse_label_page(label_text, full_text, tables):
    """
    Extract all structured fields from a single label page.

    label_text  – pdfplumber text from label region only (above TAX INVOICE line)
    full_text   – full page text (needed for order date buried in invoice section)
    tables      – pdfplumber tables from the full page
    """
    import re
    from datetime import datetime as _dt

    r = {
        "customer_name": "", "customer_address": "",
        "customer_city": "", "customer_state": "", "customer_pincode": "",
        "courier_name": "", "awb_number": "", "payment_type": "", "pickup_date": "",
        "sku": "", "size": "", "qty": 1, "color": "", "order_id": "", "order_date": None,
    }

    lines = [l.strip() for l in label_text.split("\n") if l.strip()]

    # ── Customer address section ──────────────────────────────────────────────
    ca_idx    = next((i for i, l in enumerate(lines) if "Customer Address" in l), -1)
    undel_idx = next((i for i, l in enumerate(lines) if "If undelivered" in l), -1)
    if ca_idx >= 0 and undel_idx > ca_idx + 1:
        addr = lines[ca_idx + 1 : undel_idx]
        if addr:
            r["customer_name"] = addr[0]
            r["customer_address"] = "\n".join(addr[1:])
            last = addr[-1]
            m = re.match(r"^(.*),\s*([^,]{3,}),\s*(\d{6})\s*$", last)
            if m:
                r["customer_city"]    = m.group(1).strip().rstrip(",")
                r["customer_state"]   = m.group(2).strip()
                r["customer_pincode"] = m.group(3)

    # ── Payment type ──────────────────────────────────────────────────────────
    r["payment_type"] = (
        "Prepaid" if re.search(r"\bPrepaid\b", label_text, re.I)
        else "COD" if re.search(r"\bCOD\b", label_text, re.I)
        else ""
    )

    # ── Courier name ──────────────────────────────────────────────────────────
    for c in ("Shadowfax", "Delhivery", "Xpress Bees", "Valmo", "BlueDart", "Ekart", "DTDC"):
        if re.search(r"\b" + re.escape(c) + r"\b", label_text, re.I):
            r["courier_name"] = c
            break

    # ── Pickup date (Valmo prints "Pickup DD/MM" on the label) ───────────────
    pm = re.search(r"Pickup\s+(\d{2}/\d{2})", label_text)
    if pm:
        r["pickup_date"] = pm.group(1)

    # ── AWB number (standalone string just above "Product Details") ───────────
    # Each courier has a distinctive format:
    #   Valmo:       VL + 13 digits
    #   Shadowfax:   SF + digits + optional letters (e.g. SF3451319161FPL)
    #   Delhivery:   16-digit number
    #   Xpress Bees: 13-15 digit number
    for pat in (
        r"\b(VL\d{10,16})\b",
        r"\b(SF[0-9A-Z]{8,18})\b",
        r"\b(\d{16})\b",
        r"\b(\d{13,15})\b",
    ):
        m = re.search(pat, label_text)
        if m:
            r["awb_number"] = m.group(1)
            break

    # ── Pass 1: Product Details via pdfplumber table extraction ──────────────
    # The table header is: SKU | Size | Qty | Color | Order No.
    for table in (tables or []):
        for ri, row in enumerate(table or []):
            hdr = [str(c or "").strip().upper() for c in row]
            if "SKU" in hdr and "QTY" in hdr and ri + 1 < len(table):
                dr   = table[ri + 1]
                hdr_ = hdr   # capture for closure
                dr_  = dr

                def _g(name, _h=hdr_, _d=dr_):
                    try:
                        return str(_d[_h.index(name)] or "").strip()
                    except (ValueError, IndexError):
                        return ""

                r["sku"]      = " ".join(_g("SKU").split())
                r["size"]     = _g("SIZE")
                r["color"]    = _g("COLOR")
                r["order_id"] = _g("ORDER NO.")
                try:
                    r["qty"] = max(1, int(_g("QTY")))
                except ValueError:
                    pass
                break
        if r["sku"]:   # break on sku found, not order_id (order_id may be empty)
            break

    # ── Pass 2: text fallback when table extraction finds nothing ─────────────
    # Handles PDFs where Product Details has no border lines (pdfplumber can't
    # detect borderless text as a table). Looks for the header line then data.
    if not r["sku"]:
        # Pattern: after "SKU  Size  Qty  Color  Order No." header, parse data line
        m = re.search(
            r"SKU\s+Size\s+Qty\s+Color\s+Order\s*No\.\s*\n(.+?)(?:\n|$)",
            label_text, re.IGNORECASE,
        )
        if m:
            data_line = m.group(1).strip()
            # Most Meesho SKUs have no spaces; size field is "Free Size" or "X cm"
            size_m = re.search(r"\s+(Free\s+Size|\d+\s*[Cc][Mm])\s+", data_line, re.I)
            if size_m:
                r["sku"]  = data_line[:size_m.start()].strip()
                r["size"] = size_m.group(1).strip()
                after     = data_line[size_m.end():].strip()
                parts     = after.split()
                if parts:
                    try:
                        r["qty"] = max(1, int(parts[0]))
                    except ValueError:
                        pass
                    if len(parts) >= 2:
                        r["color"]    = parts[1]
                    if len(parts) >= 3:
                        r["order_id"] = parts[-1]
            else:
                # Last-resort: treat the last token as the order ID
                parts = data_line.split()
                if len(parts) >= 2 and re.match(r"\d+_\d+", parts[-1]):
                    r["order_id"] = parts[-1]
                    r["sku"]      = parts[0]

    # ── Order date from invoice section ───────────────────────────────────────
    dm = re.search(r"Order Date\s+(\d{2}\.\d{2}\.\d{4})", full_text)
    if dm:
        try:
            r["order_date"] = _dt.strptime(dm.group(1), "%d.%m.%Y").date()
        except ValueError:
            pass

    return r


# ── Meesho Labels PDF upload ──────────────────────────────────────────────────

@api_view(["POST"])
@parser_classes([MultiPartParser])
def upload_labels_pdf(request):
    """
    Upload a Meesho shipping labels PDF (one label per page).

    Each label page has two sections separated by "TAX INVOICE":
      - Upper half: shipping label with Product Details table (SKU, Size, Qty, Color, Order No.)
      - Lower half: tax invoice (excluded from cropped output)

    Strategy:
      1. Use pdfplumber table extraction to find the "Product Details" table and
         extract SKU + Qty precisely (handles multi-word/wrapped SKUs).
      2. Locate "TAX INVOICE" text to determine crop boundary per page.
      3. Use pypdf to crop each page to the label-only region and return as base64 PDF.
    """
    import io, re, base64

    try:
        import pdfplumber
    except ImportError:
        return Response({"error": "pdfplumber not installed. Run: pip install pdfplumber"},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    try:
        from pypdf import PdfReader, PdfWriter
        HAS_PYPDF = True
    except ImportError:
        HAS_PYPDF = False

    file = request.FILES.get("file")
    if not file:
        return Response({"error": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)
    if not file.name.lower().endswith(".pdf"):
        return Response({"error": "Only PDF files are accepted."}, status=status.HTTP_400_BAD_REQUEST)

    pdf_bytes = file.read()

    # ── Batch date: accept back-dated uploads ─────────────────────────────────
    # Caller can pass upload_date=YYYY-MM-DD in the form to record historical
    # label batches under a past date. Must be ≤ today; defaults to today.
    from datetime import date as _date_cls
    today = timezone.now().date()
    upload_date_str = request.data.get("upload_date", "").strip()
    if upload_date_str:
        try:
            candidate = _date_cls.fromisoformat(upload_date_str)
            if candidate <= today:
                today = candidate
        except ValueError:
            pass  # invalid format — fall back to today

    sku_data = {}
    page_details   = []
    crop_y_list    = []   # pdfplumber top-y for TAX INVOICE, per page
    pl_heights     = []   # pdfplumber page heights
    db_rows        = []   # parsed dicts ready for LabelOrder.update_or_create
    total_pages    = 0

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            total_pages = len(pdf.pages)

            for page_num, page in enumerate(pdf.pages, 1):
                pl_heights.append(page.height)

                # ── Locate TAX INVOICE separator ─────────────────────────────
                words  = page.extract_words()
                crop_y = page.height * 0.54
                for wi in range(len(words) - 1):
                    if (words[wi]["text"].upper() == "TAX"
                            and words[wi + 1]["text"].upper() == "INVOICE"):
                        crop_y = max(0.0, words[wi]["top"] - 6)
                        break
                crop_y_list.append(crop_y)

                # ── Extract text and tables ───────────────────────────────────
                # IMPORTANT: call extract_tables() and extract_text() on the
                # original page BEFORE any crop() calls — pdfplumber's internal
                # PDF object cache can be disrupted by crop() in some versions.
                tables    = page.extract_tables() or []
                full_text = page.extract_text() or ""

                # Derive label-only text by splitting at "TAX INVOICE"
                tax_pos    = full_text.upper().find("TAX INVOICE")
                label_text = full_text[:tax_pos].strip() if tax_pos > 0 else full_text

                # ── Parse all fields via helper ───────────────────────────────
                parsed = _parse_label_page(label_text, full_text, tables)

                # ── Accumulate SKU analytics ──────────────────────────────────
                sku, qty = parsed["sku"], parsed["qty"]
                if sku:
                    if sku not in sku_data:
                        sku_data[sku] = {"count": 0, "total_qty": 0, "max_qty": 0, "high_qty_orders": 0}
                    sku_data[sku]["count"]    += 1
                    sku_data[sku]["total_qty"] += qty
                    sku_data[sku]["max_qty"]   = max(sku_data[sku]["max_qty"], qty)
                    if qty > 1:
                        sku_data[sku]["high_qty_orders"] += 1

                page_details.append({"page": page_num, "sku": sku, "qty": qty,
                                     "courier": parsed["courier_name"], "awb": parsed["awb_number"]})

                # ── Queue DB row (only if we have an order_id) ────────────────
                if parsed["order_id"]:
                    db_rows.append({
                        "order_id":        parsed["order_id"],
                        "customer_name":   parsed["customer_name"],
                        "customer_address":parsed["customer_address"],
                        "customer_city":   parsed["customer_city"],
                        "customer_state":  parsed["customer_state"],
                        "customer_pincode":parsed["customer_pincode"],
                        "courier_name":    parsed["courier_name"],
                        "awb_number":      parsed["awb_number"],
                        "payment_type":    parsed["payment_type"],
                        "pickup_date":     parsed["pickup_date"],
                        "sku":             parsed["sku"],
                        "size":            parsed["size"],
                        "qty":             parsed["qty"],
                        "color":           parsed["color"],
                        "order_date":      parsed["order_date"],
                        "uploaded_date":   today,
                    })

    except Exception as exc:
        return Response({"error": f"Could not parse PDF: {exc}"},
                        status=status.HTTP_400_BAD_REQUEST)

    # ── Save parsed rows to DB ────────────────────────────────────────────────
    # Rule: uploaded_date is SET only when a record is FIRST created.
    # On re-upload the row's data (courier, AWB, SKU, address…) is refreshed
    # but uploaded_date stays untouched — so orders remain on their original
    # day and don't "move" when the same order appears in a later batch.
    #
    # Note: create_defaults (Django 5.0+) is not available; we use
    # get_or_create + filter().update() which achieves the same semantics
    # on Django 4.2.
    saved = updated = 0
    with transaction.atomic():
        for row in db_rows:
            oid         = row.pop("order_id")
            upload_date = row.pop("uploaded_date")  # only used on first INSERT

            _, created = LabelOrder.objects.get_or_create(
                order_id=oid,
                defaults={"uploaded_date": upload_date, **row},
            )
            if created:
                saved += 1
            else:
                # Refresh all data fields — but leave uploaded_date alone
                LabelOrder.objects.filter(order_id=oid).update(**row)
                updated += 1

    # ── Generate cropped PDF (label region only, sorted by SKU count desc) ──────
    # Build SKU rank so PDF page order matches the table (most-ordered SKU first)
    sku_rank = {
        sku: rank
        for rank, (sku, _) in enumerate(
            sorted(sku_data.items(), key=lambda x: -x[1]["count"])
        )
    }

    cropped_pdf_b64 = None
    if HAS_PYPDF:
        try:
            reader = PdfReader(io.BytesIO(pdf_bytes))
            writer = PdfWriter()
            # Sort pages: by SKU rank then original page index so within each SKU
            # group the original ordering is preserved; no-SKU pages go last.
            page_order = sorted(
                range(len(reader.pages)),
                key=lambda i: (
                    sku_rank.get(
                        page_details[i]["sku"] if i < len(page_details) else "",
                        len(sku_data),
                    ),
                    i,
                ),
            )
            for i in page_order:
                pg   = reader.pages[i]
                ph   = float(pg.mediabox.height)
                pw   = float(pg.mediabox.width)
                pl_h = pl_heights[i] if i < len(pl_heights) else ph
                scale = ph / pl_h if pl_h else 1.0
                crop  = crop_y_list[i] if i < len(crop_y_list) else ph * 0.54
                y_bot = max(0.0, ph - crop * scale)
                pg.cropbox.lower_left  = (0, y_bot)
                pg.cropbox.upper_right = (pw, ph)
                writer.add_page(pg)
            buf = io.BytesIO()
            writer.write(buf)
            cropped_pdf_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        except Exception:
            cropped_pdf_b64 = None

    # ── Build analytics response ──────────────────────────────────────────────
    sku_table = sorted(
        [{"sku": k, "count": v["count"], "total_qty": v["total_qty"],
          "max_qty": v["max_qty"], "high_qty_orders": v["high_qty_orders"]}
         for k, v in sku_data.items()],
        key=lambda x: -x["count"],
    )
    total_labels = sum(v["count"] for v in sku_data.values())

    # ── Flag blocked customers found in this upload ───────────────────────────
    blocked_set = set(
        BlockedCustomer.objects.filter(is_active=True)
        .values_list("customer_name", "customer_pincode")
    )
    blocked_in_batch = []
    for pd in page_details:
        name    = pd.get("customer_name", "")
        pincode = pd.get("customer_pincode", "")
        if name and (name, pincode) in blocked_set:
            blocked_in_batch.append({
                "order_id":       pd.get("order_id", ""),
                "customer_name":  name,
                "customer_pincode": pincode,
                "sku":            pd.get("sku", ""),
            })

    return Response({
        "success": True,
        "upload_date":      str(today),          # actual date used (may be back-dated)
        "total_pages":      total_pages,
        "total_unique_skus":len(sku_data),
        "total_labels":     total_labels,
        "has_results":      total_labels > 0,
        "has_high_qty":     any(v["high_qty_orders"] > 0 for v in sku_data.values()),
        "sku_table":        sku_table,
        "page_details":     page_details,
        "cropped_pdf_b64":  cropped_pdf_b64,
        "db_saved":         saved,
        "db_updated":       updated,
        "blocked_customers_found": blocked_in_batch,
    })


# ── Label Orders — read endpoints ─────────────────────────────────────────────

@api_view(["GET"])
def label_orders_list(request):
    """
    Paginated LabelOrder list.
    Query params: date (YYYY-MM-DD), date_from, date_to, courier, payment_type,
                  page, page_size
    """
    page        = int(request.GET.get("page", 1))
    page_size   = int(request.GET.get("page_size", 50))
    date_single = request.GET.get("date", "")
    date_from   = request.GET.get("date_from", "")
    date_to     = request.GET.get("date_to", "")
    courier     = request.GET.get("courier", "")
    pay_type    = request.GET.get("payment_type", "")

    qs = LabelOrder.objects.all()

    if date_single:
        qs = qs.filter(uploaded_date=date_single)
    else:
        if date_from:
            qs = qs.filter(uploaded_date__gte=date_from)
        if date_to:
            qs = qs.filter(uploaded_date__lte=date_to)

    if courier:
        qs = qs.filter(courier_name__iexact=courier)
    if pay_type:
        qs = qs.filter(payment_type__iexact=pay_type)

    total = qs.count()
    start = (page - 1) * page_size
    items = list(qs[start : start + page_size])

    # Annotate blocked status: build lookup set from active blocked customers
    blocked_set = set(
        BlockedCustomer.objects.filter(is_active=True)
        .values_list("customer_name", "customer_pincode")
    )

    serialized = LabelOrderSerializer(items, many=True).data
    for row in serialized:
        row["is_blocked"] = (row.get("customer_name", ""), row.get("customer_pincode", "")) in blocked_set

    return Response({
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "results":   serialized,
    })


@api_view(["GET"])
def label_couriers_summary(request):
    """
    Courier-wise order count for a date range.
    Query params: date (single day), date_from, date_to
    No date params = return all records.
    Also returns the list of available uploaded dates for the date-picker.
    """
    date_single = request.GET.get("date", "")
    date_from   = request.GET.get("date_from", "")
    date_to     = request.GET.get("date_to", "")

    qs = LabelOrder.objects.all()
    if date_single:
        qs = qs.filter(uploaded_date=date_single)
        filter_label = date_single
    elif date_from or date_to:
        if date_from:
            qs = qs.filter(uploaded_date__gte=date_from)
        if date_to:
            qs = qs.filter(uploaded_date__lte=date_to)
        filter_label = f"{date_from or '…'} → {date_to or '…'}"
    else:
        filter_label = "All"

    courier_rows = list(
        qs.values("courier_name")
        .annotate(
            count       = Count("order_id"),
            prepaid     = Count("order_id", filter=DQ(payment_type="Prepaid")),
            cod         = Count("order_id", filter=DQ(payment_type="COD")),
            total_items = Sum("qty"),
        )
        .order_by("-count")
    )

    sku_rows = list(
        qs.values("sku")
        .annotate(count=Count("order_id"), total_items=Sum("qty"))
        .order_by("-count")
    )

    available_dates = list(
        LabelOrder.objects
        .values_list("uploaded_date", flat=True)
        .distinct()
        .order_by("-uploaded_date")
    )

    return Response({
        "filter":          filter_label,
        "total":           qs.count(),
        "courier_summary": courier_rows,
        "sku_summary":     sku_rows,
        "available_dates": [str(d) for d in available_dates],
    })


@api_view(["GET"])
def label_duplicate_customers(request):
    """
    Find repeat customers by ADDRESS (city + state + pincode) — NOT by name.
    Returns addresses that appear in more than one LabelOrder.

    For each duplicate address, returns every order's full details so the
    frontend can display a complete history drawer.

    Query params: date_from, date_to (optional)
    """
    date_from = request.GET.get("date_from", "")
    date_to   = request.GET.get("date_to",   "")

    # Step 1: addresses that appear in the selected period
    period_qs = LabelOrder.objects.exclude(customer_pincode="").exclude(customer_city="")
    if date_from:
        period_qs = period_qs.filter(uploaded_date__gte=date_from)
    if date_to:
        period_qs = period_qs.filter(uploaded_date__lte=date_to)

    # Step 2: find which (pincode, city, state) tuples appear > 1 time all-time,
    # but only for addresses that show up in the requested period.
    period_addrs = set(
        period_qs.values_list("customer_pincode", "customer_city", "customer_state").distinct()
    )
    if not period_addrs:
        return Response({"total": 0, "results": []})

    from django.db.models import Q
    addr_filter = Q()
    for pin, city, state in period_addrs:
        addr_filter |= Q(customer_pincode=pin, customer_city=city, customer_state=state)

    all_time_qs = LabelOrder.objects.filter(addr_filter)

    # Aggregate per address
    addr_agg = list(
        all_time_qs
        .values("customer_pincode", "customer_city", "customer_state")
        .annotate(
            order_count=Count("order_id"),
            first_ordered=Min("uploaded_date"),
            last_ordered=Max("uploaded_date"),
        )
        .filter(order_count__gt=1)
        .order_by("-order_count")
    )

    results = []
    for agg in addr_agg:
        pin   = agg["customer_pincode"]
        city  = agg["customer_city"]
        state = agg["customer_state"]
        orders = list(
            LabelOrder.objects
            .filter(customer_pincode=pin, customer_city=city, customer_state=state)
            .values(
                "order_id", "customer_name", "customer_city", "customer_state",
                "customer_pincode", "uploaded_date", "courier_name", "awb_number",
                "payment_type", "sku", "qty", "is_packed",
            )
            .order_by("-uploaded_date")
        )
        results.append({
            "address_key":      f"{city}, {state} – {pin}",
            "customer_pincode": pin,
            "customer_city":    city,
            "customer_state":   state,
            "order_count":      agg["order_count"],
            "first_ordered":    str(agg["first_ordered"]),
            "last_ordered":     str(agg["last_ordered"]),
            "orders":           orders,
        })

    return Response({"total": len(results), "results": results})


@api_view(["GET"])
def label_customer_history(request):
    """
    Full order + settlement history for one customer.

    Query params (at least one required):
      name    – customer name (case-insensitive exact match)
      pincode – customer pincode (exact)

    Joins:
      LabelOrder  →  Order        (via order_id = sub_order_no) for delivery status
      LabelOrder  →  OrderPayment (via order_id = sub_order_no) for settlement
    """
    from datetime import date as _date, datetime as _datetime

    name    = request.GET.get("name", "").strip()
    pincode = request.GET.get("pincode", "").strip()

    if not name and not pincode:
        return Response({"error": "Provide at least name or pincode."}, status=400)

    qs = LabelOrder.objects.all()
    if name:
        qs = qs.filter(customer_name__iexact=name)
    if pincode:
        qs = qs.filter(customer_pincode=pincode)

    label_list = list(qs.order_by("-uploaded_date").values())
    if not label_list:
        return Response({"orders": [], "summary": {}, "customer_name": name})

    order_ids = [r["order_id"] for r in label_list]

    # Join OrderPayment
    payment_map = {
        p.sub_order_no: {
            "live_order_status":  p.live_order_status or "",
            "settlement_amount":  float(p.final_settlement_amount or 0),
            "total_sale_amount":  float(p.total_sale_amount or 0),
            "payment_date":       str(p.payment_date) if p.payment_date else None,
        }
        for p in OrderPayment.objects.filter(sub_order_no__in=order_ids)
    }

    # Join Order (lifecycle status)
    status_map = {
        o.sub_order_no: o.reason_for_credit_entry
        for o in Order.objects.filter(sub_order_no__in=order_ids)
    }

    # ── Enrich and accumulate ────────────────────────────────────────────────
    delivered = rto = cancelled = settled_count = 0
    total_settlement = 0.0
    enriched = []

    for lo in label_list:
        oid             = lo["order_id"]
        pmt             = payment_map.get(oid)
        delivery_status = status_map.get(oid, "")
        is_settled      = oid in payment_map
        amt             = pmt["settlement_amount"] if pmt else None

        if delivery_status == "DELIVERED":
            delivered += 1
        elif delivery_status == "RTO_COMPLETE":
            rto += 1
        elif delivery_status == "CANCELLED":
            cancelled += 1

        if is_settled:
            settled_count    += 1
            total_settlement += (amt or 0)

        # Serialize dates to strings
        row = {}
        for k, v in lo.items():
            if isinstance(v, (_date, _datetime)):
                row[k] = str(v)
            else:
                row[k] = v

        row.update({
            "delivery_status":   delivery_status,
            "live_order_status": pmt["live_order_status"] if pmt else "",
            "settlement_amount": amt,
            "total_sale_amount": pmt["total_sale_amount"] if pmt else None,
            "payment_date":      pmt["payment_date"] if pmt else None,
            "is_settled":        is_settled,
        })
        enriched.append(row)

    first = label_list[0]
    total = len(label_list)

    return Response({
        "customer_name":    first.get("customer_name", ""),
        "customer_address": first.get("customer_address", ""),
        "customer_city":    first.get("customer_city", ""),
        "customer_state":   first.get("customer_state", ""),
        "customer_pincode": first.get("customer_pincode", ""),
        "summary": {
            "total_orders":     total,
            "total_items":      sum(r.get("qty", 1) for r in label_list),
            "delivered":        delivered,
            "rto":              rto,
            "cancelled":        cancelled,
            "pending":          total - delivered - rto - cancelled,
            "settled_count":    settled_count,
            "total_settlement": round(total_settlement, 2),
        },
        "orders": enriched,
    })


# ── Purchases & Inventory ─────────────────────────────────────────────────────

def _bill_to_dict(bill):
    """Serialize a PurchaseBill (with pre-fetched items) to a plain dict."""
    total = Decimal("0")
    items = []
    for item in bill.items.all():
        item_total = item.quantity * item.price_per_unit if not item.is_exchange else Decimal("0")
        total += item_total
        items.append({
            "id":                  item.id,
            "parent_sku_id":       item.parent_sku_id,
            "product_description": item.product_description,
            "quantity":            item.quantity,
            "price_per_unit":      str(item.price_per_unit),
            "is_exchange":         item.is_exchange,
            "total_amount":        str(item_total),
        })
    return {
        "id":           bill.id,
        "date":         str(bill.date),
        "seller_name":  bill.seller_name,
        "bill_number":  bill.bill_number,
        "notes":        bill.notes,
        "total_amount": str(total),
        "items":        items,
        "created_at":   bill.created_at.isoformat(),
    }


@api_view(["GET", "POST"])
def purchases_list(request):
    if request.method == "GET":
        qs = PurchaseBill.objects.prefetch_related("items").order_by("-date", "-created_at")
        date_from = request.GET.get("date_from")
        date_to   = request.GET.get("date_to")
        seller    = request.GET.get("seller", "").strip()
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)
        if seller:
            qs = qs.filter(seller_name__icontains=seller)
        bills = [_bill_to_dict(b) for b in qs]
        return Response({"results": bills, "total": len(bills)})

    # POST — create new bill with nested items
    data = request.data
    with transaction.atomic():
        bill = PurchaseBill.objects.create(
            date=data["date"],
            seller_name=data["seller_name"],
            bill_number=data.get("bill_number", ""),
            notes=data.get("notes", ""),
        )
        for it in data.get("items", []):
            PurchaseItem.objects.create(
                bill=bill,
                parent_sku_id=it.get("parent_sku_id") or None,
                product_description=it.get("product_description", ""),
                quantity=int(it["quantity"]),
                price_per_unit=Decimal(str(it["price_per_unit"])),
                is_exchange=bool(it.get("is_exchange", False)),
            )
    bill.refresh_from_db()
    bill.items.all()  # warm cache
    return Response(_bill_to_dict(PurchaseBill.objects.prefetch_related("items").get(pk=bill.pk)), status=201)


@api_view(["GET", "PUT", "DELETE"])
def purchase_detail(request, bill_id):
    try:
        bill = PurchaseBill.objects.prefetch_related("items").get(pk=bill_id)
    except PurchaseBill.DoesNotExist:
        return Response({"error": "Not found"}, status=404)

    if request.method == "GET":
        return Response(_bill_to_dict(bill))

    if request.method == "PUT":
        data = request.data
        with transaction.atomic():
            bill.date        = data.get("date", bill.date)
            bill.seller_name = data.get("seller_name", bill.seller_name)
            bill.bill_number = data.get("bill_number", bill.bill_number)
            bill.notes       = data.get("notes", bill.notes)
            bill.save()
            # Replace all items
            bill.items.all().delete()
            for it in data.get("items", []):
                PurchaseItem.objects.create(
                    bill=bill,
                    parent_sku_id=it.get("parent_sku_id") or None,
                    product_description=it.get("product_description", ""),
                    quantity=int(it["quantity"]),
                    price_per_unit=Decimal(str(it["price_per_unit"])),
                    is_exchange=bool(it.get("is_exchange", False)),
                )
        bill = PurchaseBill.objects.prefetch_related("items").get(pk=bill_id)
        return Response(_bill_to_dict(bill))

    # DELETE
    bill.delete()
    return Response({"message": "Deleted"})


@api_view(["GET"])
def purchase_pdf(request, bill_id):
    """Generate and stream a PDF receipt for one purchase bill."""
    from io import BytesIO
    from django.http import HttpResponse
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable,
    )
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT

    try:
        bill = PurchaseBill.objects.prefetch_related("items").get(pk=bill_id)
    except PurchaseBill.DoesNotExist:
        return HttpResponse("Not found", status=404)

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm,
        topMargin=18*mm, bottomMargin=18*mm,
    )
    W = A4[0] - 40*mm  # usable width

    orange = colors.HexColor("#E8510A")
    gray50 = colors.HexColor("#F9FAFB")
    gray200 = colors.HexColor("#E5E7EB")
    gray700 = colors.HexColor("#374151")

    title_style  = ParagraphStyle("title",  fontSize=20, fontName="Helvetica-Bold", textColor=orange, spaceAfter=2)
    sub_style    = ParagraphStyle("sub",    fontSize=10, fontName="Helvetica",      textColor=colors.HexColor("#6B7280"), spaceAfter=4)
    label_style  = ParagraphStyle("lbl",    fontSize=9,  fontName="Helvetica-Bold", textColor=gray700)
    value_style  = ParagraphStyle("val",    fontSize=9,  fontName="Helvetica",      textColor=gray700)
    total_style  = ParagraphStyle("tot",    fontSize=12, fontName="Helvetica-Bold", textColor=orange, alignment=TA_RIGHT)

    elems = []

    # Header
    # Brand header: Rudam + bill title on same line
    brand_style = ParagraphStyle("brand", fontSize=26, fontName="Helvetica-Bold",
                                  textColor=colors.HexColor("#E8510A"), spaceAfter=0)
    tagline_style = ParagraphStyle("tagline", fontSize=9, fontName="Helvetica",
                                   textColor=colors.HexColor("#9CA3AF"), spaceAfter=6)
    brand_tbl = Table(
        [[Paragraph("RUDAM", brand_style), Paragraph("PURCHASE BILL", title_style)]],
        colWidths=[W * 0.4, W * 0.6],
    )
    brand_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("ALIGN",  (1, 0), (1, 0),  "RIGHT"),
    ]))
    elems.append(brand_tbl)
    elems.append(Paragraph("Official Purchase Record", tagline_style))
    elems.append(HRFlowable(width=W, thickness=1, color=orange, spaceAfter=10))

    # Meta info table (left: labels, right: values)
    bill_no_display = bill.bill_number or f"#{bill.id}"
    meta = [
        [Paragraph("Bill No:", label_style),   Paragraph(bill_no_display, value_style),
         Paragraph("Date:", label_style),       Paragraph(str(bill.date), value_style)],
        [Paragraph("Seller:", label_style),     Paragraph(bill.seller_name, value_style),
         Paragraph("", label_style),            Paragraph("", value_style)],
    ]
    if bill.notes:
        meta.append([Paragraph("Notes:", label_style), Paragraph(bill.notes, value_style), Paragraph("", label_style), Paragraph("", value_style)])
    meta_tbl = Table(meta, colWidths=[22*mm, W/2 - 22*mm, 22*mm, W/2 - 22*mm])
    meta_tbl.setStyle(TableStyle([
        ("VALIGN",    (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    elems.append(meta_tbl)
    elems.append(Spacer(1, 10))
    elems.append(HRFlowable(width=W, thickness=0.5, color=gray200, spaceAfter=8))

    # Items table
    col_w = [W * f for f in (0.20, 0.35, 0.10, 0.15, 0.15, 0.05)]
    hdr = [
        Paragraph("<b>SKU</b>", label_style),
        Paragraph("<b>Description</b>", label_style),
        Paragraph("<b>Qty</b>", label_style),
        Paragraph("<b>Price/Unit</b>", label_style),
        Paragraph("<b>Total</b>", label_style),
        Paragraph("<b>Exch</b>", label_style),
    ]
    rows = [hdr]
    grand_total = Decimal("0")
    for item in bill.items.all():
        line_total = item.quantity * item.price_per_unit if not item.is_exchange else Decimal("0")
        grand_total += line_total
        rows.append([
            Paragraph(item.parent_sku_id or "—", value_style),
            Paragraph(item.product_description or "—", value_style),
            Paragraph(str(item.quantity), value_style),
            Paragraph(f"₹{item.price_per_unit}", value_style),
            Paragraph(f"₹{line_total}", value_style),
            Paragraph("Y" if item.is_exchange else "N", value_style),
        ])
    # Total row
    rows.append([
        Paragraph("", value_style), Paragraph("", value_style),
        Paragraph("", value_style), Paragraph("<b>TOTAL</b>", label_style),
        Paragraph(f"<b>₹{grand_total}</b>", label_style),
        Paragraph("", value_style),
    ])

    items_tbl = Table(rows, colWidths=col_w)
    items_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0),  gray50),
        ("GRID",          (0, 0), (-1, -2), 0.4, gray200),
        ("LINEABOVE",     (0, -1), (-1, -1), 1, orange),
        ("BACKGROUND",    (0, -1), (-1, -1), colors.HexColor("#FFF0EA")),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 5),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 5),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]))
    elems.append(items_tbl)
    elems.append(Spacer(1, 14))

    # Grand total callout
    elems.append(Paragraph(f"Grand Total: ₹{grand_total}", total_style))
    elems.append(Spacer(1, 6))
    elems.append(HRFlowable(width=W, thickness=0.5, color=gray200))
    elems.append(Spacer(1, 8))
    elems.append(Paragraph("Rudam — Generated by Meesho Profit Tracker", sub_style))

    doc.build(elems)
    buf.seek(0)
    filename = f"purchase_bill_{bill.bill_number or bill.id}.pdf"
    resp = HttpResponse(buf.read(), content_type="application/pdf")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp


@api_view(["GET"])
def inventory_view(request):
    """
    Compute current stock per parent SKU:
      current_stock = purchased_qty (non-exchange) - sold_qty (DELIVERED) + rto_qty (RTO_COMPLETE) + net_adjustments
    Also returns parent SKUs that have only adjustments (no purchases) so manual-only SKUs appear.
    """
    from django.db.models import ExpressionWrapper, F, DecimalField as DField

    # 1. Purchases per parent SKU
    purchase_agg = (
        PurchaseItem.objects
        .filter(is_exchange=False, parent_sku__isnull=False)
        .values("parent_sku_id")
        .annotate(
            purchased_qty=Sum("quantity"),
            purchase_value=Sum(
                ExpressionWrapper(F("quantity") * F("price_per_unit"), output_field=DField(max_digits=14, decimal_places=2))
            ),
        )
    )
    purchased_by_parent = {
        r["parent_sku_id"]: {"qty": r["purchased_qty"], "value": r["purchase_value"]}
        for r in purchase_agg
    }

    # 2. Manual adjustments per parent SKU
    adj_agg = (
        InventoryAdjustment.objects
        .values("parent_sku_id")
        .annotate(net_adj=Sum("quantity"))
    )
    adj_by_parent = {r["parent_sku_id"]: r["net_adj"] for r in adj_agg}

    # Merge: all parent SKUs that appear in either purchases or adjustments
    all_parent_ids = set(purchased_by_parent.keys()) | set(adj_by_parent.keys())
    if not all_parent_ids:
        return Response({"results": [], "total": 0})

    # 3. Map child SKU → parent SKU
    sku_to_parent = dict(
        FinalPrice.objects
        .filter(parent_id__in=all_parent_ids)
        .values_list("sku_id", "parent_id")
    )

    # 4. Sold qty (DELIVERED) and returned qty (RTO_COMPLETE) per child SKU
    child_skus = list(sku_to_parent.keys())
    delivered_by_sku = dict(
        Order.objects
        .filter(reason_for_credit_entry="DELIVERED", sku__in=child_skus)
        .values("sku")
        .annotate(qty=Sum("quantity"))
        .values_list("sku", "qty")
    )
    rto_by_sku = dict(
        Order.objects
        .filter(reason_for_credit_entry="RTO_COMPLETE", sku__in=child_skus)
        .values("sku")
        .annotate(qty=Sum("quantity"))
        .values_list("sku", "qty")
    )

    # 5. Roll up child → parent
    sold_by_parent = {}
    rto_by_parent  = {}
    for sku, qty in delivered_by_sku.items():
        parent = sku_to_parent.get(sku)
        if parent:
            sold_by_parent[parent] = sold_by_parent.get(parent, 0) + qty
    for sku, qty in rto_by_sku.items():
        parent = sku_to_parent.get(sku)
        if parent:
            rto_by_parent[parent] = rto_by_parent.get(parent, 0) + qty

    # 6. Last purchase date per parent SKU
    last_purchase = dict(
        PurchaseItem.objects
        .filter(parent_sku_id__in=all_parent_ids)
        .values("parent_sku_id")
        .annotate(last=Max("bill__date"))
        .values_list("parent_sku_id", "last")
    )

    results = []
    for parent_id in all_parent_ids:
        pdata    = purchased_by_parent.get(parent_id, {"qty": 0, "value": Decimal("0")})
        purchased = pdata["qty"]
        sold      = sold_by_parent.get(parent_id, 0)
        rto       = rto_by_parent.get(parent_id, 0)
        net_adj   = adj_by_parent.get(parent_id, 0)
        results.append({
            "sku_id":          parent_id,
            "purchased_qty":   purchased,
            "sold_qty":        sold,
            "rto_qty":         rto,
            "adjustment_qty":  net_adj,
            "current_stock":   purchased - sold + rto + net_adj,
            "purchase_value":  str(pdata["value"] or 0),
            "last_purchase":   str(last_purchase.get(parent_id, "")),
        })

    results.sort(key=lambda r: r["current_stock"])
    return Response({"results": results, "total": len(results)})


@api_view(["GET", "POST"])
def inventory_adjustment_list(request):
    """List or create manual inventory adjustments for a parent SKU."""
    parent_sku_id = request.GET.get("parent_sku", "").strip() if request.method == "GET" else request.data.get("parent_sku_id", "").strip()

    if request.method == "GET":
        if not parent_sku_id:
            return Response({"error": "parent_sku required"}, status=400)
        adjs = InventoryAdjustment.objects.filter(parent_sku_id=parent_sku_id).order_by("-date", "-created_at")
        results = [{
            "id":         a.id,
            "quantity":   a.quantity,
            "reason":     a.reason,
            "reason_display": dict(InventoryAdjustment.REASON_CHOICES).get(a.reason, a.reason),
            "notes":      a.notes,
            "date":       str(a.date),
            "created_at": a.created_at.isoformat(),
        } for a in adjs]
        return Response({"results": results, "total": len(results)})

    # POST
    data = request.data
    parent_sku_id = data.get("parent_sku_id", "").strip()
    if not parent_sku_id:
        return Response({"error": "parent_sku_id required"}, status=400)
    try:
        qty = int(data.get("quantity", 0))
    except (TypeError, ValueError):
        return Response({"error": "quantity must be an integer"}, status=400)
    if qty == 0:
        return Response({"error": "quantity cannot be zero"}, status=400)

    parent = ParentItemPrice.objects.filter(pk=parent_sku_id).first()
    if not parent:
        return Response({"error": f"Parent SKU '{parent_sku_id}' not found"}, status=404)

    adj = InventoryAdjustment.objects.create(
        parent_sku=parent,
        quantity=qty,
        reason=data.get("reason", "OTHER"),
        notes=data.get("notes", ""),
        date=data.get("date"),
    )
    return Response({
        "id":         adj.id,
        "quantity":   adj.quantity,
        "reason":     adj.reason,
        "reason_display": dict(InventoryAdjustment.REASON_CHOICES).get(adj.reason, adj.reason),
        "notes":      adj.notes,
        "date":       str(adj.date),
        "created_at": adj.created_at.isoformat(),
    }, status=201)


@api_view(["PUT", "DELETE"])
def inventory_adjustment_detail(request, adj_id):
    """Update or delete a single inventory adjustment."""
    try:
        adj = InventoryAdjustment.objects.get(pk=adj_id)
    except InventoryAdjustment.DoesNotExist:
        return Response({"error": "Not found"}, status=404)

    if request.method == "PUT":
        data = request.data
        try:
            qty = int(data.get("quantity", adj.quantity))
        except (TypeError, ValueError):
            return Response({"error": "quantity must be an integer"}, status=400)
        if qty == 0:
            return Response({"error": "quantity cannot be zero"}, status=400)
        adj.quantity = qty
        adj.reason   = data.get("reason", adj.reason)
        adj.notes    = data.get("notes", adj.notes)
        if data.get("date"):
            adj.date = data["date"]
        adj.save()
        return Response({
            "id":           adj.id,
            "quantity":     adj.quantity,
            "reason":       adj.reason,
            "reason_display": dict(InventoryAdjustment.REASON_CHOICES).get(adj.reason, adj.reason),
            "notes":        adj.notes,
            "date":         str(adj.date),
            "created_at":   adj.created_at.isoformat(),
        })

    # DELETE
    adj.delete()
    return Response({"message": "Deleted"})


@api_view(["POST"])
def inventory_create_sku(request):
    """Create a new Parent SKU directly from the inventory screen."""
    data = request.data
    sku_id = (data.get("sku_id") or "").strip()
    if not sku_id:
        return Response({"error": "sku_id is required"}, status=400)
    if ParentItemPrice.objects.filter(pk=sku_id).exists():
        return Response({"error": f"Parent SKU '{sku_id}' already exists"}, status=409)

    with transaction.atomic():
        parent = ParentItemPrice.objects.create(
            item_id=sku_id,
            item_price=data.get("item_price") or None,
            tax_percent=data.get("tax_percent") or None,
            packaging_cost=data.get("packaging_cost") or None,
            final_price=data.get("final_price") or None,
        )
        # Optional: add initial stock as a purchase bill
        init_qty = int(data.get("initial_qty") or 0)
        if init_qty > 0:
            price_per_unit = Decimal(str(data.get("initial_price") or "0"))
            bill = PurchaseBill.objects.create(
                date=data.get("initial_date") or timezone.now().date(),
                seller_name=data.get("initial_seller") or "Opening Stock",
                bill_number="",
                notes="Initial stock — created from Inventory",
            )
            PurchaseItem.objects.create(
                bill=bill,
                parent_sku=parent,
                product_description="Opening stock",
                quantity=init_qty,
                price_per_unit=price_per_unit,
                is_exchange=False,
            )

    return Response({"sku_id": parent.item_id, "message": "Created"}, status=201)


# ── Purchase item-level CRUD ──────────────────────────────────────────────────

@api_view(["GET"])
def purchase_sku_items(request):
    """All PurchaseItems for a given parent_sku, with bill metadata."""
    parent_sku = request.GET.get("parent_sku", "").strip()
    if not parent_sku:
        return Response({"error": "parent_sku required"}, status=400)
    items = (
        PurchaseItem.objects
        .filter(parent_sku_id=parent_sku)
        .select_related("bill")
        .order_by("-bill__date", "-bill__id")
    )
    results = []
    for it in items:
        results.append({
            "id":                  it.id,
            "bill_id":             it.bill_id,
            "bill_number":         it.bill.bill_number or f"#{it.bill_id}",
            "bill_date":           str(it.bill.date),
            "seller_name":         it.bill.seller_name,
            "product_description": it.product_description,
            "quantity":            it.quantity,
            "price_per_unit":      str(it.price_per_unit),
            "is_exchange":         it.is_exchange,
            "total_amount":        str(it.quantity * it.price_per_unit if not it.is_exchange else 0),
        })
    return Response({"results": results, "total": len(results)})


@api_view(["PUT", "DELETE"])
def purchase_item_detail(request, item_id):
    try:
        item = PurchaseItem.objects.select_related("bill").get(pk=item_id)
    except PurchaseItem.DoesNotExist:
        return Response({"error": "Not found"}, status=404)

    if request.method == "PUT":
        data = request.data
        item.product_description = data.get("product_description", item.product_description)
        item.quantity            = int(data.get("quantity", item.quantity))
        item.price_per_unit      = Decimal(str(data.get("price_per_unit", item.price_per_unit)))
        item.is_exchange         = bool(data.get("is_exchange", item.is_exchange))
        item.save()
        return Response({
            "id":             item.id,
            "quantity":       item.quantity,
            "price_per_unit": str(item.price_per_unit),
            "is_exchange":    item.is_exchange,
            "total_amount":   str(item.quantity * item.price_per_unit if not item.is_exchange else 0),
        })

    # DELETE
    bill = item.bill
    item.delete()
    # If no items left on the bill, delete the bill too
    if not bill.items.exists():
        bill.delete()
    return Response({"message": "Item deleted"})


@api_view(["GET"])
def purchase_sku_monthly(request):
    """Monthly purchase aggregates for a parent SKU."""
    parent_sku = request.GET.get("parent_sku", "").strip()
    if not parent_sku:
        return Response({"error": "parent_sku required"}, status=400)
    from django.db.models.functions import TruncMonth
    from django.db.models import ExpressionWrapper as EW, F as Fld, DecimalField as DField
    rows = (
        PurchaseItem.objects
        .filter(parent_sku_id=parent_sku, is_exchange=False)
        .annotate(month=TruncMonth("bill__date"))
        .values("month")
        .annotate(
            total_qty=Sum("quantity"),
            total_value=Sum(
                EW(Fld("quantity") * Fld("price_per_unit"), output_field=DField(max_digits=14, decimal_places=2))
            ),
            bill_count=Count("bill_id", distinct=True),
        )
        .order_by("month")
    )
    results = [{
        "month":       r["month"].strftime("%Y-%m") if r["month"] else "",
        "label":       r["month"].strftime("%b %Y") if r["month"] else "",
        "total_qty":   r["total_qty"],
        "total_value": str(r["total_value"] or 0),
        "bill_count":  r["bill_count"],
    } for r in rows]
    return Response({"results": results, "sku_id": parent_sku})


# ── Label packing ──────────────────────────────────────────────────────────────

@api_view(["PATCH"])
def label_order_pack(request, order_id):
    """Toggle or set is_packed on a LabelOrder."""
    try:
        lo = LabelOrder.objects.get(pk=order_id)
    except LabelOrder.DoesNotExist:
        return Response({"error": "Not found"}, status=404)

    force = request.data.get("packed")   # None = toggle, True/False = set
    if force is None:
        lo.is_packed = not lo.is_packed
    else:
        lo.is_packed = bool(force)

    lo.packed_at = timezone.now() if lo.is_packed else None
    lo.save(update_fields=["is_packed", "packed_at"])
    return Response({"order_id": order_id, "is_packed": lo.is_packed})


@api_view(["POST"])
def label_bulk_pack(request):
    """Mark a list of order_ids as packed=True/False."""
    order_ids = request.data.get("order_ids", [])
    packed    = bool(request.data.get("packed", True))
    packed_at = timezone.now() if packed else None
    updated   = LabelOrder.objects.filter(order_id__in=order_ids).update(
        is_packed=packed, packed_at=packed_at
    )
    return Response({"updated": updated, "packed": packed})


@api_view(["GET"])
def label_unpacked(request):
    """List unpacked LabelOrders, optionally filtered by uploaded_date."""
    qs = LabelOrder.objects.filter(is_packed=False)
    date = request.GET.get("date", "").strip()
    if date:
        qs = qs.filter(uploaded_date=date)
    results = list(qs.values(
        "order_id", "customer_name", "customer_pincode",
        "customer_city", "customer_state",
        "sku", "qty", "courier_name", "uploaded_date", "order_date",
    ))
    return Response({"results": results, "total": len(results)})


# ── Fraud Customers & Blocked Customers ──────────────────────────────────────

def _risk_level(rto_rate, claim_count):
    """Return 'high' / 'medium' / 'low' risk label."""
    if rto_rate >= 0.75 or claim_count >= 3:
        return "high"
    if rto_rate >= 0.40 or claim_count >= 1:
        return "medium"
    return "low"


@api_view(["GET"])
def fraud_customers(request):
    """
    Compute per-customer fraud metrics using LabelOrder → Order join.

    Identity key: customer_name + customer_pincode
    Metrics per customer:
      - total_orders  : distinct order_ids from LabelOrder
      - delivered     : Order rows with DELIVERED
      - rto           : Order rows with RTO_COMPLETE
      - cancelled     : Order rows with CANCELLED
      - rto_rate      : rto / (delivered + rto) if > 0
      - claim_count   : distinct orders with a non-zero OrderPayment.claims
      - risk_level    : high / medium / low
    """
    min_orders = int(request.GET.get("min_orders", 2))  # ignore customers with only 1 order

    # 1. All label orders grouped by customer identity
    label_qs = (
        LabelOrder.objects
        .exclude(customer_name="")
        .values("customer_name", "customer_pincode")
        .annotate(
            total_orders=Count("order_id", distinct=True),
            last_order=Max("order_date"),
            city=Min("customer_city"),
            state=Min("customer_state"),
        )
        .filter(total_orders__gte=min_orders)
    )

    if not label_qs.exists():
        return Response({"results": [], "total": 0})

    # 2. All LabelOrder order_ids for these customers
    all_order_ids = list(
        LabelOrder.objects
        .exclude(customer_name="")
        .values_list("order_id", flat=True)
    )

    # 3. Order outcomes keyed by sub_order_no
    outcome_map = {}
    for row in Order.objects.filter(sub_order_no__in=all_order_ids).values("sub_order_no", "reason_for_credit_entry"):
        outcome_map.setdefault(row["sub_order_no"], []).append(row["reason_for_credit_entry"])

    # 4. Orders with claims (non-zero claims amount)
    claimed_order_ids = set(
        OrderPayment.objects
        .filter(sub_order_no__in=all_order_ids, claims__isnull=False)
        .exclude(claims=0)
        .values_list("sub_order_no", flat=True)
        .distinct()
    )

    # 5. Per customer: map order_ids → outcomes
    customer_order_ids = {}
    for lo in LabelOrder.objects.exclude(customer_name="").values("order_id", "customer_name", "customer_pincode"):
        key = (lo["customer_name"], lo["customer_pincode"])
        customer_order_ids.setdefault(key, []).append(lo["order_id"])

    # 6. Build blocked lookup
    blocked_set = set(
        BlockedCustomer.objects.filter(is_active=True)
        .values_list("customer_name", "customer_pincode")
    )

    results = []
    for row in label_qs:
        name    = row["customer_name"]
        pincode = row["customer_pincode"]
        key     = (name, pincode)
        order_ids = customer_order_ids.get(key, [])

        delivered  = sum(1 for oid in order_ids if "DELIVERED"    in outcome_map.get(oid, []))
        rto        = sum(1 for oid in order_ids if "RTO_COMPLETE" in outcome_map.get(oid, []))
        cancelled  = sum(1 for oid in order_ids if "CANCELLED"    in outcome_map.get(oid, []))
        claim_count = sum(1 for oid in order_ids if oid in claimed_order_ids)
        settled     = delivered + rto
        rto_rate    = round(rto / settled, 3) if settled > 0 else 0.0

        results.append({
            "customer_name":    name,
            "customer_pincode": pincode,
            "customer_city":    row["city"] or "",
            "customer_state":   row["state"] or "",
            "total_orders":     row["total_orders"],
            "delivered":        delivered,
            "rto":              rto,
            "cancelled":        cancelled,
            "claim_count":      claim_count,
            "rto_rate":         rto_rate,
            "risk_level":       _risk_level(rto_rate, claim_count),
            "last_order":       str(row["last_order"]) if row["last_order"] else "",
            "is_blocked":       key in blocked_set,
        })

    # Sort: high risk first, then by rto_rate desc
    order_map = {"high": 0, "medium": 1, "low": 2}
    results.sort(key=lambda r: (order_map[r["risk_level"]], -r["rto_rate"]))

    # Filter to show only suspicious customers by default
    risk_filter = request.GET.get("risk", "")
    if risk_filter in ("high", "medium", "low"):
        results = [r for r in results if r["risk_level"] == risk_filter]

    return Response({"results": results, "total": len(results)})


@api_view(["GET", "POST"])
def blocked_customers_list(request):
    if request.method == "GET":
        qs = BlockedCustomer.objects.filter(is_active=True).order_by("-blocked_at")
        results = [{
            "id":               bc.id,
            "customer_name":    bc.customer_name,
            "customer_pincode": bc.customer_pincode,
            "customer_city":    bc.customer_city,
            "customer_state":   bc.customer_state,
            "reason":           bc.reason,
            "blocked_at":       bc.blocked_at.isoformat(),
        } for bc in qs]
        return Response({"results": results, "total": len(results)})

    # POST — block a customer
    data = request.data
    name    = (data.get("customer_name") or "").strip()
    pincode = (data.get("customer_pincode") or "").strip()
    if not name or not pincode:
        return Response({"error": "customer_name and customer_pincode are required."}, status=400)

    bc, created = BlockedCustomer.objects.update_or_create(
        customer_name=name,
        customer_pincode=pincode,
        defaults={
            "customer_city":  data.get("customer_city", ""),
            "customer_state": data.get("customer_state", ""),
            "reason":         data.get("reason", ""),
            "is_active":      True,
        },
    )
    return Response({
        "id":            bc.id,
        "customer_name": bc.customer_name,
        "created":       created,
    }, status=201 if created else 200)


@api_view(["DELETE", "PATCH"])
def blocked_customer_detail(request, bc_id):
    try:
        bc = BlockedCustomer.objects.get(pk=bc_id)
    except BlockedCustomer.DoesNotExist:
        return Response({"error": "Not found"}, status=404)

    if request.method == "DELETE":
        # Soft-unblock
        bc.is_active = False
        bc.save()
        return Response({"message": "Unblocked"})

    # PATCH — update reason
    bc.reason = request.data.get("reason", bc.reason)
    bc.save()
    return Response({"id": bc.id, "reason": bc.reason})


@api_view(["DELETE"])
def inventory_delete_sku(request, sku_id):
    """Delete all purchase items for a parent SKU; also delete bills that become empty."""
    items = PurchaseItem.objects.filter(parent_sku_id=sku_id)
    bill_ids = list(items.values_list("bill_id", flat=True).distinct())
    items.delete()
    for bid in bill_ids:
        if not PurchaseItem.objects.filter(bill_id=bid).exists():
            PurchaseBill.objects.filter(pk=bid).delete()
    return Response({"deleted": True})


# ── Product Photography AI ────────────────────────────────────────────────────

_PHOTO_STYLES = [
    {"index": 0, "name": "White Studio",    "prompt": "professional product photography, clean white background, soft box studio lighting, crisp shadows, commercial quality, sharp focus"},
    {"index": 1, "name": "Marble Luxury",   "prompt": "product on white marble surface, luxury brand aesthetic, soft diffused natural light, minimalist high-end photography, elegant"},
    {"index": 2, "name": "Dark Dramatic",   "prompt": "product photography, dark charcoal background, dramatic moody cinematic lighting, premium contrast shadows, bold artistic"},
    {"index": 3, "name": "Wooden Table",    "prompt": "product on rustic light wooden table, warm cozy interior, soft golden natural light, lifestyle photography, homely aesthetic"},
    {"index": 4, "name": "Nature Outdoor",  "prompt": "product in lush green outdoor nature setting, bokeh foliage background, golden hour sunlight, fresh organic aesthetic"},
    {"index": 5, "name": "Pastel Flat Lay", "prompt": "product flat lay overhead shot, soft pastel pink background, Instagram aesthetic, minimalist styling, clean composition"},
    {"index": 6, "name": "Navy Premium",    "prompt": "product on deep navy blue background, premium luxury brand aesthetic, subtle gradient, professional commercial shot, rich tones"},
    {"index": 7, "name": "Botanical",       "prompt": "product surrounded by tropical leaves and flowers, botanical garden aesthetic, lush vibrant greens, artistic lifestyle shot"},
    {"index": 8, "name": "Warm Gradient",   "prompt": "product photography, warm orange and amber gradient background, sunset tones, lifestyle brand shot, soft glowing light"},
    {"index": 9, "name": "Minimal Concrete","prompt": "product on smooth concrete surface, Scandinavian minimalist aesthetic, cool neutral tones, editorial photography, clean modern look"},
]


def _resize_for_sdxl(image_bytes):
    """Resize and pad image to 1024x1024 for SDXL img2img."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    img.thumbnail((1024, 1024), Image.LANCZOS)
    bg = Image.new("RGBA", (1024, 1024), (255, 255, 255, 255))
    offset = ((1024 - img.width) // 2, (1024 - img.height) // 2)
    bg.paste(img, offset, img)
    final = bg.convert("RGB")
    buf = io.BytesIO()
    final.save(buf, format="PNG")
    return buf.getvalue()


def _call_stability(api_key, image_bytes, style):
    try:
        resp = http_requests.post(
            "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/image-to-image",
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            files={"init_image": ("product.png", image_bytes, "image/png")},
            data={
                "image_strength": 0.40,
                "text_prompts[0][text]": style["prompt"],
                "text_prompts[0][weight]": 1,
                "text_prompts[1][text]": "blurry, low quality, watermark, text, logo, deformed, ugly, distorted",
                "text_prompts[1][weight]": -1,
                "cfg_scale": 7,
                "steps": 30,
                "samples": 1,
            },
            timeout=120,
        )
        if resp.status_code == 200:
            img_b64 = resp.json()["artifacts"][0]["base64"]
            return {"index": style["index"], "name": style["name"], "image": img_b64, "status": "ok"}
        return {"index": style["index"], "name": style["name"], "status": "error", "error": resp.text[:300]}
    except Exception as exc:
        return {"index": style["index"], "name": style["name"], "status": "error", "error": str(exc)}


@api_view(["POST"])
@parser_classes([MultiPartParser])
def generate_product_images(request):
    image_file = request.FILES.get("image")
    api_key = request.data.get("api_key", "").strip()

    if not image_file:
        return Response({"error": "No image file provided."}, status=400)
    if not api_key:
        return Response({"error": "Stability AI API key is required."}, status=400)

    try:
        resized_bytes = _resize_for_sdxl(image_file.read())
    except Exception as exc:
        return Response({"error": f"Could not process image: {exc}"}, status=400)

    results = [None] * len(_PHOTO_STYLES)
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        future_map = {
            pool.submit(_call_stability, api_key, resized_bytes, style): style["index"]
            for style in _PHOTO_STYLES
        }
        for future in concurrent.futures.as_completed(future_map):
            result = future.result()
            results[result["index"]] = result

    return Response({"results": results})