from django.db import models

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
    Composite unique key: (sub_order_no, payment_date, live_order_status).
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
        unique_together = [("sub_order_no", "payment_date", "live_order_status")]

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
                fields=["deduction_duration", "deduction_date", "campaign_id"],
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
        unique_together = [("sub_order_no", "reason_for_credit_entry", "order_date")]

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
        unique_together = [("customer_name", "customer_pincode")]
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

    serial_no          = models.PositiveIntegerField(unique=True, help_text="Row identifier from the Meesho sheet")
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