from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import MAX_BUSINESSES_PER_USER, Business, Membership, NavVisibilitySetting, User
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


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def nav_visibility(request):
    """Global sidebar tab visibility.

    GET  (any authenticated user): returns the configured visible paths so the
         sidebar can filter itself. `configured` is False when no admin has set
         a list yet, in which case the frontend shows every tab.
    PUT  (super admin only): replace the visible-paths list.
    """
    setting = NavVisibilitySetting.get_solo()

    if request.method == "GET":
        return Response({
            "visible_paths": setting.visible_paths or [],
            "configured": bool(setting.visible_paths),
        })

    if not request.user.is_super_admin:
        return Response(
            {"error": "Only a super admin can change sidebar visibility."}, status=403
        )

    paths = request.data.get("visible_paths", [])
    if not isinstance(paths, list) or not all(isinstance(p, str) for p in paths):
        return Response({"error": "visible_paths must be a list of strings."}, status=400)

    # De-dupe while preserving order.
    seen = set()
    clean = []
    for p in paths:
        p = p.strip()
        if p and p not in seen:
            seen.add(p)
            clean.append(p)

    setting.visible_paths = clean
    setting.updated_by = request.user
    setting.save()
    return Response({"visible_paths": setting.visible_paths, "configured": bool(setting.visible_paths)})


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

    # Optional: assign the new user to businesses in the same step. Super admins
    # implicitly see every business, so assignment only applies to business users.
    business_ids = request.data.get("business_ids") or []
    if user.role == User.ROLE_BUSINESS_USER and business_ids:
        if len(business_ids) > MAX_BUSINESSES_PER_USER:
            business_ids = business_ids[:MAX_BUSINESSES_PER_USER]
        valid = Business.objects.filter(pk__in=business_ids)
        for biz in valid:
            Membership.objects.get_or_create(user=user, business=biz)

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

    # Guard: suspending a user (is_active → False) revokes all access — block the
    # cases that would lock everyone out.
    new_is_active = serializer.validated_data.get("is_active", target.is_active)
    if target.is_active and not new_is_active:
        if target.pk == request.user.pk:
            return Response({"is_active": "You cannot suspend your own account."}, status=400)
        if (
            target.role == User.ROLE_SUPER_ADMIN
            and User.objects.filter(role=User.ROLE_SUPER_ADMIN, is_active=True).count() <= 1
        ):
            return Response({"is_active": "Cannot suspend the only active super admin."}, status=400)

    user = serializer.save()
    return Response(AdminUserSerializer(user).data)


@api_view(["PUT"])
@permission_classes([IsSuperAdmin])
def user_businesses(request, user_id):
    """Super-admin: replace the full set of businesses a business user can manage.

    Body: {"business_ids": [1, 2, ...]}. Adds any new memberships and removes the
    ones no longer listed, so the frontend can present a checklist and just save.
    """
    target = User.objects.filter(pk=user_id).first()
    if target is None:
        return Response({"error": "User not found."}, status=404)
    if target.role == User.ROLE_SUPER_ADMIN:
        return Response(
            {"error": "Super admins already have access to every business."}, status=400
        )

    raw = request.data.get("business_ids", [])
    if not isinstance(raw, list):
        return Response({"error": "business_ids must be a list."}, status=400)
    try:
        requested = {int(i) for i in raw}
    except (TypeError, ValueError):
        return Response({"error": "business_ids must be integers."}, status=400)

    if len(requested) > MAX_BUSINESSES_PER_USER:
        return Response(
            {"business_ids": f"A business user can belong to at most {MAX_BUSINESSES_PER_USER} businesses."},
            status=400,
        )

    valid = set(Business.objects.filter(pk__in=requested).values_list("id", flat=True))
    current = set(Membership.objects.filter(user=target).values_list("business_id", flat=True))

    for bid in valid - current:
        Membership.objects.get_or_create(user=target, business_id=bid)
    to_remove = current - valid
    if to_remove:
        Membership.objects.filter(user=target, business_id__in=to_remove).delete()

    return Response(AdminUserSerializer(target).data)


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
