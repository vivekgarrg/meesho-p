"""
Acting on Flipkart Seller Hub orders, as its Forward Orders page does — the
requests copied from the page (flipkart-api.py, never committed):

  accept     To accept → AcceptOrders (Seller Hub's "pack" call:
             sfs_revampedOrderShipmentsPackV4) — whole SKU groups at once, each
             with its package dimensions as Seller Hub already holds them.
  mark RTD   To pack, labels printed → MarkRTD (sfs_revampedOrderShipmentsGroupRTD).

Both act on the groups GetShipmentGroups lists for one dispatch-by date (the
counts' breakdown gives the dates), read fresh just before — never on what the
page last showed — and only on the groups asked for (all, when none are named).
Printing the labels in between is done in Seller Hub until its request is added.
After acting, the orders are read again so the page shows where they are now.
"""

import json
from datetime import datetime
from zoneinfo import ZoneInfo

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import flipkart_seller as fs

IST = ZoneInfo("Asia/Kolkata")
GROUP_PAGE, GROUP_PAGES = 100, 10
STAGES = {"accept": "pendingToAccept", "label": "pendingLabel", "rtd": "pendingRTD"}

GROUPS_QUERY = "query GetShipmentGroups($input: ShipmentGroupFilterRequestInput!) {\n  filteredShipmentGroups(input: $input) {\n    shipmentGroups {\n      groupId\n      subGroupIndex\n      logisticsPartnerCounts {\n        partner\n        count\n      }\n      groupDetails {\n        shipmentGroupSpecs {\n          listing {\n            listingId\n            status\n            product {\n              productId\n              title\n              fsn\n              sku\n              primaryImageUrl\n              productUrl\n            }\n          }\n          quantity\n        }\n        packages {\n          packageId\n          dimensions {\n            length\n            breadth\n            height\n            weight\n          }\n        }\n      }\n      sellerInputAttributes {\n        shippingId\n        orderId\n        pharmaOtcGroupDetails {\n          mandatoryFields\n          otcComplianceItems {\n            orderItemId\n            quantity\n            otcComplianceValues {\n              manufacturerName\n              batchNumber\n              quantity\n              expiryDate\n            }\n          }\n        }\n        imeiGroupDetails {\n          orderItemId\n          quantity\n          imeiCountPerQuantity\n          imei\n        }\n        tagloopGroupDetails {\n          orderItemId\n          quantity\n          tagIds\n        }\n      }\n      shipmentCount\n      subShipmentCount\n      priceRange {\n        minPrice\n        maxPrice\n      }\n      missingDimensions\n      isMps\n      packagingPolicy\n      channelOfSale\n    }\n    pageInfo {\n      hasMore\n      total\n    }\n    timestamp\n  }\n}"
BREAKDOWN_QUERY = "query GetStateCountBreakdown($input: FetchShipmentCountRequestInput!) {\n  shipmentStatesCountAndBreakdown(input: $input) {\n    shipmentStatesCountMetrics {\n      shipmentCountBreakdown {\n        logisticsShipmentCountDetails {\n          logisticsShipmentDetails {\n            vendorGroupCode\n            shipmentCount\n            isLarge\n            isMps\n            scheduledPickupAfter\n            scheduledPickupBy\n            pickupReattempts\n            primaryImageUrl\n            pickupDetails {\n              startTime\n              endTime\n              date\n            }\n          }\n          printStatusShipmentCountDetails {\n            isLabelPrinted\n            shipmentCount\n            breachedDbdShipmentCount\n            dbdShipmentCountDetails {\n              dispatchByDate\n              shipmentCount\n            }\n          }\n        }\n      }\n      timestamp\n    }\n  }\n}"
ACCEPT_MUTATION = "mutation AcceptOrders($view_name: String, $timestamp: String, $filters: IRevampedOrderGroupFilters, $groups: [IPackV4GroupShipments!], $shipments: [IPackV4Shipment!], $location_id: String!) {\n  sfs_revampedOrderShipmentsPackV4(\n    view_name: $view_name\n    timestamp: $timestamp\n    filters: $filters\n    groups: $groups\n    shipments: $shipments\n    location_id: $location_id\n  ) {\n    view_name\n    groups_response\n    shipment_response {\n      external_shipment_id\n      error_message\n      status\n      __typename\n    }\n    error_message\n    __typename\n  }\n}"
RTD_MUTATION = "mutation MarkRTD($view_name: String, $timestamp: String, $override_label_print: Boolean, $filters: IRevampedOrderGroupFilters, $groups: [IGroupRTDGroupShipments!], $shipments: [IGroupRTDShipments!], $location_id: String!) {\n  sfs_revampedOrderShipmentsGroupRTD(\n    view_name: $view_name\n    timestamp: $timestamp\n    override_label_print: $override_label_print\n    filters: $filters\n    groups: $groups\n    shipments: $shipments\n    location_id: $location_id\n  ) {\n    view_name\n    groups_response\n    shipment_response {\n      id\n      error_message\n      status\n      __typename\n    }\n    error_message\n    __typename\n  }\n}"

