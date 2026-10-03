"""Round-trip tests for the Flipkart template core (bulk_listing_flipkart).

Everything here runs against a synthetic .xls built to match the real
template's structure — Flipkart's own export is a legacy BIFF8 file whose
meaning lives in cell *fill colour* and in sibling `DropDownValuesForColumn{N}`
sheets, none of which any other fixture in this repo exercises. Verified by
construction: the builder below writes grey/blue fills with xlwt and the
module reads them back through xlrd exactly as it does on a real file.

Why it matters: parse_template -> extract_prefilled_rows -> build_workbook is
the whole Flipkart flow, and a sheet that parses slightly wrong produces an
upload Flipkart rejects a day later with no local symptom at all.
"""

import io

import xlrd
import xlwt
from django.test import TestCase

from . import bulk_listing_flipkart as blf

GREY = 22          # xlwt grey25 == (192, 192, 192), Flipkart-only columns
BLUE_SLOT = 0x08   # overridden to (141, 180, 226), Flipkart "mandatory"


def _fill(colour):
    st = xlwt.XFStyle()
    pat = xlwt.Pattern()
    pat.pattern = xlwt.Pattern.SOLID_PATTERN
    pat.pattern_fore_colour = colour
    st.pattern = pat
    return st


# label, type hint, fill, dropdown values (own sheet), index-sheet values
DEFAULT_COLUMNS = [
    ("Flipkart Serial Number", "", GREY, None, None),
    ("Seller SKU ID", "Single - Text", BLUE_SLOT, None, None),
    ("Main Image URL", "URL", BLUE_SLOT, None, None),
    ("Other Image URL 1", "URL", None, None, None),
    ("Other Image URL 2", "URL", None, None, None),
    ("Brand", "Single - Text", BLUE_SLOT, None, None),
    ("MRP", "Single - Positive_integer", BLUE_SLOT, None, None),
    ("Description", "Single - Long_Text", None, None, None),
    ("Procurement Type", "Dropdown", None, ["Instock", "Express"], None),
    ("Fullfilment by", "Dropdown", None, ["SELLER", "FLIPKART"], None),
    ("Shipping provider", "Single - Text", None, None, None),
    ("Items Included", "MULTI - TEXT", None, ["Wrong", "List", "Here"], None),
    ("Color", "Dropdown", None, None, ["Gold", "Silver"]),
    ("Returnable", "Boolean", None, None, None),
    ("Catalog QC Status", "", GREY, None, None),
    ("QC Failed Reason (if any)", "", GREY, None, None),
]


def build_template(columns=DEFAULT_COLUMNS, data_rows=(), sheet_name="kalash"):
    """A .xls shaped like Flipkart's own category template.

    Rows 0-3 are label / type hint / example / description; data starts at
    row 4 (blf.DATA_START_ROW). `data_rows` is a list of {label: value}.
    """
    wb = xlwt.Workbook()
    wb.set_colour_RGB(BLUE_SLOT, 141, 180, 226)

    ws = wb.add_sheet(sheet_name)
    for col, (label, hint, fill, _dd, _idx) in enumerate(columns):
        ws.write(0, col, label, _fill(fill) if fill is not None else xlwt.XFStyle())
        ws.write(1, col, hint)
        ws.write(2, col, "example")
        ws.write(3, col, "description")

    by_label = {label: col for col, (label, *_rest) in enumerate(columns)}
    for i, row in enumerate(data_rows):
        for label, value in row.items():
            ws.write(blf.DATA_START_ROW + i, by_label[label], value)

    # Flipkart's utility sheets. The widest non-utility sheet is the category
    # sheet, so Summary Sheet must stay narrower than the category sheet.
    summary = wb.add_sheet("Summary Sheet")
    summary.write(0, 0, "Instructions")

    index_cols = [(label, vals) for label, _h, _b, _dd, vals in columns if vals]
    idx = wb.add_sheet("Index")
    for c, (label, vals) in enumerate(index_cols):
        idx.write(0, c, label)
        for r, v in enumerate(vals, start=1):
            idx.write(r, c, v)

    for col, (_label, _hint, _bg, dd, _idx) in enumerate(columns):
        if not dd:
            continue
        sh = wb.add_sheet(f"DropDownValuesForColumn{col}")
        for r, v in enumerate(dd):
            sh.write(r, 0, v)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def load(buf):
    buf.seek(0)
    return blf.load_workbook(buf)


