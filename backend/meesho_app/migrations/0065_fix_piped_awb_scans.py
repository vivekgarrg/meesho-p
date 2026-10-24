"""
Repair order scans whose code came in as "AWB|routing code".

Some courier labels put the AWB and a routing code in one barcode, e.g.
"VL0085867529935|BO0VNP32". Before the scan desk split on "|", those were
saved verbatim, matched no order, and showed no data. This takes the part
before the "|", links each one to its order (label, Flipkart orders sheet,
payments or orders sheet — in its own business), marks it dispatched, and
merges it into the order's existing scan row if the parcel was also scanned
correctly.
"""

from django.db import migrations
from django.utils import timezone


def _first(code):
    return (code or "").strip().strip('"').strip("'").split("|", 1)[0].strip()


def fix(apps, schema_editor):
    ScannedOrder = apps.get_model("meesho_app", "ScannedOrder")
    LabelOrder = apps.get_model("meesho_app", "LabelOrder")
    FlipkartOrder = apps.get_model("meesho_app", "FlipkartOrder")
    OrderPayment = apps.get_model("meesho_app", "OrderPayment")
    Order = apps.get_model("meesho_app", "Order")
    from meesho_app.models import ScannedOrder as Live   # status constants + classify only

    now = timezone.now()
    rows = ScannedOrder.objects.filter(scanned_code__contains="|") | ScannedOrder.objects.filter(sub_order_no__contains="|")
    for row in rows.distinct():
        code = _first(row.scanned_code or row.sub_order_no)
        if not code:
            continue
        biz = row.business_id
        snap = {"scanned_code": code, "sub_order_no": code}
        raw_status = ""

        label = (LabelOrder.objects.filter(business_id=biz, awb_number__iexact=code).first()
                 or LabelOrder.objects.filter(business_id=biz, order_id__iexact=code).first())
        fo = None
        if not label:
            fo = (FlipkartOrder.objects.filter(business_id=biz, delivery_tracking_id__iexact=code).first()
                  or FlipkartOrder.objects.filter(business_id=biz, order_item_id__iexact=code).first())
        if label:
            snap.update(sub_order_no=label.order_id, awb_number=label.awb_number or code, matched_from="LABEL",
                        platform=label.platform or "meesho", sku=label.sku or "", size=label.size or "",
                        qty=label.qty or 1, courier_name=label.courier_name or "", payment_type=label.payment_type or "",
                        customer_name=label.customer_name or "", customer_city=label.customer_city or "",
                        customer_state=label.customer_state or "", customer_pincode=label.customer_pincode or "",
                        order_date=label.order_date)
        elif fo:
            snap.update(sub_order_no=fo.order_item_id, awb_number=fo.delivery_tracking_id or code, matched_from="FLIPKART",
                        platform="flipkart", sku=fo.sku or "", product_name=(fo.product_title or "")[:500],
                        qty=fo.quantity or 1, courier_name=fo.logistics_partner or "", order_date=fo.order_date)
            raw_status = fo.order_item_status or ""
        else:
            pay = OrderPayment.objects.filter(business_id=biz, sub_order_no__iexact=code).first()
            order = None if pay else Order.objects.filter(business_id=biz, sub_order_no__iexact=code).first()
            if pay:
                snap.update(sub_order_no=pay.sub_order_no, matched_from="PAYMENT", sku=pay.supplier_sku or "",
                            product_name=pay.product_name or "", qty=pay.quantity or 1)
            elif order:
                snap.update(sub_order_no=order.sub_order_no, matched_from="ORDER", sku=order.sku or "",
                            product_name=order.product_name or "", qty=order.quantity or 1,
                            customer_state=order.customer_state or "", order_date=order.order_date)
            else:
                snap.update(awb_number=code)   # still unknown — kept with the clean code so it links later

        # What the sheets say about it now.
        sub = snap["sub_order_no"]
        for st in Order.objects.filter(business_id=biz, sub_order_no=sub).values_list("reason_for_credit_entry", flat=True):
            raw_status = st or raw_status
        for st in OrderPayment.objects.filter(business_id=biz, sub_order_no=sub).exclude(live_order_status=None) \
                .values_list("live_order_status", flat=True):
            raw_status = st or raw_status
        ship = Live.classify_ship_status(raw_status)

        existing = ScannedOrder.objects.filter(business_id=biz, sub_order_no=sub).exclude(pk=row.pk).first()
        if existing:
            existing.scan_count = (existing.scan_count or 1) + (row.scan_count or 1)
            if row.last_scanned_at and (not existing.last_scanned_at or row.last_scanned_at > existing.last_scanned_at):
                existing.last_scanned_at = row.last_scanned_at
                existing.scan_day = row.scan_day or existing.scan_day
            if existing.status != Live.STATUS_DISPATCHED:
                existing.status = Live.STATUS_DISPATCHED
                existing.status_updated_at = now
            if ship != Live.SHIP_UNKNOWN:
                existing.ship_status, existing.ship_status_raw = ship, raw_status[:100]
            existing.save()
            row.delete()
            continue

        for k, v in snap.items():
            setattr(row, k, v)
        if row.status != Live.STATUS_DISPATCHED:
            row.status = Live.STATUS_DISPATCHED
            row.status_updated_at = now
        row.ship_status, row.ship_status_raw = ship, raw_status[:100]
        row.ship_source = "repaired scan"
        row.ship_checked_at = now
        row.save()


class Migration(migrations.Migration):
    dependencies = [
        ("meesho_app", "0064_scan_day"),
    ]

    operations = [
        migrations.RunPython(fix, migrations.RunPython.noop),
    ]
