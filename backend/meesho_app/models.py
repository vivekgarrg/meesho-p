from django.db import models

class FinalPrice(models.Model):
    """Purchase price per SKU — used to compute profit vs settlement amount."""

    sku_id = models.CharField(max_length=200, unique=True, primary_key=True)
    item_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    tax_percent = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    packaging_cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    final_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = "final_price"
        ordering = ["sku_id"]

    def __str__(self):
        return self.sku_id
        

class OrderPayment(models.Model):
    """Maps to 'Order Payments' sheet — one row per sub-order"""

    # Order Related Details
    sub_order_no = models.CharField(max_length=100, primary_key=True)
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
