"""Listing Lookup's Meesho search: a SKU with no parent looked up on Meesho in every business at once."""

import json
from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Business, Membership, User

from . import meesho_sync
from .meesho_search import products_of
from .models import MeeshoAccount

IMG = "https://images.meesho.com/images/products/1016893172/rpl4j.jpg"


def answer(*products, status_l1="active"):
    return {"count": 1, "catalogs": [{"id": 530194442, "name": "Alluring Puja Articles", "category": "Puja Articles",
                                      "catalog_image_urls": [IMG],
                                      "product_groups": [{"catalog_status_l1": status_l1, "products": list(products)}]}]}


def product(style, **kw):
    return {"id": 1016893172, "style_id": style, "sku_id": f"{style}Free Size", "variation": "Free Size",
            "name": "Brass Kalash", "image_url": IMG, "selling_price": 325, "inventory": 12, **kw}


class Res:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


class ParseTests(TestCase):
    def test_products_exact_matches_first_and_only_meesho_images(self):
        rows = products_of(answer(product("medium-lota-0045"), product("Medium-Lota-004", image_url="https://evil.example.com/x.jpg"),
                                  product("medium-lota-004", is_user_archived=True, archived_at="Aug 24, 2026")),
                           "medium-lota-004")
        self.assertEqual([(r["sku"], r["exact"]) for r in rows],
                         [("Medium-Lota-004", True), ("medium-lota-004", True), ("medium-lota-0045", False)])
        self.assertEqual(rows[0]["image_url"], IMG)                       # a bad link falls back to the catalog's photo
        self.assertEqual((rows[1]["status"], rows[1]["archived_at"]), ("Archived", "Aug 24, 2026"))
        self.assertEqual((rows[0]["status"], rows[0]["price"], rows[0]["stock"], rows[0]["catalog_id"]), ("Active", 325, 12, 530194442))
        self.assertEqual(products_of({"catalogs": []}, "x"), [])
        self.assertEqual(products_of(None, "x"), [])


class EndpointTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rudam = Business.objects.create(name="Rudam")
        self.cosmify = Business.objects.create(name="Cosmify")
        self.other = Business.objects.create(name="Not mine")
        self.user = User.objects.create_user(username="w", password="pw", role=User.ROLE_BUSINESS_USER)
        for b in (self.rudam, self.cosmify):
            Membership.objects.create(user=self.user, business=b)
        cookies = meesho_sync.encrypt(json.dumps({"connect.sid": "s"}))
        for i, b in enumerate((self.rudam, self.cosmify, self.other)):
            MeeshoAccount.objects.create(business=b, phone_number=f"900000000{i}", password_enc="x", status="ACTIVE",
                                         supplier_id=str(100 + i), supplier_identifier=f"id{i}", cookies_enc=cookies)
        self.c = APIClient()
        self.c.force_authenticate(self.user)

    def get(self, sku):
        return self.c.get(f"/api/business/{self.rudam.id}/order-scan/meesho-search/", {"sku": sku})

    def test_every_business_is_searched_and_the_ones_listing_it_come_first(self):
        def post(url, json=None, headers=None, timeout=None):
            self.assertTrue(url.endswith("/api/services/catalogManagement/fetchV2SearchResults"))
            self.assertEqual((json["query"], json["query_type"]), ("medium-lota-004", "product"))
            return {"id0": Res(463, {"message": "Unauthorized call. Token missing."}),
                    "id1": Res(200, answer(product("medium-lota-004"))),
                    "id2": Res(200, answer(product("medium-lota-004")))}[headers["identifier"]]
        with mock.patch("meesho_app.meesho_search.requests.post", side_effect=post) as sent:
            res = self.get("medium-lota-004")
        self.assertEqual(res.status_code, 200, res.data)
        got = [(r["business_name"], r["state"]) for r in res.data["results"]]
        self.assertEqual(got, [("Cosmify", "found"), ("Rudam", "no_session")])   # never a business this person can't see
        self.assertEqual(res.data["found_in"], ["Cosmify"])
        self.assertIn("expired", res.data["results"][1]["message"])
        self.assertEqual(sent.call_count, 2)
        with mock.patch("meesho_app.meesho_search.requests.post", return_value=Res(463, {})) as again:
            self.get("medium-lota-004")
        self.assertEqual(again.call_count, 1)                  # the found answer is kept a while; the expired one is asked again

    def test_similar_products_and_a_missing_sku(self):
        with mock.patch("meesho_app.meesho_search.requests.post", return_value=Res(200, answer(product("medium-lota-0045")))):
            res = self.get("medium-lota-004")
        self.assertEqual({r["state"] for r in res.data["results"]}, {"similar"})
        self.assertEqual(res.data["found_in"], [])
        self.assertEqual(self.get("").status_code, 400)