class TemplateFixtureTests(TestCase):
    """The fixture has to actually look like a Flipkart file, or nothing below
    proves anything."""

    def test_fills_survive_the_xlwt_xlrd_round_trip(self):
        rb = load(build_template())
        ws = rb.sheet_by_name("kalash")
        self.assertEqual(blf._cell_bg(rb, ws, 0, 0), blf._GREY_BG)
        self.assertEqual(blf._cell_bg(rb, ws, 0, 1), blf._BLUE_BG)
        self.assertIsNone(blf._cell_bg(rb, ws, 0, 3))


class ParseTemplateTests(TestCase):
    def setUp(self):
        self.rb = load(build_template())
        self.spec = blf.parse_template(self.rb)
        self.by_label = {f["label"]: f for f in self.spec["fields"]}

    def test_the_category_sheet_is_found_by_width(self):
        self.assertEqual(self.spec["category_label"], "kalash")
        self.assertEqual(self.spec["sheet_name"], "kalash")
        self.assertEqual(self.spec["data_start_row"], 4)

    def test_flipkart_only_columns_are_dropped(self):
        for label in ("Flipkart Serial Number", "Catalog QC Status", "QC Failed Reason (if any)"):
            self.assertNotIn(label, self.by_label, label)

    def test_blue_columns_are_required_and_others_are_not(self):
        self.assertTrue(self.by_label["Seller SKU ID"]["required"])
        self.assertTrue(self.by_label["Brand"]["required"])
        self.assertFalse(self.by_label["Description"]["required"])
        self.assertFalse(self.by_label["Other Image URL 1"]["required"])

    def test_roles_are_detected(self):
        self.assertEqual(self.by_label["Seller SKU ID"]["role"], "sku")
        self.assertEqual(self.by_label["Main Image URL"]["role"], "image_1")
        self.assertEqual(self.by_label["Other Image URL 1"]["role"], "image_2")
        self.assertEqual(self.by_label["Other Image URL 2"]["role"], "image_3")
        self.assertIsNone(self.by_label["Brand"]["role"])

    def test_types_come_from_the_hint_row(self):
        self.assertEqual(self.by_label["MRP"]["type"], "number")
        self.assertEqual(self.by_label["Description"]["type"], "textarea")
        self.assertEqual(self.by_label["Brand"]["type"], "text")
        self.assertEqual(self.by_label["Returnable"]["type"], "select")
        self.assertEqual(self.by_label["Returnable"]["options"], ["Yes", "No"])

    def test_procurement_type_ignores_the_sheets_own_wrong_dropdown(self):
        """The regression this whole area exists for: the template ships
        Instock/Express, Flipkart's API accepts neither."""
        options = self.by_label["Procurement Type"]["options"]
        self.assertEqual(
            options, ["QUICK", "REGULAR", "EXPRESS", "DOMESTIC", "MADE_TO_ORDER", "INTERNATIONAL"],
        )
        self.assertNotIn("Instock", options)
        self.assertNotIn("Express", options)

    def test_an_ordinary_dropdown_still_comes_from_its_own_sheet(self):
        self.assertEqual(self.by_label["Fullfilment by"]["options"], ["SELLER", "FLIPKART"])

    def test_a_multi_field_ignores_its_column_indexed_sheet(self):
        """Flipkart's own export has pointed a Multi field at another field's
        list; Multi values are free-typed `::` lists anyway."""
        self.assertEqual(self.by_label["Items Included"]["options"], [])
        self.assertEqual(self.by_label["Items Included"]["type"], "textarea")

    def test_an_index_sheet_column_is_used_when_there_is_no_dropdown_sheet(self):
        self.assertEqual(self.by_label["Color"]["options"], ["Gold", "Silver"])

    def test_field_keys_are_unique_even_for_repeated_labels(self):
        cols = list(DEFAULT_COLUMNS) + [("Brand", "Single - Text", None, None, None)]
        spec = blf.parse_template(load(build_template(cols)))
        keys = [f["key"] for f in spec["fields"]]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertIn("brand_2", keys)


