#!/usr/bin/env bash
# Read-only diagnostic — run on the VPS as the `deploy` user:
#   bash scratch/vps_diagnostic.sh
# (or paste the manage.py shell -c block below directly). Makes no writes.
set -euo pipefail

cd ~/meesho-p/backend
source .venv/bin/activate
set -a
source ../deploy/hostinger/.env
set +a

echo "==> Deployed commit"
git -C ~/meesho-p log -1 --oneline

echo "==> Diagnostic (Cosmify Mart / business named below, August 2026)"
python3 manage.py shell -c "
import json
from datetime import datetime
from rest_framework.test import APIRequestFactory, force_authenticate
from django.utils import timezone
from collections import defaultdict, Counter
from accounts.models import Business, User
from meesho_app.models import OrderPayment, BusinessCostSetting
from meesho_app import views

# Adjust this if the business name/id differs on prod.
business = Business.objects.filter(name__icontains='Cosmify').first()
print('business:', business.id, business.name)

user = User.objects.filter(role='super_admin').first()
factory = APIRequestFactory()
req = factory.get('/api/business/%d/profit/' % business.id, {'date_from': '2026-08-01', 'date_to': '2026-08-31'})
force_authenticate(req, user=user)
resp = views.profit_summary(req, business_id=business.id)
d = dict(resp.data)
print('--- order_summary (per bucket) ---')
for k, v in d['order_summary'].items():
    print(k, {kk: str(vv) for kk, vv in v.items()})
print('order_count', d['order_count'])
print('net_profit_loss', d['net_profit_loss'])
print('gross_revenue', d['gross_revenue'])
print('total_settled', d['total_settled'])
print('orders_missing_price', d['orders_missing_price'])
print('orders_missing_sku', d['orders_missing_sku'])

cs, _ = BusinessCostSetting.objects.get_or_create(business=business)
print('--- cost setting ---')
print('packaging_statuses', cs.packaging_statuses)
print('exchange_uses_two_packets', cs.exchange_uses_two_packets)
print('sale_price_includes_gst', cs.sale_price_includes_gst)

start = timezone.make_aware(datetime(2026, 8, 1))
end = timezone.make_aware(datetime(2026, 9, 1))
qs = OrderPayment.objects.filter(business=business, order_date__gte=start, order_date__lt=end)
print('--- raw row counts (Aug 2026) ---')
print('total rows:', qs.count())
print('distinct sub_orders:', qs.values('sub_order_no').distinct().count())
print('status value counts:', Counter((st or '').strip() for st in qs.values_list('live_order_status', flat=True)))
"
