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

    # Some SKUs genuinely have no parent and never will — a one-off, a sample, a
    # discontinued line. Without a way to say so they sit in the "unlinked" pile
    # forever, and every suggestion list keeps offering them, so the pile stops
    # meaning "needs attention". Opting one out hides it from the linking flows
    # without deleting the pricing behind it.
    parent_opt_out = models.BooleanField(
        default=False,
        help_text="Deliberately has no parent — hide it from linking and suggestions.",
    )

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

    # ── Packet scanned as claim evidence ──────────────────────────────────
    # Meesho rejects claims when the order/AWB on the reverse waybill isn't
    # legible (see the "Order ID and AWB number are not visible" rejections), so
    # capturing the packet actually scanned — and proving it matches what we
    # shipped — is what makes a claim defensible later.
    PACKET_UNCHECKED = ""
    PACKET_MATCH     = "MATCH"
    PACKET_MISMATCH  = "MISMATCH"
    PACKET_UNKNOWN   = "UNKNOWN"      # scanned, but we hold nothing to compare against

    PACKET_CHECK_CHOICES = [
        (PACKET_MATCH,    "Packet matches what we shipped"),
        (PACKET_MISMATCH, "Packet does not match"),
        (PACKET_UNKNOWN,  "Nothing on file to compare"),
    ]

    packet_id       = models.CharField(max_length=150, blank=True, db_index=True,
                                       help_text="Packet / reverse-AWB scanned off the returned parcel")
    packet_check    = models.CharField(max_length=20, choices=PACKET_CHECK_CHOICES, blank=True)
    packet_matched_against = models.CharField(max_length=150, blank=True,
                                              help_text="The value it was compared with")
    packet_scanned_at = models.DateTimeField(null=True, blank=True)

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


