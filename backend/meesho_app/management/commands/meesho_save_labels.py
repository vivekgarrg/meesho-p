"""
The last step of an automatic labels run (sync worker: MeeshoAutoLabelsJob).

Takes every business's labels Meesho made in one run (MeeshoSyncRun LABELS
with result.batch == --batch), merges them into one PDF sorted by parent SKU —
exactly as Meesho Orders' "Download merged labels" does, saving them to the
labels table too, so Order Scan has them — and keeps the PDF (MeeshoLabelFile)
for Meesho Orders' "Latest labels": Print / Download, after Meesho's own link
has expired. With --send it also goes to Telegram and/or email
(meesho_app.notify) — off for now.

Prints one line of JSON: labels, pages, the kept file's id.
"""

import base64
import json
from types import SimpleNamespace

from django.core.management.base import BaseCommand
from django.utils import timezone

from accounts.models import User
from meesho_app import meesho_sync, notify, views
from meesho_app.models import MeeshoLabelFile, MeeshoSyncRun


class Command(BaseCommand):
    help = "Merge, sort and keep one automatic run's Meesho labels (optionally send them)."

    def add_arguments(self, parser):
        parser.add_argument("--batch", required=True)
        parser.add_argument("--summary", default="")
        parser.add_argument("--send", action="store_true", help="Also send the PDF to Telegram/email.")

    def handle(self, *args, batch, summary, send, **opts):
        when = timezone.localtime().strftime("%-I:%M %p, %-d %b")
        runs = [r for r in MeeshoSyncRun.objects.filter(kind=meesho_sync.KIND_LABELS, result__batch=batch)
                .select_related("account__business").order_by("queued_at") if (r.result or {}).get("label_url")]
        out = {"batch": batch, "labels": sum(int((r.result or {}).get("success") or r.records or 0) for r in runs)}
        if not runs:
            if send:
                out["sent"] = notify.send(f"Meesho labels — {when}", f"No new labels this time.\n\n{summary}".strip())
            self.stdout.write(json.dumps(out))
            return

        try:
            merged = meesho_sync._merge_pdfs([meesho_sync._fetch_label_pdf(r.result["label_url"]) for r in runs])
        except Exception as exc:                   # noqa: BLE001 — reported, the labels stay on Meesho Orders
            out["error"] = f"downloading the labels from Meesho failed: {exc}"
            if send:
                out["sent"] = notify.send(f"Meesho labels — {when}", f"Meesho made the labels, but {out['error']}.\n\n{summary}".strip())
            self.stdout.write(json.dumps(out, default=str))
            return

        # Sorted by parent SKU and saved to the labels table, as the Labels tab
        # does — run as an admin, since the sort decides which business owns
        # each SKU across every business.
        pdf, pages, note = None, 0, ""
        admin = User.objects.filter(role=User.ROLE_SUPER_ADMIN, is_active=True).order_by("pk").first()
        if admin:
            try:
                res = views._process_labels_upload(SimpleNamespace(user=admin), runs[0].account.business, merged,
                                                   views._current_business_date().isoformat(),
                                                   crop_labels=False, platform="meesho")
                if res.status_code == 200 and res.data.get("cropped_pdf_b64"):
                    pdf = base64.b64decode(res.data["cropped_pdf_b64"])
                    pages = res.data.get("total_pages") or 0
                    out["saved"] = res.data.get("db_saved")
            except Exception as exc:               # noqa: BLE001
                note = f"Not sorted — {exc}."
        if pdf is None:
            pdf, note = merged, note or "Not sorted by parent SKU this time."

        f = meesho_sync._save_label_file(batch, MeeshoLabelFile.TRIGGER_AUTO, runs, pdf, sorted_ok=not note,
                                         pages=pages, summary="\n".join(x for x in (note, summary) if x))
        out.update(file_id=f.pk, pages=pages, sorted=not note)
        if send:
            caption = (f"{out['labels']} label{'' if out['labels'] == 1 else 's'} from {', '.join(f.business_names)}"
                       f"{', sorted by parent SKU' if not note else ''}. {note}\n\n{summary}").strip()
            out["sent"] = notify.send(f"Meesho labels — {when}", caption,
                                      filename=f"meesho-labels-{timezone.localtime():%Y-%m-%d-%H%M}.pdf", data=pdf)
        self.stdout.write(json.dumps(out, default=str))
