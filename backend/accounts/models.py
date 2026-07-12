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
