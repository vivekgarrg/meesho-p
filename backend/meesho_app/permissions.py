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
