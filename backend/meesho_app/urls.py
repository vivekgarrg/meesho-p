from django.urls import path
from . import views

urlpatterns = [
    path("upload/", views.upload_excel, name="upload_excel"),
    path("profit/available-months/", views.available_months, name="available_months"),
    path("profit/", views.profit_summary, name="profit_summary"),
    path("orders/", views.order_payments_list, name="order_payments_list"),
    path("orders/status-breakdown/", views.order_status_breakdown, name="order_status_breakdown"),
    path("orders/unsettled/", views.unsettled_orders, name="unsettled_orders"),
    path("ads/", views.ads_cost_list, name="ads_cost_list"),
    path("referrals/", views.referral_list, name="referral_list"),
    path("compensation/", views.compensation_recovery_list, name="compensation_recovery_list"),
    path("parent-prices/", views.parent_price_list, name="parent_price_list"),
    path("parent-prices/<str:item_id>/", views.parent_price_detail, name="parent_item_pricing"),
    path("parent-linking/", views.parent_linking_to_sku, name="parent_linking"),
    path("final-prices/", views.final_price_list, name="final_price_list"),
    path("final-prices/upload/", views.upload_final_price, name="upload_final_price"),
    path("final-prices/<str:sku_id>/", views.final_price_detail, name="final_price_detail"),
    path("upload-orders/", views.upload_orders_csv, name="upload_orders"),
    path("full-orders/", views.full_orders_list, name="full_orders_list"),
    path("full-orders/analytics/", views.full_orders_analytics, name="full_orders_analytics"),
    path("dashboard/", views.dashboard_analytics, name="dashboard_analytics"),
    path("labels/parse/",            views.upload_labels_pdf,         name="upload_labels_pdf"),
    path("labels/orders/",           views.label_orders_list,         name="label_orders_list"),
    path("labels/summary/",          views.label_couriers_summary,    name="label_couriers_summary"),
    path("labels/duplicates/",       views.label_duplicate_customers, name="label_duplicate_customers"),
    path("labels/customer-history/", views.label_customer_history,    name="label_customer_history"),
    # Fraud & Blocked Customers
    path("fraud-customers/",                  views.fraud_customers,          name="fraud_customers"),
    path("blocked-customers/",                views.blocked_customers_list,   name="blocked_customers_list"),
    path("blocked-customers/<int:bc_id>/",    views.blocked_customer_detail,  name="blocked_customer_detail"),
    # Purchases & Inventory
    path("purchases/",              views.purchases_list,   name="purchases_list"),
    path("purchases/<int:bill_id>/",     views.purchase_detail, name="purchase_detail"),
    path("purchases/<int:bill_id>/pdf/", views.purchase_pdf,    name="purchase_pdf"),
    path("inventory/",              views.inventory_view,   name="inventory_view"),
]
