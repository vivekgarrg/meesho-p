from django.contrib import admin
from django.urls import path, include, re_path
from django.views.generic import TemplateView
from django.views.generic.base import RedirectView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/businesses/", include("accounts.business_urls")),
    path("api/business/<int:business_id>/", include("meesho_app.urls")),
    # Browser-extension download (unauthenticated: public client code, and a
    # plain download link cannot send a JWT header).
    path("api/extension/", include("meesho_app.extension_urls")),
    # Browsers and crawlers ask for /favicon.ico at the root regardless of what
    # the HTML declares. Without this the SPA catch-all answers with index.html,
    # so the tab shows a blank icon and link checkers report an HTML favicon.
    path("favicon.ico", RedirectView.as_view(url="/static/frontend/favicon.ico", permanent=True)),
    re_path(r"^(?!api/|admin/|static/).*$", TemplateView.as_view(template_name="index.html"), name="spa"),
]
