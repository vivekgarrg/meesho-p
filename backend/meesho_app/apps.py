from django.apps import AppConfig


class MeeshoAppConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "meesho_app"

    def ready(self):
        from . import signals  # noqa: F401  (registers the receivers)
