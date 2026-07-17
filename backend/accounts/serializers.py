from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import MAX_BUSINESSES_PER_USER, Business, Membership, User


class UserSerializer(serializers.ModelSerializer):
    business_ids = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "role", "business_ids"]

    def get_business_ids(self, obj):
        return list(obj.memberships.values_list("business_id", flat=True))


class AdminUserSerializer(serializers.ModelSerializer):
    """Create / update users from the super-admin panel."""

    password = serializers.CharField(write_only=True, required=False, allow_blank=False, min_length=4)
    business_ids = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "role", "password", "business_ids"]

    def get_business_ids(self, obj):
        return list(obj.memberships.values_list("business_id", flat=True))

    def validate_role(self, value):
        if value not in (User.ROLE_SUPER_ADMIN, User.ROLE_BUSINESS_USER):
            raise serializers.ValidationError("Invalid role.")
        return value

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        if not password:
            raise serializers.ValidationError({"password": "Password is required for a new user."})
        role = validated_data.get("role", User.ROLE_BUSINESS_USER)
        user = User(**validated_data)
        user.role = role
        if role == User.ROLE_SUPER_ADMIN:
            user.is_staff = True
            user.is_superuser = True
        user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if instance.role == User.ROLE_SUPER_ADMIN:
            instance.is_staff = True
            instance.is_superuser = True
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=4)


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
