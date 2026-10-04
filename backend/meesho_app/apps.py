from django.apps import AppConfig


class MeeshoAppConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "meesho_app"

    def ready(self):
        from . import signals  # noqa: F401  (registers the receivers)

        # runserver reloads on .py changes but not on backend/.env, so an edited
        # key silently kept the old value until a manual restart. Watching it
        # makes a .env edit take effect like any code change. Dev-only: the
        # signal only fires under runserver's autoreloader.
        from django.conf import settings
        from django.utils.autoreload import autoreload_started

        def _watch_env(sender, **kwargs):
            # watch_dir(path, glob) is the reloader API (there is no
            # watch_file). Never let a failure here take down runserver: a
            # missed reload is an inconvenience, a dead dev server is not.
            try:
                sender.watch_dir(settings.BASE_DIR, ".env")
            except Exception:
                pass

        autoreload_started.connect(_watch_env, weak=False)
