from django.contrib import admin
from django.urls import path, include, re_path
from django.views.generic import TemplateView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/businesses/", include("accounts.business_urls")),
    path("api/business/<int:business_id>/", include("meesho_app.urls")),
    re_path(r"^(?!api/|admin/).*$", TemplateView.as_view(template_name="index.html"), name="spa"),
]