class ExtractPrefilledRowsTests(TestCase):
    def rows_from(self, data_rows, columns=DEFAULT_COLUMNS):
        rb = load(build_template(columns, data_rows))
        spec = blf.parse_template(rb)
        return spec, blf.extract_prefilled_rows(spec, rb)

    def test_rows_are_read_with_images_in_slot_order(self):
        _spec, rows = self.rows_from([
            {"Seller SKU ID": "SKU-1", "Main Image URL": "https://a/1.jpg",
             "Other Image URL 1": "https://a/2.jpg", "Brand": "Kalash", "MRP": 499},
        ])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["sku_id"], "SKU-1")
        self.assertEqual(rows[0]["images"], ["https://a/1.jpg", "https://a/2.jpg", ""])
        self.assertEqual(rows[0]["attributes"]["brand"], "Kalash")

    def test_reading_stops_at_the_first_blank_sku(self):
        _spec, rows = self.rows_from([
            {"Seller SKU ID": "SKU-1"}, {"Brand": "orphan"}, {"Seller SKU ID": "SKU-3"},
        ])
        self.assertEqual([r["sku_id"] for r in rows], ["SKU-1"])

    def test_a_whole_number_price_does_not_come_back_as_a_float(self):
        _spec, rows = self.rows_from([{"Seller SKU ID": "SKU-1", "MRP": 499}])
        self.assertEqual(rows[0]["attributes"]["mrp"], "499")

    def test_fulfilment_is_forced_over_whatever_the_sheet_said(self):
        _spec, rows = self.rows_from([
            {"Seller SKU ID": "SKU-1", "Fullfilment by": "FLIPKART"},
        ])
        self.assertEqual(rows[0]["attributes"]["fullfilment_by"], "SELLER")

    def test_shipping_provider_is_forced_even_when_blank(self):
        _spec, rows = self.rows_from([{"Seller SKU ID": "SKU-1"}])
        self.assertEqual(rows[0]["attributes"]["shipping_provider"], "FLIPKART")

    def test_procurement_type_defaults_only_into_a_blank_cell(self):
        _spec, rows = self.rows_from([
            {"Seller SKU ID": "SKU-1"},
            {"Seller SKU ID": "SKU-2", "Procurement Type": "DOMESTIC"},
        ])
        self.assertEqual(rows[0]["attributes"]["procurement_type"], "EXPRESS")
        self.assertEqual(rows[1]["attributes"]["procurement_type"], "DOMESTIC")

    def test_every_defaulted_and_forced_value_passes_its_own_options_check(self):
        """The server rejects a row whose value isn't in f['options'], so a
        default or forced value outside that list is a self-inflicted 400."""
        spec, rows = self.rows_from([{"Seller SKU ID": "SKU-1"}])
        by_key = {f["key"]: f for f in spec["fields"]}
        for key, value in rows[0]["attributes"].items():
            options = by_key[key]["options"]
            if options:
                self.assertIn(value, options, f"{key}={value!r}")

    def test_a_rejected_sheet_carries_its_error_back(self):
        cols = list(DEFAULT_COLUMNS)
        _spec, rows = self.rows_from([
            {"Seller SKU ID": "SKU-1", "Catalog QC Status": "Failed",
             "QC Failed Reason (if any)": "1. [procurement_type]: Invalid value"},
            {"Seller SKU ID": "SKU-2", "Catalog QC Status": "Success"},
        ], cols)
        self.assertIn("error", rows[0])
        self.assertIn("procurement_type", rows[0]["error"]["message"])
        self.assertNotIn("error", rows[1])


