from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Business, Membership, User
from .permissions import IsSuperAdmin
from .serializers import (
    AdminUserSerializer,
    BusinessSerializer,
    ChangePasswordSerializer,
    CustomTokenObtainPairSerializer,
    MembershipSerializer,
    MeSerializer,
)


class LoginView(TokenObtainPairView):
    permission_classes = [AllowAny]
    serializer_class = CustomTokenObtainPairSerializer


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(MeSerializer(request.user).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password(request):
    """Any authenticated user can change their own password."""
    serializer = ChangePasswordSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = request.user
    if not user.check_password(serializer.validated_data["old_password"]):
        return Response({"old_password": "Current password is incorrect."}, status=400)
    user.set_password(serializer.validated_data["new_password"])
    user.save()
    return Response({"detail": "Password updated successfully."})


@api_view(["GET", "POST"])
@permission_classes([IsSuperAdmin])
def user_list(request):
    """Super-admin: list all users or create a new one."""
    if request.method == "GET":
        qs = User.objects.all().order_by("id").prefetch_related("memberships")
        return Response(AdminUserSerializer(qs, many=True).data)

    serializer = AdminUserSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    if User.objects.filter(username=serializer.validated_data["username"]).exists():
        return Response({"username": "A user with that username already exists."}, status=400)
    user = serializer.save()
    return Response(AdminUserSerializer(user).data, status=201)


@api_view(["PUT", "DELETE"])
@permission_classes([IsSuperAdmin])
def user_detail(request, user_id):
    """Super-admin: update a user (role / reset password / profile) or delete."""
    target = User.objects.filter(pk=user_id).first()
    if target is None:
        return Response({"error": "User not found."}, status=404)

    if request.method == "DELETE":
        if target.pk == request.user.pk:
            return Response({"error": "You cannot delete your own account."}, status=400)
        target.delete()
        return Response(status=204)

    serializer = AdminUserSerializer(target, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    # Guard: don't let an admin demote the last remaining super admin.
    new_role = serializer.validated_data.get("role", target.role)
    if (
        target.role == User.ROLE_SUPER_ADMIN
        and new_role != User.ROLE_SUPER_ADMIN
        and User.objects.filter(role=User.ROLE_SUPER_ADMIN).count() <= 1
    ):
        return Response({"role": "Cannot demote the only super admin."}, status=400)
    user = serializer.save()
    return Response(AdminUserSerializer(user).data)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def business_list(request):
    if request.method == "GET":
        if request.user.role == User.ROLE_SUPER_ADMIN:
            qs = Business.objects.filter(is_active=True)
        else:
            qs = Business.objects.filter(memberships__user=request.user, is_active=True)
        return Response(BusinessSerializer(qs, many=True).data)

    if request.user.role != User.ROLE_SUPER_ADMIN:
        return Response({"error": "Only a super admin can create businesses."}, status=403)
    serializer = BusinessSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save(created_by=request.user)
    return Response(serializer.data, status=201)


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def business_detail(request, business_id):
    if request.user.role == User.ROLE_SUPER_ADMIN:
        business = Business.objects.filter(pk=business_id).first()
    else:
        business = Business.objects.filter(pk=business_id, memberships__user=request.user).first()
    if business is None:
        return Response({"error": "Business not found."}, status=404)

    if request.method == "GET":
        return Response(BusinessSerializer(business).data)

    if request.user.role != User.ROLE_SUPER_ADMIN:
        return Response({"error": "Only a super admin can edit a business."}, status=403)
    serializer = BusinessSerializer(business, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def membership_create(request, business_id):
    business = Business.objects.filter(pk=business_id).first()
    if business is None:
        return Response({"error": "Business not found."}, status=404)

    if request.method == "GET":
        is_member = Membership.objects.filter(user=request.user, business=business).exists()
        if request.user.role != User.ROLE_SUPER_ADMIN and not is_member:
            return Response({"error": "Business not found."}, status=404)
        memberships = Membership.objects.filter(business=business).select_related("user")
        return Response(MembershipSerializer(memberships, many=True).data)

    if request.user.role != User.ROLE_SUPER_ADMIN:
        return Response({"error": "Only a super admin can assign users to a business."}, status=403)

    target_user = User.objects.filter(pk=request.data.get("user_id")).first()
    if target_user is None:
        return Response({"error": "User not found."}, status=404)

    serializer = MembershipSerializer(
        data={"business_id": business_id}, context={"target_user": target_user}
    )
    serializer.is_valid(raise_exception=True)
    serializer.save(user=target_user, business=business)
    return Response(serializer.data, status=201)


@api_view(["DELETE"])
@permission_classes([IsSuperAdmin])
def membership_delete(request, business_id, membership_id):
    """Super-admin: remove a user's membership from a business."""
    membership = Membership.objects.filter(pk=membership_id, business_id=business_id).first()
    if membership is None:
        return Response({"error": "Membership not found."}, status=404)
    membership.delete()
    return Response(status=204)