_PARAM_NULLS = ("shipment_id", "status", "service_profile", "on_hold", "dispatch_after_date", "sku", "fsn", "order_id",
                "order_item_id", "tracking_id", "is_breached", "order_date", "approval_date", "dispatch_by_date",
                "delivered_date", "service_by_date", "dispatch_service_tiers", "upcoming", "single", "multi",
                "multiple_quantity", "replacement", "multiple_product", "multiple_packages", "forms_required",
                "is_transparent_packaging", "vendor_group_codes", "is_large", "is_mps", "reattempts",
                "must_dispatch_today", "rtd_date", "channel_of_sale", "logistics_partners")


def _now():
    return datetime.now(IST).isoformat(timespec="milliseconds")


def _need_location(account):
    if not account.location_id:
        raise fs.FlipkartError("The pickup location (LOC…) isn't known yet — Read now once (it's taken from the orders), "
                               "or set it under More on the business's card.")


def dispatch_dates(account, s, stage):
    """[(dispatch-by date as Seller Hub writes it, shipments)] waiting at this stage."""
    d = fs.orchestrator(account, "GetStateCountBreakdown", {"input": {
        "status": STAGES[stage],
        "params": {"location_id": account.location_id, "status": {"picked_up": "false", "dispatched": "false", "shipped": "false"},
                   "on_hold": False},
        "shipmentCountBreakdownLevelParams": {"dispatchByDateLevel": True}}}, BREAKDOWN_QUERY, s=s)
    out = {}
    details = (((d.get("shipmentStatesCountAndBreakdown") or {}).get("shipmentStatesCountMetrics") or {})
               .get("shipmentCountBreakdown") or {}).get("logisticsShipmentCountDetails") or []
    for lg in details:
        for p in lg.get("printStatusShipmentCountDetails") or []:
            for x in p.get("dbdShipmentCountDetails") or []:
                if x.get("dispatchByDate"):
                    out[x["dispatchByDate"]] = out.get(x["dispatchByDate"], 0) + (x.get("shipmentCount") or 0)
    return sorted(out.items())


def groups(account, s, stage, dbd):
    """The SKU groups waiting at this stage for this dispatch-by date, as GetShipmentGroups lists them."""
    out = []
    for page in range(1, GROUP_PAGES + 1):
        d = fs.orchestrator(account, "GetShipmentGroups", {"input": {
            "status": STAGES[stage], "viewType": {"groupedByFsn": True},
            "shipmentParams": {"seller_id": account.seller_id, "location_id": account.location_id, "dbd": dbd,
                               **{k: None for k in _PARAM_NULLS}},
            "timestamp": _now(),
            "sortInputs": [{"field": "shipment_count", "order": "desc"}, {"field": "units_count", "order": "asc"},
                           {"field": "skus_count", "order": "asc"}],
            "paginationInput": {"pageNum": page, "pageSize": GROUP_PAGE}}}, GROUPS_QUERY, s=s)
        f = d.get("filteredShipmentGroups") or {}
        out += [g for g in f.get("shipmentGroups") or [] if g.get("groupId")]
        if not (f.get("pageInfo") or {}).get("hasMore"):
            break
    return out


