from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

urlpatterns = [
    path("login/", views.LoginView.as_view(), name="login"),
    # Public: the landing-page signup form.
    path("leads/", views.lead_create, name="lead_create"),
    path("leads/list/", views.lead_list, name="lead_list"),
    path("leads/<int:pk>/", views.lead_detail, name="lead_detail"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("me/", views.me, name="me"),
    path("change-password/", views.change_password, name="change_password"),
    # What the caller may see (read: any user, write: super admin sets the global default)
    path("nav-visibility/", views.nav_visibility, name="nav_visibility"),
    # Per-business and per-user access rules (super admin only)
    path("nav-access/", views.nav_access, name="nav_access"),
    # Super-admin user management
    path("users/", views.user_list, name="user_list"),
    path("users/<int:user_id>/", views.user_detail, name="user_detail"),
    path("users/<int:user_id>/businesses/", views.user_businesses, name="user_businesses"),
]
