"""
Payments middleware: the Meesho payment files the sync worker downloads (the
same file the Payments upload takes) → the payments tables.

  completed   → OrderPayment, AdsCost, ReferralPayment, CompensationRecovery,
                through the upload's own importer (views.import_payment_workbook):
                an order payment is keyed on (sub-order, payment date, status),
                so reading the same days again updates rows, never duplicates
                them; a row with no bank transfer and a payment date still to
                come isn't paid and is skipped.
  outstanding → MeeshoOutstandingPayment, replaced as a whole (one file a day,
                read together) — never OrderPayment: a row there means the
                money has landed.

Before writing, each Order Payments row is checked for what the table needs —
a sub-order number, and on a completed file a payment date and an amount —
and refused with the reason when it lacks them.
"""

import io
import json

import pandas as pd
from django.db import transaction
from django.utils import timezone

from ..models import MeeshoOutstandingPayment
from .base import Result, deferred_bumps, missing

DESCRIPTION_ROW = r"^[A-Z\s\(\)\+\-\*\/]+$"      # the sheet's formula row: "A", "B", "C + D"…


def open_workbook(path):
    """A downloaded payment file (.zip or .xlsx) as a pd.ExcelFile."""
    from .. import views
    with open(path, "rb") as fh:
        data = io.BytesIO(fh.read())          # read whole: the file is closed before pandas reads it
    source, _ = views._workbook_from_upload(data)
    return pd.ExcelFile(source)


def order_payment_rows(xl):
    """The Order Payments sheet's rows, named by column, without the header and formula rows."""
    from .. import views
    if "Order Payments" not in xl.sheet_names:
        return pd.DataFrame(columns=views.ORDER_PAYMENT_COLUMNS)
    df = pd.read_excel(xl, sheet_name="Order Payments", header=None, skiprows=2)
    df.columns = views.ORDER_PAYMENT_COLUMNS[:len(df.columns)]
    df = df[df["sub_order_no"].notna()]
    return df[~df["sub_order_no"].astype(str).str.match(DESCRIPTION_ROW)]


def _check(res, df, completed):
    """Count the rows a table can't take, with why."""
    from .. import views
    for _, r in df.iterrows():
        row = r.to_dict()
        lacking = missing(row, "sub_order_no")
        if completed:
            lacking += missing(row, "payment_date")
            if views.safe_decimal(row.get("final_settlement_amount")) is None:
                lacking.append("final_settlement_amount")
        if lacking:
            res.reject(f"missing {', '.join(lacking)}", {k: row.get(k) for k in ("sub_order_no", "payment_date", "final_settlement_amount")})


def import_completed(business, books):
    """Completed payment files → the payments tables. Returns a Result."""
    from .. import views
    res = Result()
    with deferred_bumps(business.pk):
        for xl in books:
            _check(res, order_payment_rows(xl), completed=True)
            for sheet, counts in views.import_payment_workbook(business, xl).items():
                into = res.counts.setdefault(sheet, {})
                for k, v in counts.items():
                    into[k] = into.get(k, 0) + v
    return res


def import_outstanding(business, books):
    """Outstanding payment files (one a day) → MeeshoOutstandingPayment, replacing it. Returns a Result."""
    from .. import views
    res = Result()
    rows, seen = [], set()
    now = timezone.now()
    for xl in books:
        df = order_payment_rows(xl)
        for _, r in df.iterrows():
            sub = views.safe_str(r["sub_order_no"])
            if missing({"sub_order_no": sub}, "sub_order_no"):
                res.reject("missing sub_order_no", r.to_dict())
                continue
            key = (sub, views.safe_date(r.get("payment_date")), views.safe_str(r.get("live_order_status")))
            if key in seen:                 # days overlapping: each payment once
                res.add("duplicates", 1)
                continue
            seen.add(key)
            details = {k: (None if pd.isna(v) else (v.isoformat() if hasattr(v, "isoformat") else v)) for k, v in r.items()}
            rows.append(MeeshoOutstandingPayment(
                business=business, sub_order_no=sub,
                order_date=views.safe_datetime(r.get("order_date")),
                dispatch_date=views.safe_date(r.get("dispatch_date")),
                product_name=views.safe_str(r.get("product_name")) or "",
                supplier_sku=views.safe_str(r.get("supplier_sku")) or "",
                catalog_id=views.safe_int(r.get("catalog_id")),
                live_order_status=views.safe_str(r.get("live_order_status")) or "",
                quantity=views.safe_int(r.get("quantity")),
                expected_payment_date=views.safe_date(r.get("payment_date")),
                final_settlement_amount=views.safe_decimal(r.get("final_settlement_amount")),
                total_sale_amount=views.safe_decimal(r.get("total_sale_amount")),
                details=json.loads(json.dumps(details, default=str)),
                imported_at=now,
            ))
    # Bulk writes send no model signals: invalidate the business explicitly.
    with deferred_bumps(business.pk), transaction.atomic():
        removed, _ = MeeshoOutstandingPayment.objects.filter(business=business).delete()
        MeeshoOutstandingPayment.objects.bulk_create(rows, batch_size=500)
    res.counts["outstanding"] = {"rows": len(rows), "replaced": removed, "files": len(books)}
    return res
