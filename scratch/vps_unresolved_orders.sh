python3 manage.py shell -c "
from accounts.models import Business
from meesho_app.models import Order, OrderPayment
from collections import defaultdict

business = Business.objects.filter(name__icontains='Cosmify').first()
ord_qs = Order.objects.filter(business=business, order_date__gte='2026-08-01', order_date__lte='2026-08-31')
sub_orders = set(ord_qs.values_list('sub_order_no', flat=True))

qs = OrderPayment.objects.filter(business=business, sub_order_no__in=sub_orders)
status_map = defaultdict(set)
for so, st in qs.values_list('sub_order_no', 'live_order_status'):
    s = (st or '').strip()
    if s:
        status_map[so].add(s)

paid = set(qs.values_list('sub_order_no', flat=True))
print('order-table sub_orders in range:', len(sub_orders))
print('sub_orders with >=1 OrderPayment row:', len(paid))

RESOLVED = {'Delivered', 'Return', 'RTO', 'Exchange'}
unresolved = {so: sorted(status_map.get(so, set())) for so in paid if not (status_map.get(so, set()) & RESOLVED)}
print('unresolved count:', len(unresolved))
for so, sts in sorted(unresolved.items()):
    print(so, '|', ','.join(sts) if sts else '(no status text on any row)')
"