class ScannedOrder(models.Model):
    """
    One outgoing order recorded at the scanning desk, so its progress can be
    looked up later.

    Why this exists separately from LabelOrder: a label only tells us what
    *should* go out — it is created by a PDF upload and says nothing about what
    was physically handled. This table is the log of what someone actually
    scanned, when, and what state they put it in. It also survives the order
    being absent from every other table: a code that matches nothing at all is
    still recorded (matched_from = NONE), because "I scanned this and the system
    didn't know it" is exactly the kind of thing worth being able to look up.

    The product/customer columns are a *snapshot* copied from whatever source
    resolved the code. They are deliberately denormalised rather than a FK: the
    point of the log is what was true at the desk on the day, and a later label
    re-upload must not silently rewrite history.

    Natural key is (business, sub_order_no) — one row per order, and re-scanning
    the same parcel bumps scan_count instead of adding a duplicate, so the desk
    gets told "already scanned" rather than quietly logging it twice.
    """

    # ── Where the parcel is in our own process ────────────────────────────
    STATUS_SCANNED    = "SCANNED"
    STATUS_PACKED     = "PACKED"
    STATUS_DISPATCHED = "DISPATCHED"
    STATUS_ON_HOLD    = "ON_HOLD"
    STATUS_ISSUE      = "ISSUE"
    STATUS_CANCELLED  = "CANCELLED"

    STATUS_CHOICES = [
        (STATUS_SCANNED,    "Scanned"),
        (STATUS_PACKED,     "Packed"),
        (STATUS_DISPATCHED, "Dispatched"),
        (STATUS_ON_HOLD,    "On hold"),
        (STATUS_ISSUE,      "Problem"),
        (STATUS_CANCELLED,  "Cancelled"),
    ]

    # Still somewhere in our hands — the ones a "what's left to do" view wants.
    OPEN_STATUSES = (STATUS_SCANNED, STATUS_PACKED, STATUS_ON_HOLD, STATUS_ISSUE)
    # Needs a person to look at it.
    ATTENTION_STATUSES = (STATUS_ON_HOLD, STATUS_ISSUE)

    # ── Did it actually leave the building? ───────────────────────────────
    # Derived from the uploaded Orders / Payments sheets, which are the only
    # status Meesho gives us — there is no live Meesho API in this app. So this
    # answers "as far as our data knows", and UNKNOWN is a real, common answer
    # for a parcel scanned today whose sheet lands next week.
    SHIP_SHIPPED     = "SHIPPED"      # dispatched, delivered, or already back (RTO)
    SHIP_NOT_SHIPPED = "NOT_SHIPPED"  # Meesho still has it as pending / ready-to-ship
    SHIP_CANCELLED   = "CANCELLED"    # cancelled before dispatch
    SHIP_UNKNOWN     = "UNKNOWN"      # no sheet covers this order yet

    SHIP_STATUS_CHOICES = [
        (SHIP_SHIPPED,     "Shipped"),
        (SHIP_NOT_SHIPPED, "Not shipped yet"),
        (SHIP_CANCELLED,   "Cancelled"),
        (SHIP_UNKNOWN,     "No status yet"),
    ]

    # Raw sheet values, upper-cased, that mean the parcel has left. RTO_* counts
    # as shipped: it went out and came back, so it is emphatically not "waiting
    # to be dispatched", which is the thing the desk needs to catch.
    SHIPPED_MARKERS = (
        "SHIPPED", "DELIVERED", "RTO", "RTO_COMPLETE", "RTO_LOCKED",
        "RETURN", "EXCHANGE", "DOOR_STEP_EXCHANGED",
    )
    NOT_SHIPPED_MARKERS = ("READY_TO_SHIP", "PENDING")
    CANCELLED_MARKERS = ("CANCELLED",)

    # ── Which table the scanned code was recognised from ──────────────────
    MATCH_LABEL   = "LABEL"      # shipping label PDF — the richest source
    MATCH_PAYMENT = "PAYMENT"    # payments sheet
    MATCH_ORDER   = "ORDER"      # orders sheet
    MATCH_NONE    = "NONE"       # nothing in the system knows this code (yet)

    MATCH_CHOICES = [
        (MATCH_LABEL,   "Shipping label"),
        (MATCH_PAYMENT, "Payments sheet"),
        (MATCH_ORDER,   "Orders sheet"),
        (MATCH_NONE,    "Not recognised"),
    ]

    # ── Identity ──────────────────────────────────────────────────────────
    scanned_code = models.CharField(max_length=200, db_index=True,
                                    help_text="Exactly what the scanner read, before resolution")
    sub_order_no = models.CharField(max_length=100, db_index=True,
                                    help_text="Resolved sub-order, or the raw code when unrecognised")
    awb_number   = models.CharField(max_length=100, blank=True, db_index=True)
    matched_from = models.CharField(max_length=20, choices=MATCH_CHOICES, default=MATCH_NONE)

    # ── Snapshot of the order as it was at scan time ──────────────────────
    sku          = models.CharField(max_length=300, blank=True, db_index=True)
    product_name = models.TextField(blank=True)
    size         = models.CharField(max_length=100, blank=True)
    qty          = models.PositiveIntegerField(default=1)
    courier_name = models.CharField(max_length=100, blank=True, db_index=True)
    payment_type = models.CharField(max_length=20, blank=True)   # "Prepaid" | "COD"

    customer_name    = models.CharField(max_length=255, blank=True)
    customer_city    = models.CharField(max_length=100, blank=True)
    customer_state   = models.CharField(max_length=100, blank=True)
    customer_pincode = models.CharField(max_length=10, blank=True)

    order_date = models.DateField(null=True, blank=True)

    # ── Progress recorded at the desk ──────────────────────────────────────
    status            = models.CharField(max_length=20, choices=STATUS_CHOICES,
                                         default=STATUS_SCANNED, db_index=True)
    status_updated_at = models.DateTimeField(null=True, blank=True)
    notes             = models.TextField(blank=True)

    # ── Shipping status, as resolved at scan time ─────────────────────────
    # Stored rather than always computed so the log records what the desk was
    # told when it acted. It is re-resolved on every scan and on demand, because
    # a later sheet upload can turn UNKNOWN into a real answer.
    ship_status    = models.CharField(max_length=20, choices=SHIP_STATUS_CHOICES,
                                      default=SHIP_UNKNOWN, db_index=True)
    ship_status_raw = models.CharField(max_length=100, blank=True,
                                       help_text="The sheet value this was derived from")
    # Where the answer came from — "orders", "payments · Rudam 2", "via AWB",
    # "return on file". Recorded because "why does this say shipped?" is the
    # first question asked when a status looks wrong.
    ship_source     = models.CharField(max_length=100, blank=True)
    ship_checked_at = models.DateTimeField(null=True, blank=True)

    # ── Scan bookkeeping ──────────────────────────────────────────────────
    scan_count      = models.PositiveIntegerField(default=1)
    first_scanned_at = models.DateTimeField(auto_now_add=True, db_index=True)
    last_scanned_at  = models.DateTimeField(db_index=True)
    scanned_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="order_scans",
    )

    updated_at = models.DateTimeField(auto_now=True)

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT,
    )

    class Meta:
        db_table = "scanned_orders"
        ordering = ["-last_scanned_at"]
        unique_together = [("business", "sub_order_no")]
        indexes = [
            models.Index(fields=["business", "status"]),
            models.Index(fields=["business", "last_scanned_at"]),
        ]

    def __str__(self):
        return f"{self.sub_order_no} | {self.sku} | {self.status}"

    @property
    def scan_date(self):
        """Local date the parcel was last scanned — what the desk groups by."""
        return timezone.localtime(self.last_scanned_at).date() if self.last_scanned_at else None

    @classmethod
    def classify_ship_status(cls, raw):
        """
        Turn a sheet's status string into one of our four buckets.

        Matching is substring-based on purpose: the Orders sheet says
        RTO_COMPLETE while the Payments sheet says RTO for the same thing, and
        new Meesho variants (DOOR_STEP_EXCHANGED) keep appearing. Cancelled is
        checked before the shipped markers so "CANCELLED" can never be read as
        shipped by a partial match.
        """
        text = (raw or "").strip().upper()
        if not text:
            return cls.SHIP_UNKNOWN
        if any(m in text for m in cls.CANCELLED_MARKERS):
            return cls.SHIP_CANCELLED
        if any(m in text for m in cls.NOT_SHIPPED_MARKERS):
            return cls.SHIP_NOT_SHIPPED
        if any(m in text for m in cls.SHIPPED_MARKERS):
            return cls.SHIP_SHIPPED
        return cls.SHIP_UNKNOWN

    @property
    def needs_shipping_attention(self):
        """Scanned and packed by us, but Meesho says it never went out."""
        return self.ship_status in (self.SHIP_NOT_SHIPPED, self.SHIP_CANCELLED)


