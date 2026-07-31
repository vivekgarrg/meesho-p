from datetime import timedelta

from django.db import models
from django.utils import timezone

class ParentItemPrice(models.Model):
    # item_id is unique per business (not globally) so the same parent id can
    # exist in more than one business — see unique_together below.
    item_id = models.CharField(max_length=200, db_index=True)
    item_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    tax_percent = models.IntegerField(null=True, blank=True)
    packaging_cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    final_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "parent_item_price"
        ordering = ["item_id"]
        unique_together = [("business", "item_id")]
    def __str__(self):
        return self.item_id

class FinalPrice(models.Model):
    """Purchase price per SKU — used to compute profit vs settlement amount."""

    # sku_id is unique per business (not globally) so the same SKU can exist in
    # more than one business — see unique_together below.
    sku_id = models.CharField(max_length=200, db_index=True)
    item_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    tax_percent = models.IntegerField(null=True, blank=True)
    packaging_cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    parent = models.ForeignKey(ParentItemPrice, on_delete=models.SET_NULL, null=True,
                                    blank=True,
                                    related_name="sku_prices",
                                    db_column="parent_id",
                                )
    final_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "final_price"
        ordering = ["sku_id"]
        unique_together = [("business", "sku_id")]

    def __str__(self):
        return self.sku_id
        

