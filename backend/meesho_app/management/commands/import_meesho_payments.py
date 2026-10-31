"""
Import one Meesho payment file the sync worker downloaded (MeeshoPaymentsJob,
sync/app/jobs/meesho_payments_job.rb) — the same file the Payments upload takes.

  completed:   the panel's previous payments → OrderPayment, AdsCost,
               ReferralPayment, CompensationRecovery, via the upload's own
               importer (views.import_payment_workbook).
  outstanding: payments scheduled but not paid → MeeshoOutstandingPayment,
               replacing what was there. Never into OrderPayment: a row there
               means the money has landed.

Prints one line of JSON with the counts, which the worker keeps on its run.
"""

import json

import pandas as pd
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from accounts.models import Business
from meesho_app import views
from meesho_app.models import MeeshoOutstandingPayment


class Command(BaseCommand):
    help = "Import a Meesho payment file (.zip or .xlsx) downloaded by the sync worker."

    def add_arguments(self, parser):
        parser.add_argument("--business", type=int, required=True)
        parser.add_argument("--file", action="append", required=True,
                            help="Repeat for several files (outstanding: one per day, imported together).")
        parser.add_argument("--kind", choices=["completed", "outstanding"], required=True)

    def handle(self, *args, business, file, kind, **opts):
        biz = Business.objects.filter(pk=business).first()
        if not biz:
            raise CommandError(f"No business {business}.")
        paths = [file] if isinstance(file, str) else list(file)    # call_command passes one file as a string
        books = [_open(path) for path in paths]
        if kind == "completed":
            results = {}
            for xl in books:
                for sheet, counts in views.import_payment_workbook(biz, xl).items():
                    into = results.setdefault(sheet, {})
                    for k, v in counts.items():
                        into[k] = into.get(k, 0) + v
        else:
            results = {"outstanding": import_outstanding(biz, books)}
        self.stdout.write(json.dumps(results, default=str))


def _open(path):
    import io
    with open(path, "rb") as fh:
        data = io.BytesIO(fh.read())          # read whole: the file is closed before pandas reads it
    try:
        source, _ = views._workbook_from_upload(data)
        return pd.ExcelFile(source)
    except Exception as exc:
        raise CommandError(f"Could not read the payment file: {exc}")


def import_outstanding(business, books):
    """Replace the business's outstanding payments with these files' Order Payments rows (one per day)."""
    rows = []
    seen = set()
    for xl in books:
        rows += _outstanding_rows(business, xl, seen)
    with transaction.atomic():
        removed, _ = MeeshoOutstandingPayment.objects.filter(business=business).delete()
        MeeshoOutstandingPayment.objects.bulk_create(rows, batch_size=500)
    return {"rows": len(rows), "replaced": removed, "files": len(books)}


def _outstanding_rows(business, xl, seen):
    rows = []
    if "Order Payments" in xl.sheet_names:
        df = pd.read_excel(xl, sheet_name="Order Payments", header=None, skiprows=2)
        df.columns = views.ORDER_PAYMENT_COLUMNS[:len(df.columns)]
        df = df[df["sub_order_no"].notna()]
        df = df[~df["sub_order_no"].astype(str).str.match(r"^[A-Z\s\(\)\+\-\*\/]+$")]
        now = timezone.now()
        for _, r in df.iterrows():
            sub = views.safe_str(r["sub_order_no"])
            key = (sub, views.safe_date(r.get("payment_date")), views.safe_str(r.get("live_order_status")))
            if not sub or key in seen:           # days overlapping: each payment once
                continue
            seen.add(key)
            details = {k: (None if pd.isna(v) else (v.isoformat() if hasattr(v, "isoformat") else v))
                       for k, v in r.items()}
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
    return rows
