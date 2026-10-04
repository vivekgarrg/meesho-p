"""
Bring already-uploaded listing images in line with the current layout:

  - images stored before product folders existed (folder blank, key under
    listing-images/<biz>/<yyyy>/<mm>/…) are moved into their parent's folder,
    keeping their image number;
  - parents with no picture get their first uploaded photo as the default.

    python manage.py tidy_listing_images --dry-run    # show what would change
    python manage.py tidy_listing_images              # do it

Safe to run repeatedly: anything already tidy is left alone. A move is copy ->
verify -> delete, so a failure part-way leaves the original in place.
"""

from collections import Counter

from django.core.management.base import BaseCommand, CommandError

from meesho_app import object_storage
from meesho_app.listing_images_views import _build_key, _file_base, set_default_parent_image
from meesho_app.models import ListingImage, ParentItemPrice


class Command(BaseCommand):
    help = "Move pre-folder listing images into product folders and set default parent images."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report only; change nothing.")

    def handle(self, *args, **opts):
        dry = opts["dry_run"]
        if not object_storage.is_ready():
            raise CommandError(object_storage.credential_problem() or "Object storage is not configured.")

        moved = failed = 0
        legacy = (ListingImage.objects
                  .filter(status=ListingImage.STATUS_UPLOADED, folder="")
                  .select_related("parent", "business").order_by("image_no"))
        for img in legacy:
            folder = self._folder_for(img)
            file_base = _file_base(img.product_name) or folder
            ext = object_storage.ALLOWED_CONTENT_TYPES.get(img.content_type, "jpg")
            new_key = _build_key(img.business, folder, file_base, img.image_no, ext)
            self.stdout.write(f"#{img.image_no}: {img.key}\n     -> {new_key}")
            if dry:
                continue
            try:
                object_storage.move_object(img.key, new_key)
            except Exception as exc:
                failed += 1
                self.stdout.write(self.style.ERROR(f"     failed, left as it was: {exc}"))
                continue
            img.key, img.folder = new_key, folder
            img.save(update_fields=["key", "folder"])
            moved += 1

        defaults = 0
        parents = ParentItemPrice.objects.filter(
            listing_images__status=ListingImage.STATUS_UPLOADED,
        ).distinct()
        for parent in parents:
            if parent.image_url:
                continue
            if dry:
                self.stdout.write(f"{parent.item_id}: would get its first photo as its picture")
                continue
            if set_default_parent_image(parent):
                defaults += 1
                self.stdout.write(f"{parent.item_id}: picture -> {parent.image_url}")

        verb = "would move" if dry else "moved"
        self.stdout.write(self.style.SUCCESS(
            f"\n{verb} {legacy.count() if dry else moved} image(s)"
            + ("" if dry else f", {failed} failed, {defaults} parent picture(s) set")
        ))

    @staticmethod
    def _folder_for(img):
        """The folder this image's parent already uses most; failing that,
        one named after the product, then the parent itself."""
        if img.parent_id:
            used = Counter(ListingImage.objects
                           .filter(parent_id=img.parent_id).exclude(folder="")
                           .values_list("folder", flat=True))
            if used:
                return used.most_common(1)[0][0]
        return _file_base(img.product_name) or _file_base(img.parent.item_id if img.parent_id else "") or "untitled"