class ListingTemplate(models.Model):
    """
    A saved set of Meesho listing-form values, synced from the browser extension.

    The extension scans whatever form is on screen and derives a *logical key*
    per field (name → id → label → placeholder) rather than a CSS selector, so a
    template keeps matching after Meesho ships a redesign. `fields` maps those
    keys to the values to prefill; `labels` keeps the human label that was on
    screen at save time, purely so the popup and the web UI can show something
    readable next to each key.

    Both are JSON because the shape is dictated by whatever form Meesho renders
    — there is no fixed column set to model, and inventing one would break the
    moment Meesho adds a field.

    Scoped to a business rather than to a user: the rest of this schema is
    business-scoped, and a team listing for the same catalogue needs to share
    templates. `created_by` records who saved it, and survives that user being
    deleted so the template isn't lost with them.

    Natural key is (business, name) — saving under an existing name updates it in
    place, which is what the extension's popup already does locally.
    """

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT, related_name="listing_templates",
    )

    name = models.CharField(max_length=200, db_index=True)
    fields = models.JSONField(default=dict, help_text="logical field key → value to prefill")
    labels = models.JSONField(default=dict, blank=True,
                              help_text="logical field key → the label shown on the page")

    # The Meesho URL the template was captured from, so it's obvious which form
    # a template belongs to when several look alike.
    source_url = models.TextField(blank=True)

    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="listing_templates",
    )
    # Who last pushed a change from an extension, which is not necessarily the
    # person who first created it once a template is shared across a team.
    updated_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="listing_templates_updated",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        db_table = "listing_templates"
        ordering = ["-updated_at"]
        unique_together = [("business", "name")]
        indexes = [models.Index(fields=["business", "updated_at"])]

    def __str__(self):
        return f"{self.name} ({len(self.fields or {})} fields)"

    @property
    def field_count(self):
        return len(self.fields or {})


class BulkListingFieldPreset(models.Model):
    """
    A named set of Bulk Listing form values, saved so a future product in the
    same (or a similar) category doesn't need everything retyped.

    Kept separate from ListingTemplate even though the shape is similar: that
    table holds DOM-derived keys the browser extension fills a live Meesho
    page with, and mixing Bulk Listing presets into it would surface
    unrelated entries in the extension's own Templates tab. `fields` here is
    keyed by the *parsed template's* field key (see bulk_listing.py), which
    only ever means something against a template's own field list — applying
    a preset just prefills whichever keys happen to match the template in use
    and leaves the rest alone, so it degrades gracefully across categories.
    """

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT, related_name="bulk_listing_presets",
    )
    name = models.CharField(max_length=200, db_index=True)
    # The template's own category label at save time — display only, so the
    # preset picker can hint "this was saved from Puja Articles".
    source_label = models.CharField(max_length=255, blank=True)
    fields = models.JSONField(default=dict, help_text="field key -> value to prefill")
    labels = models.JSONField(default=dict, blank=True,
                              help_text="field key -> the human label shown at save time")

    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="bulk_listing_presets_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "bulk_listing_field_presets"
        ordering = ["name"]
        unique_together = [("business", "name")]

    def __str__(self):
        return f"{self.name} ({len(self.fields or {})} fields)"

    @property
    def field_count(self):
        return len(self.fields or {})


class FlipkartBulkTemplate(models.Model):
    """
    A Flipkart category template (.xls) uploaded once and kept for reuse.

    Unlike Meesho — one bundled "quick start" covers a common category, and
    a fresh template is a quick re-download away otherwise — Flipkart has no
    bundled template at all and its field set is wildly different per
    category, so re-uploading the same category's file on every batch is
    real, avoidable friction. The raw bytes are kept here (BinaryField ->
    `longblob` on MySQL, comfortably north of any real template's size)
    rather than on disk, because this app has no configured file storage
    backend (see settings.py — no MEDIA_ROOT/STORAGES) and a filesystem
    path wouldn't reliably survive a redeploy anyway.

    Deliberately not shared with Meesho's flow: Meesho already has its own
    upload-or-built-in mechanism, and mixing the two would mean filtering
    every list by platform for no real benefit — Flipkart is the only
    platform that asked for this.
    """

    business = models.ForeignKey(
        "accounts.Business", on_delete=models.PROTECT, related_name="flipkart_bulk_templates",
    )
    name = models.CharField(max_length=200, db_index=True)
    category_label = models.CharField(max_length=255, blank=True)
    original_filename = models.CharField(max_length=255, blank=True)
    file_data = models.BinaryField()

    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="flipkart_bulk_templates_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "flipkart_bulk_templates"
        ordering = ["name"]
        unique_together = [("business", "name")]

    def __str__(self):
        return self.name

    @property
    def file_size(self):
        return len(self.file_data or b"")


