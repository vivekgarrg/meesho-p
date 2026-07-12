from rest_framework.permissions import BasePermission

from .models import User


class IsSuperAdmin(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == User.ROLE_SUPER_ADMIN
        )
