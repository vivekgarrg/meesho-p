from rest_framework import serializers
from .models import OrderPayment, AdsCost, ReferralPayment, CompensationRecovery, FinalPrice, ParentItemPrice, ParentPriceHistory, Order, LabelOrder


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
    class Meta:
        model = FinalPrice
        fields = "__all__"
        read_only_fields = ["business"]
        
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