def summary(g, dbd):
    """One group as the page shows it."""
    specs = (g.get("groupDetails") or {}).get("shipmentGroupSpecs") or []
    return {"group_id": g["groupId"], "sub_group_index": g.get("subGroupIndex") or 0, "dispatch_by": dbd,
            "shipments": g.get("shipmentCount") or 0, "missing_dimensions": bool(g.get("missingDimensions")),
            "price": (g.get("priceRange") or {}).get("maxPrice"),
            "orders": [x.get("orderId") for x in g.get("sellerInputAttributes") or [] if x.get("orderId")],
            "items": [{"sku": ((x.get("listing") or {}).get("product") or {}).get("sku") or "",
                       "title": ((x.get("listing") or {}).get("product") or {}).get("title") or "",
                       "image": ((x.get("listing") or {}).get("product") or {}).get("primaryImageUrl") or "",
                       "qty": x.get("quantity") or 1} for x in specs]}


def accept_group(g, dbd):
    """AcceptOrders' group, as the page sends it: Seller Hub's own package dimensions, its price range, its date."""
    packages = (g.get("groupDetails") or {}).get("packages") or []
    price = g.get("priceRange") or {}
    return {"group_id": g["groupId"], "sub_group_index": g.get("subGroupIndex") or 0, "size": g.get("shipmentCount") or 0,
            "dimensions": [{**{k: (p.get("dimensions") or {}).get(k) for k in ("length", "breadth", "height", "weight")},
                            "external_sub_shipment_id": p.get("packageId"), "volumetric_weight": 1} for p in packages],
            "max_price": price.get("maxPrice"), "min_price": price.get("minPrice"),
            "channel_of_sale": g.get("channelOfSale") or "FLIPKART", "packaging_policy": g.get("packagingPolicy") or "DEFAULT",
            "dispatch_by_date": dbd}


def rtd_group(g, dbd):
    return {"group_id": g["groupId"], "sub_group_index": g.get("subGroupIndex") or 0, "dispatch_by_date": dbd,
            "channel_of_sale": g.get("channelOfSale") or "FLIPKART", "packaging_policy": g.get("packagingPolicy") or "DEFAULT",
            "size": g.get("shipmentCount") or 0}


def waiting(account, s=None):
    """{stage: [group summary]} — what can be accepted, needs labels, can be marked RTD — read now."""
    _need_location(account)
    s = s or fs._load(account, fs._http())
    out = {}
    for stage in STAGES:
        out[stage] = [summary(g, dbd) for dbd, _n in dispatch_dates(account, s, stage) for g in groups(account, s, stage, dbd)]
    return out


def _outcome(body, key):
    """What Flipkart said of each shipment: {"done": n, "failed": [{"id", "error"}], "error": top-level message}."""
    r = (body or {}).get(key) or {}
    done, failed = 0, []
    for x in r.get("shipment_response") or []:
        st = str(x.get("status") or "").upper()
        if x.get("error_message") or st in ("FAILED", "FAILURE", "ERROR", "REJECTED"):
            failed.append({"id": x.get("external_shipment_id") or x.get("id"), "error": x.get("error_message") or st})
        else:
            done += 1
    return {"done": done, "failed": failed, "error": r.get("error_message") or "", "groups_response": r.get("groups_response")}


