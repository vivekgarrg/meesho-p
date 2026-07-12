from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import Business, Membership, User


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (("Business role", {"fields": ("role",)}),)
    list_display = ("username", "email", "role", "is_staff")


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "is_active", "created_at")


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "business", "created_at")
