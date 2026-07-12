from django.urls import path

from . import views

urlpatterns = [
    path("", views.business_list, name="business_list"),
    path("<int:business_id>/", views.business_detail, name="business_detail"),
    path("<int:business_id>/memberships/", views.membership_create, name="membership_create"),
]