class ClaimTicket(models.Model):
    """
    One claim ticket from the Meesho supplier panel's ticket export
    (Supplier-<id>_Status-all_Created-from-<date>-to-<date>.csv).

    This is the other half of the returns story: ReturnDelivery records what we
    decided at the scanning desk, while this records what Meesho actually did
    about it — approved, rejected, or still open — with the money and the reason.
    Uploading it is what closes the loop, because nothing else tells us a claim
    was paid or why one was refused.

    The sheet keeps the outcome in prose rather than columns, e.g.
      "Your claim payment of Rs 511.56 for this order was done on 05 Aug 2026
       with a transaction id: AXISCN1427572435"
      "Your claim of Rs. 356.26 for this order has been scheduled on 2026-07-15"
    so `claim_amount`, `transaction_id`, `settled_on` and `payment_state` are
    parsed out of `last_update` at import time. They are stored rather than
    re-parsed on read because the wording changes between Meesho releases, and a
    figure already extracted shouldn't silently disappear when it does.

    Natural key is (business, ticket_id): a ticket id is unique in the panel, so
    re-uploading an overlapping date range updates in place.
    """

    STATUS_OPEN     = "OPEN"
    STATUS_APPROVED = "APPROVED"
    STATUS_REJECTED = "REJECTED"
    STATUS_OTHER    = "OTHER"

    STATUS_CHOICES = [
        (STATUS_OPEN,     "Open"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_REJECTED, "Rejected"),
        (STATUS_OTHER,    "Other"),
    ]

    # Whether the approved money has actually moved.
    PAY_PAID      = "PAID"        # "...was done on <date> with a transaction id"
    PAY_SCHEDULED = "SCHEDULED"   # "...has been scheduled on <date>"
    PAY_NONE      = "NONE"

    PAYMENT_STATE_CHOICES = [
        (PAY_PAID,      "Paid"),
        (PAY_SCHEDULED, "Scheduled"),
        (PAY_NONE,      "Not applicable"),
    ]

    # ── Identity ──────────────────────────────────────────────────────────
    ticket_id   = models.CharField(max_length=60, db_index=True)
    suborder_no = models.CharField(max_length=100, blank=True, db_index=True)
    order_no    = models.CharField(max_length=100, blank=True, db_index=True)

    # ── Product, as the sheet reports it (often blank in the panel export) ──
    product_name = models.TextField(blank=True)
    sku          = models.CharField(max_length=300, blank=True, db_index=True)
    variation    = models.CharField(max_length=255, blank=True)
    meesho_pid   = models.CharField(max_length=100, blank=True)
    qty          = models.PositiveIntegerField(null=True, blank=True)

    # ── The ticket ────────────────────────────────────────────────────────
    ticket_status     = models.CharField(max_length=20, choices=STATUS_CHOICES,
                                         default=STATUS_OPEN, db_index=True)
    ticket_status_raw = models.CharField(max_length=60, blank=True)
    issue             = models.CharField(max_length=255, blank=True, db_index=True)
    created_at_meesho = models.DateTimeField(null=True, blank=True, db_index=True)
    last_update       = models.TextField(blank=True)
    reopen_validity   = models.DateField(null=True, blank=True)
    cpp_flag          = models.CharField(max_length=40, blank=True)

    # ── Parsed out of last_update ──────────────────────────────────────────
    claim_amount   = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    transaction_id = models.CharField(max_length=80, blank=True, db_index=True)
    settled_on     = models.DateField(null=True, blank=True)
    payment_state  = models.CharField(max_length=20, choices=PAYMENT_STATE_CHOICES,
                                      default=PAY_NONE, db_index=True)

    # Whether this ticket found a ReturnDelivery to attach to. Recorded so the
    # UI can say "42 tickets have no matching return" instead of silently
    # dropping them — usually it means the returns export hasn't been uploaded.
    linked_return = models.ForeignKey(
        "ReturnDelivery", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="claim_tickets",
    )

    uploaded_at = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    business = models.ForeignKey("accounts.Business", on_delete=models.PROTECT)

    class Meta:
        db_table = "claim_tickets"
        ordering = ["-created_at_meesho", "-uploaded_at"]
        unique_together = [("business", "ticket_id")]
        indexes = [
            models.Index(fields=["business", "ticket_status"]),
            models.Index(fields=["business", "suborder_no"]),
        ]

    def __str__(self):
        return f"{self.ticket_id} · {self.ticket_status} · {self.suborder_no}"

    @property
    def is_reopenable(self):
        """A rejected ticket can be argued again until its reopen date passes."""
        if self.ticket_status != self.STATUS_REJECTED or not self.reopen_validity:
            return False
        return self.reopen_validity >= timezone.localdate()

    @property
    def days_to_reopen(self):
        if self.ticket_status != self.STATUS_REJECTED or not self.reopen_validity:
            return None
        return (self.reopen_validity - timezone.localdate()).days