class OrderPayment(models.Model):
    """
    Maps to 'Order Payments' sheet.
    One logical order can have multiple rows (main delivery row + blank-status
    affiliate-fee / claim-adjustment rows).
    Composite unique key: (business, sub_order_no, payment_date, live_order_status).
    """

    # Order Related Details
    sub_order_no = models.CharField(max_length=100, db_index=True)
    order_date = models.DateTimeField(null=True, blank=True)
    dispatch_date = models.DateField(null=True, blank=True)
    product_name = models.TextField(null=True, blank=True)
    supplier_sku = models.CharField(max_length=200, null=True, blank=True)
    catalog_id = models.BigIntegerField(null=True, blank=True)
    order_source = models.CharField(max_length=200, null=True, blank=True)
    live_order_status = models.CharField(max_length=100, null=True, blank=True)
    product_gst_percent = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    listing_price_incl_taxes = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    quantity = models.IntegerField(null=True, blank=True)

    # Payment Details
    transaction_id = models.CharField(max_length=100, null=True, blank=True)
    payment_date = models.DateField(null=True, blank=True)
    final_settlement_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    # Revenue Details
    price_type = models.CharField(max_length=100, null=True, blank=True)
    total_sale_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    total_sale_return_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    fixed_fee_revenue = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    warehousing_fee = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    return_premium = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    return_premium_of_return = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    # Deductions
    meesho_commission_percentage = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    meesho_commission_incl_gst = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    meesho_gold_platform_fee = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    meesho_mall_platform_fee = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    fixed_fee_deduction = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    warehousing_fee_deduction = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    return_shipping_charge = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    gst_compensation_prp_shipping = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    # Other Charges
    shipping_charge_incl_gst = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    other_support_service_charges = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    waivers = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    net_other_support_service_charges = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    gst_on_net_other_support_service_charges = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    # TCS & TDS
    tcs = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    tds_rate_percent = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    tds = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    # Recovery, Claims and Compensation
    compensation = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    claims = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    recovery = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    compensation_reason = models.TextField(null=True, blank=True)
    claims_reason = models.TextField(null=True, blank=True)
    recovery_reason = models.TextField(null=True, blank=True)

    uploaded_at = models.DateTimeField(auto_now_add=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "order_payments"
        ordering = ["-order_date"]
        unique_together = [("business", "sub_order_no", "payment_date", "live_order_status")]

    def __str__(self):
        return self.sub_order_no


class AdsCost(models.Model):
    """Maps to 'Ads Cost' sheet"""

    deduction_duration = models.DateField(null=True, blank=True)
    deduction_date = models.DateField(null=True, blank=True)
    campaign_id = models.CharField(max_length=100, null=True, blank=True)
    ad_cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    credits_waivers_discounts = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    ad_cost_incl_credits_waivers = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    gst = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    total_ads_cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    uploaded_at = models.DateTimeField(auto_now_add=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "ads_cost"
        ordering = ["-deduction_date"]
        constraints = [
            models.UniqueConstraint(
                fields=["business", "deduction_duration", "deduction_date", "campaign_id"],
                name="unique_ads_cost_entry",
            )
        ]

    def __str__(self):
        return f"Ad: {self.campaign_id} on {self.deduction_date}"


class ParentPriceHistory(models.Model):
    """One price-change entry for a parent SKU. effective_from tells when this price took effect."""
    parent = models.ForeignKey(
        ParentItemPrice, on_delete=models.CASCADE,
        related_name="price_history", db_column="parent_id",
    )
    effective_from = models.DateField()
    item_price = models.DecimalField(max_digits=12, decimal_places=2)
    tax_percent = models.IntegerField(default=0)
    packaging_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    final_price = models.DecimalField(max_digits=12, decimal_places=2)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "parent_price_history"
        unique_together = [("parent", "effective_from")]
        ordering = ["effective_from"]

    def __str__(self):
        return f"{self.parent_id} from {self.effective_from}: ₹{self.final_price}"


class ReferralPayment(models.Model):
    """Maps to 'Referral Payments' sheet"""

    reward_id = models.CharField(max_length=200, primary_key=True)
    payment_date = models.DateField(null=True, blank=True)
    store_name = models.CharField(max_length=200, null=True, blank=True)
    reason = models.TextField(null=True, blank=True)
    net_referral_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    taxes_gst_tds = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    uploaded_at = models.DateTimeField(auto_now_add=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "referral_payments"
        ordering = ["-payment_date"]

    def __str__(self):
        return self.reward_id


class CompensationRecovery(models.Model):
    """Maps to 'Compensation and Recovery' sheet"""

    date = models.DateField(null=True, blank=True)
    program_name = models.CharField(max_length=200, null=True, blank=True)
    reason = models.TextField(null=True, blank=True)
    amount_incl_gst = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    uploaded_at = models.DateTimeField(auto_now_add=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "compensation_recovery"
        ordering = ["-date"]

    def __str__(self):
        return f"{self.program_name} on {self.date}"


class Order(models.Model):
    REASON_CHOICES = [
        ("DELIVERED", "Delivered"),
        ("RTO_COMPLETE", "RTO Complete"),
        ("CANCELLED", "Cancelled"),
    ]

    reason_for_credit_entry = models.CharField(max_length=50, blank=True, null=True)
    sub_order_no    = models.CharField(max_length=100, db_index=True)
    catalog_id      = models.BigIntegerField(null=True, blank=True)
    order_date      = models.DateField(null=True, blank=True)
    order_source    = models.CharField(max_length=100, blank=True, null=True)
    customer_state  = models.CharField(max_length=100, blank=True, null=True)
    product_name    = models.TextField(blank=True, null=True)
    sku             = models.CharField(max_length=255, blank=True, null=True)
    size            = models.CharField(max_length=50, blank=True, null=True)
    quantity        = models.PositiveIntegerField(default=1)
    supplier_listed_price      = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    supplier_discounted_price  = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    packet_id       = models.CharField(max_length=100, blank=True, null=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    @classmethod
    def latest_per_order(cls, base_qs=None):
        """
        Return one row per sub_order_no — the most recent entry by order_date
        then created_at. Pass a filtered queryset as base_qs to pre-filter
        (e.g. by date range) before deduplication.
        """
        from django.db.models import OuterRef, Subquery
        qs = base_qs if base_qs is not None else cls.objects.all()
        latest_id = (
            cls.objects.filter(sub_order_no=OuterRef("sub_order_no"))
            .order_by("-order_date", "-created_at")
            .values("id")[:1]
        )
        return qs.filter(id=Subquery(latest_id))

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "orders"
        ordering = ["-order_date"]
        unique_together = [("business", "sub_order_no", "reason_for_credit_entry", "order_date")]

    def __str__(self):
        return self.sub_order_no


class BlockedCustomer(models.Model):
    """
    Customers manually blocked by the seller.
    Matched on customer_name + customer_pincode (same way LabelOrder identifies a person).
    Blocked customers are flagged whenever their labels are parsed.
    """
    customer_name    = models.CharField(max_length=255, db_index=True)
    customer_pincode = models.CharField(max_length=10, db_index=True)
    customer_city    = models.CharField(max_length=100, blank=True)
    customer_state   = models.CharField(max_length=100, blank=True)
    reason           = models.TextField(blank=True)
    blocked_at       = models.DateTimeField(auto_now_add=True)
    is_active        = models.BooleanField(default=True, db_index=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "blocked_customers"
        # Per business: the same shopper can legitimately be blocked by one
        # business and not another.
        unique_together = [("business", "customer_name", "customer_pincode")]
        ordering = ["-blocked_at"]

    def __str__(self):
        return f"{self.customer_name} ({self.customer_pincode})"


class PurchaseBill(models.Model):
    """One purchase transaction / vendor bill."""
    date        = models.DateField()
    seller_name = models.CharField(max_length=255)
    bill_number = models.CharField(max_length=100, blank=True)
    notes       = models.TextField(blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "purchase_bills"
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"Bill {self.bill_number or self.id} — {self.seller_name} ({self.date})"


class PurchaseItem(models.Model):
    """One line item within a PurchaseBill."""
    bill               = models.ForeignKey(PurchaseBill, on_delete=models.CASCADE, related_name="items")
    parent_sku         = models.ForeignKey(
        ParentItemPrice, on_delete=models.SET_NULL,
        null=True, blank=True, db_column="parent_sku_id",
    )
    product_description = models.CharField(max_length=500, blank=True)
    quantity           = models.PositiveIntegerField()
    price_per_unit     = models.DecimalField(max_digits=10, decimal_places=2)
    is_exchange        = models.BooleanField(default=False)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "purchase_items"

    def __str__(self):
        return f"{self.parent_sku_id} x{self.quantity} ({'exchange' if self.is_exchange else 'purchase'})"


class InventoryAdjustment(models.Model):
    """Manual stock correction — damaged, found, miscounted, etc."""
    REASON_CHOICES = [
        ("DAMAGED",    "Damaged / Written Off"),
        ("FOUND",      "Stock Found / Recount"),
        ("CORRECTION", "Inventory Correction"),
        ("LOST",       "Lost / Stolen"),
        ("RETURN",     "Customer Return (non-Meesho)"),
        ("OTHER",      "Other"),
    ]
    parent_sku = models.ForeignKey(
        ParentItemPrice, on_delete=models.CASCADE,
        related_name="inventory_adjustments", db_column="parent_sku_id",
    )
    quantity   = models.IntegerField()  # positive = add stock, negative = remove stock
    reason     = models.CharField(max_length=50, choices=REASON_CHOICES, default="OTHER")
    notes      = models.TextField(blank=True)
    date       = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "inventory_adjustments"
        ordering = ["-date", "-created_at"]

    def __str__(self):
        sign = "+" if self.quantity >= 0 else ""
        return f"{self.parent_sku_id} {sign}{self.quantity} ({self.reason}) on {self.date}"


class ConsumableItem(models.Model):
    """Master list of operational consumables: polythene bags, bubble wrap, stationery, etc."""
    CATEGORY_CHOICES = [
        ("POLYTHENE",   "Polythene / Plastic Bags"),
        ("BUBBLE_WRAP", "Bubble Wrap"),
        ("STATIONARY",  "Stationery"),
        ("LABELS",      "Shipping Labels / Tape"),
        ("BOX",         "Boxes / Packaging"),
        ("OTHER",       "Other"),
    ]
    UNIT_CHOICES = [
        ("pieces", "Pieces"),
        ("rolls",  "Rolls"),
        ("meters", "Meters"),
        ("grams",  "Grams"),
        ("kgs",    "Kilograms"),
        ("packs",  "Packs"),
        ("boxes",  "Boxes"),
    ]
    name       = models.CharField(max_length=255)
    category   = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default="OTHER")
    unit       = models.CharField(max_length=20, choices=UNIT_CHOICES, default="pieces")
    notes      = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "consumable_items"
        ordering = ["category", "name"]

    def __str__(self):
        return f"{self.name} ({self.get_category_display()})"


class ConsumablePurchase(models.Model):
    """Restocking of a consumable item from a supplier."""
    item           = models.ForeignKey(ConsumableItem, on_delete=models.CASCADE, related_name="purchases")
    date           = models.DateField()
    quantity       = models.DecimalField(max_digits=10, decimal_places=2)
    price_per_unit = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    seller_name    = models.CharField(max_length=255, blank=True)
    notes          = models.TextField(blank=True)
    created_at     = models.DateTimeField(auto_now_add=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "consumable_purchases"
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"{self.item.name} ×{self.quantity} on {self.date}"


class ConsumableUsage(models.Model):
    """Usage event or 'opening a new package' of a consumable item."""
    EVENT_TYPES = [
        ("USE",   "Used / Consumed"),
        ("OPEN",  "Opened New Package"),
        ("WASTE", "Damaged / Wasted"),
    ]
    item       = models.ForeignKey(ConsumableItem, on_delete=models.CASCADE, related_name="usages")
    date       = models.DateField()
    event_type = models.CharField(max_length=10, choices=EVENT_TYPES, default="USE")
    quantity   = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    notes      = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "consumable_usages"
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"{self.item.name} — {self.get_event_type_display()} ×{self.quantity} on {self.date}"


class InventoryLog(models.Model):
    """Immutable audit trail: every inventory-related create / update / delete."""
    ACTION_CHOICES = [
        ("CREATE", "Created"),
        ("UPDATE", "Updated"),
        ("DELETE", "Deleted"),
    ]
    ENTITY_CHOICES = [
        ("PURCHASE",            "Purchase Item"),
        ("ADJUSTMENT",          "Stock Adjustment"),
        ("SKU",                 "Parent SKU"),
        ("CONSUMABLE_PURCHASE", "Consumable Purchase"),
        ("CONSUMABLE_USAGE",    "Consumable Usage"),
        ("CONSUMABLE_ITEM",     "Consumable Item"),
        ("PACKED_STOCK",        "Packed Stock Entry"),
    ]
    entity_type     = models.CharField(max_length=25, choices=ENTITY_CHOICES)
    entity_id       = models.CharField(max_length=50, blank=True)
    action          = models.CharField(max_length=10, choices=ACTION_CHOICES)
    parent_sku_id   = models.CharField(max_length=200, blank=True, db_index=True)
    quantity_change = models.IntegerField(null=True, blank=True)
    description     = models.TextField()
    metadata        = models.JSONField(default=dict, blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "inventory_logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["parent_sku_id", "-created_at"]),
            models.Index(fields=["entity_type", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.entity_type} {self.action}: {self.description[:60]}"


class LabelOrder(models.Model):
    """
    One row per label (= one shipping order) parsed from an uploaded Meesho labels PDF.
    Primary key is the sub_order_no printed in the Product Details table of each label.
    """

    order_id = models.CharField(max_length=150, primary_key=True)

    # Customer
    customer_name    = models.CharField(max_length=255, blank=True, db_index=True)
    customer_address = models.TextField(blank=True)
    customer_city    = models.CharField(max_length=100, blank=True, db_index=True)
    customer_state   = models.CharField(max_length=100, blank=True, db_index=True)
    customer_pincode = models.CharField(max_length=10, blank=True, db_index=True)

    # Logistics
    courier_name  = models.CharField(max_length=100, blank=True, db_index=True)
    awb_number    = models.CharField(max_length=100, blank=True)
    payment_type  = models.CharField(max_length=20, blank=True)   # "Prepaid" | "COD"
    pickup_date   = models.CharField(max_length=20, blank=True)   # "12/06" as printed on label

    # Product
    sku   = models.CharField(max_length=300, blank=True)
    size  = models.CharField(max_length=100, blank=True)
    qty   = models.PositiveIntegerField(default=1)
    color = models.CharField(max_length=100, blank=True)

    # Dates
    order_date    = models.DateField(null=True, blank=True)        # from invoice section
    uploaded_date = models.DateField(db_index=True)                # date PDF was processed

    # Packing tracking
    is_packed     = models.BooleanField(default=False, db_index=True)
    packed_at     = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "label_orders"
        ordering = ["-uploaded_date", "courier_name"]

    def __str__(self):
        return f"{self.order_id} | {self.courier_name} | {self.sku}"


class MeeshoInventory(models.Model):
    """
    Mirrors the Meesho inventory sheet (catalog/product/variation level).
    system_stock_count is fetched from Meesho; seller_stock_count is the
    editable 'YOUR STOCK COUNT' column used to push updates back.
    """

    STOCK_TYPE_CHOICES = [
        ("IN_STOCK",     "In Stock"),
        ("OUT_OF_STOCK", "Out of Stock"),
        ("ALL",          "All"),
    ]

    # Not globally unique: Meesho numbers every export from 1, so each business
    # has its own SERIAL NO 1..N. Uniqueness is per business (see Meta).
    serial_no          = models.PositiveIntegerField(db_index=True, help_text="Row identifier from the Meesho sheet")
    catalog_name       = models.CharField(max_length=500)
    catalog_id         = models.BigIntegerField(db_index=True)
    product_name       = models.TextField()
    product_id         = models.BigIntegerField(db_index=True)
    style_id           = models.CharField(max_length=255, blank=True)
    variation_id       = models.BigIntegerField(null=True, blank=True)
    variation          = models.CharField(max_length=255, blank=True)
    stock_type         = models.CharField(max_length=15, choices=STOCK_TYPE_CHOICES, default="ALL")
    system_stock_count = models.IntegerField(default=0, help_text="Current stock count as reported by Meesho")
    seller_stock_count = models.IntegerField(null=True, blank=True, help_text="Seller-edited stock count to push to Meesho")

    uploaded_at        = models.DateTimeField(auto_now_add=True)
    updated_at         = models.DateTimeField(auto_now=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "meesho_inventory"
        ordering = ["serial_no"]
        unique_together = [("business", "serial_no")]
        indexes = [
            models.Index(fields=["catalog_id"]),
            models.Index(fields=["product_id"]),
        ]

    def __str__(self):
        return f"[{self.serial_no}] {self.catalog_name} — {self.style_id}"


class MeeshoPriceUpdate(models.Model):
    """Stores the new prices a seller wants to push to Meesho for a given inventory item."""
    inventory = models.OneToOneField(
        MeeshoInventory, on_delete=models.CASCADE,
        related_name="price_update",
    )
    new_msp  = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True,
                                   help_text="New Meesho Selling Price")
    new_wdrp = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True,
                                   help_text="Wrong/Defective Return Price")
    new_mrp  = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True,
                                   help_text="New Maximum Retail Price (optional)")
    updated_at = models.DateTimeField(auto_now=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "meesho_price_updates"
        ordering = ["inventory__serial_no"]

    def __str__(self):
        return f"PriceUpdate {self.inventory.style_id}: MSP={self.new_msp}"

class ExpenseInvoice(models.Model):
    """A business expense invoice — packaging material and other running costs.

    Line-item based (see ExpenseInvoiceItem); the total is computed from items.
    """
    invoice_no = models.CharField(max_length=100, blank=True)
    vendor     = models.CharField(max_length=255, blank=True)
    title      = models.CharField(max_length=255, blank=True)
    date       = models.DateField()
    notes      = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "expense_invoices"
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"Expense {self.invoice_no or self.id} — {self.vendor} ({self.date})"


class ExpenseInvoiceItem(models.Model):
    """One line on an ExpenseInvoice. amount = quantity * unit_rate (computed)."""
    CATEGORY_CHOICES = [
        ("packaging", "Packaging Material"),
        ("other", "Other Expense"),
    ]
    invoice     = models.ForeignKey(ExpenseInvoice, on_delete=models.CASCADE, related_name="items")
    description = models.CharField(max_length=500)
    category    = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default="packaging")
    quantity    = models.DecimalField(max_digits=12, decimal_places=2, default=1)
    unit_rate   = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "expense_invoice_items"

    @property
    def amount(self):
        return (self.quantity or 0) * (self.unit_rate or 0)

    def __str__(self):
        return f"{self.description} ({self.category})"


class TransportCharge(models.Model):
    """A daily transportation / logistics charge for the business."""
    date       = models.DateField()
    amount     = models.DecimalField(max_digits=12, decimal_places=2)
    note       = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "transport_charges"
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"Transport {self.date}: ₹{self.amount}"


class PackedStockEvent(models.Model):
    """
    One scan/entry event against a printed inventory label. The barcode on
    the label encodes the Parent SKU id directly — scanning (or typing) it
    here adds (or, with a negative quantity, removes) units from that SKU's
    packed & ready-to-ship stock count, separate from purchased/sold stock.
    """
    parent_sku = models.ForeignKey(
        ParentItemPrice, on_delete=models.CASCADE,
        related_name="packed_stock_events", db_column="parent_sku_id",
    )
    quantity     = models.IntegerField()  # positive = packed, negative = unpacked/correction
    code_scanned = models.CharField(max_length=200, blank=True)
    notes        = models.TextField(blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "packed_stock_events"
        ordering = ["-created_at"]

    def __str__(self):
        sign = "+" if self.quantity >= 0 else ""
        return f"{self.parent_sku_id} {sign}{self.quantity} packed"


class EstimatedProfitOrder(models.Model):
    """
    One row from an uploaded Meesho 'Order Summary' CSV (Estimated Profit tab).
    Stores the raw order data only — cost/profit is always computed live against
    current SKU pricing when read, the same way /profit/ works, so adding/fixing
    a SKU's price retroactively updates every stored row that references it.

    Re-uploading the same sheet updates rows in place instead of duplicating:
    (business, sub_order_no, order_status) is the natural key — one row per
    sub-order per lifecycle status (an order can appear once as e.g. "Delivered"
    and, if it later changes, again as "Returned").
    """
    sub_order_no  = models.CharField(max_length=100, db_index=True)
    order_status  = models.CharField(max_length=50)
    catalog_id    = models.CharField(max_length=100, null=True, blank=True)
    sku_id        = models.CharField(max_length=200, db_index=True)
    quantity      = models.PositiveIntegerField(default=1)
    price         = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    order_date    = models.DateField(null=True, blank=True)
    payout_value  = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    payout_status = models.CharField(max_length=50, null=True, blank=True)
    claim_status  = models.CharField(max_length=50, null=True, blank=True)

    uploaded_at = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "estimated_profit_orders"
        ordering = ["-order_date", "-uploaded_at"]
        unique_together = [("business", "sub_order_no", "order_status")]

    def __str__(self):
        return f"{self.sub_order_no} ({self.order_status})"


class ReturnDelivery(models.Model):
    """
    One returned parcel that has physically come back to us, parsed from the
    Meesho supplier-panel "Returns → Completed/Delivered" CSV export.

    This is the only Meesho report that carries `delivered_date` — the day the
    return was handed back to the seller. That date starts the 7-day window in
    which a claim can be raised, so it drives the countdown and the warnings.

    Natural key is (business, suborder_no, awb_number): a return leg is
    identified by the AWB it travelled back on, so re-uploading an overlapping
    2-week export updates existing rows instead of duplicating them, while a
    genuine second return of the same sub-order (a different AWB) still lands
    as its own row. Claim fields are never written by the importer, so an
    upload can't wipe claim work already recorded against a row.
    """

    # Meesho allows a claim to be raised within this many days of the return
    # being delivered back to the seller.
    CLAIM_WINDOW_DAYS = 7
    # Day of the window from which the UI starts warning that the claim is
    # still not raised (i.e. 2 days left of 7).
    WARN_FROM_DAY = 5

    CLAIM_UNREVIEWED   = "UNREVIEWED"
    CLAIM_NOT_REQUIRED = "NOT_REQUIRED"
    CLAIM_REQUIRED     = "REQUIRED"
    CLAIM_RAISED       = "RAISED"
    CLAIM_APPROVED     = "APPROVED"
    CLAIM_REJECTED     = "REJECTED"

    CLAIM_STATUS_CHOICES = [
        (CLAIM_UNREVIEWED,   "Not reviewed yet"),
        (CLAIM_NOT_REQUIRED, "No claim needed"),
        (CLAIM_REQUIRED,     "Claim required"),
        (CLAIM_RAISED,       "Claim raised"),
        (CLAIM_APPROVED,     "Claim approved"),
        (CLAIM_REJECTED,     "Claim rejected"),
    ]

    # Statuses where a claim is still owed — these are the ones the countdown
    # and the expiry warnings apply to.
    OPEN_CLAIM_STATUSES = (CLAIM_UNREVIEWED, CLAIM_REQUIRED)

    VERIFY_MATCH    = "MATCH"
    VERIFY_MISMATCH = "MISMATCH"
    VERIFY_CHOICES  = [
        (VERIFY_MATCH,    "Correct product received"),
        (VERIFY_MISMATCH, "Wrong product received"),
    ]

    # ── Identity (what you scan) ──────────────────────────────────────────
    suborder_no = models.CharField(max_length=100, db_index=True)
    order_no    = models.CharField(max_length=100, blank=True, db_index=True)
    awb_number  = models.CharField(max_length=100, blank=True, db_index=True)

    # ── Product ───────────────────────────────────────────────────────────
    product_name = models.TextField(blank=True)
    sku          = models.CharField(max_length=300, blank=True, db_index=True)
    variation    = models.CharField(max_length=255, blank=True)
    meesho_pid   = models.CharField(max_length=100, blank=True)
    category     = models.CharField(max_length=200, blank=True)
    qty          = models.PositiveIntegerField(default=1)

    # ── The return journey ────────────────────────────────────────────────
    dispatch_date          = models.DateField(null=True, blank=True)
    return_created_date    = models.DateField(null=True, blank=True)
    delivered_date         = models.DateField(null=True, blank=True, db_index=True)
    type_of_return         = models.CharField(max_length=60, blank=True)   # "Customer Return" | "Courier Return (RTO)"
    sub_type               = models.CharField(max_length=60, blank=True)   # FIRST_RET | forward_RTO | EXCHANGE_RTO
    courier_partner        = models.CharField(max_length=100, blank=True)
    tracking_link          = models.TextField(blank=True)
    proof_of_delivery      = models.TextField(blank=True)
    return_price_type      = models.CharField(max_length=100, blank=True)
    return_reason          = models.TextField(blank=True)
    detailed_return_reason = models.TextField(blank=True)
    otp_verified_at        = models.DateTimeField(null=True, blank=True)

    # ── Claim tracking (entered in the app, never from the sheet) ──────────
    claim_status    = models.CharField(max_length=20, choices=CLAIM_STATUS_CHOICES,
                                       default=CLAIM_UNREVIEWED, db_index=True)
    claim_marked_at = models.DateTimeField(null=True, blank=True,
                                           help_text="When the claim was flagged as required")
    claim_raised_at = models.DateTimeField(null=True, blank=True,
                                           help_text="When the claim was actually raised on Meesho")
    claim_amount    = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    claim_reference = models.CharField(max_length=150, blank=True,
                                       help_text="Meesho ticket / claim reference id")
    claim_notes     = models.TextField(blank=True)

    # ── Physical check at the scanning desk ───────────────────────────────
    verify_result = models.CharField(max_length=20, choices=VERIFY_CHOICES, blank=True)
    verified_at   = models.DateTimeField(null=True, blank=True)

    uploaded_at = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "return_deliveries"
        ordering = ["-delivered_date", "-return_created_date", "-uploaded_at"]
        unique_together = [("business", "suborder_no", "awb_number")]
        indexes = [
            models.Index(fields=["business", "claim_status"]),
            models.Index(fields=["business", "delivered_date"]),
        ]

    def __str__(self):
        return f"{self.suborder_no} | {self.sku} | returned {self.delivered_date}"

    # ── Claim window ──────────────────────────────────────────────────────
    @property
    def claim_deadline(self):
        """Last date a claim can be raised — delivered_date + 7 days."""
        if not self.delivered_date:
            return None
        return self.delivered_date + timedelta(days=self.CLAIM_WINDOW_DAYS)

    def days_left(self, today=None):
        """Days remaining to raise a claim. 0 = today is the last day, <0 = missed."""
        deadline = self.claim_deadline
        if deadline is None:
            return None
        return (deadline - (today or timezone.localdate())).days

    def day_of_window(self, today=None):
        """How many days into the 7-day window we are (0 = delivered today)."""
        if not self.delivered_date:
            return None
        return ((today or timezone.localdate()) - self.delivered_date).days

    def claim_urgency(self, today=None):
        """
        How pressing this row's claim is:
          none     — nothing owed (already raised / decided / marked not needed)
          unknown  — no delivered date on the sheet, so no window to track
          ok       — 3+ days of the window still left
          warning  — day 5 or 6 of 7: only 1–2 days left, claim still not raised
          last_day — the deadline is today
          expired  — the window closed without a claim
        """
        if self.claim_status not in self.OPEN_CLAIM_STATUSES:
            return "none"
        left = self.days_left(today)
        if left is None:
            return "unknown"
        if left < 0:
            return "expired"
        if left == 0:
            return "last_day"
        if left <= self.CLAIM_WINDOW_DAYS - self.WARN_FROM_DAY:
            return "warning"
        return "ok"


class GstTransaction(models.Model):
    """
    One line from Meesho's TCS sales / sales-return export — the data a GST
    return is actually filed from.

    Sales and returns share this table (see `kind`) because GST for a period is
    output tax on sales *net of* returns, and every downstream figure needs both
    together.

    Note the grain: one sub-order can have several lines. Meesho appends
    negative-value adjustment lines (quantity 0) for post-sale price
    corrections, so lines must be summed rather than deduped by sub-order.
    """

    KIND_SALE   = "SALE"
    KIND_RETURN = "RETURN"
    KIND_CHOICES = [(KIND_SALE, "Sale"), (KIND_RETURN, "Sale return / cancellation")]

    kind = models.CharField(max_length=10, choices=KIND_CHOICES, db_index=True)

    # Period this line is filed in — taken from the sheet, not derived, so it
    # matches whatever Meesho reported it under.
    financial_year = models.IntegerField(db_index=True)
    month_number   = models.IntegerField(db_index=True)

    sub_order_num = models.CharField(max_length=100, db_index=True)
    order_date    = models.DateField(null=True, blank=True)
    manifest_date = models.DateField(null=True, blank=True)
    # Returns only: when the cancellation/return happened.
    cancel_return_date = models.DateField(null=True, blank=True)

    hsn_code = models.CharField(max_length=20, blank=True, db_index=True)
    quantity = models.IntegerField(default=0)
    gst_rate = models.DecimalField(max_digits=6, decimal_places=2, default=0)

    total_taxable_sale_value = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    tax_amount               = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    total_invoice_value      = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    taxable_shipping         = models.DecimalField(max_digits=14, decimal_places=4, default=0)

    end_customer_state = models.CharField(max_length=100, blank=True, db_index=True)
    supplier_gstin     = models.CharField(max_length=20, blank=True)
    eco_tcs_gstin      = models.CharField(max_length=20, blank=True, help_text="Meesho's GSTIN as the e-commerce operator")
    supplier_id        = models.CharField(max_length=50, blank=True)
    sup_name           = models.CharField(max_length=255, blank=True)

    uploaded_at = models.DateTimeField(auto_now_add=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "gst_transactions"
        ordering = ["-financial_year", "-month_number", "sub_order_num"]
        indexes = [
            models.Index(fields=["business", "financial_year", "month_number", "kind"]),
            models.Index(fields=["business", "gst_rate"]),
        ]

    def __str__(self):
        return f"{self.kind} {self.sub_order_num} @{self.gst_rate}%"

    @property
    def signed_taxable(self):
        """Returns reduce the period's taxable value, so they carry a negative sign."""
        v = self.total_taxable_sale_value or 0
        return -v if self.kind == self.KIND_RETURN else v

    @property
    def signed_tax(self):
        v = self.tax_amount or 0
        return -v if self.kind == self.KIND_RETURN else v


class GstInvoiceDetail(models.Model):
    """
    One row of Meesho's "Tax invoice details" export: the invoice/credit-note
    number issued for a sub-order, with its HSN and product description.

    Kept separate from GstTransaction because the grain differs — a sub-order
    can have both an INVOICE and a later CREDIT NOTE, each with its own
    document number. Used to put an invoice number and product name against
    the tax lines, and to cross-check the HSN actually invoiced.
    """
    doc_type      = models.CharField(max_length=30, db_index=True,
                                     help_text="INVOICE / CREDIT NOTE / CREDIT_DISCOUNT / …")
    order_date    = models.DateTimeField(null=True, blank=True)
    suborder_no   = models.CharField(max_length=100, db_index=True)
    product_description = models.TextField(blank=True)
    hsn           = models.CharField(max_length=20, blank=True, db_index=True)
    invoice_no    = models.CharField(max_length=100, db_index=True)

    # Derived from order_date so an upload can replace exactly one period.
    period_year  = models.IntegerField(db_index=True)
    period_month = models.IntegerField(db_index=True)

    uploaded_at = models.DateTimeField(auto_now_add=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "gst_invoice_details"
        ordering = ["-order_date"]
        # (sub-order, document no) is unique in Meesho's export — a sub-order
        # may appear twice, but never twice under the same document.
        unique_together = [("business", "suborder_no", "invoice_no")]

    def __str__(self):
        return f"{self.doc_type} {self.invoice_no} ({self.suborder_no})"
