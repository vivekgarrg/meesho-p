from django.urls import path
from . import views

urlpatterns = [
    path("upload/", views.upload_excel, name="upload_excel"),
    path("profit/", views.profit_summary, name="profit_summary"),
    path("orders/", views.order_payments_list, name="order_payments_list"),
    path("orders/status-breakdown/", views.order_status_breakdown, name="order_status_breakdown"),
    path("ads/", views.ads_cost_list, name="ads_cost_list"),
    path("referrals/", views.referral_list, name="referral_list"),
    path("compensation/", views.compensation_recovery_list, name="compensation_recovery_list"),
    path("final-prices/", views.final_price_list, name="final_price_list"),
    path("final-prices/upload/", views.upload_final_price, name="upload_final_price"),
    path("final-prices/<str:sku_id>/", views.final_price_detail, name="final_price_detail"),
]
