from rest_framework import serializers
from .models import OrderPayment, AdsCost, ReferralPayment, CompensationRecovery, FinalPrice


class OrderPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderPayment
        fields = "__all__"


class AdsCostSerializer(serializers.ModelSerializer):
    class Meta:
        model = AdsCost
        fields = "__all__"


class ReferralPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReferralPayment
        fields = "__all__"


class CompensationRecoverySerializer(serializers.ModelSerializer):
    class Meta:
        model = CompensationRecovery
        fields = "__all__"
        
class FinalPriceSerializer(serializers.ModelSerializer):
    class Meta:
        model = FinalPrice
        fields = "__all__"
           