class WorkerTask(models.Model):
    """
    A piece of paid piecework handed to a team member.

    Two kinds today, and they pay differently because the work differs:

      LISTING       Download the photo from a Drive link, edit it, create the
                    listing on Meesho, report the SKU id. Paid a per-task rate
                    you set when creating it, once you approve the SKU.

      RETURN_CLAIM  Download the unboxing video, compress it under Meesho's
                    size limit, raise the claim. Paid a flat fee once you
                    confirm the claim went up, plus a bonus if Meesho actually
                    approves it — which is not the worker's doing, but is worth
                    incentivising.

    Money is never written on this row. Every rupee lands as a WalletEntry, so
    the wallet is a ledger you can audit rather than a number that changed for
    reasons nobody recorded. `*_credited_at` here only marks that the entry has
    already been written, so a re-review or a re-imported sheet can't pay twice.
    """

    TYPE_LISTING = "LISTING"
    TYPE_RETURN_CLAIM = "RETURN_CLAIM"
    TYPE_CHOICES = [
        (TYPE_LISTING, "Listing"),
        (TYPE_RETURN_CLAIM, "Return claim"),
    ]

    # Which marketplace the listing goes on. Rates are held per platform, since
    # the work and what it's worth differ between them.
    PLATFORM_MEESHO = "MEESHO"
    PLATFORM_AMAZON = "AMAZON"
    PLATFORM_FLIPKART = "FLIPKART"
    PLATFORM_CHOICES = [
        (PLATFORM_MEESHO, "Meesho"),
        (PLATFORM_AMAZON, "Amazon"),
        (PLATFORM_FLIPKART, "Flipkart"),
    ]

    # Meesho rejects claim videos above this, which is the whole reason the
    # compression step exists in the worker's instructions.
    CLAIM_VIDEO_MAX_MB = 22

    STATUS_ASSIGNED  = "ASSIGNED"    # waiting on the worker
    STATUS_SUBMITTED = "SUBMITTED"   # worker says it's done, waiting on you
    STATUS_APPROVED  = "APPROVED"    # you accepted it — this is what pays
    STATUS_REJECTED  = "REJECTED"    # not acceptable, nothing paid

    STATUS_CHOICES = [
        (STATUS_ASSIGNED,  "To do"),
        (STATUS_SUBMITTED, "Awaiting review"),
        (STATUS_APPROVED,  "Approved"),
        (STATUS_REJECTED,  "Rejected"),
    ]

    OPEN_STATUSES = (STATUS_ASSIGNED, STATUS_SUBMITTED)

    business = models.ForeignKey("accounts.Business", on_delete=models.PROTECT,
                                 related_name="worker_tasks")
    task_type = models.CharField(max_length=20, choices=TYPE_CHOICES, db_index=True)

    title        = models.CharField(max_length=200, blank=True)
    source_link  = models.TextField(blank=True,
                                    help_text="Drive folder with the photo, or the claim video")
    instructions = models.TextField(blank=True)

    # RETURN_CLAIM only: which return this claim is for. This is what lets the
    # uploaded ticket sheet find the task later and release the bonus.
    suborder_no = models.CharField(max_length=100, blank=True, db_index=True)

    platform = models.CharField(max_length=20, choices=PLATFORM_CHOICES,
                                default=PLATFORM_MEESHO, db_index=True)

    # The same brief can go to several people, each doing their own listings and
    # paid for their own. A single FK would have forced you to duplicate the task
    # per person, and then the brief, the link and the rate could drift apart.
    assignees = models.ManyToManyField("accounts.User", related_name="worker_tasks")

    # Values you decide up front, copied into every SKU form on this task.
    #
    # Held as JSON rather than a column per field because they mirror whatever
    # TaskListing carries, and duplicating eight columns just to hold their
    # defaults would mean changing two places every time a field is added.
    # Purely a starting point: the worker can still correct any of them per SKU,
    # since variants genuinely differ.
    listing_defaults = models.JSONField(default=dict, blank=True)

    # Paused work stays visible but takes no new listings — the way to stop a
    # job mid-flight without hiding what has already been done or deleting a
    # task whose listings have already been paid for.
    is_paused = models.BooleanField(default=False, db_index=True)
    paused_at = models.DateTimeField(null=True, blank=True)
    created_by  = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                    blank=True, related_name="worker_tasks_created")

    # LISTING only. When set, every SKU approved on this task is linked to this
    # parent (see task_listing_review) instead of joining the catalogue as a
    # bare, unpriced row — so a whole product's variants inherit its price/tax
    # automatically instead of an admin linking each one by hand afterwards.
    parent_sku = models.ForeignKey(
        "ParentItemPrice", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="worker_tasks", db_column="parent_sku_id",
    )
    # LISTING only. Which saved browser-extension template a worker should use
    # to fill the listing form — purely informational here (the extension
    # applies templates by name/id on its own), so teammates picking up the same
    # brief use the same fields instead of guessing.
    listing_template = models.ForeignKey(
        "ListingTemplate", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="worker_tasks",
    )

    # ── What it pays ───────────────────────────────────────────────────────
    # Rates are copied onto the task at creation rather than read from a
    # setting at payout time: changing your standard rate must not silently
    # re-price work somebody already finished.
    reward_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0,
                                        help_text="LISTING: paid on approval. "
                                                  "RETURN_CLAIM: paid once the claim is up.")
    bonus_amount  = models.DecimalField(max_digits=10, decimal_places=2, default=0,
                                        help_text="RETURN_CLAIM: extra, paid if Meesho approves the claim")

    # ── Progress ───────────────────────────────────────────────────────────
    status = models.CharField(max_length=20, choices=STATUS_CHOICES,
                              default=STATUS_ASSIGNED, db_index=True)

    submitted_sku       = models.CharField(max_length=300, blank=True,
                                           help_text="LISTING: the SKU id the worker created")
    submitted_reference = models.CharField(max_length=200, blank=True,
                                           help_text="RETURN_CLAIM: ticket id / reference")
    submitted_note      = models.TextField(blank=True)
    submitted_at        = models.DateTimeField(null=True, blank=True)
    # Claim work is submitted by one person even when the brief went to several,
    # so the payout has to know who actually did it.
    submitted_by        = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                            blank=True, related_name="worker_tasks_submitted")

    review_comment = models.TextField(blank=True)
    reviewed_by    = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                       blank=True, related_name="worker_tasks_reviewed")
    reviewed_at    = models.DateTimeField(null=True, blank=True)

    # Paid-once guards.
    reward_credited_at = models.DateTimeField(null=True, blank=True)
    bonus_credited_at  = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        db_table = "worker_tasks"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["business", "status"]),
            models.Index(fields=["business", "suborder_no"]),
        ]

    def __str__(self):
        return f"{self.task_type} · {self.platform} · {self.status}"

    @property
    def total_possible(self):
        """What this task pays if everything goes right."""
        return (self.reward_amount or 0) + (self.bonus_amount or 0)

    @property
    def awaiting_bonus(self):
        """Approved claim work whose Meesho outcome hasn't paid out yet."""
        return (
            self.task_type == self.TYPE_RETURN_CLAIM
            and self.status == self.STATUS_APPROVED
            and self.bonus_credited_at is None
            and (self.bonus_amount or 0) > 0
        )


