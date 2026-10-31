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
        parser.add_argument("--file", required=True)
        parser.add_argument("--kind", choices=["completed", "outstanding"], required=True)

    def handle(self, *args, business, file, kind, **opts):
        biz = Business.objects.filter(pk=business).first()
        if not biz:
            raise CommandError(f"No business {business}.")
        with open(file, "rb") as fh:
            try:
                source, _ = views._workbook_from_upload(fh)
                xl = pd.ExcelFile(source)
            except Exception as exc:
                raise CommandError(f"Could not read the payment file: {exc}")
            if kind == "completed":
                results = views.import_payment_workbook(biz, xl)
            else:
                results = {"outstanding": import_outstanding(biz, xl)}
        self.stdout.write(json.dumps(results, default=str))


def import_outstanding(business, xl):
    """Replace the business's outstanding payments with this file's Order Payments rows."""
    rows = []
    if "Order Payments" in xl.sheet_names:
        df = pd.read_excel(xl, sheet_name="Order Payments", header=None, skiprows=2)
        df.columns = views.ORDER_PAYMENT_COLUMNS[:len(df.columns)]
        df = df[df["sub_order_no"].notna()]
        df = df[~df["sub_order_no"].astype(str).str.match(r"^[A-Z\s\(\)\+\-\*\/]+$")]
        now = timezone.now()
        for _, r in df.iterrows():
            sub = views.safe_str(r["sub_order_no"])
            if not sub:
                continue
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
    with transaction.atomic():
        removed, _ = MeeshoOutstandingPayment.objects.filter(business=business).delete()
        MeeshoOutstandingPayment.objects.bulk_create(rows, batch_size=500)
    return {"rows": len(rows), "replaced": removed}
