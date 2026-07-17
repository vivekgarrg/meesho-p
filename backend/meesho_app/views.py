import pandas as pd
import numpy as np
from decimal import Decimal, InvalidOperation
from django.db import transaction, IntegrityError
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
from .helpers.helper import status_wise_summary
from .permissions import get_authorized_business

from .models import OrderPayment, AdsCost, ReferralPayment, CompensationRecovery, FinalPrice, Order, ParentItemPrice, ParentPriceHistory, LabelOrder, PurchaseBill, PurchaseItem, BlockedCustomer, InventoryAdjustment, ConsumableItem, ConsumablePurchase, ConsumableUsage, InventoryLog, MeeshoInventory, MeeshoPriceUpdate
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
def upload_excel(request, business_id):
    """
    Upload a Meesho payment Excel file.
    Parses all 4 sheets and inserts/updates rows in the DB.
    """
    business = get_authorized_business(request, business_id)
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
                    business=business,
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
                    business=business,
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
                    business=business,
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
                    business=business,
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

_DELIVERED_STATUSES = frozenset(["DELIVERED"])

_EXCHANGE_STATUSES = frozenset(["EXCHANGE", "EXCHANGED"])

_RETURN_STATUSES  = frozenset([
    "RETURN", "RETURNED", "PREMIUM_RETURN",
])
_RTO_STATUSES = frozenset([
    "RTO", "RTO_COMPLETE"
])
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
    rows = sorted(payment_rows, key=_payment_date_key, reverse=True)
    main_all = [r for r in rows if r.live_order_status]
    adj      = [r for r in rows if not r.live_order_status]
    
    _seen: dict = {}
    for r in main_all:
        _seen[r.live_order_status.upper()] = r
        _seen[r.live_order_status.upper()] = r
    main = list(_seen.values())


    _seen2: dict = {}
    for r in adj:
        if r.claims and r.claims > 0:
            _seen2["claim"] = r
        elif r.recovery_reason and r.recovery_reason.lower() == "affiliate fee":
            _seen2["affiliate"] = r
        else:
            _seen2["others"] = r
            _seen2["others"] = r
                
        
    all_known_statuses = (
    _DELIVERED_STATUSES
    | _SHIPPED_STATUSES
    | _RETURN_STATUSES
    | _RTO_STATUSES
    | _EXCHANGE_STATUSES
)

    rto_rows = [r for r in main if r.live_order_status.upper() in _RTO_STATUSES]
    return_rows = [r for r in main if r.live_order_status.upper() in _RETURN_STATUSES]
    shipped        = [r for r in main if r.live_order_status.upper() in _SHIPPED_STATUSES]
    delivered_rows = [r for r in main if r.live_order_status.upper() in _DELIVERED_STATUSES]
    exchange_rows = [r for r in main if r.live_order_status.upper() in _EXCHANGE_STATUSES]
    other_status_rows = [r for r in main if r.live_order_status.upper() not in all_known_statuses]
    
    claim_rows = _seen2.get("claim", [])
    affiliate_rows = _seen2.get("affiliate", [])
    other_adj_rows = _seen2.get("others", [])

    return {
        "rows":           rows,
        "main":           main,
        "adj":            adj,
        
        #status wise rows
        "shipped_rows":   shipped,
        "return_rows":    return_rows,
        "delivered_rows": delivered_rows,
        "rto_rows": rto_rows, 
        "exchange_rows": exchange_rows,
        "other_status_rows": other_status_rows,
        
        #adjustment rows
        "claim_rows": claim_rows,
        "affiliate_rows": affiliate_rows,
        "other_adj_rows": other_adj_rows
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
    return c["main"], False
    # return c["non_shipped"], False


def _sum_settlement(rows, include_shipped=False):
    """
    Sum final_settlement_amount across rows.

    SHIPPED rows represent an advance/provisional payment.  They should be
    included only when the order has *progressed past shipping* (i.e. has a
    DELIVERED / RETURN / RTO / EXCHANGE row), because in that case both the
    advance credit (SHIPPED row) and the final adjustment (e.g. RETURNED row)
    are real money movements that must both be counted.

    For orders still sitting in SHIPPED state (no final row yet) the SHIPPED
    amount is provisional and is excluded to avoid double-counting when the
    final row arrives later.
    """
    return sum(
        Decimal(r.final_settlement_amount or 0)
        for r in rows
        if include_shipped
        or not r.live_order_status
        or r.live_order_status.upper() not in _SHIPPED_STATUSES
    )


def _extract_claims(adj_rows):
    """Total claims money credited from Meesho (info-only, not in P&L)."""
    total = Decimal("0")
    for r in adj_rows:
        total += Decimal(r.claims or 0)
    return total

def _extract_return_fee(main_rows):
    """Total claims money credited from Meesho (info-only, not in P&L)."""
    total = Decimal("0")
    for r in main_rows:
        total += Decimal(r.return_shipping_charge or 0)
    return total


def _affiliate_total(adj_rows):
    raw = sum(Decimal(r.final_settlement_amount or 0)
              for r in adj_rows if r.recovery_reason == "Affiliate Fee")
    return raw if raw else Decimal("0")


# ── Per-order profit formula ───────────────────────────────────────────────────

def compute_order_net(payment_rows, sku_final_price, sku_packaging_price, quantity, unique_statuses, 
                      sku_item_price=None, sku_tax_percent=None):
    # list(["Cancelled", "Delivered", "Return", "RTO", "Shipped", "Exchange", "Unknown"])
    
    ZERO = Decimal("0")
    TWO  = Decimal("2")
    qty  = Decimal(str(quantity))

    purchase_cost  = Decimal(str(sku_item_price or 0)) * qty   # item_cost × qty
    packaging_cost = Decimal(str(sku_packaging_price or 0))    # fixed per order, not × qty
    tax_cost       = ( purchase_cost * Decimal(str(sku_tax_percent or 0)) / Decimal("100")) * qty

    c = _classify_rows(payment_rows)

    adj_rows      = c["adj"]
    main_rows     = c["main"]
    affiliate_fees = _affiliate_total(adj_rows)
    claims         = _extract_claims(adj_rows)
    return_shipping_fee = _extract_return_fee(main_rows)
    sub_order_no   = payment_rows[0].sub_order_no

    # Include the SHIPPED row's settlement when the order progressed past shipping —
    # both the advance credit (SHIPPED) and the final adjustment (RETURN/RTO/DELIVERED)
    # are real money movements and must be summed together.
    progressed_past_shipped = bool(
        c["return_rows"] or c["rto_rows"] or c["delivered_rows"]
        or c["exchange_rows"] or c["claim_rows"]
    )
    total_settlement = _sum_settlement(c["rows"], include_shipped=progressed_past_shipped)
    
    net = 0
    status = ""
    
    unknown_rows = c["other_adj_rows"]  or c["other_status_rows"]
    claimed_orders = c["claim_rows"]
    return_orders = c["return_rows"]
    rto_orders = c["rto_rows"]
    exchange_orders = c["exchange_rows"]
    delivered_orders = c["delivered_rows"]
    
    final_purchasing = 0
    
    if unknown_rows:
        final_purchasing  = 0
        net = 0 - final_purchasing
        status = unique_statuses[-1]
        
    elif claimed_orders:
        final_purchasing = purchase_cost + packaging_cost
        net = total_settlement - final_purchasing
        status = unique_statuses[0]
    elif exchange_orders:
        final_purchasing = purchase_cost + (packaging_cost * 2 ) + tax_cost
        net = total_settlement - final_purchasing
        status = unique_statuses[-2]
    elif return_orders:
        final_purchasing = 0 
        net = total_settlement - final_purchasing
        status = unique_statuses[-5]
    elif rto_orders:
        final_purchasing = 0 
        net = total_settlement - final_purchasing
        status = unique_statuses[-4]
    elif delivered_orders:
        final_purchasing =  purchase_cost + packaging_cost + tax_cost
        net = total_settlement - final_purchasing
        status = unique_statuses[-6]
    else:
        final_purchasing = 0 
        net = total_settlement - final_purchasing
        status = unique_statuses[-1]
        
    return {
        "net": net, 
        "status": status,
        "total_settlement": total_settlement,
        "purchase_cost": purchase_cost,
        "packaging_cost": packaging_cost,
        "tax_cost": tax_cost,
        "quantity": qty,
        "sub_order_no": sub_order_no,
        "affiliate_fees": affiliate_fees,
        "return_shipping_fee" : return_shipping_fee,
        "claims": claims,
        "final_purchase_cost": final_purchasing
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
        sku[f"{key}_final_purchase_cost"] = 0
        sku[f"{key}_tax_cost"] = 0
        sku[f"{key}_total_settlement"] = 0
        sku[f"{key}_payment_rows"] = []


def _ensure_status_buckets(sku, _unique_statuses):
    """Pre-initialise the five main buckets + other_net so no KeyError later."""
    _init_sku_bucket("delivered", "profit", sku)
    _init_sku_bucket("return",    "loss",   sku)
    _init_sku_bucket("rto",       "loss",   sku)
    _init_sku_bucket("exchange",  "net",    sku)
    _init_sku_bucket("claim",     "loss",   sku)
    _init_sku_bucket("unknown",     "loss",   sku)
    if sku.get("other_net") is None:
        sku["other_net"]   = 0
        sku["other_count"] = 0


def _inject_order_into_bucket(sku, result, net):
    status_upper = (result["status"] or "").upper()
    raw = _norm_key((result["status"] or "").lower())

    if raw == "claim" or raw == "exchange" :
        _inc(sku, f"{raw}_loss",         net)
    elif raw in ("return", "rto"):
        _inc(sku, f"{raw}_loss",           net)
    elif status_upper in _DELIVERED_STATUSES:
        _inc(sku, "delivered_profit",         net)
    else:
        _inc(sku, "other_net",   net)
        _inc(sku, "other_count")
        
    _inc(sku, f"{raw}_purchase_cost",  result["purchase_cost"])
    _inc(sku, f"{raw}_packaging_cost", result["packaging_cost"])
    _inc(sku, f"{raw}_count")
    _inc(sku, f"{raw}_quantity",       result["quantity"])
    _inc(sku, f"{raw}_final_purchase_cost", result["final_purchase_cost"])
    _inc(sku, f"{raw}_tax_cost", result["tax_cost"])
    _inc(sku, f"{raw}_total_settlement", result["total_settlement"])


# ── Per-SKU accumulator ────────────────────────────────────────────────────────

def accumulate_sku_profit(sku_id, obj, result, price_map, packaging_map, unique_statuses):
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
    
    # ── Settled order: route to status bucket (claim-first priority) ─────────
    _inject_order_into_bucket(sku, result, net)
    _inc(sku, "settled_amount", result["total_settlement"])
    
    if result.get("status") == "Claim":
        _inc(sku, "claims_total", result["claims"])

    sku["net_profit"] = (
        Decimal(sku.get("delivered_profit", 0)) +
        Decimal(sku.get("return_loss",      0)) +
        Decimal(sku.get("rto_loss",         0)) +
        Decimal(sku.get("exchange_loss",     0)) +
        Decimal(sku.get("claim_loss",       0))
    )
    sku["total_purchase_cost"] = Decimal(sku.get("delivered_final_purchase_cost", 0)) +  Decimal(sku.get("exchange_final_purchase_cost", 0)) +  Decimal(sku.get("claim_final_purchase_cost", 0))
    sku["total_tax_cost"] = Decimal(sku.get("delivered_tax_cost", 0)) +  Decimal(sku.get("exchange_tax_cost", 0)) +  Decimal(sku.get("claim_tax_cost", 0))
    sku["total_packaging_cost"] = Decimal(sku.get("delivered_packaging_cost", 0)) +  Decimal(sku.get("exchange_packaging_cost", 0)) +  Decimal(sku.get("claim_packaging_cost", 0))
    sku["total_packaging_cost_for_returns"] = Decimal(sku.get("return_packaging_cost", 0)) + Decimal(sku.get("rto_packaging_cost", 0))
    

@api_view(["GET"])
def available_months(request, business_id):
    """
    Returns distinct order months (YYYY-MM) newest first.
    Primary source: Order.order_date (DateField, reliable).
    Falls back to OrderPayment.order_date if Order table is empty.
    """
    business = get_authorized_business(request, business_id)
    dates = list(Order.objects.filter(business=business).dates("order_date", "month", order="DESC"))
    if not dates:
        dates = list(
            OrderPayment.objects
            .filter(business=business)
            .exclude(order_date=None)
            .dates("order_date", "month", order="DESC")
        )
    return Response([d.strftime("%Y-%m") for d in dates])


@api_view(["GET"])
def unsettled_orders(request, business_id):
    """Orders in the Order table that have no matching OrderPayment record."""
    business = get_authorized_business(request, business_id)
    date_from = request.GET.get("date_from", "")
    date_to   = request.GET.get("date_to", "")
    page      = int(request.GET.get("page", 1))
    page_size = int(request.GET.get("page_size", 50))
    search    = request.GET.get("search", "")

    order_qs = Order.objects.filter(business=business)
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

    settled_nos = set(OrderPayment.objects.filter(business=business).values_list("sub_order_no", flat=True).distinct())
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
def payment_mismatch(request, business_id):
    """
    Bi-directional mismatch:
      - orders_no_payment: Orders in Order table with no matching OrderPayment row
      - payments_no_order: OrderPayment rows whose sub_order_no has no Order row
    """
    from collections import defaultdict

    business = get_authorized_business(request, business_id)
    date_from = request.GET.get("date_from", "")
    date_to   = request.GET.get("date_to",   "")
    page      = int(request.GET.get("page",      1))
    page_size = int(request.GET.get("page_size", 50))
    view      = request.GET.get("view", "orders")  # "orders" | "payments"

    # ── Orders with no payment ────────────────────────────────────────────────
    order_qs = Order.objects.filter(business=business)
    if date_from:
        order_qs = order_qs.filter(order_date__gte=date_from)
    if date_to:
        order_qs = order_qs.filter(order_date__lte=date_to)

    payment_sub_nos = set(OrderPayment.objects.filter(business=business).values_list("sub_order_no", flat=True).distinct())
    latest_orders   = Order.latest_per_order(base_qs=order_qs)
    orders_no_pay   = (
        latest_orders
        .exclude(sub_order_no__in=payment_sub_nos)
        .exclude(reason_for_credit_entry__iexact="cancelled")
        .order_by("-order_date")
    )
    onp_agg = orders_no_pay.aggregate(count=Count("sub_order_no"), total_value=Sum("supplier_discounted_price"))

    # ── Payments with no order ────────────────────────────────────────────────
    pay_qs = OrderPayment.objects.filter(business=business)
    if date_from:
        pay_qs = pay_qs.filter(order_date__date__gte=date_from)
    if date_to:
        pay_qs = pay_qs.filter(order_date__date__lte=date_to)

    order_sub_nos = set(Order.objects.filter(business=business).values_list("sub_order_no", flat=True).distinct())
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
def return_claims_detail(request, business_id):
    """
    Grouped view of all RETURN / RTO / CLAIM orders.
    Returns one summary row per sub_order_no + all sub-payment rows.
    """
    from collections import defaultdict

    business = get_authorized_business(request, business_id)
    date_from     = request.GET.get("date_from",  "")
    date_to       = request.GET.get("date_to",    "")
    page          = int(request.GET.get("page",      1))
    page_size     = int(request.GET.get("page_size", 30))
    search        = request.GET.get("search",    "")
    status_filter = request.GET.get("status",    "")

    RETURN_STATUSES = ["RETURN", "RETURNED", "RTO", "RTO_COMPLETE"]

    base_qs = OrderPayment.objects.filter(business=business)
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
                business=business,
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

    # Claim-first: orders with any claims row are CLAIM, not RETURN or RTO
    _claimed_sub_orders = (
        OrderPayment.objects
        .filter(business=business, sub_order_no__in=qualifying_ids, claims__gt=0)
        .values_list("sub_order_no", flat=True)
    )
    if status_filter == "return":
        # Pure returns: have RETURN status AND no claim payment
        qualifying_ids = (
            OrderPayment.objects
            .filter(business=business, sub_order_no__in=qualifying_ids, live_order_status__in=["RETURN", "RETURNED"])
            .exclude(sub_order_no__in=_claimed_sub_orders)
            .values_list("sub_order_no", flat=True).distinct()
        )
    elif status_filter == "rto":
        # Pure RTOs: have RTO status AND no claim payment
        qualifying_ids = (
            OrderPayment.objects
            .filter(business=business, sub_order_no__in=qualifying_ids, live_order_status__in=["RTO", "RTO_COMPLETE"])
            .exclude(sub_order_no__in=_claimed_sub_orders)
            .values_list("sub_order_no", flat=True).distinct()
        )
    elif status_filter == "claim":
        qualifying_ids = _claimed_sub_orders

    qualifying_list = list(qualifying_ids)
    total = len(qualifying_list)

    # Paginate sub_order_nos
    start          = (page - 1) * page_size
    page_sub_orders = qualifying_list[start: start + page_size]

    # Fetch all payment rows for this page's orders
    all_rows = (
        OrderPayment.objects
        .filter(business=business, sub_order_no__in=page_sub_orders)
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
        
        latest_status = (settlement_rows[-1].live_order_status
                         if settlement_rows else None)
        first = rows[0] if rows else None

        # Claim-first classification for display
        all_statuses = {(r.live_order_status or "").upper() for r in rows}
        if total_claims > 0:
            order_type = "CLAIM"
        elif all_statuses & {"RETURN", "RETURNED"}:
            order_type = "RETURN"
        elif all_statuses & {"RTO", "RTO_COMPLETE"}:
            order_type = "RTO"
        else:
            order_type = "DELIVERED"

        results.append({
            "sub_order_no":    sub_order_no,
            "sku":             first.supplier_sku if first else None,
            "product_name":    first.product_name if first else None,
            "order_date":      str(first.order_date.date()) if first and first.order_date else None,
            "latest_status":   latest_status,
            "order_type":      order_type,
            "net_settlement":  round(net_settlement,   2),
            "total_claims":    round(total_claims,     2),
            "total_commission": round(total_commission, 2),
            "total_tcs":       round(total_tcs,        2),
            "total_tds":       round(total_tds,        2),
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
def claimed_orders(request, business_id):
    """
    Orders where Meesho paid a claim (claims > 0 in any payment row).
    Supports: date_from, date_to, page, page_size,
              status (all/return/rto), sku, view (orders/sku)
    """
    from collections import defaultdict

    business = get_authorized_business(request, business_id)
    date_from     = request.GET.get("date_from",  "")
    date_to       = request.GET.get("date_to",    "")
    page          = int(request.GET.get("page",      1))
    page_size     = int(request.GET.get("page_size", 30))
    status_filter = request.GET.get("status", "")   # "" / "return" / "rto"
    sku_filter    = request.GET.get("sku",    "")
    view_mode     = request.GET.get("view",   "orders")  # "orders" / "sku"

    RETURN_STATUSES = ["RETURN", "RETURNED", "RTO", "RTO_COMPLETE", "PREMIUM_RETURN"]

    base_qs = OrderPayment.objects.filter(business=business)
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
            .filter(business=business, sub_order_no__in=claimed_qs, live_order_status__in=["RETURN", "RETURNED"])
            .values_list("sub_order_no", flat=True).distinct()
        )
    elif status_filter == "rto":
        claimed_qs = (
            OrderPayment.objects
            .filter(business=business, sub_order_no__in=claimed_qs, live_order_status__in=["RTO", "RTO_COMPLETE"])
            .values_list("sub_order_no", flat=True).distinct()
        )

    # SKU filter
    if sku_filter:
        claimed_qs = (
            OrderPayment.objects
            .filter(business=business, sub_order_no__in=claimed_qs, supplier_sku__icontains=sku_filter)
            .values_list("sub_order_no", flat=True).distinct()
        )

    claimed_list = list(claimed_qs)
    total = len(claimed_list)

    # Summary stats across ALL matching orders (not just this page)
    all_rows_qs = OrderPayment.objects.filter(business=business, sub_order_no__in=claimed_list)
    total_claim_amount = float(
        all_rows_qs.aggregate(t=Sum("claims"))["t"] or 0
    )
    return_count = (
        OrderPayment.objects
        .filter(business=business, sub_order_no__in=claimed_list, live_order_status__in=["RETURN", "RETURNED"])
        .values("sub_order_no").distinct().count()
    )
    rto_count = (
        OrderPayment.objects
        .filter(business=business, sub_order_no__in=claimed_list, live_order_status__in=["RTO", "RTO_COMPLETE"])
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
        .filter(business=business, sub_order_no__in=page_sub_orders)
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


def _build_payout_breakdown(qs):
    """
    Raw per-status settlement for payout CSV reconciliation.
    Groups payment rows by live_order_status and returns count + settlement
    in the same format as the Meesho monthly payout summary.
    """
    from django.db.models import Count, Sum as DSum

    STATUS_LABELS = {
        "delivered":  "Delivered",
        "return":     "Returned",
        "returned":   "Returned",
        "rto":        "RTO",
        "rto_complete": "RTO",
        "exchange":   "Exchanged",
        "exchanged":  "Exchanged",
        "cancelled":  "Cancelled",
        "shipped":    "Shipped (in-transit)",
        "in transit": "Shipped (in-transit)",
    }

    # Status rows (non-null)
    status_rows = (
        qs.exclude(DQ(live_order_status__isnull=True) | DQ(live_order_status=""))
        .values("live_order_status")
        .annotate(
            order_count=Count("sub_order_no", distinct=True),
            settlement=DSum("final_settlement_amount"),
            return_shipping=DSum("return_shipping_charge"),
        )
    )

    buckets = {}
    for row in status_rows:
        raw = (row["live_order_status"] or "").lower()
        label = STATUS_LABELS.get(raw, row["live_order_status"])
        if label not in buckets:
            buckets[label] = {"count": 0, "settlement": Decimal("0"), "return_shipping": Decimal("0")}
        buckets[label]["count"]           += row["order_count"]
        buckets[label]["settlement"]      += Decimal(str(row["settlement"] or 0))
        buckets[label]["return_shipping"] += Decimal(str(row["return_shipping"] or 0))

    # Adj rows — claims and other (affiliate, pickup, etc.)
    adj_rows = qs.filter(DQ(live_order_status__isnull=True) | DQ(live_order_status=""))
    claim_agg = adj_rows.filter(claims__gt=0).aggregate(
        count=Count("sub_order_no", distinct=True),
        total_claims=DSum("claims"),
        settlement=DSum("final_settlement_amount"),
    )
    other_adj_agg = adj_rows.filter(
        DQ(claims__isnull=True) | DQ(claims=0)
    ).values("recovery_reason").annotate(
        count=Count("id"),
        settlement=DSum("final_settlement_amount"),
    )

    result = []
    order_priority = ["Delivered", "Returned", "RTO", "Exchanged", "Cancelled", "Shipped (in-transit)"]
    for label in order_priority:
        if label in buckets:
            b = buckets[label]
            result.append({
                "type": label,
                "count": b["count"],
                "settlement": round(float(b["settlement"]), 2),
                "return_shipping": round(float(b["return_shipping"]), 2),
            })
    # Remaining statuses not in priority list
    for label, b in buckets.items():
        if label not in order_priority:
            result.append({
                "type": label,
                "count": b["count"],
                "settlement": round(float(b["settlement"]), 2),
                "return_shipping": round(float(b["return_shipping"]), 2),
            })

    # Claims
    if claim_agg["count"]:
        result.append({
            "type": "Claims Accepted",
            "count": claim_agg["count"],
            "settlement": round(float(claim_agg["settlement"] or 0), 2),
            "claims_amount": round(float(claim_agg["total_claims"] or 0), 2),
        })

    # Other adj rows (affiliate fees, manual pickup, etc.)
    for row in other_adj_agg:
        reason = row["recovery_reason"] or "Unknown Adj"
        result.append({
            "type": f"Adj: {reason}",
            "count": row["count"],
            "settlement": round(float(row["settlement"] or 0), 2),
        })

    return result



@api_view(["GET"])
def profit_summary(request, business_id):
    """
    Calculate overall Meesho profit.
    Accepts date_from / date_to (YYYY-MM-DD).
    Filters OrderPayment via Order.order_date join; falls back to
    OrderPayment.order_date__date if Order table has no records for range.
    """
    business = get_authorized_business(request, business_id)
    date_from = request.GET.get("date_from", "")
    date_to   = request.GET.get("date_to", "")

    qs = OrderPayment.objects.filter(business=business)


    if date_from or date_to:
        ord_qs = Order.objects.filter(business=business)
        if date_from:
            # qs = qs.filter(order_date__gte=date_from)
            ord_qs = ord_qs.filter(order_date__gte=date_from)
        if date_to:
            # qs = qs.filter(order_date__lte=date_to)
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
    _fp_all        = list(FinalPrice.objects.filter(business=business).only("sku_id", "final_price", "packaging_cost", "parent_id", "item_price", "tax_percent"))
    price_map      = {fp.sku_id: fp.final_price    or Decimal("0") for fp in _fp_all}
    packaging_map  = {fp.sku_id: fp.packaging_cost or Decimal("0") for fp in _fp_all}
    item_price_map = {fp.sku_id: fp.item_price     or Decimal("0") for fp in _fp_all}
    tax_map        = {fp.sku_id: fp.tax_percent    or 0            for fp in _fp_all}
    sku_parent_map = {fp.sku_id: fp.parent_id for fp in _fp_all if fp.parent_id}
    
    _fp_parent     = list(ParentItemPrice.objects.filter(business=business).only("item_id", "item_price", "tax_percent", "packaging_cost", "final_price"))
    parent_price_map      = {fp.item_id: fp.final_price    or Decimal("0") for fp in _fp_parent}
    parent_packaging_map  = {fp.item_id: fp.packaging_cost or Decimal("0") for fp in _fp_parent}
    parent_item_price_map = {fp.item_id: fp.item_price     or Decimal("0") for fp in _fp_parent}
    parent_tax_map        = {fp.item_id: fp.tax_percent    or 0            for fp in _fp_parent}

    # Build date-effective price history: {parent_id: [(effective_from, final_price, packaging_cost, item_price, tax_percent), ...]}
    from collections import defaultdict
    _hist = list(
        ParentPriceHistory.objects
        .filter(business=business)
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
                else: 
                    return (
                    parent_price_map.get(pid,      Decimal("0")),
                    parent_packaging_map.get(pid,  Decimal("0")),
                    parent_item_price_map.get(pid, Decimal("0")),
                    parent_tax_map.get(pid, 0),
                    )
                    
        return (
            price_map.get(sku_id,      Decimal("0")),
            packaging_map.get(sku_id,  Decimal("0")),
            item_price_map.get(sku_id, Decimal("0")),
            tax_map.get(sku_id, 0),
        )

    # Pre-fetch distinct statuses ONCE so _ensure_status_buckets can pre-initialise keys
    unique_statuses = list(["Claim","Cancelled", "Delivered", "Return", "RTO", "Shipped", "Exchange", "Unknown"])

    _FIELDS = (
        "sub_order_no", "supplier_sku", "quantity",
        "final_settlement_amount", "live_order_status",
        "recovery_reason", "claims", "return_shipping_charge",
        "order_date", "payment_date",
    )

    # Group ALL payment rows by sub_order_no
    order_groups = defaultdict(list)
    for payment in qs.only(*_FIELDS).order_by("-payment_date"):
        order_groups[payment.sub_order_no].append(payment)

    order_wise_profit   = {}
    missing_sku         = []
    orders_with_price   = 0
    orders_missing_price = 0
    
    for sub_no, payments in order_groups.items():
        order = (
            Order.objects
            .filter(business=business, sub_order_no=sub_no)
            .values("sub_order_no", "sku", "quantity")
            .first()
            ) or {}
        primary = next((p for p in payments if p.live_order_status), payments[0])
        sku = order.get("sku") or primary.supplier_sku
        qty = order.get("quantity") or primary.quantity

        if not sku or sku not in price_map:
            missing_sku.append(sku)
            orders_missing_price += 1
            continue

        eff_price, eff_pkg, eff_item_price, eff_tax_pct = get_eff_price(sku, primary.order_date)
        result = compute_order_net(payments, eff_price, eff_pkg, qty, unique_statuses,eff_item_price, eff_tax_pct, )
        accumulate_sku_profit(sku, order_wise_profit, result, price_map, packaging_map, unique_statuses)
        orders_with_price += 1


    missing_sku          = list(set(missing_sku))
    total_loss           = sum(Decimal(str(v.get("return_loss",      0) or 0)) for v in order_wise_profit.values())
    total_rto_loss       = sum(Decimal(str(v.get("rto_loss",         0) or 0)) for v in order_wise_profit.values())
    total_exchange_net   = sum(Decimal(str(v.get("exchange_loss",     0) or 0)) for v in order_wise_profit.values())
    total_other          = sum(Decimal(str(v.get("other_net",        0) or 0)) for v in order_wise_profit.values())
    total_purchase_cost  = sum(Decimal(str(v.get("total_purchase_cost",  0) or 0)) for v in order_wise_profit.values())
    total_packaging_cost = sum(Decimal(str(v.get("total_packaging_cost", 0) or 0)) for v in order_wise_profit.values())
    total_packaging_cost_for_return = sum(Decimal(str(v.get("total_packaging_cost_for_returns", 0) or 0)) for v in order_wise_profit.values())
    total_tax_cost = sum(Decimal(str(v.get("total_tax_cost", 0) or 0)) for v in order_wise_profit.values())

    # Counts per outcome (for rate calculations)
    delivered_summary = status_wise_summary(order_wise_profit, "delivered")
    exchanged_summary = status_wise_summary(order_wise_profit, "exchange")
    rto_summary =  status_wise_summary(order_wise_profit, "rto")
    return_summary =  status_wise_summary(order_wise_profit, "return")
    claim_summary = status_wise_summary(order_wise_profit, "claim")
    unknown_summary = status_wise_summary(order_wise_profit, "unknown")
    
    order_status_summary = {
        "delivered_summary":delivered_summary,
        "exchanged_summary":exchanged_summary,
        "rto_summary": rto_summary,
        "return_summary":return_summary,
        "claim_summary":claim_summary,
        "unknown_summary": unknown_summary
    }
    
    
    
    total_return_count     = sum(v.get("return_count",     0) for v in order_wise_profit.values())
    total_rto_count        = sum(v.get("rto_count",        0) for v in order_wise_profit.values())
    total_exchange_count   = sum(v.get("exchange_count",   0) for v in order_wise_profit.values())
    total_other_count      = sum(v.get("other_count",      0) for v in order_wise_profit.values())
    total_claim_count      = sum(v.get("claim_count",      0) for v in order_wise_profit.values())
    total_claim_loss       = sum(Decimal(str(v.get("claim_loss",         0) or 0)) for v in order_wise_profit.values())
    total_claim_purchase_cost  = sum(Decimal(str(v.get("claim_purchase_cost",     0) or 0)) for v in order_wise_profit.values())
    total_exchange_pkg_cost    = sum(Decimal(str(v.get("exchange_packaging_cost",  0) or 0)) for v in order_wise_profit.values())
    total_return_pkg_cost      = sum(Decimal(str(v.get("return_packaging_cost",   0) or 0)) for v in order_wise_profit.values())
    total_rto_pkg_cost         = sum(Decimal(str(v.get("rto_packaging_cost",      0) or 0)) for v in order_wise_profit.values())

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

    ads_qs = AdsCost.objects.filter(business=business)
    if date_from:
        ads_qs = ads_qs.filter(deduction_date__gte=date_from)
    if date_to:
        ads_qs = ads_qs.filter(deduction_date__lte=date_to)
    raw_ads = ads_qs.aggregate(total=Sum("total_ads_cost"))["total"] or Decimal("0")
    # Ads cost is always a deduction from seller earnings. Meesho's Excel stores it
    # as a positive spend amount. Force negative so the formula: order_net_pl + ads
    # always subtracts the ad spend regardless of how it's stored.
    ads = -abs(raw_ads)

    ref_qs = ReferralPayment.objects.filter(business=business)
    if date_from:
        ref_qs = ref_qs.filter(payment_date__gte=date_from)
    if date_to:
        ref_qs = ref_qs.filter(payment_date__lte=date_to)
    referral = ref_qs.aggregate(total=Sum("net_referral_amount"))["total"] or Decimal("0")

    comp_qs = CompensationRecovery.objects.filter(business=business)
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
        total_forward_shipping=Sum("shipping_charge_incl_gst"),
        total_return_shipping=Sum("return_shipping_charge"),
    )

    revenue                  = agg["revenue"]                  or Decimal("0")
    gross_revenue            = agg["gross_revenue"]            or Decimal("0")
    total_commission         = agg["total_commission"]         or Decimal("0")
    total_tcs                = agg["total_tcs"]                or Decimal("0")
    total_tds                = agg["total_tds"]                or Decimal("0")
    total_forward_shipping   = agg["total_forward_shipping"]   or Decimal("0")
    total_return_shipping    = agg["total_return_shipping"]    or Decimal("0")
    total_shipping_cost      = total_forward_shipping + total_return_shipping

    net_revenue = revenue - total_purchase_cost + ads + comp_recovery

    # Ensure sum(sku.net_profit) == revenue - total_purchase_cost by absorbing the gap
    # (settlement from missing-SKU orders) into a synthetic __unattributed__ bucket.
    total_sku_net = sum(Decimal(str(v.get("net_profit", 0) or 0)) for v in order_wise_profit.values())
    unattributed_gap = (revenue - total_purchase_cost) - total_sku_net
    if abs(unattributed_gap) > Decimal("0.01"):
        order_wise_profit["__unattributed__"] = {
            "net_profit": float(unattributed_gap),
            "order_count": orders_missing_price,
            "sku_id": "__unattributed__",
            "one_unit_price": 0,
            "total_purchase_cost": 0,
        }

    # Keep raw DB aggregate as informational (includes claims adj rows) — NOT used in P&L
    raw_settlement = revenue

    # Tax summary — what % of gross revenue was withheld as tax
    total_tax_withheld = total_tcs + total_tds
    tax_rate_pct = round(float(total_tax_withheld / gross_revenue * 100), 2) if gross_revenue else 0.0
    commission_rate_pct = round(float(total_commission / gross_revenue * 100), 2) if gross_revenue else 0.0
    total_deduction_rate_pct = round(float((total_tax_withheld + total_commission) / gross_revenue * 100), 2) if gross_revenue else 0.0



    return Response({
        "gross_revenue":          round(gross_revenue, 2),
        "total_settled":          round(revenue, 2), 
        "total_purchase_cost":    round(total_purchase_cost, 2),
        "total_packaging_cost":   round(total_packaging_cost, 2),
        "total_packaging_cost_for_returns": round(total_packaging_cost_for_return, 2),
        "total_tax_cost":         round(total_tax_cost, 2),
        "net_profit_loss": round(float(revenue - total_purchase_cost), 2),
        "order_summary": order_status_summary,
        "total_loss":             round(total_loss, 2),
        "total_rto_loss":         round(total_rto_loss, 2),
        "total_exchange_net":     round(total_exchange_net, 2),
        "total_exchange_count":   total_exchange_count,
        "total_exchange_pkg_cost": round(total_exchange_pkg_cost, 2),
        "total_other":            round(total_other, 2),
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
        "total_shipping_cost":          round(total_shipping_cost, 2),
        "total_forward_shipping":       round(total_forward_shipping, 2),
        "total_return_shipping":        round(total_return_shipping, 2),
        "net_settlement_revenue":       round(revenue, 2),
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
        "total_return_count":          total_return_count,
        "total_rto_count":             total_rto_count,
        "total_claim_count":           total_claim_count,
        "total_claim_loss":            round(total_claim_loss, 2),
        "total_claim_purchase_cost":   round(total_claim_purchase_cost, 2),
        "total_return_pkg_cost":       round(total_return_pkg_cost, 2),
        "total_rto_pkg_cost":          round(total_rto_pkg_cost, 2),
        "tax_summary": {
            "total_tax_withheld":       round(float(total_tax_withheld), 2),
            "tax_rate_pct":             tax_rate_pct,
            "commission_rate_pct":      commission_rate_pct,
            "total_deduction_rate_pct": total_deduction_rate_pct,
        },
        "payout_breakdown": _build_payout_breakdown(qs),
    })


@api_view(["GET"])
def orders_grouped(request, business_id):
    """
    Returns OrderPayment rows grouped by sub_order_no with a derived classified status.
    Filters: ?month=YYYY-MM, ?date_from=, ?date_to=, ?status=DELIVERED|RETURN|RTO|EXCHANGE|SHIPPED|UNKNOWN
    Also returns KPI summary for the filtered set.
    """
    from collections import defaultdict
    import calendar as _cal

    business = get_authorized_business(request, business_id)
    month      = request.GET.get("month", "").strip()
    date_from  = request.GET.get("date_from", "").strip()
    date_to    = request.GET.get("date_to", "").strip()
    status_f   = request.GET.get("status", "").strip().upper()
    page       = int(request.GET.get("page", 1))
    page_size  = int(request.GET.get("page_size", 50))
    search = request.GET.get("search", "").strip()

    qs = OrderPayment.objects.filter(business=business)

    if month:
        year, mo = (int(x) for x in month.split("-"))
        first_day = datetime(year, mo, 1).date()
        last_day  = datetime(year, mo, _cal.monthrange(year, mo)[1]).date()
        qs = qs.filter(
            order_date__gte=datetime.combine(first_day, time.min),
            order_date__lte=datetime.combine(last_day,  time.max),
        )
    else:
        if date_from:
            d = datetime.strptime(date_from, "%Y-%m-%d").date()
            qs = qs.filter(order_date__gte=datetime.combine(d, time.min))
        if date_to:
            d = datetime.strptime(date_to, "%Y-%m-%d").date()
            qs = qs.filter(order_date__lte=datetime.combine(d, time.max))
            
    if search:
        qs = qs.filter(
            DQ(sub_order_no__icontains=search) |
            DQ(supplier_sku__icontains=search) | 
            DQ(product_name__icontains=search)
        )    

    all_rows = list(qs.order_by("sub_order_no", "payment_date", "id"))

    # ── Group by sub_order_no ─────────────────────────────────────────────────
    groups: dict = defaultdict(list)
    for r in all_rows:
        groups[r.sub_order_no].append(r)

    def _effective_status(row_list):
        statuses = {(r.live_order_status or "").upper() for r in row_list}
        has_claim = any((r.claims or 0) > 0 for r in row_list)
        if has_claim:                                    return "CLAIM"
        if statuses & _EXCHANGE_STATUSES:                return "EXCHANGE"
        if statuses & _RETURN_STATUSES:                  return "RETURN"
        if statuses & _RTO_STATUSES:                     return "RTO"
        if statuses & _DELIVERED_STATUSES:               return "DELIVERED"
        if statuses & _SHIPPED_STATUSES:                 return "SHIPPED"
        return "UNKNOWN"

    def _group_settlement(row_list):
        statuses = {(r.live_order_status or "").upper() for r in row_list}
        progressed = bool(
            statuses & (_RETURN_STATUSES | _RTO_STATUSES | _DELIVERED_STATUSES | _EXCHANGE_STATUSES)
        )
        return float(_sum_settlement(row_list, include_shipped=progressed))

    # ── Classify every group ──────────────────────────────────────────────────
    classified = []
    for sub_no, rows in groups.items():
        eff = _effective_status(rows)
        first = rows[0]
        classified.append({
            "sub_order_no":   sub_no,
            "status":         eff,
            "settlement":     _group_settlement(rows),
            "sku":            first.supplier_sku,
            "catalog_id":     first.catalog_id,
            "product_name":   first.product_name,
            "order_date":     str(first.order_date.date()) if first.order_date else None,
            "row_count":      len(rows),
            "rows":           [],     # filled below for the requested page only
        })

    # ── KPI summary (all groups, before pagination) ───────────────────────────
    from collections import Counter
    status_counts = Counter(g["status"] for g in classified)
    status_settlement = {}
    for g in classified:
        status_settlement[g["status"]] = round(
            status_settlement.get(g["status"], 0) + g["settlement"], 2
        )
    kpi = {
        "total_groups":     len(classified),
        "total_settlement": round(sum(g["settlement"] for g in classified), 2),
        "by_status":        [
            {"status": s, "count": status_counts[s], "settlement": status_settlement.get(s, 0)}
            for s in ["DELIVERED", "RETURN", "RTO", "EXCHANGE", "CLAIM", "SHIPPED", "UNKNOWN"]
            if status_counts.get(s, 0) > 0
        ],
    }

    # ── Apply status filter ───────────────────────────────────────────────────
    if status_f:
        classified = [g for g in classified if g["status"] == status_f]

    # Sort newest first
    classified.sort(key=lambda g: g["order_date"] or "", reverse=True)

    total = len(classified)
    page_groups = classified[(page - 1) * page_size: page * page_size]

    # Attach full row detail only for page groups (avoid serializing thousands of rows)
    sub_nos_page = {g["sub_order_no"] for g in page_groups}
    detail_map: dict = defaultdict(list)
    for r in all_rows:
        if r.sub_order_no in sub_nos_page:
            detail_map[r.sub_order_no].append({
                "id":                          r.id,
                "sub_order_no":                r.sub_order_no,
                "live_order_status":           r.live_order_status,
                "payment_date":                str(r.payment_date) if r.payment_date else None,
                "order_date":                  str(r.order_date.date()) if r.order_date else None,
                "final_settlement_amount":     float(r.final_settlement_amount or 0),
                "total_sale_amount":           float(r.total_sale_amount or 0),
                "meesho_commission_incl_gst":  float(r.meesho_commission_incl_gst or 0),
                "tcs":                         float(r.tcs or 0),
                "tds":                         float(r.tds or 0),
                "claims":                      float(r.claims or 0),
                "return_shipping_charge":      float(r.return_shipping_charge or 0),
                "listing_price_incl_taxes":    float(r.listing_price_incl_taxes or 0),
            })

    for g in page_groups:
        g["rows"] = detail_map.get(g["sub_order_no"], [])

    return Response({
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "kpi":       kpi,
        "groups":    page_groups,
    })


@api_view(["GET"])
def order_payments_list(request, business_id):
    business = get_authorized_business(request, business_id)
    page = int(request.GET.get("page", 1))
    page_size = int(request.GET.get("page_size", 50))
    status_filter = request.GET.get("status", "")
    sku_filter = request.GET.get("sku", "")
    date_from = request.GET.get("date_from", "")
    date_to = request.GET.get("date_to", "")

    qs = OrderPayment.objects.filter(business=business)
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
def ads_cost_list(request, business_id):
    business = get_authorized_business(request, business_id)
    qs = AdsCost.objects.filter(business=business)
    return Response(AdsCostSerializer(qs, many=True).data)


@api_view(["GET"])
def referral_list(request, business_id):
    business = get_authorized_business(request, business_id)
    qs = ReferralPayment.objects.filter(business=business)
    return Response(ReferralPaymentSerializer(qs, many=True).data)


@api_view(["GET"])
def compensation_recovery_list(request, business_id):
    business = get_authorized_business(request, business_id)
    qs = CompensationRecovery.objects.filter(business=business)
    return Response(CompensationRecoverySerializer(qs, many=True).data)


@api_view(["GET"])
def order_status_breakdown(request, business_id):
    business = get_authorized_business(request, business_id)
    breakdown = (
        OrderPayment.objects
        .filter(business=business)
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
def final_price_list(request, business_id):
    business = get_authorized_business(request, business_id)
    if request.method == "GET":
        search = request.GET.get("search", "")
        qs = FinalPrice.objects.filter(business=business)
        if search:
            qs = qs.filter(sku_id__icontains=search)
        items = qs
        return Response({
            "results": FinalPriceSerializer(items, many=True).data,
        })

    serializer = FinalPriceSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save(business=business)
    return Response(serializer.data, status=status.HTTP_201_CREATED)

@api_view(["GET", "POST"])
def parent_price_list(request, business_id):
    business = get_authorized_business(request, business_id)
    if request.method == "GET":
        search = request.GET.get("search", "")
        qs = ParentItemPrice.objects.filter(business=business)
        if search:
            qs = qs.filter(item_id__icontains=search)
        items = qs
        return Response({
            "results": ParentItemPriceSerializer(items, many=True).data,
        })

    serializer = ParentItemPriceSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save(business=business)
    return Response(serializer.data, status=status.HTTP_201_CREATED)



@api_view(["GET", "PUT", "PATCH", "DELETE"])
def final_price_detail(request, business_id, sku_id):
    business = get_authorized_business(request, business_id)
    try:
        obj = FinalPrice.objects.get(pk=sku_id, business=business)
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
def parent_price_detail(request, business_id, item_id):
    business = get_authorized_business(request, business_id)
    print("is there")
    try:
        obj = ParentItemPrice.objects.get(pk=item_id, business=business)
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
def parent_linking_to_sku(request, business_id):
    business = get_authorized_business(request, business_id)
    try:

        if request.method == "POST":
            serializer = ParentItemPriceSerializer(data=request.data)
        else:
            obj = ParentItemPrice.objects.get(pk=request.data["item_id"], business=business)
            serializer = ParentItemPriceSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        parent = serializer.save(business=business)
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
            business=business, sku_id__in=sku_ids
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
def _sync_parent_current_price(parent_id, business):
    """After adding/deleting a history entry, keep ParentItemPrice + linked FinalPrices in sync."""
    history = ParentPriceHistory.objects.filter(parent_id=parent_id, business=business).order_by("-effective_from").first()
    if not history:
        return
    ParentItemPrice.objects.filter(pk=parent_id, business=business).update(
        item_price=history.item_price,
        tax_percent=history.tax_percent,
        packaging_cost=history.packaging_cost,
        final_price=history.final_price,
    )
    FinalPrice.objects.filter(parent_id=parent_id, business=business).update(
        item_price=history.item_price,
        tax_percent=history.tax_percent,
        packaging_cost=history.packaging_cost,
        final_price=history.final_price,
    )


@api_view(["GET", "POST"])
def parent_price_history_list(request, business_id, item_id):
    business = get_authorized_business(request, business_id)
    try:
        parent = ParentItemPrice.objects.get(pk=item_id, business=business)
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
    serializer.save(business=business)
    _sync_parent_current_price(item_id, business)
    return Response(serializer.data, status=201)


@api_view(["DELETE"])
def parent_price_history_detail(request, business_id, item_id, pk):
    business = get_authorized_business(request, business_id)
    try:
        obj = ParentPriceHistory.objects.get(pk=pk, parent_id=item_id, business=business)
    except ParentPriceHistory.DoesNotExist:
        return Response({"error": "Not found."}, status=404)
    obj.delete()
    _sync_parent_current_price(item_id, business)
    return Response({"deleted": True})


@api_view(["GET"])
def unlinked_skus(request, business_id):
    """SKUs available to link to a parent.

    Two sources, merged:
      1. FinalPrice rows that have no parent yet (priced but unlinked).
      2. SKUs seen in the orders table that have no linked FinalPrice entry —
         i.e. brand-new SKUs that were never priced/linked ("new" SKUs).

    Each result carries `order_count` (how many orders reference the SKU) and
    `has_price` (whether a FinalPrice row already exists). Response shape stays
    backward compatible ({"results": [{sku_id, item_price, final_price, ...}]}).
    """
    business = get_authorized_business(request, business_id)
    q = request.GET.get("q", "").strip().lower()

    linked = set(
        FinalPrice.objects
        .filter(business=business, parent__isnull=False)
        .values_list("sku_id", flat=True)
    )

    results = {}

    # 1) Priced FinalPrice rows not yet attached to a parent.
    for row in (
        FinalPrice.objects
        .filter(business=business, parent__isnull=True)
        .values("sku_id", "item_price", "final_price")
    ):
        results[row["sku_id"]] = {
            "sku_id": row["sku_id"],
            "item_price": row["item_price"],
            "final_price": row["final_price"],
            "has_price": True,
            "order_count": 0,
        }

    # 2) SKUs from the orders table with no linked entry — the "new" SKUs.
    order_counts = (
        Order.objects
        .filter(business=business)
        .exclude(sku__isnull=True)
        .exclude(sku="")
        .values("sku")
        .annotate(n=Count("sku"))
    )
    for row in order_counts:
        sku = row["sku"]
        if sku in linked:
            continue
        if sku in results:
            results[sku]["order_count"] = row["n"]
        else:
            results[sku] = {
                "sku_id": sku,
                "item_price": None,
                "final_price": None,
                "has_price": False,
                "order_count": row["n"],
            }

    out = list(results.values())
    if q:
        out = [r for r in out if q in r["sku_id"].lower()]
    # Most-ordered first, then alphabetical — surfaces the SKUs that matter most.
    out.sort(key=lambda r: (-r["order_count"], r["sku_id"]))
    return Response({"results": out})


@api_view(["POST"])
def link_sku_to_parent(request, business_id):
    """Link a single SKU to a parent, creating the FinalPrice row if it does not
    exist yet (e.g. a SKU that only appears in the orders table). The child
    inherits the parent's current pricing. Used by the drag-and-drop UI.

    Body: {"sku_id": "...", "parent_id": "..."}
    """
    business = get_authorized_business(request, business_id)
    sku_id = (request.data.get("sku_id") or "").strip()
    parent_id = (request.data.get("parent_id") or "").strip()

    if not sku_id:
        return Response({"error": "sku_id is required."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        parent = ParentItemPrice.objects.get(pk=parent_id, business=business)
    except ParentItemPrice.DoesNotExist:
        return Response({"error": "Parent not found."}, status=status.HTTP_404_NOT_FOUND)

    result = _bulk_link_skus_to_parent(business=business, parent=parent, sku_ids=[sku_id])
    if result["failed"]:
        return Response({
            "error": "SKU belongs to another business and cannot be linked here.",
            "sku_id": sku_id,
            "parent_id": parent.item_id,
        }, status=status.HTTP_409_CONFLICT)

    return Response({
        "message": f"{sku_id} linked to {parent.item_id}",
        "sku_id": sku_id,
        "parent_id": parent.item_id,
        "created": result["created"] > 0,
    }, status=status.HTTP_200_OK)


def _normalize_sku_ids(raw_sku_ids):
    seen = set()
    out = []
    for sku in raw_sku_ids or []:
        s = (sku or "").strip()
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def _bulk_link_skus_to_parent(*, business, parent, sku_ids):
    """Fast in-memory planning + bulk DB writes for linking SKUs to a parent."""
    sku_ids = _normalize_sku_ids(sku_ids)
    if not sku_ids:
        return {"requested": 0, "linked": 0, "created": 0, "updated": 0, "failed": 0, "failed_skus": []}

    existing_global = dict(
        FinalPrice.objects
        .filter(sku_id__in=sku_ids)
        .values_list("sku_id", "business_id")
    )
    conflicts = [sku for sku in sku_ids if sku in existing_global and existing_global[sku] != business.id]
    allowed_ids = [sku for sku in sku_ids if sku not in conflicts]

    existing_business_rows = {
        row.sku_id: row
        for row in FinalPrice.objects.filter(business=business, sku_id__in=allowed_ids)
    }

    to_create_ids = [sku for sku in allowed_ids if sku not in existing_business_rows and sku not in existing_global]
    to_update = [existing_business_rows[sku] for sku in allowed_ids if sku in existing_business_rows]

    for row in to_update:
        row.parent = parent
        row.item_price = parent.item_price
        row.tax_percent = parent.tax_percent
        row.packaging_cost = parent.packaging_cost
        row.final_price = parent.final_price

    created = 0
    updated = 0
    with transaction.atomic():
        if to_update:
            FinalPrice.objects.bulk_update(
                to_update,
                ["parent", "item_price", "tax_percent", "packaging_cost", "final_price"],
                batch_size=500,
            )
            updated = len(to_update)

        if to_create_ids:
            to_create = [
                FinalPrice(
                    sku_id=sku,
                    business=business,
                    parent=parent,
                    item_price=parent.item_price,
                    tax_percent=parent.tax_percent,
                    packaging_cost=parent.packaging_cost,
                    final_price=parent.final_price,
                )
                for sku in to_create_ids
            ]
            try:
                FinalPrice.objects.bulk_create(to_create, batch_size=500)
                created = len(to_create)
            except IntegrityError:
                # Graceful fallback for race/conflict edges.
                for obj in to_create:
                    try:
                        FinalPrice.objects.create(
                            sku_id=obj.sku_id,
                            business=business,
                            parent=parent,
                            item_price=parent.item_price,
                            tax_percent=parent.tax_percent,
                            packaging_cost=parent.packaging_cost,
                            final_price=parent.final_price,
                        )
                        created += 1
                    except IntegrityError:
                        conflicts.append(obj.sku_id)

    linked = created + updated
    return {
        "requested": len(sku_ids),
        "linked": linked,
        "created": created,
        "updated": updated,
        "failed": len(conflicts),
        "failed_skus": sorted(set(conflicts)),
    }


@api_view(["POST"])
def bulk_link_skus_to_parent(request, business_id):
    """Bulk-link many SKUs to a parent in one fast request.

    Body:
      {
        "parent_id": "PARENT_1",
        "sku_ids": ["SKU1", "SKU2", ...]
      }
    """
    business = get_authorized_business(request, business_id)
    parent_id = (request.data.get("parent_id") or "").strip()
    sku_ids = request.data.get("sku_ids") or []

    if not parent_id:
        return Response({"error": "parent_id is required."}, status=status.HTTP_400_BAD_REQUEST)
    if not isinstance(sku_ids, list):
        return Response({"error": "sku_ids must be a list."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        parent = ParentItemPrice.objects.get(pk=parent_id, business=business)
    except ParentItemPrice.DoesNotExist:
        return Response({"error": "Parent not found."}, status=status.HTTP_404_NOT_FOUND)

    result = _bulk_link_skus_to_parent(business=business, parent=parent, sku_ids=sku_ids)
    return Response({
        "message": f"Linked {result['linked']} SKU(s) to {parent_id}",
        "parent_id": parent_id,
        **result,
    }, status=status.HTTP_200_OK)


def _safe_target_parent_id(raw_parent_id, target_business_id):
    base = (raw_parent_id or "").strip() or f"PARENT_{target_business_id}"
    existing = ParentItemPrice.objects.filter(pk=base).first()
    if not existing:
        return base
    if existing.business_id == target_business_id:
        return base

    i = 1
    while True:
        candidate = f"{base}__B{target_business_id}_{i}"
        if not ParentItemPrice.objects.filter(pk=candidate).exists():
            return candidate
        i += 1


@api_view(["POST"])
def import_parent_groups(request, business_id):
    """Copy parent grouping pattern from another business into the current business.

    Body:
      {
        "source_business_id": 2,
        "parent_ids": ["PARENT_A", "PARENT_B"]   # optional
      }
    """
    target_business = get_authorized_business(request, business_id)
    started_at = timezone.now()
    source_business_id = request.data.get("source_business_id")
    parent_ids = request.data.get("parent_ids") or []

    if source_business_id in (None, ""):
        return Response({"error": "source_business_id is required."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        source_business = get_authorized_business(request, int(source_business_id))
    except Exception:
        return Response({"error": "Invalid source business."}, status=status.HTTP_400_BAD_REQUEST)

    if source_business.id == target_business.id:
        return Response({"error": "source_business_id must be different from target business."}, status=status.HTTP_400_BAD_REQUEST)

    if parent_ids and not isinstance(parent_ids, list):
        return Response({"error": "parent_ids must be a list when provided."}, status=status.HTTP_400_BAD_REQUEST)

    source_qs = ParentItemPrice.objects.filter(business=source_business).prefetch_related("sku_prices")
    if isinstance(parent_ids, list) and parent_ids:
        source_qs = source_qs.filter(item_id__in=parent_ids)
    source_parents = list(source_qs)

    # Build import candidates against SKUs visible to target business.
    target_skus = set(
        FinalPrice.objects.filter(business=target_business).values_list("sku_id", flat=True)
    )
    target_skus.update(
        sku for sku in Order.objects.filter(business=target_business).exclude(sku__isnull=True).exclude(sku="").values_list("sku", flat=True)
    )
    target_skus.update(
        sid for sid in MeeshoInventory.objects.filter(business=target_business).exclude(style_id="").values_list("style_id", flat=True)
    )

    imported_groups = []
    total_linked = 0
    total_created = 0
    total_updated = 0
    total_failed = 0
    skipped_groups = 0

    with transaction.atomic():
        for sp in source_parents:
            source_skus = [fp.sku_id for fp in sp.sku_prices.all()]
            matched_skus = [sku for sku in source_skus if sku in target_skus]
            if not matched_skus:
                skipped_groups += 1
                continue

            target_parent_id = _safe_target_parent_id(sp.item_id, target_business.id)
            target_parent, _ = ParentItemPrice.objects.get_or_create(
                item_id=target_parent_id,
                defaults={
                    "business": target_business,
                    "item_price": sp.item_price,
                    "tax_percent": sp.tax_percent,
                    "packaging_cost": sp.packaging_cost,
                    "final_price": sp.final_price,
                },
            )

            if target_parent.business_id != target_business.id:
                skipped_groups += 1
                continue

            result = _bulk_link_skus_to_parent(
                business=target_business,
                parent=target_parent,
                sku_ids=matched_skus,
            )

            total_linked += result["linked"]
            total_created += result["created"]
            total_updated += result["updated"]
            total_failed += result["failed"]

            imported_groups.append({
                "source_parent_id": sp.item_id,
                "target_parent_id": target_parent.item_id,
                "matched_skus": len(matched_skus),
                "linked": result["linked"],
                "failed": result["failed"],
                "failed_skus": result["failed_skus"][:20],
            })

    elapsed_ms = int((timezone.now() - started_at).total_seconds() * 1000)

    return Response({
        "source_business_id": source_business.id,
        "target_business_id": target_business.id,
        "groups_requested": len(source_parents),
        "groups_imported": len(imported_groups),
        "groups_skipped": skipped_groups,
        "linked": total_linked,
        "created": total_created,
        "updated": total_updated,
        "failed": total_failed,
        "elapsed_ms": elapsed_ms,
        "results": imported_groups,
    }, status=status.HTTP_200_OK)


@api_view(["POST"])
@parser_classes([MultiPartParser])
def upload_final_price(request, business_id):
    """
    Upload an Excel or CSV sheet to upsert FinalPrice rows.
    Expected columns: sku_id, item_price, tax_percent, packaging_cost, final_price
    """
    business = get_authorized_business(request, business_id)
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
                business=business, sku_id=pk, defaults=defaults
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
def upload_orders_csv(request, business_id):
    """
    Upload Orders CSV file and create/update Order records.
    """
    business = get_authorized_business(request, business_id)

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
                business=business,
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
def full_orders_list(request, business_id):
    """Paginated list of Order rows with date/status/sku/state/search/month filters."""
    business = get_authorized_business(request, business_id)
    page      = int(request.GET.get("page", 1))
    page_size = int(request.GET.get("page_size", 50))
    status_filter = request.GET.get("status", "")
    sku_filter    = request.GET.get("sku", "")
    state_filter  = request.GET.get("state", "")
    search        = request.GET.get("search", "")
    month         = request.GET.get("month", "")   # YYYY-MM
    date_from     = request.GET.get("date_from", "")
    date_to       = request.GET.get("date_to", "")

    # month shortcut overrides explicit date_from/date_to
    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            import calendar
            last_day = calendar.monthrange(y, m)[1]
            date_from = f"{y:04d}-{m:02d}-01"
            date_to   = f"{y:04d}-{m:02d}-{last_day:02d}"
        except (ValueError, IndexError):
            pass

    qs = Order.objects.filter(business=business)
    if status_filter:
        qs = qs.filter(reason_for_credit_entry__iexact=status_filter)
    if sku_filter:
        qs = qs.filter(sku__icontains=sku_filter)
    if state_filter:
        qs = qs.filter(customer_state__iexact=state_filter)
    if search:
        qs = qs.filter(
            DQ(sub_order_no__icontains=search) |
            DQ(product_name__icontains=search) |
            DQ(sku__icontains=search)
        )
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
def full_orders_analytics(request, business_id):
    """Aggregate stats for Order model — drives the Orders tab summary cards."""
    business = get_authorized_business(request, business_id)
    date_from     = request.GET.get("date_from", "")
    date_to       = request.GET.get("date_to", "")
    status_filter = request.GET.get("status", "")
    month         = request.GET.get("month", "")

    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            import calendar
            last_day = calendar.monthrange(y, m)[1]
            date_from = f"{y:04d}-{m:02d}-01"
            date_to   = f"{y:04d}-{m:02d}-{last_day:02d}"
        except (ValueError, IndexError):
            pass

    base = Order.objects.filter(business=business)
    if date_from:
        base = base.filter(order_date__gte=date_from)
    if date_to:
        base = base.filter(order_date__lte=date_to)
    if status_filter:
        base = base.filter(reason_for_credit_entry__iexact=status_filter)

    qs = Order.latest_per_order(base_qs=base)

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
        .order_by("-count")[:15]
    )

    daily = list(
        qs.values("order_date")
        .annotate(count=Count("sub_order_no", distinct=True))
        .order_by("order_date")
    )

    # Available months — always from unfiltered base for the month picker
    all_months = list(
        Order.objects.filter(business=business).values_list("order_date", flat=True)
        .exclude(order_date__isnull=True)
        .order_by("order_date")
        .distinct()
    )
    months = sorted({str(d)[:7] for d in all_months})

    return Response({
        "total": qs.count(),
        "by_status": by_status,
        "by_state": by_state,
        "by_sku": by_sku,
        "daily": daily,
        "months": months,
    })


@api_view(["GET"])
def dashboard_analytics(request, business_id):
    """
    Primary filter: Order.order_date (reliable DateField).
    Then join OrderPayment by sub_order_no to find settled orders.
    Unsettled = orders in date range with no matching payment.
    """
    business = get_authorized_business(request, business_id)
    date_from = request.GET.get("date_from", "")
    date_to   = request.GET.get("date_to", "")

    # ── Step 1: filter Orders by placement date, then deduplicate to latest ──
    date_filtered_qs = Order.objects.filter(business=business)
    if date_from:
        date_filtered_qs = date_filtered_qs.filter(order_date__gte=date_from)
    if date_to:
        date_filtered_qs = date_filtered_qs.filter(order_date__lte=date_to)

    # latest_per_order ensures each sub_order_no appears once (most-recent status row)
    order_qs  = Order.latest_per_order(base_qs=date_filtered_qs)
    order_nos = set(order_qs.values_list("sub_order_no", flat=True))

    # ── Step 2: find payments for those orders ────────────────────────────────
    payment_qs = (
        OrderPayment.objects.filter(business=business, sub_order_no__in=order_nos)
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
def upload_labels_pdf(request, business_id):
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
    business = get_authorized_business(request, business_id)
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

                page_details.append({
                    "page":             page_num,
                    "sku":              sku,
                    "qty":              qty,
                    "courier":          parsed["courier_name"],
                    "awb":              parsed["awb_number"],
                    "order_id":         parsed["order_id"],
                    "customer_name":    parsed["customer_name"],
                    "customer_pincode": parsed["customer_pincode"],
                    "customer_address": parsed["customer_address"],
                    "customer_city":    parsed["customer_city"],
                    "customer_state":   parsed["customer_state"],
                })

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
                business=business,
                defaults={"uploaded_date": upload_date, **row},
            )
            if created:
                saved += 1
            else:
                # Refresh all data fields — but leave uploaded_date alone
                LabelOrder.objects.filter(order_id=oid, business=business).update(**row)
                updated += 1

    # ── Resolve parent SKU for each child SKU ────────────────────────────────────
    _fp_qs = FinalPrice.objects.filter(
        business=business, sku_id__in=list(sku_data.keys())
    ).values("sku_id", "parent_id")
    sku_to_parent = {row["sku_id"]: row["parent_id"] for row in _fp_qs}

    # Enrich page_details with parent SKU
    for _pd in page_details:
        _pd["parent_sku"] = sku_to_parent.get(_pd.get("sku") or "")

    # Build parent-level rank: aggregate child counts under each parent so the
    # most-dispatched parent group appears first in the cropped PDF.
    parent_count: dict = {}
    for _sku, _data in sku_data.items():
        _parent = sku_to_parent.get(_sku) or _sku
        parent_count[_parent] = parent_count.get(_parent, 0) + _data["count"]
    parent_rank = {
        _p: _r for _r, (_p, _) in enumerate(
            sorted(parent_count.items(), key=lambda x: -x[1])
        )
    }

    # ── Generate cropped PDF (label region only, sorted by parent→child count) ─
    # Sort: parent group (most labels first) → child SKU rank → original page idx
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
            page_order = sorted(
                range(len(reader.pages)),
                key=lambda i: (
                    parent_rank.get(
                        sku_to_parent.get(
                            (page_details[i]["sku"] if i < len(page_details) else "") or ""
                        ) or (page_details[i]["sku"] if i < len(page_details) else "") or "",
                        len(parent_count),
                    ),
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
        [{"sku": k, "parent_sku": sku_to_parent.get(k),
          "count": v["count"], "total_qty": v["total_qty"],
          "max_qty": v["max_qty"], "high_qty_orders": v["high_qty_orders"]}
         for k, v in sku_data.items()],
        key=lambda x: -x["count"],
    )
    total_labels = sum(v["count"] for v in sku_data.values())

    # ── Flag blocked customers found in this upload ───────────────────────────
    blocked_set = set(
        BlockedCustomer.objects.filter(business=business, is_active=True)
        .values_list("customer_name", "customer_pincode")
    )
    blocked_in_batch = []
    for _pd in page_details:
        _name    = _pd.get("customer_name", "")
        _pincode = _pd.get("customer_pincode", "")
        if _name and (_name, _pincode) in blocked_set:
            blocked_in_batch.append({
                "order_id":         _pd.get("order_id", ""),
                "customer_name":    _name,
                "customer_pincode": _pincode,
                "sku":              _pd.get("sku", ""),
            })

    # ── Repeated customers: find prior-history customers in this batch ────────
    # Build (name, pincode) → batch info map
    batch_customers: dict = {}
    batch_order_ids: set  = set()
    for _pd in page_details:
        _name = (_pd.get("customer_name") or "").strip().lower()
        _pincode = str(_pd.get("customer_pincode") or "").strip()
        _oid    = _pd.get("order_id", "")
        if _oid:
            batch_order_ids.add(_oid)
        if not _name or not _pincode:
            continue
        _key = (_name, _pincode)
        if _key not in batch_customers:
            batch_customers[_key] = {
                "customer_name":    _name,
                "customer_pincode": _pincode,
                "customer_address": _pd.get("customer_address", "") or "",
                "customer_city":    _pd.get("customer_city", "") or "",
                "customer_state":   _pd.get("customer_state", "") or "",
                "batch_orders": [],
            }
        batch_customers[_key]["batch_orders"].append({
            "order_id": _oid,
            "sku":      _pd.get("sku", ""),
            "qty":      _pd.get("qty", 1),
        })

    repeated_customers = []
    if batch_customers:
        _all_names    = [k[0] for k in batch_customers]
        _all_pincodes = [k[1] for k in batch_customers]

        # Prior orders = same customer, NOT in this batch
        _prior_rows = list(
            LabelOrder.objects
            .filter(business=business, customer_name__in=_all_names, customer_pincode__in=_all_pincodes)
            .exclude(order_id__in=list(batch_order_ids))
            .values("order_id", "customer_name", "customer_pincode",
                    "sku", "qty", "order_date", "uploaded_date")
        )

        # Group prior rows by customer key
        _prior_by_customer: dict = {}
        for _row in _prior_rows:
            _k = (_row["customer_name"], _row["customer_pincode"])
            _prior_by_customer.setdefault(_k, []).append(_row)

        # Only process customers that actually have prior history
        _prior_order_ids = [_r["order_id"] for _r in _prior_rows]
        _outcomes: dict  = {}
        if _prior_order_ids:
            for _o in (Order.objects
                       .filter(business=business, sub_order_no__in=_prior_order_ids)
                       .values("sub_order_no", "reason_for_credit_entry")):
                _outcomes.setdefault(_o["sub_order_no"], []).append(
                    _o["reason_for_credit_entry"]
                )

        _RETURN_S = {"RETURN", "RETURNED"}

        for _key, _prior in _prior_by_customer.items():
            if not _prior:
                continue
            print("Missing key:", repr(_key))
            print("Available keys:")
            # _bc = batch_customers[_key]

            # Resolve status for each prior order
            _enriched = []
            for _r in _prior:
                _sts = _outcomes.get(_r["order_id"], [])
                if "DELIVERED" in _sts:
                    _resolved = "DELIVERED"
                elif any(_s in _RETURN_S for _s in _sts):
                    _resolved = "RETURN"
                elif "RTO_COMPLETE" in _sts:
                    _resolved = "RTO"
                elif "CANCELLED" in _sts:
                    _resolved = "CANCELLED"
                else:
                    _resolved = "PENDING"
                _enriched.append({
                    "order_id":   _r["order_id"],
                    "sku":        _r["sku"] or "",
                    "qty":        _r["qty"] or 1,
                    "order_date": str(_r["order_date"]) if _r["order_date"] else "",
                    "status":     _resolved,
                })

            _enriched.sort(key=lambda x: x["order_date"], reverse=True)

            _total     = len(_enriched)
            _delivered = sum(1 for _o in _enriched if _o["status"] == "DELIVERED")
            _returned  = sum(1 for _o in _enriched if _o["status"] == "RETURN")
            _rto       = sum(1 for _o in _enriched if _o["status"] == "RTO")
            _ret_rate  = round(_returned / _total, 3) if _total > 0 else 0.0

            # SKU breakdown
            _sku_stats: dict = {}
            for _o in _enriched:
                _s_sku = _o["sku"] or "Unknown"
                _s     = _sku_stats.setdefault(_s_sku, {
                    "sku": _s_sku, "orders": 0, "qty": 0,
                    "delivered": 0, "returned": 0, "rto": 0,
                })
                _s["orders"] += 1
                _s["qty"]    += int(_o["qty"] or 1)
                if _o["status"] == "DELIVERED": _s["delivered"] += 1
                elif _o["status"] == "RETURN":  _s["returned"]  += 1
                elif _o["status"] == "RTO":     _s["rto"]       += 1

            repeated_customers.append({
                "customer_name":     _key[0],
                "customer_pincode":  _key[1],
                # "customer_address":  _bc["customer_address"],
                # "customer_city":     _bc["customer_city"],
                # "customer_state":    _bc["customer_state"],
                # "batch_orders":      _bc["batch_orders"],
                "prior_order_count": _total,
                "delivered":         _delivered,
                "returned":          _returned,
                "rto":               _rto,
                "return_rate":       _ret_rate,
                "risk_level":        _risk_level(_ret_rate, _returned),
                "is_blocked":        _key in blocked_set,
                "sku_breakdown":     sorted(_sku_stats.values(), key=lambda x: -x["orders"]),
                "orders":            _enriched[:50],
                "last_seen":         _enriched[0]["order_date"] if _enriched else "",
            })

        # Sort: blocked first, then high risk, then by return rate desc
        _rl_order = {"high": 0, "medium": 1, "low": 2}
        repeated_customers.sort(key=lambda r: (
            0 if r["is_blocked"] else 1,
            _rl_order.get(r["risk_level"], 3),
            -r["return_rate"],
        ))

    return Response({
        "success": True,
        "upload_date":      str(today),
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
        "repeated_customers":      repeated_customers,
    })


# ── Label Orders — read endpoints ─────────────────────────────────────────────

@api_view(["GET"])
def label_orders_list(request, business_id):
    """
    Paginated LabelOrder list.
    Query params: date (YYYY-MM-DD), date_from, date_to, courier, payment_type,
                  page, page_size
    """
    business = get_authorized_business(request, business_id)
    page        = int(request.GET.get("page", 1))
    page_size   = int(request.GET.get("page_size", 50))
    date_single = request.GET.get("date", "")
    date_from   = request.GET.get("date_from", "")
    date_to     = request.GET.get("date_to", "")
    courier     = request.GET.get("courier", "")
    pay_type    = request.GET.get("payment_type", "")

    qs = LabelOrder.objects.filter(business=business)

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
        BlockedCustomer.objects.filter(business=business, is_active=True)
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
def label_couriers_summary(request, business_id):
    """
    Courier-wise order count for a date range.
    Query params: date (single day), date_from, date_to
    No date params = return all records.
    Also returns the list of available uploaded dates for the date-picker.
    """
    business = get_authorized_business(request, business_id)
    date_single = request.GET.get("date", "")
    date_from   = request.GET.get("date_from", "")
    date_to     = request.GET.get("date_to", "")

    qs = LabelOrder.objects.filter(business=business)
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
        .filter(business=business)
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
def label_duplicate_customers(request, business_id):
    """
    Find repeat customers by ADDRESS (city + state + pincode) — NOT by name.
    Returns addresses that appear in more than one LabelOrder.

    For each duplicate address, returns every order's full details so the
    frontend can display a complete history drawer.

    Query params: date_from, date_to (optional)
    """
    business = get_authorized_business(request, business_id)
    date_from = request.GET.get("date_from", "")
    date_to   = request.GET.get("date_to",   "")

    # Step 1: addresses that appear in the selected period
    period_qs = LabelOrder.objects.filter(business=business).exclude(customer_pincode="").exclude(customer_city="")
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

    all_time_qs = LabelOrder.objects.filter(addr_filter, business=business)

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
            .filter(business=business, customer_pincode=pin, customer_city=city, customer_state=state)
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
def label_customer_history(request, business_id):
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

    business = get_authorized_business(request, business_id)
    name    = request.GET.get("name", "").strip()
    pincode = request.GET.get("pincode", "").strip()

    if not name and not pincode:
        return Response({"error": "Provide at least name or pincode."}, status=400)

    qs = LabelOrder.objects.filter(business=business)
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
        for p in OrderPayment.objects.filter(business=business, sub_order_no__in=order_ids)
    }

    # Join Order (lifecycle status)
    status_map = {
        o.sub_order_no: o.reason_for_credit_entry
        for o in Order.objects.filter(business=business, sub_order_no__in=order_ids)
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


def _log_inventory(business, entity_type, entity_id, action, description,
                   parent_sku_id="", quantity_change=None, metadata=None):
    """Write one immutable audit-log entry."""
    InventoryLog.objects.create(
        business=business,
        entity_type=entity_type,
        entity_id=str(entity_id),
        action=action,
        parent_sku_id=parent_sku_id or "",
        quantity_change=quantity_change,
        description=description,
        metadata=metadata or {},
    )

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
def purchases_list(request, business_id):
    business = get_authorized_business(request, business_id)
    if request.method == "GET":
        qs = PurchaseBill.objects.filter(business=business).prefetch_related("items").order_by("-date", "-created_at")
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
            business=business,
            date=data["date"],
            seller_name=data["seller_name"],
            bill_number=data.get("bill_number", ""),
            notes=data.get("notes", ""),
        )
        for it in data.get("items", []):
            PurchaseItem.objects.create(
                business=business,
                bill=bill,
                parent_sku_id=it.get("parent_sku_id") or None,
                product_description=it.get("product_description", ""),
                quantity=int(it["quantity"]),
                price_per_unit=Decimal(str(it["price_per_unit"])),
                is_exchange=bool(it.get("is_exchange", False)),
            )
    bill.refresh_from_db()
    for it in bill.items.all():
        if it.parent_sku_id:
            _log_inventory(
                business,
                "PURCHASE", it.id, "CREATE",
                f"Added {it.quantity} units of {it.parent_sku_id} from {bill.seller_name}",
                parent_sku_id=it.parent_sku_id,
                quantity_change=it.quantity,
                metadata={"bill_id": bill.id, "price_per_unit": str(it.price_per_unit), "is_exchange": it.is_exchange},
            )
    return Response(_bill_to_dict(PurchaseBill.objects.prefetch_related("items").get(pk=bill.pk, business=business)), status=201)


@api_view(["GET", "PUT", "DELETE"])
def purchase_detail(request, business_id, bill_id):
    business = get_authorized_business(request, business_id)
    try:
        bill = PurchaseBill.objects.prefetch_related("items").get(pk=bill_id, business=business)
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
                    business=business,
                    bill=bill,
                    parent_sku_id=it.get("parent_sku_id") or None,
                    product_description=it.get("product_description", ""),
                    quantity=int(it["quantity"]),
                    price_per_unit=Decimal(str(it["price_per_unit"])),
                    is_exchange=bool(it.get("is_exchange", False)),
                )
        bill = PurchaseBill.objects.prefetch_related("items").get(pk=bill_id, business=business)
        return Response(_bill_to_dict(bill))

    # DELETE
    bill.delete()
    return Response({"message": "Deleted"})


@api_view(["GET"])
def purchase_pdf(request, business_id, bill_id):
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

    business = get_authorized_business(request, business_id)
    try:
        bill = PurchaseBill.objects.prefetch_related("items").get(pk=bill_id, business=business)
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
def inventory_view(request, business_id):
    """
    Compute current stock per parent SKU:
      current_stock = purchased_qty (non-exchange) - sold_qty (DELIVERED) + rto_qty (RTO_COMPLETE) + net_adjustments
    Also returns parent SKUs that have only adjustments (no purchases) so manual-only SKUs appear.
    """
    from django.db.models import ExpressionWrapper, F, DecimalField as DField

    business = get_authorized_business(request, business_id)

    # 1. Purchases per parent SKU
    purchase_agg = (
        PurchaseItem.objects
        .filter(business=business, is_exchange=False, parent_sku__isnull=False)
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
        .filter(business=business)
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
        .filter(business=business, parent_id__in=all_parent_ids)
        .values_list("sku_id", "parent_id")
    )

    # 4. Sold qty (DELIVERED) and returned qty (RTO_COMPLETE) per child SKU
    child_skus = list(sku_to_parent.keys())
    delivered_by_sku = dict(
        Order.objects
        .filter(business=business, reason_for_credit_entry="DELIVERED", sku__in=child_skus)
        .values("sku")
        .annotate(qty=Sum("quantity"))
        .values_list("sku", "qty")
    )
    rto_by_sku = dict(
        Order.objects
        .filter(business=business, reason_for_credit_entry="RTO_COMPLETE", sku__in=child_skus)
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
        .filter(business=business, parent_sku_id__in=all_parent_ids)
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
def inventory_adjustment_list(request, business_id):
    """List or create manual inventory adjustments for a parent SKU."""
    business = get_authorized_business(request, business_id)
    parent_sku_id = request.GET.get("parent_sku", "").strip() if request.method == "GET" else request.data.get("parent_sku_id", "").strip()

    if request.method == "GET":
        if not parent_sku_id:
            return Response({"error": "parent_sku required"}, status=400)
        adjs = InventoryAdjustment.objects.filter(business=business, parent_sku_id=parent_sku_id).order_by("-date", "-created_at")
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

    parent = ParentItemPrice.objects.filter(pk=parent_sku_id, business=business).first()
    if not parent:
        return Response({"error": f"Parent SKU '{parent_sku_id}' not found"}, status=404)

    adj = InventoryAdjustment.objects.create(
        business=business,
        parent_sku=parent,
        quantity=qty,
        reason=data.get("reason", "OTHER"),
        notes=data.get("notes", ""),
        date=data.get("date"),
    )
    _log_inventory(
        business,
        "ADJUSTMENT", adj.id, "CREATE",
        f"Manual adjustment: {'+' if adj.quantity >= 0 else ''}{adj.quantity} units of {parent_sku_id} ({adj.reason})",
        parent_sku_id=parent_sku_id,
        quantity_change=adj.quantity,
        metadata={"reason": adj.reason, "notes": adj.notes},
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
def inventory_adjustment_detail(request, business_id, adj_id):
    """Update or delete a single inventory adjustment."""
    business = get_authorized_business(request, business_id)
    try:
        adj = InventoryAdjustment.objects.get(pk=adj_id, business=business)
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
        _log_inventory(
            business,
            "ADJUSTMENT", adj.id, "UPDATE",
            f"Updated adjustment for {adj.parent_sku_id}: qty→{adj.quantity} reason={adj.reason}",
            parent_sku_id=adj.parent_sku_id,
            quantity_change=adj.quantity,
        )
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
    _log_inventory(
        business,
        "ADJUSTMENT", adj.id, "DELETE",
        f"Deleted adjustment: {adj.parent_sku_id} {adj.quantity} ({adj.reason})",
        parent_sku_id=adj.parent_sku_id,
        quantity_change=-adj.quantity,
    )
    adj.delete()
    return Response({"message": "Deleted"})


@api_view(["POST"])
def inventory_create_sku(request, business_id):
    """Create a new Parent SKU directly from the inventory screen."""
    business = get_authorized_business(request, business_id)
    data = request.data
    sku_id = (data.get("sku_id") or "").strip()
    if not sku_id:
        return Response({"error": "sku_id is required"}, status=400)
    if ParentItemPrice.objects.filter(pk=sku_id, business=business).exists():
        return Response({"error": f"Parent SKU '{sku_id}' already exists"}, status=409)

    with transaction.atomic():
        parent = ParentItemPrice.objects.create(
            business=business,
            item_id=sku_id,
            item_price=data.get("item_price") or None,
            tax_percent=data.get("tax_percent") or None,
            packaging_cost=data.get("packaging_cost") or None,
            final_price=data.get("final_price") or None,
        )
        _log_inventory(business, "SKU", parent.item_id, "CREATE", f"Created Parent SKU: {parent.item_id}", parent_sku_id=parent.item_id)
        # Optional: add initial stock as a purchase bill
        init_qty = int(data.get("initial_qty") or 0)
        if init_qty > 0:
            price_per_unit = Decimal(str(data.get("initial_price") or "0"))
            bill = PurchaseBill.objects.create(
                business=business,
                date=data.get("initial_date") or timezone.now().date(),
                seller_name=data.get("initial_seller") or "Opening Stock",
                bill_number="",
                notes="Initial stock — created from Inventory",
            )
            PurchaseItem.objects.create(
                business=business,
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
def purchase_sku_items(request, business_id):
    """All PurchaseItems for a given parent_sku, with bill metadata."""
    business = get_authorized_business(request, business_id)
    parent_sku = request.GET.get("parent_sku", "").strip()
    if not parent_sku:
        return Response({"error": "parent_sku required"}, status=400)
    items = (
        PurchaseItem.objects
        .filter(business=business, parent_sku_id=parent_sku)
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
def purchase_item_detail(request, business_id, item_id):
    business = get_authorized_business(request, business_id)
    try:
        item = PurchaseItem.objects.select_related("bill").get(pk=item_id, business=business)
    except PurchaseItem.DoesNotExist:
        return Response({"error": "Not found"}, status=404)

    if request.method == "PUT":
        data = request.data
        item.product_description = data.get("product_description", item.product_description)
        item.quantity            = int(data.get("quantity", item.quantity))
        item.price_per_unit      = Decimal(str(data.get("price_per_unit", item.price_per_unit)))
        item.is_exchange         = bool(data.get("is_exchange", item.is_exchange))
        item.save()
        _log_inventory(
            business,
            "PURCHASE", item.id, "UPDATE",
            f"Updated purchase item: {item.parent_sku_id} qty→{item.quantity} price→{item.price_per_unit}",
            parent_sku_id=item.parent_sku_id or "",
            quantity_change=item.quantity,
        )
        return Response({
            "id":             item.id,
            "quantity":       item.quantity,
            "price_per_unit": str(item.price_per_unit),
            "is_exchange":    item.is_exchange,
            "total_amount":   str(item.quantity * item.price_per_unit if not item.is_exchange else 0),
        })

    # DELETE
    bill = item.bill
    _log_inventory(
        business,
        "PURCHASE", item.id, "DELETE",
        f"Deleted purchase item: {item.parent_sku_id} ×{item.quantity}",
        parent_sku_id=item.parent_sku_id or "",
        quantity_change=-item.quantity,
    )
    item.delete()
    # If no items left on the bill, delete the bill too
    if not bill.items.exists():
        bill.delete()
    return Response({"message": "Item deleted"})


@api_view(["GET"])
def purchase_sku_monthly(request, business_id):
    """Monthly purchase aggregates for a parent SKU."""
    business = get_authorized_business(request, business_id)
    parent_sku = request.GET.get("parent_sku", "").strip()
    if not parent_sku:
        return Response({"error": "parent_sku required"}, status=400)
    from django.db.models.functions import TruncMonth
    from django.db.models import ExpressionWrapper as EW, F as Fld, DecimalField as DField
    rows = (
        PurchaseItem.objects
        .filter(business=business, parent_sku_id=parent_sku, is_exchange=False)
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


# ── Consumable Items ──────────────────────────────────────────────────────────

@api_view(["GET", "POST"])
def consumable_items_list(request, business_id):
    business = get_authorized_business(request, business_id)
    if request.method == "GET":
        items = ConsumableItem.objects.filter(business=business)
        results = []
        for item in items:
            purchased  = item.purchases.aggregate(t=Sum("quantity"))["t"] or Decimal("0")
            used       = item.usages.filter(event_type__in=["USE", "WASTE"]).aggregate(t=Sum("quantity"))["t"] or Decimal("0")
            total_spend = item.purchases.aggregate(
                t=Sum(ExpressionWrapper(F("quantity") * F("price_per_unit"), output_field=DjDecimalField(max_digits=14, decimal_places=2)))
            )["t"] or Decimal("0")
            last_purchase = item.purchases.aggregate(last=Max("date"))["last"]
            last_usage    = item.usages.aggregate(last=Max("date"))["last"]
            results.append({
                "id":               item.id,
                "name":             item.name,
                "category":         item.category,
                "category_display": item.get_category_display(),
                "unit":             item.unit,
                "notes":            item.notes,
                "purchased_qty":    float(purchased),
                "used_qty":         float(used),
                "current_stock":    float(purchased - used),
                "total_spend":      str(total_spend),
                "last_purchase":    str(last_purchase) if last_purchase else "",
                "last_usage":       str(last_usage) if last_usage else "",
            })
        return Response({"results": results, "total": len(results)})

    data = request.data
    if not data.get("name"):
        return Response({"error": "name is required"}, status=400)
    item = ConsumableItem.objects.create(
        business=business,
        name=data["name"],
        category=data.get("category", "OTHER"),
        unit=data.get("unit", "pieces"),
        notes=data.get("notes", ""),
    )
    _log_inventory(business, "CONSUMABLE_ITEM", item.id, "CREATE", f"Created consumable item: {item.name}")
    return Response({"id": item.id, "name": item.name, "category": item.category, "unit": item.unit}, status=201)


@api_view(["GET", "PUT", "DELETE"])
def consumable_item_detail(request, business_id, item_id):
    business = get_authorized_business(request, business_id)
    try:
        item = ConsumableItem.objects.get(pk=item_id, business=business)
    except ConsumableItem.DoesNotExist:
        return Response({"error": "Not found"}, status=404)

    if request.method == "GET":
        purchases = [{"id": p.id, "date": str(p.date), "quantity": float(p.quantity), "price_per_unit": str(p.price_per_unit), "total": str(p.quantity * p.price_per_unit), "seller_name": p.seller_name, "notes": p.notes} for p in item.purchases.order_by("-date")]
        usages    = [{"id": u.id, "date": str(u.date), "event_type": u.event_type, "event_display": u.get_event_type_display(), "quantity": float(u.quantity), "notes": u.notes} for u in item.usages.order_by("-date")]
        return Response({"id": item.id, "name": item.name, "category": item.category, "unit": item.unit, "notes": item.notes, "purchases": purchases, "usages": usages})

    if request.method == "PUT":
        old_name = item.name
        item.name     = request.data.get("name", item.name)
        item.category = request.data.get("category", item.category)
        item.unit     = request.data.get("unit", item.unit)
        item.notes    = request.data.get("notes", item.notes)
        item.save()
        _log_inventory(business, "CONSUMABLE_ITEM", item.id, "UPDATE", f"Updated consumable: {old_name} → {item.name}")
        return Response({"id": item.id, "name": item.name, "category": item.category, "unit": item.unit})

    name = item.name
    item.delete()
    _log_inventory(business, "CONSUMABLE_ITEM", item_id, "DELETE", f"Deleted consumable item: {name}")
    return Response({"message": "Deleted"})


@api_view(["GET", "POST"])
def consumable_purchases_list(request, business_id):
    business = get_authorized_business(request, business_id)
    if request.method == "GET":
        item_id = request.GET.get("item_id")
        qs = ConsumablePurchase.objects.filter(business=business).select_related("item").order_by("-date")
        if item_id:
            qs = qs.filter(item_id=item_id)
        results = [{
            "id": p.id, "item_id": p.item_id, "item_name": p.item.name, "item_unit": p.item.unit,
            "date": str(p.date), "quantity": float(p.quantity),
            "price_per_unit": str(p.price_per_unit),
            "total_amount": str(p.quantity * p.price_per_unit),
            "seller_name": p.seller_name, "notes": p.notes,
        } for p in qs]
        return Response({"results": results})

    data = request.data
    try:
        item = ConsumableItem.objects.get(pk=data.get("item_id"), business=business)
    except ConsumableItem.DoesNotExist:
        return Response({"error": "Consumable item not found"}, status=404)

    p = ConsumablePurchase.objects.create(
        business=business,
        item=item,
        date=data["date"],
        quantity=Decimal(str(data.get("quantity", 1))),
        price_per_unit=Decimal(str(data.get("price_per_unit", 0))),
        seller_name=data.get("seller_name", ""),
        notes=data.get("notes", ""),
    )
    _log_inventory(
        business,
        "CONSUMABLE_PURCHASE", p.id, "CREATE",
        f"Purchased {float(p.quantity)} {item.unit} of {item.name} from {p.seller_name or 'unknown'}",
        quantity_change=int(p.quantity),
        metadata={"item_id": item.id, "item_name": item.name, "quantity": float(p.quantity), "price_per_unit": str(p.price_per_unit)},
    )
    return Response({"id": p.id, "item_id": p.item_id, "date": str(p.date), "quantity": float(p.quantity), "price_per_unit": str(p.price_per_unit)}, status=201)


@api_view(["PUT", "DELETE"])
def consumable_purchase_detail(request, business_id, purchase_id):
    business = get_authorized_business(request, business_id)
    try:
        p = ConsumablePurchase.objects.select_related("item").get(pk=purchase_id, business=business)
    except ConsumablePurchase.DoesNotExist:
        return Response({"error": "Not found"}, status=404)

    if request.method == "PUT":
        old_qty = float(p.quantity)
        data = request.data
        p.date           = data.get("date", p.date)
        p.quantity       = Decimal(str(data.get("quantity", p.quantity)))
        p.price_per_unit = Decimal(str(data.get("price_per_unit", p.price_per_unit)))
        p.seller_name    = data.get("seller_name", p.seller_name)
        p.notes          = data.get("notes", p.notes)
        p.save()
        _log_inventory(business, "CONSUMABLE_PURCHASE", p.id, "UPDATE",
            f"Updated {p.item.name} purchase: qty {old_qty} → {float(p.quantity)}", quantity_change=int(p.quantity) - int(old_qty))
        return Response({"id": p.id, "quantity": float(p.quantity), "price_per_unit": str(p.price_per_unit)})

    item_name = p.item.name
    qty = float(p.quantity)
    p.delete()
    _log_inventory(business, "CONSUMABLE_PURCHASE", purchase_id, "DELETE",
        f"Deleted purchase of {qty} {item_name}", quantity_change=-int(qty))
    return Response({"message": "Deleted"})


@api_view(["GET", "POST"])
def consumable_usages_list(request, business_id):
    business = get_authorized_business(request, business_id)
    if request.method == "GET":
        item_id = request.GET.get("item_id")
        qs = ConsumableUsage.objects.filter(business=business).select_related("item").order_by("-date")
        if item_id:
            qs = qs.filter(item_id=item_id)
        results = [{
            "id": u.id, "item_id": u.item_id, "item_name": u.item.name, "item_unit": u.item.unit,
            "date": str(u.date), "event_type": u.event_type,
            "event_display": u.get_event_type_display(),
            "quantity": float(u.quantity), "notes": u.notes,
        } for u in qs]
        return Response({"results": results})

    data = request.data
    try:
        item = ConsumableItem.objects.get(pk=data.get("item_id"), business=business)
    except ConsumableItem.DoesNotExist:
        return Response({"error": "Consumable item not found"}, status=404)

    event_type = data.get("event_type", "USE")
    qty = Decimal(str(data.get("quantity", 1)))
    u = ConsumableUsage.objects.create(
        business=business,
        item=item, date=data["date"], event_type=event_type, quantity=qty,
        notes=data.get("notes", ""),
    )
    desc_map = {
        "USE":   f"Used {float(qty)} {item.unit} of {item.name}",
        "OPEN":  f"Opened new package of {item.name} ({float(qty)} {item.unit})",
        "WASTE": f"Wasted/damaged {float(qty)} {item.unit} of {item.name}",
    }
    _log_inventory(business, "CONSUMABLE_USAGE", u.id, "CREATE",
        desc_map.get(event_type, f"Used {float(qty)} of {item.name}"),
        quantity_change=-int(qty) if event_type in ["USE", "WASTE"] else 0,
        metadata={"item_id": item.id, "item_name": item.name, "event_type": event_type, "quantity": float(qty)})
    return Response({"id": u.id, "item_id": u.item_id, "date": str(u.date), "event_type": u.event_type, "quantity": float(u.quantity)}, status=201)


@api_view(["DELETE"])
def consumable_usage_detail(request, business_id, usage_id):
    business = get_authorized_business(request, business_id)
    try:
        u = ConsumableUsage.objects.select_related("item").get(pk=usage_id, business=business)
    except ConsumableUsage.DoesNotExist:
        return Response({"error": "Not found"}, status=404)
    item_name, qty, event_type = u.item.name, float(u.quantity), u.event_type
    u.delete()
    _log_inventory(business, "CONSUMABLE_USAGE", usage_id, "DELETE",
        f"Deleted usage record: {qty} of {item_name} ({event_type})")
    return Response({"message": "Deleted"})


# ── Inventory Audit Log ───────────────────────────────────────────────────────

@api_view(["GET"])
def inventory_logs_list(request, business_id):
    business = get_authorized_business(request, business_id)
    qs = InventoryLog.objects.filter(business=business)
    parent_sku  = request.GET.get("parent_sku",  "").strip()
    entity_type = request.GET.get("entity_type", "").strip()
    action      = request.GET.get("action",      "").strip()
    date_from   = request.GET.get("date_from",   "").strip()
    date_to     = request.GET.get("date_to",     "").strip()

    if parent_sku:  qs = qs.filter(parent_sku_id=parent_sku)
    if entity_type: qs = qs.filter(entity_type=entity_type)
    if action:      qs = qs.filter(action=action)
    if date_from:   qs = qs.filter(created_at__date__gte=date_from)
    if date_to:     qs = qs.filter(created_at__date__lte=date_to)

    page      = max(1, int(request.GET.get("page", 1)))
    page_size = max(1, min(200, int(request.GET.get("page_size", 50))))
    total     = qs.count()
    offset    = (page - 1) * page_size

    results = [{
        "id":              log.id,
        "entity_type":     log.entity_type,
        "entity_id":       log.entity_id,
        "action":          log.action,
        "parent_sku_id":   log.parent_sku_id,
        "quantity_change": log.quantity_change,
        "description":     log.description,
        "metadata":        log.metadata,
        "created_at":      log.created_at.isoformat(),
    } for log in qs[offset:offset + page_size]]

    return Response({"results": results, "total": total, "page": page, "page_size": page_size})


# ── Inventory Charts ──────────────────────────────────────────────────────────

@api_view(["GET"])
def inventory_charts(request, business_id):
    """Aggregated data for inventory dashboard charts."""
    import datetime
    from django.db.models.functions import TruncMonth
    from django.db.models import ExpressionWrapper as EW, F as Fld, DecimalField as DField2

    business = get_authorized_business(request, business_id)

    # ── 1. Current stock by SKU ───────────────────────────────────────────────
    purchase_agg = (
        PurchaseItem.objects.filter(business=business, is_exchange=False, parent_sku__isnull=False)
        .values("parent_sku_id")
        .annotate(
            purchased_qty=Sum("quantity"),
            purchase_value=Sum(EW(Fld("quantity") * Fld("price_per_unit"), output_field=DField2(max_digits=14, decimal_places=2))),
        )
    )
    purchased_by_parent = {r["parent_sku_id"]: {"qty": r["purchased_qty"], "value": float(r["purchase_value"] or 0)} for r in purchase_agg}

    adj_agg = {r["parent_sku_id"]: r["net_adj"] for r in InventoryAdjustment.objects.filter(business=business).values("parent_sku_id").annotate(net_adj=Sum("quantity"))}

    all_parents = set(purchased_by_parent.keys()) | set(adj_agg.keys())
    sku_to_parent = dict(FinalPrice.objects.filter(business=business, parent_id__in=all_parents).values_list("sku_id", "parent_id"))
    child_skus = list(sku_to_parent.keys())

    del_by_sku = dict(Order.objects.filter(business=business, reason_for_credit_entry="DELIVERED", sku__in=child_skus).values("sku").annotate(q=Sum("quantity")).values_list("sku", "q"))
    rto_by_sku = dict(Order.objects.filter(business=business, reason_for_credit_entry="RTO_COMPLETE", sku__in=child_skus).values("sku").annotate(q=Sum("quantity")).values_list("sku", "q"))

    sold_by_parent = {}
    rto_by_parent  = {}
    for sku, qty in del_by_sku.items():
        p = sku_to_parent.get(sku)
        if p: sold_by_parent[p] = sold_by_parent.get(p, 0) + qty
    for sku, qty in rto_by_sku.items():
        p = sku_to_parent.get(sku)
        if p: rto_by_parent[p] = rto_by_parent.get(p, 0) + qty

    stock_by_sku = []
    for parent_id in all_parents:
        pdata   = purchased_by_parent.get(parent_id, {"qty": 0, "value": 0})
        current = pdata["qty"] - sold_by_parent.get(parent_id, 0) + rto_by_parent.get(parent_id, 0) + adj_agg.get(parent_id, 0)
        status  = "out" if current <= 0 else "low" if current <= 3 else "instock"
        stock_by_sku.append({"sku_id": parent_id, "current_stock": current, "purchase_value": pdata["value"], "status": status})
    stock_by_sku.sort(key=lambda x: -x["current_stock"])

    stock_status = {
        "instock": sum(1 for s in stock_by_sku if s["status"] == "instock"),
        "low":     sum(1 for s in stock_by_sku if s["status"] == "low"),
        "out":     sum(1 for s in stock_by_sku if s["status"] == "out"),
    }

    # ── 2. Monthly purchases last 12 months ───────────────────────────────────
    twelve_ago = datetime.date.today() - datetime.timedelta(days=365)
    monthly_qs = (
        PurchaseItem.objects.filter(business=business, is_exchange=False, bill__date__gte=twelve_ago)
        .annotate(month=TruncMonth("bill__date"))
        .values("month")
        .annotate(total_qty=Sum("quantity"), total_value=Sum(EW(Fld("quantity") * Fld("price_per_unit"), output_field=DField2(max_digits=14, decimal_places=2))), bill_count=Count("bill_id", distinct=True))
        .order_by("month")
    )
    monthly_purchases = [{"month": r["month"].strftime("%Y-%m"), "label": r["month"].strftime("%b %y"), "total_qty": r["total_qty"], "total_value": float(r["total_value"] or 0), "bill_count": r["bill_count"]} for r in monthly_qs if r["month"]]

    # ── 3. Consumable monthly spend last 6 months ─────────────────────────────
    six_ago = datetime.date.today() - datetime.timedelta(days=180)
    consumable_monthly = []
    if ConsumableItem.objects.filter(business=business).exists():
        cons_qs = (
            ConsumablePurchase.objects.filter(business=business, date__gte=six_ago)
            .annotate(month=TruncMonth("date"))
            .values("month", "item__category")
            .annotate(total_spend=Sum(EW(Fld("quantity") * Fld("price_per_unit"), output_field=DField2(max_digits=14, decimal_places=2))))
            .order_by("month")
        )
        by_month = {}
        for r in cons_qs:
            key = r["month"].strftime("%Y-%m") if r["month"] else ""
            if not key: continue
            if key not in by_month:
                by_month[key] = {"month": key, "label": r["month"].strftime("%b %y"), "total": 0}
            by_month[key][r["item__category"]] = float(r["total_spend"] or 0)
            by_month[key]["total"] += float(r["total_spend"] or 0)
        consumable_monthly = sorted(by_month.values(), key=lambda x: x["month"])

    # ── 4. Top SKUs by purchase value ─────────────────────────────────────────
    top_by_value = sorted(stock_by_sku, key=lambda x: -x["purchase_value"])[:10]

    return Response({
        "stock_by_sku":       stock_by_sku[:20],
        "top_by_value":       top_by_value,
        "stock_status":       stock_status,
        "monthly_purchases":  monthly_purchases,
        "consumable_monthly": consumable_monthly,
        "total_skus":         len(stock_by_sku),
        "total_stock":        sum(s["current_stock"] for s in stock_by_sku),
        "total_value":        sum(s["purchase_value"] for s in stock_by_sku),
    })


# ── Label packing ──────────────────────────────────────────────────────────────

@api_view(["PATCH"])
def label_order_pack(request, business_id, order_id):
    """Toggle or set is_packed on a LabelOrder."""
    business = get_authorized_business(request, business_id)
    try:
        lo = LabelOrder.objects.get(pk=order_id, business=business)
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
def label_bulk_pack(request, business_id):
    """Mark a list of order_ids as packed=True/False."""
    business = get_authorized_business(request, business_id)
    order_ids = request.data.get("order_ids", [])
    packed    = bool(request.data.get("packed", True))
    packed_at = timezone.now() if packed else None
    updated   = LabelOrder.objects.filter(business=business, order_id__in=order_ids).update(
        is_packed=packed, packed_at=packed_at
    )
    return Response({"updated": updated, "packed": packed})


@api_view(["GET"])
def label_unpacked(request, business_id):
    """List unpacked LabelOrders, optionally filtered by uploaded_date."""
    business = get_authorized_business(request, business_id)
    qs = LabelOrder.objects.filter(business=business, is_packed=False)
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

def _risk_level(return_rate, return_count):
    """Return 'high' / 'medium' / 'low' based on RETURN behaviour (not RTO)."""
    if return_rate >= 0.5 or return_count >= 3:
        return "high"
    if return_rate >= 0.25 or return_count >= 2:
        return "medium"
    return "low"


@api_view(["GET"])
def fraud_customers(request, business_id):
    """
    Per-customer analysis: identity = customer_name + customer_pincode.
    Groups orders by same name + same address, returns full order history,
    per-SKU breakdown, and return-based risk level.
    """
    business = get_authorized_business(request, business_id)
    min_orders = int(request.GET.get("min_orders", 2))

    # 1. Load every LabelOrder row with full detail in one query
    all_label_rows = list(
        LabelOrder.objects
        .filter(business=business)
        .exclude(customer_name="")
        .values(
            "order_id", "customer_name", "customer_pincode",
            "customer_address", "customer_city", "customer_state",
            "sku", "qty", "order_date",
        )
    )
    if not all_label_rows:
        return Response({"results": [], "total": 0})

    # 2. Group by (name, pincode); build per-order detail list
    customer_orders = {}
    all_order_ids   = []
    for lo in all_label_rows:
        key = (lo["customer_name"], lo["customer_pincode"])
        customer_orders.setdefault(key, []).append({
            "order_id":   lo["order_id"],
            "sku":        lo["sku"] or "",
            "qty":        lo["qty"] or 1,
            "order_date": str(lo["order_date"]) if lo["order_date"] else "",
            "address":    lo["customer_address"] or "",
            "city":       lo["customer_city"] or "",
            "state":      lo["customer_state"] or "",
            "status":     "PENDING",
        })
        all_order_ids.append(lo["order_id"])

    # 3. Outcomes from Order table  (DELIVERED / RETURN / RETURNED / RTO_COMPLETE / CANCELLED)
    outcome_map = {}
    for row in Order.objects.filter(business=business, sub_order_no__in=all_order_ids).values("sub_order_no", "reason_for_credit_entry"):
        outcome_map.setdefault(row["sub_order_no"], []).append(row["reason_for_credit_entry"])

    # 4. Claims lookup
    claimed_ids = set(
        OrderPayment.objects
        .filter(business=business, sub_order_no__in=all_order_ids, claims__isnull=False)
        .exclude(claims=0)
        .values_list("sub_order_no", flat=True)
        .distinct()
    )

    # 5. Blocked lookup
    blocked_set = set(
        BlockedCustomer.objects.filter(business=business, is_active=True)
        .values_list("customer_name", "customer_pincode")
    )

    RETURN_STATUSES = {"RETURN", "RETURNED"}

    results = []
    for (name, pincode), orders in customer_orders.items():
        # Deduplicate order_ids (same order can appear twice if multi-item)
        seen_ids: dict = {}
        for o in orders:
            oid = o["order_id"]
            if oid not in seen_ids:
                seen_ids[oid] = o
        unique_orders = list(seen_ids.values())
        if len(unique_orders) < min_orders:
            continue

        # Resolve statuses
        enriched = []
        for o in unique_orders:
            statuses = outcome_map.get(o["order_id"], [])
            if "DELIVERED" in statuses:
                resolved = "DELIVERED"
            elif any(s in RETURN_STATUSES for s in statuses):
                resolved = "RETURN"
            elif "RTO_COMPLETE" in statuses:
                resolved = "RTO"
            elif "CANCELLED" in statuses:
                resolved = "CANCELLED"
            else:
                resolved = "PENDING"
            enriched.append({**o, "status": resolved})

        enriched.sort(key=lambda x: x["order_date"], reverse=True)

        delivered = sum(1 for o in enriched if o["status"] == "DELIVERED")
        returned  = sum(1 for o in enriched if o["status"] == "RETURN")
        rto       = sum(1 for o in enriched if o["status"] == "RTO")
        cancelled = sum(1 for o in enriched if o["status"] == "CANCELLED")
        pending   = sum(1 for o in enriched if o["status"] == "PENDING")
        total     = len(enriched)
        claim_count = sum(1 for o in enriched if o["order_id"] in claimed_ids)

        return_rate = round(returned / total, 3) if total > 0 else 0.0
        rto_rate    = round(rto    / total, 3) if total > 0 else 0.0

        # Per-SKU breakdown
        sku_stats: dict = {}
        for o in enriched:
            sku = o["sku"] or "Unknown"
            s   = sku_stats.setdefault(sku, {"sku": sku, "orders": 0, "qty": 0,
                                              "delivered": 0, "returned": 0, "rto": 0})
            s["orders"] += 1
            s["qty"]    += int(o["qty"] or 1)
            if o["status"] == "DELIVERED": s["delivered"] += 1
            elif o["status"] == "RETURN":  s["returned"]  += 1
            elif o["status"] == "RTO":     s["rto"]       += 1

        sample = enriched[0] if enriched else {}
        results.append({
            "customer_name":    name,
            "customer_pincode": pincode,
            "customer_address": sample.get("address", ""),
            "customer_city":    sample.get("city", ""),
            "customer_state":   sample.get("state", ""),
            "total_orders":     total,
            "delivered":        delivered,
            "returned":         returned,
            "rto":              rto,
            "cancelled":        cancelled,
            "pending":          pending,
            "return_rate":      return_rate,
            "rto_rate":         rto_rate,
            "claim_count":      claim_count,
            "risk_level":       _risk_level(return_rate, returned),
            "last_order":       enriched[0]["order_date"] if enriched else "",
            "is_blocked":       (name, pincode) in blocked_set,
            "sku_breakdown":    sorted(sku_stats.values(), key=lambda x: -x["orders"]),
            "orders":           enriched[:60],
        })

    order_map = {"high": 0, "medium": 1, "low": 2}
    results.sort(key=lambda r: (order_map[r["risk_level"]], -r["return_rate"], -r["returned"]))

    risk_filter = request.GET.get("risk", "")
    if risk_filter in ("high", "medium", "low"):
        results = [r for r in results if r["risk_level"] == risk_filter]

    return Response({"results": results, "total": len(results)})


@api_view(["GET", "POST"])
def blocked_customers_list(request, business_id):
    business = get_authorized_business(request, business_id)
    if request.method == "GET":
        qs = BlockedCustomer.objects.filter(business=business, is_active=True).order_by("-blocked_at")
        results = [{
            "id":               bc.id,
            "id":               bc.id,
            "customer_name":    bc.customer_name,
            "customer_pincode": bc.customer_pincode,
            "customer_city":    bc.customer_city,
            "customer_state":   bc.customer_state,
            "customer_address": getattr(bc, "customer_address", ""),
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
        business=business,
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
def blocked_customer_detail(request, business_id, bc_id):
    business = get_authorized_business(request, business_id)
    try:
        bc = BlockedCustomer.objects.get(pk=bc_id, business=business)
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
def inventory_delete_sku(request, business_id, sku_id):
    """Delete all purchase items for a parent SKU; also delete bills that become empty."""
    business = get_authorized_business(request, business_id)
    items = PurchaseItem.objects.filter(business=business, parent_sku_id=sku_id)
    bill_ids = list(items.values_list("bill_id", flat=True).distinct())
    count = items.count()
    _log_inventory(business, "SKU", sku_id, "DELETE", f"Deleted all {count} purchase entries for {sku_id}", parent_sku_id=sku_id, quantity_change=-count)
    items.delete()
    for bid in bill_ids:
        if not PurchaseItem.objects.filter(bill_id=bid, business=business).exists():
            PurchaseBill.objects.filter(pk=bid, business=business).delete()
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
def generate_product_images(request, business_id):
    business = get_authorized_business(request, business_id)
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


# ── Meesho Inventory ───────────────────────────────────────────────────────────

_INV_COL_MAP = {
    "serial no":           "serial_no",
    "serial_no":           "serial_no",
    "catalog name":        "catalog_name",
    "catalog_name":        "catalog_name",
    "catalog id":          "catalog_id",
    "catalog_id":          "catalog_id",
    "product name":        "product_name",
    "product_name":        "product_name",
    "product id":          "product_id",
    "product_id":          "product_id",
    "style id":            "style_id",
    "style_id":            "style_id",
    "variation id":        "variation_id",
    "variation_id":        "variation_id",
    "variation":           "variation",
    "stock":               "stock_type",
    "stock_type":          "stock_type",
    "system stock count":  "system_stock_count",
    "system_stock_count":  "system_stock_count",
    "your stock count":    "seller_stock_count",
    "seller_stock_count":  "seller_stock_count",
}

_DESCRIPTION_ROW_MARKERS = {
    "row identifier", "catalog name", "catalog id", "product id/style id",
}


def _safe_inv_int(val, default=None):
    try:
        v = int(float(str(val).strip()))
        return v
    except Exception:
        return default


@api_view(["POST"])
@parser_classes([MultiPartParser])
def meesho_inventory_upload(request, business_id):
    business = get_authorized_business(request, business_id)
    file = request.FILES.get("file")
    if not file:
        return Response({"error": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        if file.name.lower().endswith((".xlsx", ".xls")):
            import openpyxl as _opxl
            file.seek(0)
            wb = _opxl.load_workbook(file, read_only=True, data_only=True)
            # Find the sheet whose name contains "fill this" (case-insensitive)
            sheet_name = None
            for name in wb.sheetnames:
                if "fill this" in name.lower():
                    sheet_name = name
                    break
            wb.close()
            file.seek(0)
            df = pd.read_excel(file, sheet_name=sheet_name, dtype=str)
        else:
            df = pd.read_csv(file, dtype=str)
    except Exception as exc:
        return Response({"error": f"Could not read file: {exc}"}, status=status.HTTP_400_BAD_REQUEST)

    df.columns = [str(c).strip().lower() for c in df.columns]
    df.rename(columns=_INV_COL_MAP, inplace=True)

    if "serial_no" not in df.columns:
        return Response({"error": "Missing required column: SERIAL NO"}, status=status.HTTP_400_BAD_REQUEST)

    def _is_description_row(row):
        val = str(row.get("serial_no", "")).strip().lower()
        return val in _DESCRIPTION_ROW_MARKERS or not val.lstrip("-").lstrip().replace(".", "").isdigit()

    df = df[~df.apply(_is_description_row, axis=1)].reset_index(drop=True)

    created = updated = skipped = 0
    with transaction.atomic():
        for _, row in df.iterrows():
            sno     = _safe_inv_int(row.get("serial_no"))
            cat_id  = _safe_inv_int(row.get("catalog_id"))
            prod_id = _safe_inv_int(row.get("product_id"))
            if sno is None or cat_id is None or prod_id is None:
                skipped += 1
                continue

            raw_seller = row.get("seller_stock_count", "")
            seller_count = _safe_inv_int(raw_seller) if str(raw_seller).strip() not in ("", "nan") else None

            defaults = {
                "catalog_name":       str(row.get("catalog_name", "")).strip(),
                "catalog_id":         cat_id,
                "product_name":       str(row.get("product_name", "")).strip(),
                "product_id":         prod_id,
                "style_id":           str(row.get("style_id", "")).strip(),
                "variation_id":       _safe_inv_int(row.get("variation_id")),
                "variation":          str(row.get("variation", "")).strip(),
                "stock_type":         str(row.get("stock_type", "ALL")).strip().upper() or "ALL",
                "system_stock_count": _safe_inv_int(row.get("system_stock_count"), 0),
                "seller_stock_count": seller_count,
            }
            _, was_created = MeeshoInventory.objects.update_or_create(
                business=business, serial_no=sno, defaults=defaults,
            )
            if was_created:
                created += 1
            else:
                updated += 1

    return Response(
        {"success": True, "created": created, "updated": updated, "skipped": skipped},
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET", "PATCH"])
def meesho_inventory_list(request, business_id):
    business = get_authorized_business(request, business_id)
    if request.method == "PATCH":
        updates = request.data if isinstance(request.data, list) else []
        count = 0
        with transaction.atomic():
            for item in updates:
                pk  = item.get("id")
                val = item.get("seller_stock_count")
                if pk is None:
                    continue
                MeeshoInventory.objects.filter(pk=pk, business=business).update(
                    seller_stock_count=_safe_inv_int(val)
                )
                count += 1
        return Response({"updated": count})

    qs = MeeshoInventory.objects.filter(business=business).order_by("serial_no")
    if request.GET.get("low_stock") == "1":
        qs = qs.filter(system_stock_count__lt=100)

    search = request.GET.get("q", "").strip()
    if search:
        qs = qs.filter(
            DQ(catalog_name__icontains=search) |
            DQ(product_name__icontains=search) |
            DQ(style_id__icontains=search)
        )

    data = list(qs.values(
        "id", "serial_no", "catalog_name", "catalog_id",
        "product_name", "product_id", "style_id",
        "variation_id", "variation", "stock_type",
        "system_stock_count", "seller_stock_count",
    ))
    total           = MeeshoInventory.objects.filter(business=business).count()
    low_stock_count = MeeshoInventory.objects.filter(business=business, system_stock_count__lt=100).count()
    return Response({"items": data, "total": total, "low_stock_count": low_stock_count})


@api_view(["GET"])
def meesho_inventory_download(request, business_id):
    from io import BytesIO
    from django.http import HttpResponse
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment

    business = get_authorized_business(request, business_id)
    qs = MeeshoInventory.objects.filter(business=business).order_by("serial_no")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Inventory-Fill this"

    headers = [
        "SERIAL NO", "CATALOG NAME", "CATALOG ID", "PRODUCT NAME",
        "PRODUCT ID", "STYLE ID", "VARIATION ID", "VARIATION",
        "STOCK", "SYSTEM STOCK COUNT", "YOUR STOCK COUNT",
    ]
    desc_row = [
        "Row identifier", "Catalog name", "Catalog id", "Product name",
        "Product id", "Product ID/Style ID", "Variation id", "Variation",
        "Stock type (IN_STOCK / OUT_OF_STOCK / ALL)",
        "Current system stock count",
        "Edit this (keep empty if no change in stock)",
    ]
    ws.append(headers)
    ws.append(desc_row)

    for item in qs:
        # YOUR STOCK COUNT: filled only where the seller has set a new value,
        # empty otherwise so Meesho skips those rows
        your_stock = item.seller_stock_count if item.seller_stock_count is not None else ""
        ws.append([
            item.serial_no,
            item.catalog_name,
            item.catalog_id,
            item.product_name,
            item.product_id,
            item.style_id,
            item.variation_id,
            item.variation,
            item.stock_type,
            item.system_stock_count,
            your_stock,
        ])

    col_widths = [10, 28, 14, 50, 14, 30, 14, 14, 10, 22, 22]
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    response = HttpResponse(
        buf.read(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = 'attachment; filename="meesho_inventory_updated.xlsx"'
    return response


# ── Meesho Price Update ────────────────────────────────────────────────────────

@api_view(["GET", "PATCH"])
def meesho_price_update_list(request, business_id):
    """
    GET  — return all inventory items enriched with profit data.
           ?max_profit=<n>  filters to SKUs with avg_profit_per_unit < n
           ?q=<search>      filters by catalog/product/style
    PATCH — bulk-save price updates: [{inventory_id, new_msp, new_wdrp, new_mrp}, ...]
    """
    business = get_authorized_business(request, business_id)
    if request.method == "PATCH":
        updates = request.data if isinstance(request.data, list) else []
        inv_ids = [u.get("inventory_id") for u in updates if u.get("inventory_id") is not None]
        inv_ids = list({int(i) for i in inv_ids})

        inventory_map = {
            inv.id: inv
            for inv in MeeshoInventory.objects.filter(business=business, id__in=inv_ids)
        }
        existing_updates = {
            pu.inventory_id: pu
            for pu in MeeshoPriceUpdate.objects.filter(business=business, inventory_id__in=inv_ids)
        }

        to_create = []
        to_update = []
        touched_ids = set()

        for item in updates:
            inv_id = item.get("inventory_id")
            if inv_id is None:
                continue
            inv_id = int(inv_id)
            inv = inventory_map.get(inv_id)
            if not inv:
                continue

            payload = {}
            for field in ("new_msp", "new_wdrp", "new_mrp"):
                raw = item.get(field)
                payload[field] = safe_decimal(raw) if raw not in (None, "", "null") else None

            existing = existing_updates.get(inv_id)
            if existing:
                existing.new_msp = payload["new_msp"]
                existing.new_wdrp = payload["new_wdrp"]
                existing.new_mrp = payload["new_mrp"]
                to_update.append(existing)
            else:
                to_create.append(MeeshoPriceUpdate(business=business, inventory=inv, **payload))
            touched_ids.add(inv_id)

        with transaction.atomic():
            if to_create:
                MeeshoPriceUpdate.objects.bulk_create(to_create, batch_size=500)
            if to_update:
                MeeshoPriceUpdate.objects.bulk_update(to_update, ["new_msp", "new_wdrp", "new_mrp"], batch_size=500)

        return Response({"updated": len(touched_ids)})

    # ── GET ──────────────────────────────────────────────────────────────────
    from django.db.models import Avg, Count, Sum as DjSum

    # Per-SKU delivery stats from OrderPayment
    delivered_agg = (
        OrderPayment.objects
        .filter(business=business, live_order_status__iexact="delivered")
        .values("supplier_sku")
        .annotate(
            avg_settlement=Avg("final_settlement_amount"),
            delivery_count=Count("id"),
        )
    )
    delivered_map = {r["supplier_sku"]: r for r in delivered_agg}

    # Current listing price per SKU
    listing_agg = (
        OrderPayment.objects
        .filter(business=business)
        .exclude(listing_price_incl_taxes=None)
        .values("supplier_sku")
        .annotate(last_price=Avg("listing_price_incl_taxes"))
    )
    listing_map = {r["supplier_sku"]: float(r["last_price"] or 0) for r in listing_agg}

    # Cost from FinalPrice
    fp_map = {fp.sku_id: float(fp.final_price or 0)
              for fp in FinalPrice.objects.filter(business=business).only("sku_id", "final_price")}

    # Existing price updates
    pu_map = {pu.inventory_id: pu
              for pu in MeeshoPriceUpdate.objects.filter(business=business).select_related("inventory")}

    qs = MeeshoInventory.objects.filter(business=business).order_by("serial_no")

    search = request.GET.get("q", "").strip()
    if search:
        qs = qs.filter(
            DQ(catalog_name__icontains=search) |
            DQ(product_name__icontains=search) |
            DQ(style_id__icontains=search)
        )

    max_profit_str = request.GET.get("max_profit", "").strip()
    max_profit = None
    try:
        if max_profit_str != "":
            max_profit = float(max_profit_str)
    except ValueError:
        pass

    results = []
    for inv in qs:
        sid = inv.style_id.strip() if inv.style_id else ""
        d   = delivered_map.get(sid, {})

        avg_settlement = float(d.get("avg_settlement") or 0)
        delivery_count = int(d.get("delivery_count") or 0)
        cost           = fp_map.get(sid, None)
        current_price  = listing_map.get(sid, None)

        avg_profit = None
        if cost is not None and avg_settlement:
            avg_profit = round(avg_settlement - cost, 2)

        # Apply profit threshold filter
        if max_profit is not None:
            if avg_profit is None or avg_profit >= max_profit:
                continue

        pu = pu_map.get(inv.id)
        results.append({
            "inventory_id":    inv.id,
            "serial_no":       inv.serial_no,
            "catalog_name":    inv.catalog_name,
            "catalog_id":      inv.catalog_id,
            "product_name":    inv.product_name,
            "product_id":      inv.product_id,
            "style_id":        inv.style_id,
            "variation":       inv.variation,
            "variation_id":    inv.variation_id,
            "system_stock":    inv.system_stock_count,
            "delivery_count":  delivery_count,
            "avg_settlement":  round(avg_settlement, 2) if avg_settlement else None,
            "cost":            cost,
            "current_price":   current_price,
            "avg_profit":      avg_profit,
            # saved price updates
            "new_msp":         float(pu.new_msp)  if pu and pu.new_msp  is not None else None,
            "new_wdrp":        float(pu.new_wdrp) if pu and pu.new_wdrp is not None else None,
            "new_mrp":         float(pu.new_mrp)  if pu and pu.new_mrp  is not None else None,
        })

    return Response({
        "items": results,
        "total": len(results),
    })


@api_view(["GET"])
def meesho_price_update_download(request, business_id):
    """
    Download the Meesho price update sheet.
    Only rows where new_msp has been set are included.
    Columns match Meesho's bulk price update template exactly.
    """
    from io import BytesIO
    from django.http import HttpResponse
    import openpyxl

    business = get_authorized_business(request, business_id)
    rows = (
        MeeshoPriceUpdate.objects
        .filter(business=business, new_msp__isnull=False)
        .select_related("inventory")
        .order_by("inventory__serial_no")
    )

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "MSP Update"

    headers = [
        "Catalog ID",
        "Product ID",
        "Variation Name",
        "Variation ID",
        "New Meesho Selling Price (MSP)",
        "Wrong/Defective Return Price (WDRP) (if catalog is part of WDRP)",
        "New Maximum Retail Price (MRP) (Optional)",
    ]
    ws.append(headers)

    from openpyxl.styles import Font, PatternFill, Alignment
    header_fill = PatternFill("solid", fgColor="4F46E5")
    header_font = Font(bold=True, color="FFFFFF")
    for cell in ws[1]:
        cell.font      = header_font
        cell.fill      = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for pu in rows:
        inv = pu.inventory
        ws.append([
            inv.catalog_id,
            inv.product_id,
            inv.variation or "Free Size",
            inv.variation_id,
            float(pu.new_msp),
            float(pu.new_wdrp) if pu.new_wdrp is not None else "",
            float(pu.new_mrp)  if pu.new_mrp  is not None else "",
        ])

    col_widths = [14, 14, 20, 14, 32, 50, 35]
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    resp = HttpResponse(
        buf.read(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    resp["Content-Disposition"] = 'attachment; filename="meesho_price_update.xlsx"'
    return resp
