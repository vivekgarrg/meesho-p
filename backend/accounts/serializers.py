from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import MAX_BUSINESSES_PER_USER, Business, Membership, User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "role"]


class BusinessSerializer(serializers.ModelSerializer):
    class Meta:
        model = Business
        fields = ["id", "name", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class MembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    business = BusinessSerializer(read_only=True)
    business_id = serializers.PrimaryKeyRelatedField(
        source="business", queryset=Business.objects.all(), write_only=True
    )

    class Meta:
        model = Membership
        fields = ["id", "user", "business", "business_id", "created_at"]
        read_only_fields = ["id", "user", "created_at"]

    def validate(self, attrs):
        user = attrs.get("user") or self.context.get("target_user")
        if user is None:
            raise serializers.ValidationError("A target user is required.")
        if user.role == User.ROLE_BUSINESS_USER:
            existing = Membership.objects.filter(user=user).count()
            if existing >= MAX_BUSINESSES_PER_USER:
                raise serializers.ValidationError(
                    f"This user already belongs to the maximum of {MAX_BUSINESSES_PER_USER} businesses."
                )
        return attrs


class MeSerializer(serializers.ModelSerializer):
    businesses = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "role", "businesses"]

    def get_businesses(self, obj):
        if obj.role == User.ROLE_SUPER_ADMIN:
            qs = Business.objects.filter(is_active=True)
        else:
            qs = Business.objects.filter(memberships__user=obj, is_active=True)
        return BusinessSerializer(qs, many=True).data


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        return token