class WalletEntry(models.Model):
    """
    One line of a worker's ledger. Balance is the sum of these, never a stored
    number — a stored balance and a ledger that disagree is a support ticket you
    can't answer.

    Earnings are positive. A settlement does NOT write a negative line; it
    stamps the entries it covers (see `settlement`), so "what have I paid" and
    "what is still owed" are both answerable, and paying someone can never be
    confused with them earning less.
    """

    KIND_LISTING       = "LISTING"        # approved listing task
    KIND_CLAIM_RAISED  = "CLAIM_RAISED"   # claim task accepted
    KIND_CLAIM_BONUS   = "CLAIM_BONUS"    # Meesho approved that claim
    KIND_ADJUSTMENT    = "ADJUSTMENT"     # manual correction, can be negative

    KIND_CHOICES = [
        (KIND_LISTING,      "Listing approved"),
        (KIND_CLAIM_RAISED, "Claim raised"),
        (KIND_CLAIM_BONUS,  "Claim approved bonus"),
        (KIND_ADJUSTMENT,   "Manual adjustment"),
    ]

    business = models.ForeignKey("accounts.Business", on_delete=models.PROTECT,
                                 related_name="wallet_entries")
    user = models.ForeignKey("accounts.User", on_delete=models.PROTECT,
                             related_name="wallet_entries")
    task = models.ForeignKey(WorkerTask, on_delete=models.SET_NULL, null=True, blank=True,
                             related_name="wallet_entries")
    # Listing pay is per SKU, so the ledger points at the exact listing it paid
    # for — "which of my listings earned this" has to be answerable.
    listing = models.ForeignKey("TaskListing", on_delete=models.SET_NULL, null=True, blank=True,
                                related_name="wallet_entries")

    kind   = models.CharField(max_length=20, choices=KIND_CHOICES, db_index=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2,
                                 help_text="INR. Positive is earned; adjustments may be negative.")
    note   = models.TextField(blank=True)

    settlement = models.ForeignKey("WalletSettlement", on_delete=models.SET_NULL, null=True,
                                   blank=True, related_name="entries")

    created_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                   blank=True, related_name="wallet_entries_created")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "wallet_entries"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "settlement"]),
            models.Index(fields=["business", "user"]),
        ]

    def __str__(self):
        return f"{self.user_id} {self.kind} ₹{self.amount}"

    @property
    def is_settled(self):
        return self.settlement_id is not None


