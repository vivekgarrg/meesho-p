"""
Extension download routes.

Kept out of meesho_app/urls.py because those are all mounted under
/api/business/<id>/ and are business-scoped; downloading the client is neither.
"""

from django.urls import path

from . import extension_views

urlpatterns = [
    path("info/", extension_views.extension_info, name="extension_info"),
    path("download/", extension_views.extension_download, name="extension_download"),
]
