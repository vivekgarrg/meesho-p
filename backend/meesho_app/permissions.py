from rest_framework.exceptions import NotFound, PermissionDenied

from accounts.models import Business, Membership, User


def get_authorized_business(request, business_id):
    """
    Call at the top of every business-scoped view in meesho_app.

    Returns the Business instance if request.user may access it. Raises
    NotFound if the business doesn't exist (or is inactive), or
    PermissionDenied if the user has no membership in it (and isn't a
    super_admin). A wrong business_id for a real business intentionally
    raises the same NotFound a nonexistent id would, so a business_user
    can't distinguish "not yours" from "doesn't exist".
    """
    try:
        business = Business.objects.get(pk=business_id, is_active=True)
    except Business.DoesNotExist:
        raise NotFound("Business not found.")

    user = request.user
    if user.role == User.ROLE_SUPER_ADMIN:
        return business
    if Membership.objects.filter(user=user, business=business).exists():
        return business
    raise NotFound("Business not found.")
