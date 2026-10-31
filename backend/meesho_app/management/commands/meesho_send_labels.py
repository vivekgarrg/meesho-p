"""
The last step of the 8 AM / 5 PM Meesho run (sync worker: MeeshoAutoLabelsJob).

Takes every business's labels Meesho made in one run (MeeshoSyncRun LABELS
with result.batch == --batch), merges them into one PDF sorted by parent SKU —
exactly as Meesho Orders' "Download merged labels" does, saving them to the
labels table too, so Order Scan has them — and sends the PDF, with what the run
did (--summary), to Telegram and/or email (meesho_app.notify).

Prints one line of JSON: labels, pages, and how each channel went.
"""

import base64
import json
from types import SimpleNamespace

from django.core.management.base import BaseCommand
from django.utils import timezone

from accounts.models import User
from meesho_app import meesho_sync, notify, views
from meesho_app.models import MeeshoSyncRun


class Command(BaseCommand):
    help = "Merge, sort and send one auto-run's Meesho labels."

    def add_arguments(self, parser):
        parser.add_argument("--batch", required=True)
        parser.add_argument("--summary", default="")

    def handle(self, *args, batch, summary, **opts):
        now = timezone.localtime()
        when = now.strftime("%-I:%M %p, %-d %b")
        runs = [r for r in MeeshoSyncRun.objects.filter(kind=meesho_sync.KIND_LABELS, result__batch=batch)
                .select_related("account__business").order_by("queued_at") if (r.result or {}).get("label_url")]
        out = {"batch": batch, "labels": sum(int((r.result or {}).get("success") or r.records or 0) for r in runs)}

        if not runs:
            out["sent"] = notify.send(f"Meesho labels — {when}", f"No new labels this time.\n\n{summary}".strip())
            self.stdout.write(json.dumps(out))
            return

        pdf = views_pdf = None
        note = ""
        try:
            views_pdf = meesho_sync._merge_pdfs([meesho_sync._fetch_label_pdf(r.result["label_url"]) for r in runs])
        except Exception as exc:                   # noqa: BLE001 — reported in the message
            out["sent"] = notify.send(f"Meesho labels — {when}",
                                      f"Meesho made the labels, but downloading them failed: {exc}\n"
                                      f"Download them from Meesho Orders → Ready to ship.\n\n{summary}".strip())
            self.stdout.write(json.dumps(out, default=str))
            return

        # Sorted by parent SKU and saved to the labels table, as the Labels tab
        # does — run as an admin, since the sort decides which business owns
        # each SKU across every business.
        admin = User.objects.filter(role=User.ROLE_SUPER_ADMIN, is_active=True).order_by("pk").first()
        if admin:
            try:
                res = views._process_labels_upload(SimpleNamespace(user=admin), runs[0].account.business, views_pdf,
                                                   views._current_business_date().isoformat(),
                                                   crop_labels=False, platform="meesho")
                if res.status_code == 200 and res.data.get("cropped_pdf_b64"):
                    pdf = base64.b64decode(res.data["cropped_pdf_b64"])
                    out["pages"] = res.data.get("total_pages")
                    out["saved"] = res.data.get("db_saved")
            except Exception as exc:               # noqa: BLE001
                note = f"(Not sorted — {exc}.)"
        if pdf is None:
            pdf = views_pdf
            note = note or "(Not sorted by parent SKU this time.)"

        businesses = sorted({r.account.business.name for r in runs})
        caption = (f"{out['labels']} label{'' if out['labels'] == 1 else 's'} from {', '.join(businesses)}, "
                   f"sorted by parent SKU. {note}\n\n{summary}").strip()
        out["sent"] = notify.send(f"Meesho labels — {when}", caption,
                                  filename=f"meesho-labels-{now:%Y-%m-%d-%H%M}.pdf", data=pdf)
        self.stdout.write(json.dumps(out, default=str))
