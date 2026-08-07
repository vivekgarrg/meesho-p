from rest_framework.decorators import (api_view, authentication_classes,
                                       permission_classes, throttle_classes)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework import status
from rest_framework_simplejwt.views import TokenObtainPairView

from . import nav
from .access import (
    business_rule,
    global_rule,
    resolve_visible_paths,
    set_business_rule,
    set_global_rule,
    set_user_rule,
    user_rule,
)
from .models import MAX_BUSINESSES_PER_USER, Business, Lead, Membership, NavVisibilitySetting, User
from .permissions import IsSuperAdmin
from .serializers import (
    AdminUserSerializer,
    BusinessSerializer,
    ChangePasswordSerializer,
    CustomTokenObtainPairSerializer,
    MembershipSerializer,
    MeSerializer,
    LeadSerializer,
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


def _validate_paths(raw):
    """(clean_list, error_response) — one shared validator for every scope."""
    if not isinstance(raw, list) or not all(isinstance(p, str) for p in raw):
        return None, Response({"error": "visible_paths must be a list of strings."}, status=400)
    bad = nav.unknown_paths(raw)
    if bad:
        return None, Response(
            {"error": f"Unknown nav path(s): {', '.join(bad)}"}, status=400
        )
    return nav.clean_paths(raw), None


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def nav_visibility(request):
    """
    What the signed-in user is allowed to see.

    GET  (any authenticated user): the *resolved* set of areas — their own rule,
         else their business's, else the global default. Pass ?business=<id> so
         the answer reflects the business they're currently looking at, since a
         user can belong to several with different rules. `configured` is False
         when nothing restricts them, in which case the frontend shows every tab.
    PUT  (super admin only): replace the global default. Per-business and
         per-user rules live on /nav-access/.
    """
    if request.method == "GET":
        business = None
        raw_id = request.query_params.get("business")
        if raw_id:
            try:
                business = Business.objects.filter(pk=int(raw_id), is_active=True).first()
            except (TypeError, ValueError):
                business = None
            # Only honour a business the caller actually belongs to, so the
            # business id in the query string can't be used to probe other
            # tenants' configuration.
            if business and not request.user.is_super_admin:
                if not Membership.objects.filter(user=request.user, business=business).exists():
                    business = None

        paths, source = resolve_visible_paths(request.user, business)
        return Response({
            "visible_paths": paths if paths is not None else [],
            "configured": paths is not None,
            "source": source,
            "business": business.id if business else None,
        })

    if not request.user.is_super_admin:
        return Response(
            {"error": "Only a super admin can change sidebar visibility."}, status=403
        )

    clean, error = _validate_paths(request.data.get("visible_paths", []))
    if error:
        return error

    set_global_rule(clean, updated_by=request.user)
    return Response({"visible_paths": clean, "configured": bool(clean)})


@api_view(["GET", "PUT"])
@permission_classes([IsSuperAdmin])
def nav_access(request):
    """
    Access rules for every scope, for the Admin Panel.

    GET  returns the catalog of areas plus the current rule for the global
         default, every business and every user, so the screen can show at a
         glance who is restricted and to what.
    PUT  writes one rule: {"scope": "global"|"business"|"user",
                           "target_id": <id, omit for global>,
                           "visible_paths": [...]}
         An empty list clears the rule (falls back to the next level up).
    """
    if request.method == "GET":
        businesses = Business.objects.filter(is_active=True).select_related("profile").order_by("name")
        users = User.objects.all().select_related("access").prefetch_related(
            "memberships__business"
        ).order_by("username")

        g = global_rule()
        return Response({
            "nav_items": nav.NAV_CATALOG,
            "always_visible": nav.ALWAYS_VISIBLE_PATHS,
            "global": {"visible_paths": g, "configured": bool(g)},
            "businesses": [
                {
                    "id": b.id,
                    "name": b.name,
                    "visible_paths": business_rule(b),
                    "configured": bool(business_rule(b)),
                }
                for b in businesses
            ],
            "users": [
                {
                    "id": u.id,
                    "username": u.username,
                    "role": u.role,
                    "visible_paths": user_rule(u),
                    "configured": bool(user_rule(u)),
                    "businesses": [
                        {"id": m.business_id, "name": m.business.name}
                        for m in u.memberships.all()
                    ],
                }
                for u in users
            ],
        })

    scope = (request.data.get("scope") or "").strip()
    clean, error = _validate_paths(request.data.get("visible_paths", []))
    if error:
        return error

    if scope == "global":
        set_global_rule(clean, updated_by=request.user)
        return Response({"scope": scope, "visible_paths": clean, "configured": bool(clean)})

    target_id = request.data.get("target_id")
    if not target_id:
        return Response({"error": "target_id is required for this scope."}, status=400)

    if scope == "business":
        business = Business.objects.filter(pk=target_id).first()
        if not business:
            return Response({"error": "Business not found."}, status=404)
        set_business_rule(business, clean, updated_by=request.user)
        return Response({
            "scope": scope, "target_id": business.id,
            "visible_paths": clean, "configured": bool(clean),
        })

    if scope == "user":
        target = User.objects.filter(pk=target_id).first()
        if not target:
            return Response({"error": "User not found."}, status=404)
        set_user_rule(target, clean, updated_by=request.user)
        return Response({
            "scope": scope, "target_id": target.id,
            "visible_paths": clean, "configured": bool(clean),
        })

    return Response({"error": 'scope must be one of "global", "business", "user".'}, status=400)


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


# ══════════════════════════════════════════════════════════════════════════════
# Public enquiries from the marketing site
# ══════════════════════════════════════════════════════════════════════════════

class LeadThrottle(AnonRateThrottle):
    """A public write endpoint needs a ceiling, or it becomes a spam sink."""
    scope = "leads"


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([LeadThrottle])
def lead_create(request):
    """
    Record a request for access. Public on purpose — this is the signup form on
    the landing page — so it is throttled, size-capped, and carries a honeypot.
    """
    payload = request.data if isinstance(request.data, dict) else {}

    # Bots fill every field they find; a real browser never sees this one.
    if str(payload.get("company_website") or "").strip():
        # Answer as though it worked: telling a bot it was caught only helps it.
        return Response({"success": True}, status=status.HTTP_201_CREATED)

    # Coerced to "" rather than passed through: an absent optional field arrives
    # as None, and a blank=True CharField rejects None even though it accepts "".
    # Every optional field on the form would otherwise 400 the whole submission.
    serializer = LeadSerializer(data={
        k: (str(payload.get(k) or "").strip())[:500] for k in
        ("name", "business_name", "phone", "email", "marketplaces", "monthly_orders", "message")
    })
    serializer.is_valid(raise_exception=True)

    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    ip = (forwarded.split(",")[0].strip() if forwarded
          else request.META.get("REMOTE_ADDR")) or None
    serializer.save(
        source="landing",
        ip_address=ip,
        user_agent=(request.META.get("HTTP_USER_AGENT") or "")[:500],
    )
    return Response({"success": True}, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsSuperAdmin])
def lead_list(request):
    """Enquiries, newest first — the follow-up queue."""
    qs = Lead.objects.all()
    wanted = request.GET.get("status", "").strip().upper()
    if wanted:
        qs = qs.filter(status=wanted)
    rows = list(qs[:500])
    return Response({
        "total": Lead.objects.count(),
        "new": Lead.objects.filter(status=Lead.STATUS_NEW).count(),
        "results": LeadSerializer(rows, many=True).data,
    })


@api_view(["PATCH", "DELETE"])
@permission_classes([IsSuperAdmin])
def lead_detail(request, pk):
    try:
        lead = Lead.objects.get(pk=pk)
    except Lead.DoesNotExist:
        return Response({"error": "Not found."}, status=404)

    if request.method == "DELETE":
        lead.delete()
        return Response({"deleted": True})

    payload = request.data if isinstance(request.data, dict) else {}
    if "status" in payload:
        wanted = str(payload["status"] or "").strip().upper()
        if wanted not in {c[0] for c in Lead.STATUS_CHOICES}:
            return Response({"error": "Unknown status."}, status=400)
        lead.status = wanted
    if "notes" in payload:
        lead.notes = str(payload["notes"] or "").strip()
    lead.save()
    return Response(LeadSerializer(lead).data)
