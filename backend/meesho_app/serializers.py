from rest_framework import serializers

from .helpers.helper import strip_html
from .models import OrderPayment, AdsCost, ReferralPayment, CompensationRecovery, FinalPrice, ParentItemPrice, ParentPriceHistory, Order, LabelOrder, ReturnDelivery, ScannedOrder, ListingTemplate, ClaimTicket, WorkerTask, WalletEntry, WalletSettlement, TaskListing, PlatformRate, TaskDocument, BulkListingFieldPreset, FlipkartBulkTemplate, BulkListingBatch


class OrderPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderPayment
        fields = "__all__"
        read_only_fields = ["business"]


class AdsCostSerializer(serializers.ModelSerializer):
    class Meta:
        model = AdsCost
        fields = "__all__"
        read_only_fields = ["business"]


class ReferralPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReferralPayment
        fields = "__all__"
        read_only_fields = ["business"]


class CompensationRecoverySerializer(serializers.ModelSerializer):
    class Meta:
        model = CompensationRecovery
        fields = "__all__"
        read_only_fields = ["business"]
        
class FinalPriceSerializer(serializers.ModelSerializer):
    # parent is now a surrogate-keyed FK; expose/consume it as the parent's
    # item_id string so the API contract (and the frontend) is unchanged.
    # Writes are resolved to the ParentItemPrice object in the view.
    parent = serializers.SerializerMethodField()

    class Meta:
        model = FinalPrice
        fields = "__all__"
        read_only_fields = ["business"]

    def get_parent(self, obj):
        return obj.parent.item_id if obj.parent_id else None
        
class ParentPriceHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ParentPriceHistory
        fields = "__all__"
        read_only_fields = ["business"]


class ParentItemPriceSerializer(serializers.ModelSerializer):
    sku_ids = serializers.SlugRelatedField(
        source="sku_prices",
        many=True,
        read_only=True,
        slug_field="sku_id",
    )
    price_history = ParentPriceHistorySerializer(many=True, read_only=True)

    class Meta:
        model = ParentItemPrice
        fields = "__all__"
        read_only_fields = ["business"]


class OrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = Order
        fields = "__all__"
        read_only_fields = ["business"]


class LabelOrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = LabelOrder
        fields = "__all__"
        read_only_fields = ["business"]


class ReturnDeliverySerializer(serializers.ModelSerializer):
    """
    Adds the derived claim-window fields the UI counts down on. They are
    computed per request (never stored) so the countdown is always relative
    to today rather than to whenever the row was last saved.
    """
    claim_deadline = serializers.DateField(read_only=True)
    days_left      = serializers.SerializerMethodField()
    day_of_window  = serializers.SerializerMethodField()
    claim_urgency  = serializers.SerializerMethodField()
    claim_window_days = serializers.IntegerField(source="CLAIM_WINDOW_DAYS", read_only=True)
    business_name  = serializers.CharField(source="business.name", read_only=True, default=None)

    class Meta:
        model = ReturnDelivery
        fields = "__all__"
        read_only_fields = ["business", "uploaded_at", "updated_at"]

    def get_days_left(self, obj):
        return obj.days_left()

    def get_day_of_window(self, obj):
        return obj.day_of_window()

    def get_claim_urgency(self, obj):
        return obj.claim_urgency()


class ScannedOrderSerializer(serializers.ModelSerializer):
    """
    A recorded scan. `scanned_by_name` is flattened onto the row so the table can
    show who scanned it without the client resolving user ids.

    `meesho_status` is *not* set here — it is looked up in bulk by the view for a
    whole page of rows at once, because resolving it per row would be a query per
    row. The field is declared so it always appears in the payload (null when the
    view has nothing to attach).
    """
    scanned_by_name = serializers.CharField(source="scanned_by.username", read_only=True, default=None)
    scan_date       = serializers.DateField(read_only=True)
    meesho_status   = serializers.SerializerMethodField()
    needs_shipping_attention = serializers.BooleanField(read_only=True)
    # Pooled lists mix businesses, so every row has to say which one it is.
    business_name   = serializers.CharField(source="business.name", read_only=True, default=None)

    class Meta:
        model = ScannedOrder
        fields = "__all__"
        read_only_fields = [
            "business", "scan_count", "first_scanned_at", "last_scanned_at",
            "updated_at", "matched_from",
            # Derived from the uploaded sheets, never client-supplied.
            "ship_status", "ship_status_raw", "ship_source", "ship_checked_at",
        ]

    def get_meesho_status(self, obj):
        # Attached by the view (see _meesho_status_map) — absent means "unknown".
        return getattr(obj, "meesho_status", None)


