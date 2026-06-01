import pandas as pd
import numpy as np
from decimal import Decimal, InvalidOperation
from django.db import transaction
from django.db.models import Sum, Count
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from .models import OrderPayment, AdsCost, ReferralPayment, CompensationRecovery, FinalPrice
from .serializers import (
    OrderPaymentSerializer, AdsCostSerializer,
    ReferralPaymentSerializer, CompensationRecoverySerializer,
    FinalPriceSerializer,
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
                obj, was_created = OrderPayment.objects.update_or_create(
                    sub_order_no=pk, defaults=defaults
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

        created = 0
        with transaction.atomic():
            for _, row in df.iterrows():
                AdsCost.objects.create(
                    deduction_duration=safe_date(row.get("deduction_duration")),
                    deduction_date=safe_date(row.get("deduction_date")),
                    campaign_id=safe_str(row.get("campaign_id")),
                    ad_cost=safe_decimal(row.get("ad_cost")),
                    credits_waivers_discounts=safe_decimal(row.get("credits_waivers_discounts")),
                    ad_cost_incl_credits_waivers=safe_decimal(row.get("ad_cost_incl_credits_waivers")),
                    gst=safe_decimal(row.get("gst")),
                    total_ads_cost=safe_decimal(row.get("total_ads_cost")),
                )
                created += 1
        results["ads_cost"] = {"created": created}

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


def set_increment_fields(object, key, value = None):
    if not object.get(key):
        object[key] = 0
    
    if value:
        object[key] += value 
    else:
        object[key] += 1    

def set_normal_fields(object, key, value):
    object[key] = value  
    

def set_profit(sku_id, object, order, price_map):
    packaging_map = {
        fp.sku_id: fp.packaging_cost or Decimal("0")
        for fp in FinalPrice.objects.all()
    }
    
    if not object.get(sku_id):
        object[sku_id] = {"loss": 0, "profit": 0, "order_count": 0, "final_price": price_map[sku_id], 
                          "purchase_cost": 0, "total_purchase_cost":0,"p_cost":0,
                          "settled_amount":0}
    
    is_profit = order.final_settlement_amount > 0
    
    sku = object[sku_id]
    
    if is_profit :
        profit =  order.final_settlement_amount - ( price_map[sku_id] * order.quantity )
        set_increment_fields(sku, "profit", profit)
        set_increment_fields(sku, "purchase_cost", price_map[sku_id])
        set_increment_fields(sku, "p_cost", packaging_map[sku_id])
    else:
        set_increment_fields(sku, "loss", order.final_settlement_amount)
        
    set_increment_fields(sku, "total_purchase_cost", price_map[sku_id])
    set_increment_fields(sku, "total_packaging_cost", packaging_map[sku_id])
    set_increment_fields(sku, "settled_amount", order.final_settlement_amount)   
    set_increment_fields(sku, order.live_order_status)
    set_increment_fields(sku, order.recovery_reason)
    set_increment_fields(sku, "order_count")     

@api_view(["GET"])
def profit_summary(request):
    """
    Calculate overall Meesho profit:
      Revenue    = SUM(final_settlement_amount) from OrderPayments
      Ads Cost   = SUM(total_ads_cost) from AdsCost
      Referral   = SUM(net_referral_amount) from ReferralPayments
      Comp/Rec   = SUM(amount_incl_gst) from CompensationRecovery
      Net Profit = Revenue + Ads Cost + Referral + Comp/Rec
                   (negative values in Meesho sheets already represent costs)
    """
    revenue = OrderPayment.objects.aggregate(
        total=Sum("final_settlement_amount")
    )["total"] or Decimal("0")
    
    price_map = {
        fp.sku_id: fp.final_price or Decimal("0")
        for fp in FinalPrice.objects.all()
    }
  
    order_wise_profit = {}
    missing_sku = []
    total_purchase_cost = 0
    for order in OrderPayment.objects.only("quantity", "sub_order_no", "final_settlement_amount", "supplier_sku", "live_order_status", "recovery_reason"):
        sku = order.supplier_sku
        if sku and sku in price_map:
            set_profit(sku, order_wise_profit, order, price_map)
        else:
            missing_sku.append(sku) 
    missing_sku = list(set(missing_sku))       
    total_profit = sum(item['profit'] for item in order_wise_profit.values())
    total_loss = sum(item['loss'] for item in order_wise_profit.values())
    total_purchase_cost = sum(item['purchase_cost'] for item in order_wise_profit.values())
    total_packaging_cost = sum(item['p_cost'] for item in order_wise_profit.values())    
    # total_orders = 0
    # for d in order_wise_profit:
    #     print(d.items())
        
        


    ads = AdsCost.objects.aggregate(
        total=Sum("total_ads_cost")
    )["total"] or Decimal("0")

    referral = ReferralPayment.objects.aggregate(
        total=Sum("net_referral_amount")
    )["total"] or Decimal("0")

    comp_recovery = CompensationRecovery.objects.aggregate(
        total=Sum("amount_incl_gst")
    )["total"] or Decimal("0")

    gross_revenue = OrderPayment.objects.aggregate(
        total=Sum("total_sale_amount")
    )["total"] or Decimal("0")

    total_commission = OrderPayment.objects.aggregate(
        total=Sum("meesho_commission_incl_gst")
    )["total"] or Decimal("0")

    total_tcs = OrderPayment.objects.aggregate(total=Sum("tcs"))["total"] or Decimal("0")
    total_tds = OrderPayment.objects.aggregate(total=Sum("tds"))["total"] or Decimal("0")
    total_shipping = OrderPayment.objects.aggregate(
        total=Sum("shipping_charge_incl_gst")
    )["total"] or Decimal("0")

    net_profit = revenue + ads + referral + comp_recovery

    _, orders_with_price, orders_missing_price, orders_missing_sku = _compute_purchase_cost()
    # total_profit = revenue - total_purchase_cost
    
    net_revenue = total_profit + total_loss + ads

    return Response({
        "gross_revenue": round(gross_revenue, 2),
        "net_settlement_revenue": round(revenue, 2),
        "total_purchase_cost": round(total_purchase_cost, 2),
        "total_profit": round(total_profit, 2),
        "total_loss": round(total_loss, 2),
        "net_revenue": round(net_revenue, 2),
        "sku_wise_profit": order_wise_profit,
        "orders_with_price": orders_with_price,
        "orders_missing_price": orders_missing_price,
        "orders_missing_sku": orders_missing_sku,
        "missing_sku": missing_sku,
        "total_packaging_cost":total_packaging_cost,
        
        # "final_price_sku_count": FinalPrice.objects.count(),
        "total_ads_cost": round(ads, 2),
        "total_referral_income": round(referral, 2),
        "total_compensation_recovery": round(comp_recovery, 2),
        "total_commission_paid": round(total_commission, 2),
        "total_tcs": round(total_tcs, 2),
        "total_tds": round(total_tds, 2),
        "total_shipping_cost": round(total_shipping, 2),
        # "net_profit": round(net_profit, 2),
        "order_count": OrderPayment.objects.count(),
        "ads_campaigns": AdsCost.objects.count(),
        "referral_count": ReferralPayment.objects.count(),
        "compensation_recovery_count": CompensationRecovery.objects.count(),
    })


@api_view(["GET"])
def order_payments_list(request):
    page = int(request.GET.get("page", 1))
    page_size = int(request.GET.get("page_size", 50))
    status_filter = request.GET.get("status", "")
    qs = OrderPayment.objects.all()
    if status_filter:
        qs = qs.filter(live_order_status__iexact=status_filter)
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
            for col in ("item_price", "tax_percent", "packaging_cost", "final_price"):
                if col in df.columns:
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
