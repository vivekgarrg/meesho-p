from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/businesses/", include("accounts.business_urls")),
    path("api/business/<int:business_id>/", include("meesho_app.urls")),
]