class ListingTemplateSerializer(serializers.ModelSerializer):
    """
    A listing template as the browser extension consumes it.

    Usernames are flattened onto the row because the extension popup has no way
    to resolve user ids, and `field_count` is exposed so the template list can be
    rendered without shipping every field value to a list view.
    """
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default=None)
    updated_by_name = serializers.CharField(source="updated_by.username", read_only=True, default=None)
    field_count     = serializers.IntegerField(read_only=True)

    class Meta:
        model = ListingTemplate
        fields = "__all__"
        read_only_fields = ["business", "created_by", "updated_by", "created_at", "updated_at"]

    def validate_name(self, value):
        name = (value or "").strip()
        if not name:
            raise serializers.ValidationError("A template needs a name.")
        return name

    def validate_fields(self, value):
        # The extension sends {logicalKey: value}. Anything else means a bug or a
        # hand-edited import file, and storing it would break prefill silently.
        if not isinstance(value, dict):
            raise serializers.ValidationError("fields must be an object of key → value.")
        return value

    def validate_labels(self, value):
        if value in (None, ""):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("labels must be an object of key → label.")
        return value


class BulkListingFieldPresetSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default=None)
    field_count     = serializers.IntegerField(read_only=True)

    class Meta:
        model = BulkListingFieldPreset
        fields = "__all__"
        read_only_fields = ["business", "created_by", "created_at", "updated_at"]

    def validate_name(self, value):
        name = (value or "").strip()
        if not name:
            raise serializers.ValidationError("A preset needs a name.")
        return name

    def validate_fields(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("fields must be an object of key → value.")
        return value


class FlipkartBulkTemplateSerializer(serializers.ModelSerializer):
    """Never exposes `file_data` — a couple hundred KB of binary in every
    list-row response would be wasteful, and the raw bytes only ever need
    to travel back out through `bulk_listing_generate`'s own template_id
    lookup, not through this serializer."""
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default=None)
    file_size        = serializers.IntegerField(read_only=True)

    class Meta:
        model = FlipkartBulkTemplate
        fields = ["id", "name", "category_label", "original_filename", "file_size",
                  "created_by_name", "created_at", "updated_at"]


class BulkListingBatchSerializer(serializers.ModelSerializer):
    """Never exposes file_data/source_file_data — same reasoning as
    FlipkartBulkTemplateSerializer. Review status is flattened on from the
    linked WorkerTask/TaskListings so the panel can show "3/12 approved"
    without a second request per row."""
    created_by_name  = serializers.CharField(source="created_by.username", read_only=True, default=None)
    worker_task_status = serializers.CharField(source="worker_task.status", read_only=True, default=None)
    approved_count   = serializers.SerializerMethodField()
    total_count      = serializers.IntegerField(source="row_count", read_only=True)

    class Meta:
        model = BulkListingBatch
        fields = ["id", "platform", "category_label", "filename", "first_sku_id", "sku_ids",
                  "row_count", "source_kind", "worker_task", "worker_task_status",
                  "approved_count", "total_count", "created_by_name", "created_at"]

    def get_approved_count(self, obj):
        if not obj.worker_task_id:
            return None
        return obj.worker_task.listings.filter(status="APPROVED").count()


class BulkListingBatchDetailSerializer(BulkListingBatchSerializer):
    """Adds payload_snapshot (needed to hydrate the form for "load to edit"),
    still never exposing the binary fields — used only by the single-batch
    detail endpoint, not the list, since the snapshot can be sizeable."""

    class Meta(BulkListingBatchSerializer.Meta):
        fields = BulkListingBatchSerializer.Meta.fields + ["payload_snapshot"]


class ClaimTicketSerializer(serializers.ModelSerializer):
    """
    A claim ticket. Everything is read-only: this table is a faithful record of
    what Meesho's export said, and letting a client edit it would make the
    reconciliation it exists for meaningless.

    `last_update_text` is the HTML rejection reason reduced to plain words —
    exposed alongside the raw value so the UI can show something readable
    without having to sanitise markup itself.
    """
    linked_suborder = serializers.CharField(source="linked_return.suborder_no",
                                            read_only=True, default=None)
    linked_sku      = serializers.CharField(source="linked_return.sku", read_only=True, default=None)
    is_reopenable   = serializers.BooleanField(read_only=True)
    days_to_reopen  = serializers.IntegerField(read_only=True)
    last_update_text = serializers.SerializerMethodField()

    class Meta:
        model = ClaimTicket
        fields = "__all__"
        read_only_fields = [f.name for f in ClaimTicket._meta.fields]

    def get_last_update_text(self, obj):
        return strip_html(obj.last_update)