class WalletSettlement(models.Model):
    """
    A payout: money actually handed over, and the ledger lines it covers.

    Recorded as its own row rather than a flag on each entry so there is one
    place that says how much was paid, when, and by what means — which is what
    you need when a worker asks about a payment from three weeks ago.
    """

    business = models.ForeignKey("accounts.Business", on_delete=models.PROTECT,
                                 related_name="wallet_settlements")
    user = models.ForeignKey("accounts.User", on_delete=models.PROTECT,
                             related_name="wallet_settlements")

    amount    = models.DecimalField(max_digits=12, decimal_places=2)
    paid_on   = models.DateField(default=timezone.localdate)
    method    = models.CharField(max_length=60, blank=True, help_text="UPI / cash / bank transfer")
    reference = models.CharField(max_length=150, blank=True, help_text="UTR or transaction note")
    note      = models.TextField(blank=True)

    created_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                   blank=True, related_name="wallet_settlements_created")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "wallet_settlements"
        ordering = ["-paid_on", "-created_at"]

    def __str__(self):
        return f"{self.user_id} paid ₹{self.amount} on {self.paid_on}"


class TaskListing(models.Model):
    """
    One SKU created for a listing task.

    A task is a *product*; a listing is one SKU of it. Workers routinely create
    several variants from the same photo set, so the SKU had to stop being a
    single field on the task — otherwise a second variant meant either a second
    task (duplicating the brief and the rate) or overwriting the first.

    Each row is priced and approved on its own, so pay is genuinely per listing
    and rejecting one variant doesn't cost the worker the others.

    `sku_id` is unique per business: the same SKU listed twice is either a
    mistake or two people claiming the same work, and the database is the only
    place that can catch it reliably.
    """

    STATUS_PENDING  = "PENDING"
    STATUS_APPROVED = "APPROVED"
    STATUS_REJECTED = "REJECTED"
    STATUS_CHOICES = [
        (STATUS_PENDING,  "Awaiting review"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_REJECTED, "Rejected"),
    ]

    business = models.ForeignKey("accounts.Business", on_delete=models.PROTECT,
                                 related_name="task_listings")
    task = models.ForeignKey(WorkerTask, on_delete=models.CASCADE, related_name="listings")
    created_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT,
                                   related_name="task_listings")

    sku_id = models.CharField(max_length=300, db_index=True)

    # ── What was listed, as entered by the worker ─────────────────────────
    # Held here rather than on the task because they vary per variant, and
    # because this is the record of what was actually put on the marketplace.
    listing_price          = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True,
                                                 help_text="Selling price on the platform")
    wrong_defective_price  = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True,
                                                 help_text="Price claimed back for a wrong/defective return")
    mrp                    = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    min_settlement_amount  = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True,
                                                 help_text="Lowest settlement worth accepting")
    sku_prefix             = models.CharField(max_length=100, blank=True,
                                              help_text="The agreed prefix this SKU should start with")
    hsn_code               = models.CharField(max_length=20, blank=True, db_index=True)
    tax_percent            = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    notes                  = models.TextField(blank=True)

    # ── Review ────────────────────────────────────────────────────────────
    status         = models.CharField(max_length=20, choices=STATUS_CHOICES,
                                      default=STATUS_PENDING, db_index=True)
    review_comment = models.TextField(blank=True)
    reviewed_by    = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                       blank=True, related_name="task_listings_reviewed")
    reviewed_at    = models.DateTimeField(null=True, blank=True)

    # Stamped when approval registered this SKU in the pricing catalogue, so a
    # re-approval can't create it twice and you can see which SKUs are live.
    added_to_catalog_at = models.DateTimeField(null=True, blank=True)

    # What this listing paid, frozen at approval. Copied from the task so that
    # changing a rate later cannot retroactively alter what somebody was paid.
    reward_amount      = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    reward_credited_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "task_listings"
        ordering = ["-created_at"]
        unique_together = [("business", "sku_id")]
        indexes = [
            models.Index(fields=["task", "status"]),
            models.Index(fields=["created_by", "status"]),
        ]

    def __str__(self):
        return f"{self.sku_id} ({self.status})"

    @property
    def prefix_ok(self):
        """Whether the SKU honours the prefix it was supposed to start with."""
        if not self.sku_prefix:
            return None
        return self.sku_id.lower().startswith(self.sku_prefix.lower())


