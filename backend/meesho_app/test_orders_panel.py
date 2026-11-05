"""
The Orders Panel: every order the sync pulled, by state and by dispatch day —
an order placed before the cutoff ships that day, after it the next day.
"""

import datetime as dt
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.access import set_user_rule
from accounts.models import Business, Membership, User

from . import orders_panel
from .models import MeeshoAccount, MeeshoSyncSnapshot


def local(y, m, d, h, mi=0):
    return timezone.make_aware(dt.datetime(y, m, d, h, mi))


class OrdersPanelTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="o", password="pw", role=User.ROLE_SUPER_ADMIN)
        self.a = Business.objects.create(name="Rudam")
        self.b = Business.objects.create(name="Cosmify Mart")
        for biz in (self.a, self.b):
            Membership.objects.create(user=self.user, business=biz)
        self.acc = {biz.pk: MeeshoAccount.objects.create(business=biz, phone_number=f"90000000{biz.pk:02d}", password_enc="x",
                                                         status="ACTIVE", supplier_id=str(biz.pk), supplier_identifier="x")
                    for biz in (self.a, self.b)}
        self.c = APIClient()
        self.c.force_authenticate(self.user)
        # Rudam: two to accept (one before the 1 pm cutoff, one after), a label to download,
        # one downloaded, one shipped yesterday; one order seen both pending and ready (not counted twice).
        self.snap(self.a, "pending", [self.row("P1", "2026-11-05T09:00:00+0530", "2026-11-05"),
                                      self.row("P2", "2026-11-05T14:30:00+0530", "2026-11-06"),
                                      self.row("X1", "2026-11-05T10:00:00+0530", "2026-11-05")])
        self.snap(self.a, "ready_to_ship", [self.row("R1", "2026-11-04T20:00:00+0530", "2026-11-04", label="Not Downloaded"),
                                            self.row("R2", "2026-11-05T08:00:00+0530", "2026-11-05", label="Downloaded", qty=3),
                                            self.row("X1", "2026-11-05T10:00:00+0530", "2026-11-05", label="Downloaded")])
        self.snap(self.a, "shipped", [self.row("S1", "2026-11-04T09:00:00+0530", "2026-11-04")])
        # Cosmify: one cancelled today, one to accept.
        self.snap(self.b, "cancelled", [self.row("C1", "2026-11-05T11:00:00+0530", "2026-11-05")])
        self.snap(self.b, "pending", [self.row("P3", "2026-11-05T12:59:00+0530", "2026-11-05")])

    def row(self, sub, created, due, label=False, qty=1):
        return {"sub_order_num": sub, "created_iso": created, "dispatch_by": due, "label": label, "quantity": qty,
                "sku": f"sku-{sub}", "sla_status": "breaching_soon"}

    def snap(self, biz, tab, rows):
        MeeshoSyncSnapshot.objects.create(account=self.acc[biz.pk], endpoint=f"orders_{tab}", http_status=200,
                                          fetched_at=timezone.now(), payload=rows)

    def get(self, now, user_client=None):
        with mock.patch.object(orders_panel, "_now", return_value=now):
            res = (user_client or self.c).get(f"/api/business/{self.a.id}/meesho-orders/panel/")
        return res

    def test_counts_by_state_across_businesses(self):
        d = self.get(local(2026, 11, 5, 15)).data
        t = d["totals"]
        self.assertEqual((t["to_accept"], t["to_download"], t["downloaded"], t["open"]), (3, 1, 2, 6))
        self.assertEqual(t["quantity_open"], 8)                                     # R2 is 3 pieces
        self.assertEqual(sorted(r["sub_order_num"] for r in d["orders"]).count("X1"), 1)
        x1 = next(r for r in d["orders"] if r["sub_order_num"] == "X1")
        self.assertEqual(x1["status"], "downloaded")                                  # furthest along wins
        self.assertEqual({b["business"]: b["to_accept"] for b in d["by_business"]}, {"Rudam": 2, "Cosmify Mart": 1})

    def test_the_cutoff_decides_the_day(self):
        d = self.get(local(2026, 11, 5, 15)).data                                    # past 1 pm
        self.assertEqual((d["today"], d["incoming_day"], d["cutoff_hour"]), ("2026-11-05", "2026-11-06", 13))
        days = {x["date"]: x for x in d["days"]}
        # Ships 5 Nov: 4 Nov 1 pm → 5 Nov 1 pm (R1, R2, X1, P1, P3 at 12:59, C1).
        self.assertEqual(days["2026-11-05"]["total"], 6)
        self.assertEqual(days["2026-11-05"]["cancelled"], 1)
        # Ships 6 Nov: P2, placed at 2:30 pm.
        self.assertEqual((days["2026-11-06"]["total"], days["2026-11-06"]["to_accept"]), (1, 1))
        self.assertEqual(days["2026-11-04"]["shipped"], 1)
        self.assertEqual(d["totals"]["cancelled"], 1)
        p2 = next(r for r in d["orders"] if r["sub_order_num"] == "P2")
        self.assertEqual(p2["ship_day"], "2026-11-06")

    def test_before_the_cutoff_today_is_still_filling(self):
        d = self.get(local(2026, 11, 5, 10)).data
        self.assertEqual(d["incoming_day"], "2026-11-05")
        self.assertEqual(d["days"][0]["date"], "2026-11-05")                        # newest first, nothing for tomorrow yet
        self.assertEqual(d["due"], {"overdue": 1, "today": 4, "tomorrow": 1, "later": 0, "unknown": 0})

    def test_its_own_permission(self):
        clerk = User.objects.create_user(username="c", password="pw", role=User.ROLE_BUSINESS_USER)
        Membership.objects.create(user=clerk, business=self.a)
        c = APIClient()
        c.force_authenticate(clerk)
        set_user_rule(clerk, ["/order-scan"])
        self.assertEqual(self.get(local(2026, 11, 5, 15), c).status_code, 403)
        set_user_rule(clerk, ["/orders-panel"])
        res = self.get(local(2026, 11, 5, 15), c)
        self.assertEqual(res.status_code, 200)
        self.assertEqual([b["name"] for b in res.data["businesses"]], ["Rudam"])  # only what they're assigned to