class WorkerTaskSerializer(serializers.ModelSerializer):
    """
    A task as both sides see it. Usernames and the earned-so-far figure are
    flattened on because the worker's phone shouldn't need a second request to
    render a list row.
    """
    assignee_names   = serializers.SerializerMethodField()
    assignee_ids     = serializers.SerializerMethodField()
    submitted_by_name = serializers.CharField(source="submitted_by.username", read_only=True, default=None)
    listing_count    = serializers.SerializerMethodField()
    approved_count   = serializers.SerializerMethodField()
    listings         = serializers.SerializerMethodField()
    created_by_name  = serializers.CharField(source="created_by.username", read_only=True, default=None)
    reviewed_by_name = serializers.CharField(source="reviewed_by.username", read_only=True, default=None)
    business_name    = serializers.CharField(source="business.name", read_only=True, default=None)
    total_possible   = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    awaiting_bonus   = serializers.BooleanField(read_only=True)
    earned           = serializers.SerializerMethodField()
    parent_sku_item_id = serializers.CharField(source="parent_sku.item_id", read_only=True, default=None)
    parent_sku_price = serializers.DecimalField(source="parent_sku.final_price", max_digits=12,
                                                decimal_places=2, read_only=True, default=None)
    listing_template_name = serializers.CharField(source="listing_template.name", read_only=True, default=None)

    class Meta:
        model = WorkerTask
        fields = "__all__"
        read_only_fields = [
            "business", "created_by", "reviewed_by", "reviewed_at", "submitted_at",
            "status", "reward_credited_at", "bonus_credited_at", "created_at", "updated_at",
            "submitted_by", "paused_at",
        ]

    def get_earned(self, obj):
        """What this task has actually paid so far — summed from the ledger."""
        return float(sum(e.amount for e in obj.wallet_entries.all()))

    def _asking_admin(self):
        request = self.context.get("request")
        user = request.user if request is not None else None
        return getattr(user, "role", None) == "super_admin"

    def get_assignee_names(self, obj):
        """
        Who else has this task is the admin's business, not a worker's. A worker
        sees the job, not the roster — knowing who else was given the same brief
        invites comparison and tells them nothing useful about their own work.
        """
        if not self._asking_admin():
            return []
        return [u.username for u in obj.assignees.all()]

    def get_assignee_ids(self, obj):
        if not self._asking_admin():
            return []
        return [u.pk for u in obj.assignees.all()]

    def get_listing_count(self, obj):
        return obj.listings.count()

    def get_approved_count(self, obj):
        return sum(1 for l in obj.listings.all() if l.status == TaskListing.STATUS_APPROVED)

    def get_listings(self, obj):
        """
        The SKUs on this task. A worker sees only their own — several people can
        share a brief, and one worker's variants are not another's business.
        """
        rows = obj.listings.all()
        user = (self.context.get("request").user
                if self.context.get("request") is not None else None)
        if user is not None and getattr(user, "role", None) != "super_admin":
            rows = [r for r in rows if r.created_by_id == user.pk]
        return TaskListingSerializer(rows, many=True, context=self.context).data


class WalletEntrySerializer(serializers.ModelSerializer):
    user_name     = serializers.CharField(source="user.username", read_only=True, default=None)
    business_name = serializers.CharField(source="business.name", read_only=True, default=None)
    task_type     = serializers.CharField(source="task.task_type", read_only=True, default=None)
    task_title    = serializers.CharField(source="task.title", read_only=True, default=None)
    is_settled    = serializers.BooleanField(read_only=True)

    class Meta:
        model = WalletEntry
        fields = "__all__"
        read_only_fields = [f.name for f in WalletEntry._meta.fields]


class WalletSettlementSerializer(serializers.ModelSerializer):
    user_name       = serializers.CharField(source="user.username", read_only=True, default=None)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default=None)
    entry_count     = serializers.SerializerMethodField()

    class Meta:
        model = WalletSettlement
        fields = "__all__"
        read_only_fields = ["business", "created_by", "created_at"]

    def get_entry_count(self, obj):
        return obj.entries.count()


class TaskListingSerializer(serializers.ModelSerializer):
    created_by_name  = serializers.CharField(source="created_by.username", read_only=True, default=None)
    locked_fields    = serializers.SerializerMethodField()
    reviewed_by_name = serializers.CharField(source="reviewed_by.username", read_only=True, default=None)
    platform         = serializers.CharField(source="task.platform", read_only=True, default=None)
    task_title       = serializers.CharField(source="task.title", read_only=True, default=None)
    prefix_ok        = serializers.BooleanField(read_only=True)

    def get_locked_fields(self, obj):
        """
        Which fields the caller may not change. The UI renders these read-only;
        the API refuses them regardless, so this is a convenience rather than
        the enforcement.
        """
        request = self.context.get("request")
        user = request.user if request is not None else None
        if getattr(user, "role", None) == "super_admin":
            return []
        return ["listing_price", "wrong_defective_price", "mrp",
                "min_settlement_amount", "sku_prefix", "hsn_code", "tax_percent"]

    class Meta:
        model = TaskListing
        fields = "__all__"
        read_only_fields = [
            "business", "task", "batch", "created_by", "status", "reviewed_by", "reviewed_at",
            "reward_amount", "reward_credited_at", "created_at", "updated_at",
        ]


class PlatformRateSerializer(serializers.ModelSerializer):
    updated_by_name = serializers.CharField(source="updated_by.username", read_only=True, default=None)
    user_name       = serializers.CharField(source="user.username", read_only=True, default=None)

    class Meta:
        model = PlatformRate
        fields = "__all__"
        read_only_fields = ["business", "updated_by", "updated_at"]


class TaskDocumentSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default=None)

    class Meta:
        model = TaskDocument
        fields = "__all__"
        read_only_fields = ["business", "created_by", "created_at", "updated_at"]