class BuildWorkbookTests(TestCase):
    """Generate, then re-read the generated file — the only check that proves
    values actually landed in the right cells."""

    def round_trip(self, rows, data_rows=None):
        rb = load(build_template(DEFAULT_COLUMNS, data_rows or [{"Seller SKU ID": "SEED"}]))
        spec = blf.parse_template(rb)
        out = blf.build_workbook(spec, rb, rows)
        buf = io.BytesIO()
        out.save(buf)
        buf.seek(0)
        rb2 = xlrd.open_workbook(file_contents=buf.read(), formatting_info=True)
        return spec, rb2, blf.parse_template(rb2)

    def test_values_land_in_the_right_columns(self):
        rows = [{
            "sku_id": "SKU-1",
            "images": ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg"],
            "attributes": {"brand": "Kalash", "mrp": "499", "procurement_type": "EXPRESS",
                           "fullfilment_by": "SELLER", "shipping_provider": "FLIPKART"},
        }]
        spec, rb2, spec2 = self.round_trip(rows)
        back = blf.extract_prefilled_rows(spec2, rb2)
        self.assertEqual(len(back), 1)
        self.assertEqual(back[0]["sku_id"], "SKU-1")
        self.assertEqual(back[0]["images"],
                         ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg"])
        self.assertEqual(back[0]["attributes"]["brand"], "Kalash")
        self.assertEqual(back[0]["attributes"]["procurement_type"], "EXPRESS")
        self.assertEqual(back[0]["attributes"]["fullfilment_by"], "SELLER")

    def test_a_number_is_written_as_a_number_not_text(self):
        """Flipkart's own validation formulas don't read a price stored as
        text — the Meesho side had exactly this bug (see coerce_cell)."""
        rows = [{"sku_id": "SKU-1", "images": ["", "", ""], "attributes": {"mrp": "499"}}]
        spec, rb2, _spec2 = self.round_trip(rows)
        ws = rb2.sheet_by_name(spec["sheet_name"])
        mrp_col = next(f["column"] for f in spec["fields"] if f["label"] == "MRP")
        cell = ws.cell(spec["data_start_row"], mrp_col)
        self.assertEqual(cell.ctype, xlrd.XL_CELL_NUMBER, "MRP should be numeric")
        self.assertEqual(cell.value, 499)

    def test_the_header_rows_and_utility_sheets_survive(self):
        """Flipkart rejects a file whose own scaffolding was lost."""
        rows = [{"sku_id": "SKU-1", "images": ["", "", ""], "attributes": {}}]
        spec, rb2, spec2 = self.round_trip(rows)
        self.assertEqual([f["label"] for f in spec2["fields"]],
                         [f["label"] for f in spec["fields"]])
        self.assertIn("Summary Sheet", rb2.sheet_names())
        self.assertIn("Index", rb2.sheet_names())
        self.assertTrue(any(n.startswith("DropDownValuesForColumn") for n in rb2.sheet_names()))

    def test_required_flags_survive_so_a_regenerated_file_still_validates(self):
        rows = [{"sku_id": "SKU-1", "images": ["", "", ""], "attributes": {}}]
        spec, _rb2, spec2 = self.round_trip(rows)
        before = {f["label"]: f["required"] for f in spec["fields"]}
        after = {f["label"]: f["required"] for f in spec2["fields"]}
        self.assertEqual(before, after)

    def test_multiple_rows_are_written_in_order_from_the_data_start_row(self):
        rows = [
            {"sku_id": f"SKU-{i}", "images": ["", "", ""], "attributes": {"brand": f"B{i}"}}
            for i in range(1, 4)
        ]
        spec, rb2, spec2 = self.round_trip(rows)
        back = blf.extract_prefilled_rows(spec2, rb2)
        self.assertEqual([r["sku_id"] for r in back], ["SKU-1", "SKU-2", "SKU-3"])
        self.assertEqual([r["attributes"]["brand"] for r in back], ["B1", "B2", "B3"])


class PalettePreservationTests(TestCase):
    """Flipkart marks mandatory columns with an Office-theme blue that a .xls
    can only hold as a custom palette override. xlutils.copy carries the XF
    records but not the palette, so generated sheets came back with every
    `required` flag gone — and re-uploading one (which this flow invites)
    silently stopped enforcing Flipkart's own mandatory attributes.
    """

    def generate(self, rb, spec, rows):
        out = blf.build_workbook(spec, rb, rows)
        buf = io.BytesIO()
        out.save(buf)
        buf.seek(0)
        return xlrd.open_workbook(file_contents=buf.read(), formatting_info=True)

    def test_the_mandatory_blue_survives_a_generate(self):
        rb = load(build_template(DEFAULT_COLUMNS, [{"Seller SKU ID": "SEED"}]))
        spec = blf.parse_template(rb)
        rb2 = self.generate(rb, spec, [{"sku_id": "S1", "images": ["", "", ""], "attributes": {}}])
        ws2 = rb2.sheet_by_name(spec["sheet_name"])
        sku_col = next(f["column"] for f in spec["fields"] if f["label"] == "Seller SKU ID")
        self.assertEqual(blf._cell_bg(rb2, ws2, 0, sku_col), blf._BLUE_BG)

    def test_required_fields_still_enforce_after_a_round_trip(self):
        rb = load(build_template(DEFAULT_COLUMNS, [{"Seller SKU ID": "SEED"}]))
        spec = blf.parse_template(rb)
        rb2 = self.generate(rb, spec, [{"sku_id": "S1", "images": ["", "", ""], "attributes": {}}])
        spec2 = blf.parse_template(rb2)
        required = {f["label"] for f in spec2["fields"] if f["required"]}
        self.assertEqual(required, {"Seller SKU ID", "Main Image URL", "Brand", "MRP"})

    def test_a_generate_chain_does_not_erode_the_palette(self):
        """Generate, re-upload, generate again — the loop a seller fixing a
        rejected sheet actually performs."""
        rb = load(build_template(DEFAULT_COLUMNS, [{"Seller SKU ID": "SEED"}]))
        spec = blf.parse_template(rb)
        for _ in range(3):
            rb = self.generate(rb, spec, [{"sku_id": "S1", "images": ["", "", ""], "attributes": {}}])
            spec = blf.parse_template(rb)
            self.assertTrue(
                any(f["required"] for f in spec["fields"]), "required flags lost in the chain",
            )
        self.assertEqual(sum(f["required"] for f in spec["fields"]), 4)


class LeftoverRowClearingTests(TestCase):
    """Generating fewer rows than the template carries used to leave the
    originals in the file, so Flipkart created listings the seller had removed
    — under the template's own stale SKUs and attributes."""

    def generate_and_read(self, seeded, rows):
        rb = load(build_template(DEFAULT_COLUMNS, seeded))
        spec = blf.parse_template(rb)
        out = blf.build_workbook(spec, rb, rows)
        buf = io.BytesIO()
        out.save(buf)
        buf.seek(0)
        rb2 = xlrd.open_workbook(file_contents=buf.read(), formatting_info=True)
        spec2 = blf.parse_template(rb2)
        return blf.extract_prefilled_rows(spec2, rb2)

    def seeded(self, n):
        return [
            {"Seller SKU ID": f"SEED-{i}", "Main Image URL": f"https://a/{i}.jpg",
             "Brand": f"B{i}", "MRP": 100 + i}
            for i in range(1, n + 1)
        ]

    def test_removing_rows_removes_them_from_the_generated_sheet(self):
        back = self.generate_and_read(
            self.seeded(3),
            [{"sku_id": "KEEP-1", "images": ["https://a/x.jpg", "", ""], "attributes": {"brand": "Kalash"}}],
        )
        self.assertEqual([r["sku_id"] for r in back], ["KEEP-1"])

    def test_no_stale_attribute_survives_on_a_cleared_row(self):
        back = self.generate_and_read(
            self.seeded(3),
            [{"sku_id": "KEEP-1", "images": ["", "", ""], "attributes": {"brand": "Kalash"}}],
        )
        self.assertEqual(len(back), 1)
        self.assertNotIn("B2", str(back))
        self.assertNotIn("SEED-2", str(back))

    def test_generating_the_same_number_of_rows_is_unaffected(self):
        back = self.generate_and_read(
            self.seeded(3),
            [{"sku_id": f"NEW-{i}", "images": ["", "", ""], "attributes": {"brand": f"K{i}"}}
             for i in (1, 2, 3)],
        )
        self.assertEqual([r["sku_id"] for r in back], ["NEW-1", "NEW-2", "NEW-3"])
        self.assertEqual([r["attributes"]["brand"] for r in back], ["K1", "K2", "K3"])

    def test_generating_more_rows_than_the_template_had_still_works(self):
        back = self.generate_and_read(
            self.seeded(1),
            [{"sku_id": f"NEW-{i}", "images": ["", "", ""], "attributes": {}} for i in (1, 2, 3, 4)],
        )
        self.assertEqual([r["sku_id"] for r in back], ["NEW-1", "NEW-2", "NEW-3", "NEW-4"])

    def test_a_cleared_row_does_not_keep_flipkarts_old_rejection(self):
        """Otherwise a removed row's QC error would reappear on reload."""
        seeded = self.seeded(2)
        seeded[1]["Catalog QC Status"] = "Failed"
        seeded[1]["QC Failed Reason (if any)"] = "1. [procurement_type]: Invalid value"
        back = self.generate_and_read(
            seeded, [{"sku_id": "KEEP-1", "images": ["", "", ""], "attributes": {}}],
        )
        self.assertEqual(len(back), 1)
        self.assertNotIn("error", back[0])
