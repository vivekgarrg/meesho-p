import re

from rest_framework.exceptions import NotFound, PermissionDenied

from accounts.access import api_access_denied
from accounts.models import Business, Membership, User

# /api/business/<id>/<the part we care about>
_SUB_PATH_RE = re.compile(r"^/api/business/\d+/(?P<sub>.*)$")


def _api_sub_path(request):
    """The endpoint path with the /api/business/<id>/ prefix stripped."""
    match = _SUB_PATH_RE.match(request.path or "")
    return match.group("sub") if match else ""


def accessible_businesses(request, include=None):
    """
    Every active business this user may read, for the screens that pool across
    them (scanning, returns, labels).

    Pooling exists because one desk packs and receives parcels for several
    businesses at once: a scanned code that belongs to a sibling business should
    resolve, not read as "unrecognised". It is deliberately limited to
    memberships the user already has, so pooling can never widen what someone can
    see — it only saves them switching business to find something they were
    always allowed to look at.

    `include` guarantees the currently-selected business is in the list even if
    the membership query somehow misses it (a super admin looking at a business
    they aren't a member of).
    """
    user = request.user
    if user.role == User.ROLE_SUPER_ADMIN:
        qs = Business.objects.filter(is_active=True)
    else:
        qs = Business.objects.filter(memberships__user=user, is_active=True).distinct()

    businesses = list(qs)
    if include is not None and not any(b.pk == include.pk for b in businesses):
        businesses.append(include)
    return businesses


def get_authorized_business(request, business_id):
    """
    Call at the top of every business-scoped view in meesho_app.

    Returns the Business instance if request.user may access it. Raises
    NotFound if the business doesn't exist (or is inactive), or
    PermissionDenied if the user has no membership in it (and isn't a
    super_admin). A wrong business_id for a real business intentionally
    raises the same NotFound a nonexistent id would, so a business_user
    can't distinguish "not yours" from "doesn't exist".

    It is also where per-user / per-business area restrictions are enforced.
    Every business-scoped endpoint already funnels through here, so checking in
    one place means a hidden tab is genuinely unreachable rather than just
    missing from the sidebar. Endpoints shared by many screens are left
    unguarded on purpose — see accounts.nav.API_OWNERSHIP.
    """
    try:
        business = Business.objects.get(pk=business_id, is_active=True)
    except Business.DoesNotExist:
        raise NotFound("Business not found.")

    user = request.user
    is_member = (
        user.role == User.ROLE_SUPER_ADMIN
        or Membership.objects.filter(user=user, business=business).exists()
    )
    if not is_member:
        raise NotFound("Business not found.")

    denial = api_access_denied(user, business, _api_sub_path(request))
    if denial:
        raise PermissionDenied(denial)

    return business
