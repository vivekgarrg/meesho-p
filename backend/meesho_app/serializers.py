from rest_framework import serializers
from .models import OrderPayment, AdsCost, ReferralPayment, CompensationRecovery, FinalPrice, ParentItemPrice, ParentPriceHistory, Order, LabelOrder, ReturnDelivery, ScannedOrder


class OrderPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderPayment
        fields = "__all__"
        read_only_fields = ["business"]


class AdsCostSerializer(serializers.ModelSerializer):
    class Meta:
        model = AdsCost
        fields = "__all__"
        read_only_fields = ["business"]


class ReferralPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReferralPayment
        fields = "__all__"
        read_only_fields = ["business"]


class CompensationRecoverySerializer(serializers.ModelSerializer):
    class Meta:
        model = CompensationRecovery
        fields = "__all__"
        read_only_fields = ["business"]
        
class FinalPriceSerializer(serializers.ModelSerializer):
    # parent is now a surrogate-keyed FK; expose/consume it as the parent's
    # item_id string so the API contract (and the frontend) is unchanged.
    # Writes are resolved to the ParentItemPrice object in the view.
    parent = serializers.SerializerMethodField()

    class Meta:
        model = FinalPrice
        fields = "__all__"
        read_only_fields = ["business"]

    def get_parent(self, obj):
        return obj.parent.item_id if obj.parent_id else None
        
class ParentPriceHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ParentPriceHistory
        fields = "__all__"
        read_only_fields = ["business"]


class ParentItemPriceSerializer(serializers.ModelSerializer):
    sku_ids = serializers.SlugRelatedField(
        source="sku_prices",
        many=True,
        read_only=True,
        slug_field="sku_id",
    )
    price_history = ParentPriceHistorySerializer(many=True, read_only=True)

    class Meta:
        model = ParentItemPrice
        fields = "__all__"
        read_only_fields = ["business"]


class OrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = Order
        fields = "__all__"
        read_only_fields = ["business"]


class LabelOrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = LabelOrder
        fields = "__all__"
        read_only_fields = ["business"]


class ReturnDeliverySerializer(serializers.ModelSerializer):
    """
    Adds the derived claim-window fields the UI counts down on. They are
    computed per request (never stored) so the countdown is always relative
    to today rather than to whenever the row was last saved.
    """
    claim_deadline = serializers.DateField(read_only=True)
    days_left      = serializers.SerializerMethodField()
    day_of_window  = serializers.SerializerMethodField()
    claim_urgency  = serializers.SerializerMethodField()
    claim_window_days = serializers.IntegerField(source="CLAIM_WINDOW_DAYS", read_only=True)

    class Meta:
        model = ReturnDelivery
        fields = "__all__"
        read_only_fields = ["business", "uploaded_at", "updated_at"]

    def get_days_left(self, obj):
        return obj.days_left()

    def get_day_of_window(self, obj):
        return obj.day_of_window()

    def get_claim_urgency(self, obj):
        return obj.claim_urgency()


class ScannedOrderSerializer(serializers.ModelSerializer):
    """
    A recorded scan. `scanned_by_name` is flattened onto the row so the table can
    show who scanned it without the client resolving user ids.

    `meesho_status` is *not* set here — it is looked up in bulk by the view for a
    whole page of rows at once, because resolving it per row would be a query per
    row. The field is declared so it always appears in the payload (null when the
    view has nothing to attach).
    """
    scanned_by_name = serializers.CharField(source="scanned_by.username", read_only=True, default=None)
    scan_date       = serializers.DateField(read_only=True)
    meesho_status   = serializers.SerializerMethodField()

    class Meta:
        model = ScannedOrder
        fields = "__all__"
        read_only_fields = [
            "business", "scan_count", "first_scanned_at", "last_scanned_at",
            "updated_at", "matched_from",
        ]

    def get_meesho_status(self, obj):
        # Attached by the view (see _meesho_status_map) — absent means "unknown".
        return getattr(obj, "meesho_status", None)