def act(account, stage, wanted=None, dispatch_by=None, s=None):
    """Accept (stage "accept") or mark RTD (stage "rtd") the groups waiting now — those in `wanted` (group ids),
    or all; one dispatch-by date (`dispatch_by`) or every one. Returns what Flipkart said, per date."""
    if stage not in ("accept", "rtd"):
        raise ValueError(stage)
    _need_location(account)
    s = s or fs._load(account, fs._http())
    wanted = set(wanted or [])
    results, skipped = [], []
    for dbd, _n in dispatch_dates(account, s, stage):
        if dispatch_by and dbd != dispatch_by:
            continue
        chosen = [g for g in groups(account, s, stage, dbd) if not wanted or g["groupId"] in wanted]
        if stage == "accept":
            # Without its package's size and weight Seller Hub can't pack it: left for Seller Hub, said so.
            skipped += [summary(g, dbd) for g in chosen if g.get("missingDimensions")]
            chosen = [g for g in chosen if not g.get("missingDimensions")]
        if not chosen:
            continue
        common = {"view_name": "group_shipment", "timestamp": _now(), "filters": {}, "shipments": [],
                  "location_id": account.location_id}
        if stage == "accept":
            body = fs.graphql(account, "AcceptOrders", {**common, "groups": [accept_group(g, dbd) for g in chosen]}, ACCEPT_MUTATION, s=s,
                              extra_headers={"operation": "mutation", "x-client-id": "SD", "x-requested-with": "XMLHttpRequest"})
            out = _outcome(body, "sfs_revampedOrderShipmentsPackV4")
        else:
            body = fs.graphql(account, "MarkRTD", {**common, "override_label_print": False,
                                                   "groups": [rtd_group(g, dbd) for g in chosen]}, RTD_MUTATION, s=s,
                              extra_headers={"operation": "mutation", "x-client-id": "SD", "x-requested-with": "XMLHttpRequest"})
            out = _outcome(body, "sfs_revampedOrderShipmentsGroupRTD")
        results.append({"dispatch_by": dbd, "groups": len(chosen), "shipments": sum(g.get("shipmentCount") or 0 for g in chosen), **out})
    return {"stage": stage, "results": results, "skipped": skipped,
            "shipments": sum(r["shipments"] for r in results), "failed": sum(len(r["failed"]) for r in results),
            "errors": [r["error"] for r in results if r["error"]]}


# ── API ──────────────────────────────────────────────────────────────────────

def _account(request, business_id):
    biz, err = fs._target(request, business_id)
    if err:
        return None, None, err
    a = fs.A.objects.filter(business=biz, status=fs.A.STATUS_ACTIVE).first()
    if not a:
        return biz, None, Response({"error": f"Flipkart isn't connected for {biz.name}."}, status=status.HTTP_404_NOT_FOUND)
    if not a.location_id:                  # not known yet: the orders name it (see flipkart_seller.refresh)
        try:
            fs.refresh(a, sync=False)
        except fs.FlipkartError:
            pass
        a.refresh_from_db()
    return biz, a, None


def _expired(a, e):
    if e.expired:
        a.status, a.status_message = fs.A.STATUS_EXPIRED, str(e)
        a.save(update_fields=["status", "status_message", "updated_at"])


@api_view(["GET"])
def waiting_view(request, business_id):
    """GET flipkart-seller/actions/?business= — the groups to accept, to print labels for, to mark RTD, read now."""
    biz, a, err = _account(request, business_id)
    if err:
        return err
    try:
        return Response({"business": biz.pk, **waiting(a)})
    except fs.FlipkartError as e:
        _expired(a, e)
        return Response({"error": str(e)}, status=status.HTTP_409_CONFLICT)


def _act_view(request, business_id, stage):
    biz, a, err = _account(request, business_id)
    if err:
        return err
    data = request.data if isinstance(request.data, dict) else {}
    try:
        out = act(a, stage, wanted=data.get("groups") or None, dispatch_by=data.get("dispatch_by") or None)
    except fs.FlipkartError as e:
        _expired(a, e)
        return Response({"error": str(e)}, status=status.HTTP_409_CONFLICT)
    try:                                   # the orders as they are now, for the page (no payments sync: it's quick)
        fs.refresh(fs.A.objects.get(pk=a.pk), sync=False)
    except fs.FlipkartError:
        pass
    return Response({**out, **fs._state(request, business_id)},
                    status=status.HTTP_200_OK if not out["errors"] and not out["failed"] else status.HTTP_207_MULTI_STATUS)


@api_view(["POST"])
def accept_view(request, business_id):
    """POST flipkart-seller/accept/ {business, groups?: [group_id], dispatch_by?} — accept them in Seller Hub."""
    return _act_view(request, business_id, "accept")


@api_view(["POST"])
def rtd_view(request, business_id):
    """POST flipkart-seller/rtd/ {business, groups?: [group_id], dispatch_by?} — mark them ready to dispatch."""
    return _act_view(request, business_id, "rtd")
