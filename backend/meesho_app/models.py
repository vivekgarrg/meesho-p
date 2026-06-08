from django.db import models

class ParentItemPrice(models.Model):
    item_id = models.CharField(max_length=200, unique=True, primary_key=True)
    item_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    tax_percent = models.IntegerField(null=True, blank=True)
    packaging_cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    final_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    class Meta:
        db_table = "parent_item_price"
        ordering = ["item_id"]
    def __str__(self):
        return self.item_id   

class FinalPrice(models.Model):
    """Purchase price per SKU — used to compute profit vs settlement amount."""

    sku_id = models.CharField(max_length=200, unique=True, primary_key=True)
    item_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    tax_percent = models.IntegerField(null=True, blank=True)
    packaging_cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    parent = models.ForeignKey(ParentItemPrice, on_delete=models.SET_NULL, null=True,
                                    blank=True,
                                    related_name="sku_prices",
                                    db_column="parent_id",
                                )
    final_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = "final_price"
        ordering = ["sku_id"]

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

    class Meta:
        db_table = "ads_cost"
        ordering = ["-deduction_date"]

    def __str__(self):
        return f"Ad: {self.campaign_id} on {self.deduction_date}"


class ReferralPayment(models.Model):
    """Maps to 'Referral Payments' sheet"""

    reward_id = models.CharField(max_length=200, primary_key=True)
    payment_date = models.DateField(null=True, blank=True)
    store_name = models.CharField(max_length=200, null=True, blank=True)
    reason = models.TextField(null=True, blank=True)
    net_referral_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    taxes_gst_tds = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    uploaded_at = models.DateTimeField(auto_now_add=True)

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

    class Meta:
        db_table = "purchase_items"

    def __str__(self):
        return f"{self.parent_sku_id} x{self.quantity} ({'exchange' if self.is_exchange else 'purchase'})"


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

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "label_orders"
        ordering = ["-uploaded_date", "courier_name"]

    def __str__(self):
        return f"{self.order_id} | {self.courier_name} | {self.sku}"