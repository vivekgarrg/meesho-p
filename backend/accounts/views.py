from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Business, Membership, User
from .permissions import IsSuperAdmin
from .serializers import (
    BusinessSerializer,
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
