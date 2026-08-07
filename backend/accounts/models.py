from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models

MAX_BUSINESSES_PER_USER = 5


class User(AbstractUser):
    ROLE_SUPER_ADMIN = "super_admin"
    ROLE_BUSINESS_USER = "business_user"
    ROLE_CHOICES = [
        (ROLE_SUPER_ADMIN, "Super Admin"),
        (ROLE_BUSINESS_USER, "Business User"),
    ]

    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default=ROLE_BUSINESS_USER)

    @property
    def is_super_admin(self):
        return self.role == self.ROLE_SUPER_ADMIN

    def __str__(self):
        return self.username


class Business(models.Model):
    name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="businesses_created"
    )

    class Meta:
        db_table = "businesses"

    def __str__(self):
        return self.name


class NavVisibilitySetting(models.Model):
    """Global sidebar tab visibility, applied to every user in every business.

    Single-row (singleton) config managed by super admins. `visible_paths` is the
    list of nav item paths that should appear in the sidebar. An empty list is
    treated as "not configured yet" → all tabs are shown (safe default).
    """

    visible_paths = models.JSONField(default=list, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="nav_visibility_updates",
    )

    class Meta:
        db_table = "nav_visibility_setting"

    @classmethod
    def get_solo(cls):
        obj = cls.objects.first()
        if obj is None:
            obj = cls.objects.create(visible_paths=[])
        return obj

    def __str__(self):
        return f"NavVisibility({len(self.visible_paths)} tabs)"


class UserAccess(models.Model):
    """
    Per-user override of which areas of the app that person can reach.

    One row per user, created on demand. An empty `visible_paths` means "no
    override" — the user falls back to their business's rule, and then to the
    global default. That distinction matters: an empty list has to mean
    "unset" rather than "nothing visible", otherwise creating the row would
    lock the user out of everything by accident.

    Kept out of the User model so the auth table stays about authentication.
    """

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="access")
    visible_paths = models.JSONField(default=list, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="user_access_updates",
    )

    class Meta:
        db_table = "user_access"
        verbose_name_plural = "user access"

    def __str__(self):
        return f"Access for {self.user.username} ({len(self.visible_paths)} areas)"


class Membership(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="memberships")
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="memberships")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "memberships"
        unique_together = [("user", "business")]

    def clean(self):
        if self.user.role == User.ROLE_BUSINESS_USER:
            existing = Membership.objects.filter(user=self.user).exclude(pk=self.pk).count()
            if existing >= MAX_BUSINESSES_PER_USER:
                raise ValidationError(
                    f"A business user can belong to at most {MAX_BUSINESSES_PER_USER} businesses."
                )

    def __str__(self):
        return f"{self.user.username} @ {self.business.name}"


class BusinessProfile(models.Model):
    """
    Everything about a business beyond its name and membership list: statutory
    identifiers, contact and address details, and the business-level switches
    that change how its numbers are calculated.

    Kept in its own table rather than piled onto Business so the identity of a
    business (name, active flag, who created it) stays separate from its
    editable profile and preferences. One row per business, created on demand.
    """

    business = models.OneToOneField(
        Business, on_delete=models.CASCADE, related_name="profile",
    )

    # ── Identity ──────────────────────────────────────────────────────────
    legal_name   = models.CharField(max_length=255, blank=True,
                                    help_text="Registered name, if it differs from the display name")
    gstin        = models.CharField(max_length=20, blank=True)
    pan          = models.CharField(max_length=20, blank=True)
    supplier_id  = models.CharField(max_length=50, blank=True,
                                    help_text="Meesho supplier id for this business")

    # ── Contact ───────────────────────────────────────────────────────────
    contact_person = models.CharField(max_length=255, blank=True)
    phone          = models.CharField(max_length=30, blank=True)
    email          = models.EmailField(blank=True)

    # ── Address ───────────────────────────────────────────────────────────
    address_line1 = models.CharField(max_length=255, blank=True)
    address_line2 = models.CharField(max_length=255, blank=True)
    city          = models.CharField(max_length=100, blank=True)
    state         = models.CharField(max_length=100, blank=True)
    pincode       = models.CharField(max_length=10, blank=True)

    # ── Calculation preferences ───────────────────────────────────────────
    # When on, the period's transportation charges are subtracted from profit.
    # Off by default so switching this on is an explicit, visible decision
    # rather than something that silently changes existing numbers.
    deduct_transport_charges = models.BooleanField(
        default=False,
        help_text="Subtract daily transportation charges from profit for this business",
    )

    # ── Access ────────────────────────────────────────────────────────────
    # Which areas of the app this business shows. Empty = no override, so the
    # global default applies (see UserAccess for why empty can't mean "none").
    # A user's own override, if they have one, wins over this.
    visible_paths = models.JSONField(default=list, blank=True)

    notes      = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "business_profiles"

    def __str__(self):
        return f"Profile for {self.business.name}"


class Lead(models.Model):
    """
    Someone who asked for access from the public site.

    Deliberately NOT an account. Self-serve signup would have to create a
    tenant, and today's super_admin role can read every business — so an
    account created by a stranger would either see everyone's data or be unable
    to run its own. Until there's a business-owner role, a signup is an enquiry
    and onboarding stays a manual, deliberate act.
    """

    STATUS_NEW       = "NEW"
    STATUS_CONTACTED = "CONTACTED"
    STATUS_CONVERTED = "CONVERTED"
    STATUS_DROPPED   = "DROPPED"
    STATUS_CHOICES = [
        (STATUS_NEW,       "New"),
        (STATUS_CONTACTED, "Contacted"),
        (STATUS_CONVERTED, "Converted"),
        (STATUS_DROPPED,   "Not interested"),
    ]

    name          = models.CharField(max_length=120)
    business_name = models.CharField(max_length=200, blank=True)
    phone         = models.CharField(max_length=30, blank=True, db_index=True)
    email         = models.EmailField(blank=True, db_index=True)
    marketplaces  = models.CharField(max_length=200, blank=True,
                                     help_text="Which platforms they sell on")
    monthly_orders = models.CharField(max_length=60, blank=True)
    message       = models.TextField(blank=True)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES,
                              default=STATUS_NEW, db_index=True)
    notes  = models.TextField(blank=True)

    # Kept for spam triage — a burst from one address is the usual signature.
    source     = models.CharField(max_length=60, blank=True, default="landing")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "leads"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.phone or self.email or 'no contact'})"
