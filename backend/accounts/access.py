"""
Resolving *what a given person can see*, in one place.

Three levels of configuration, most specific first:

  1. the user's own rule      (UserAccess.visible_paths)
  2. their business's rule    (BusinessProfile.visible_paths)
  3. the global default       (NavVisibilitySetting.visible_paths)

An empty list at any level means "not configured, ask the next level". If none of
the three is configured, nothing is restricted — a fresh install behaves exactly
as it did before any of this existed.
"""

from .models import BusinessProfile, NavVisibilitySetting, User, UserAccess
from .nav import clean_paths, owners_for_api_path

SOURCE_USER = "user"
SOURCE_BUSINESS = "business"
SOURCE_GLOBAL = "global"
SOURCE_NONE = "none"


def user_rule(user):
    """The user's own override, or [] when they have none."""
    access = getattr(user, "access", None)
    return clean_paths(access.visible_paths) if access else []


def business_rule(business):
    """A business's override, or [] when it has none."""
    if business is None:
        return []
    profile = getattr(business, "profile", None)
    return clean_paths(profile.visible_paths) if profile else []


def global_rule():
    return clean_paths(NavVisibilitySetting.get_solo().visible_paths)


def resolve_visible_paths(user, business=None):
    """
    Returns (paths, source).

    `paths` is None when nothing restricts this user — callers must treat that as
    "everything allowed" rather than as an empty list.
    """
    # Super admins are never restricted. They administer the rules, so applying a
    # business-level rule to them would lock whoever set it out of most of the app
    # (including, in a bad case, the screen needed to undo it). Restricting an
    # individual is what business_user accounts are for.
    if user is not None and getattr(user, "role", None) == User.ROLE_SUPER_ADMIN:
        return None, SOURCE_NONE

    paths = user_rule(user)
    if paths:
        return paths, SOURCE_USER

    paths = business_rule(business)
    if paths:
        return paths, SOURCE_BUSINESS

    paths = global_rule()
    if paths:
        return paths, SOURCE_GLOBAL

    return None, SOURCE_NONE


def can_view_path(user, business, nav_path):
    allowed, _ = resolve_visible_paths(user, business)
    return allowed is None or nav_path in allowed


def api_access_denied(user, business, sub_path):
    """
    The reason to refuse this API call, or None to allow it.

    `sub_path` is the part of the URL after /api/business/<id>/. Endpoints with no
    declared owner are always allowed — see nav.API_OWNERSHIP for why.
    """
    owners = owners_for_api_path(sub_path)
    if not owners:
        return None

    allowed, _ = resolve_visible_paths(user, business)
    if allowed is None:
        return None
    if any(owner in allowed for owner in owners):
        return None

    return "This area is not enabled for your account."


# ── Admin-side helpers ───────────────────────────────────────────────────────

def set_user_rule(user, paths, updated_by=None):
    access, _ = UserAccess.objects.get_or_create(user=user)
    access.visible_paths = clean_paths(paths)
    access.updated_by = updated_by
    access.save()
    # Django caches reverse one-to-ones, so point the caller's `user` at the row
    # we just wrote — otherwise resolve_visible_paths() would read the old value.
    user.access = access
    return access.visible_paths


def set_business_rule(business, paths, updated_by=None):
    profile, _ = BusinessProfile.objects.get_or_create(business=business)
    profile.visible_paths = clean_paths(paths)
    profile.save(update_fields=["visible_paths", "updated_at"])
    business.profile = profile   # same cache invalidation as above
    return profile.visible_paths


def set_global_rule(paths, updated_by=None):
    setting = NavVisibilitySetting.get_solo()
    setting.visible_paths = clean_paths(paths)
    setting.updated_by = updated_by
    setting.save()
    return setting.visible_paths