class PlatformRate(models.Model):
    """
    What a piece of work pays, per platform.

    Kept as its own table so a rate is decided once and stays put until somebody
    changes it — task creation reads the current rate and copies it onto the
    task, and approval copies it again onto the listing. Editing a rate here
    therefore affects only future work, never anything already done.
    """

    business = models.ForeignKey("accounts.Business", on_delete=models.PROTECT,
                                 related_name="platform_rates")
    platform  = models.CharField(max_length=20, choices=WorkerTask.PLATFORM_CHOICES)
    task_type = models.CharField(max_length=20, choices=WorkerTask.TYPE_CHOICES,
                                 default=WorkerTask.TYPE_LISTING)

    # Null = the business-wide standing rate (today's only kind of row). A row
    # with a user set is that person's override, checked first — an admin who
    # wants to pay one worker more (or less) than the rest sets this instead of
    # retyping a rate on every task handed to them.
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, null=True,
                             blank=True, related_name="platform_rates")

    reward_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    bonus_amount  = models.DecimalField(max_digits=10, decimal_places=2, default=0,
                                        help_text="Claim tasks only")

    updated_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                   blank=True, related_name="platform_rates_updated")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "platform_rates"
        ordering = ["platform", "task_type"]
        unique_together = [("business", "platform", "task_type", "user")]

    def __str__(self):
        who = f" for {self.user.username}" if self.user_id else ""
        return f"{self.platform} {self.task_type} ₹{self.reward_amount}{who}"


class TaskDocument(models.Model):
    """
    A how-to the team can refer to — the listing manual, a video walkthrough,
    the claim process. Just titled links, kept in a deliberate order, so the
    answer to "how do I do this" lives next to the work instead of in a chat.
    """

    business = models.ForeignKey("accounts.Business", on_delete=models.PROTECT,
                                 related_name="task_documents")
    title       = models.CharField(max_length=200)
    url         = models.TextField(blank=True)
    description = models.TextField(blank=True)
    # Which platform it explains, or blank for anything.
    platform    = models.CharField(max_length=20, blank=True)
    sort_order  = models.IntegerField(default=0)

    created_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                   blank=True, related_name="task_documents_created")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "task_documents"
        ordering = ["sort_order", "title"]

    def __str__(self):
        return self.title


def _default_packaging_statuses():
    """Callable default — a JSONField must not share one mutable list."""
    return list(BusinessCostSetting.DEFAULT_PACKAGING_STATUSES)


class BusinessCostSetting(models.Model):
    """
    How a business wants its own costs charged against profit.

    Packaging is the case that needs a switch. A box is consumed the moment an
    order is packed, so whether a *returned* or *RTO* order should still carry
    that cost is a judgement about the business, not a fact in the data — one
    owner writes the wasted box off against the return, another only counts
    packaging on orders that actually sold. Rather than hard-code one opinion,
    every outcome is selectable and the owner decides.

    One row per business, created on first read so there is nothing to migrate
    and no null to guard against at the call site.
    """

    DELIVERED = "DELIVERED"
    RETURN    = "RETURN"
    RTO       = "RTO"
    EXCHANGE  = "EXCHANGE"
    CLAIM     = "CLAIM"

    PACKAGING_STATUS_CHOICES = [
        (DELIVERED, "Delivered"),
        (RETURN,    "Returned"),
        (RTO,       "RTO"),
        (EXCHANGE,  "Exchange"),
        (CLAIM,     "Claim"),
    ]
    ALL_PACKAGING_STATUSES = [s for s, _ in PACKAGING_STATUS_CHOICES]

    # Exactly what the app charged before this setting existed, so an existing
    # business sees its numbers unchanged until it deliberately opts in.
    DEFAULT_PACKAGING_STATUSES = [DELIVERED, EXCHANGE, CLAIM]

    business = models.OneToOneField(
        "accounts.Business", on_delete=models.CASCADE, related_name="cost_setting",
    )

    packaging_statuses = models.JSONField(
        default=_default_packaging_statuses,
        help_text="Order outcomes whose packaging cost is deducted from profit.",
    )

    # An exchange goes out twice, so it consumes two boxes. True keeps the
    # behaviour the profit engine has always had; a business that reuses the
    # customer's original packaging can turn it off.
    exchange_uses_two_packets = models.BooleanField(default=True)

    # Meesho's sale figures are GST-inclusive — the listing field is literally
    # `listing_price_incl_taxes`. So the tax owed on a ₹253 sale at 5% is the
    # slice already inside it (253 × 5/105 = ₹12.05), not ₹12.65 added on top.
    # Getting this backwards overstates the GST bill by the rate itself, so it
    # is a switch rather than an assumption.
    sale_price_includes_gst = models.BooleanField(default=True)

    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                   blank=True, related_name="cost_settings_updated")

    class Meta:
        db_table = "business_cost_settings"

    def __str__(self):
        return f"Cost settings for {self.business_id}"

    def charges_packaging_for(self, status_key):
        """Whether an order that ended in `status_key` carries its packaging cost."""
        return (status_key or "").upper() in set(self.packaging_statuses or [])
