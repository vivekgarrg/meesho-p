"""
Page extraction for Meesho shipping-label PDFs.

Deliberately free of any Django import. Extraction is the expensive part of a
label upload (pdfminer's character/layout pass plus table detection — measured
at ~107 ms/page, so ~8.4s of a ~10s 79-page upload), and it parallelises
cleanly across pages. Workers are spawned processes on macOS/Windows, which
re-import the worker's module; keeping this module Django-free means a worker
starts in milliseconds instead of booting the whole app and its DB connections.

This module only ever *extracts* raw material (text, tables, page geometry).
All field parsing stays in views._parse_label_page so there is exactly one
implementation of the label-format rules, and switching between the serial and
parallel paths cannot change what gets parsed.
"""

import ctypes
import io
import os
import time

# Parallelism is only worth its ~0.4s pool-startup cost on larger batches.
MIN_PAGES_FOR_PARALLEL = 12
# The pdfium engine below does a page in ~6ms, so a pool only pays for itself on
# large batches (150 pages serial is ~1s; pool startup alone is ~0.4s).
MIN_PAGES_FOR_PARALLEL_FAST = 300
# Leave headroom so an upload can't starve the web server of CPU.
MAX_WORKERS = 4


def _locate_tax_invoice(page):
    """
    Top-y of the "TAX INVOICE" heading, which is where the label ends and the
    invoice half begins. Falls back to 54% down the page, matching the
    long-standing default when the heading isn't found.
    """
    words = page.extract_words()
    for wi in range(len(words) - 1):
        if (words[wi]["text"].upper() == "TAX"
                and words[wi + 1]["text"].upper() == "INVOICE"):
            return max(0.0, words[wi]["top"] - 6)
    return page.height * 0.54


def extract_pages(args):
    """
    Extract one contiguous slice of pages: (pdf_bytes, start, end) with `end`
    exclusive. Returns a list of per-page dicts in page order.

    Ordering note: extract_tables() and extract_text() must run on the
    uncropped page and before any crop() call — pdfplumber's internal object
    cache can otherwise be disturbed. The original serial implementation relied
    on the same ordering.
    """
    import pdfplumber  # imported inside the worker so the parent needn't pay for it twice

    pdf_bytes, start, end = args
    out = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        total = len(pdf.pages)
        for idx in range(start, min(end, total)):
            page = pdf.pages[idx]
            crop_y = _locate_tax_invoice(page)
            tables = page.extract_tables() or []
            full_text = page.extract_text() or ""
            out.append({
                "index": idx,
                "height": page.height,
                "crop_y": crop_y,
                "tables": tables,
                "full_text": full_text,
            })
            # Release the page's cached objects; on a 200-page batch holding
            # them all would balloon memory for no benefit.
            page.close()
    return out


# ── Fast engine (pdfium) ─────────────────────────────────────────────────────
#
# pdfplumber/pdfminer takes ~62 ms a page — measured on real Meesho label
# batches — most of it spent on table detection that the current label format
# never uses (the product table is not a ruled table, so the text fallback in
# _parse_label_page is what actually supplies the SKU). pdfium, the engine inside
# Chrome, reads the same pages in ~6 ms.
#
# It must hand the parser *identical* text, because the parser is positional (the
# customer address is "the lines between two markers", and a courier name printed
# on the same baseline as an address line is part of that line). So this rebuilds
# pdfplumber's line grouping exactly: a word's "top" is the baseline less
# size × (1 + descent) with Helvetica's descent of -0.207 (verified against
# pdfminer's own char tops), and words within 3pt of each other share a line.
# Checked against pdfplumber on 150 real label pages: field-for-field identical.
#
# Anything that doesn't look right is re-read with pdfplumber by the caller (see
# extract_page_exact), so a label in an unfamiliar layout is slower, never wrong.

_PDFIUM_DESCENT = -0.207
_LINE_TOLERANCE = 3.0


def pdfium_available():
    try:
        import pypdfium2  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


def extract_pages_fast(args):
    """Same contract as extract_pages — (pdf_bytes, start, end) → per-page dicts
    — but via pdfium. `tables` is always empty and pages are tagged fast=True."""
    import pypdfium2 as pdfium
    import pypdfium2.raw as raw

    pdf_bytes, start, end = args
    pdf = pdfium.PdfDocument(pdf_bytes)
    get_origin, get_size, get_unicode, get_box = (
        raw.FPDFText_GetCharOrigin, raw.FPDFText_GetFontSize, raw.FPDFText_GetUnicode,
        raw.FPDFText_GetCharBox)
    x, y = ctypes.c_double(), ctypes.c_double()
    out = []
    try:
        total = len(pdf)
        for idx in range(start, min(end, total)):
            page = pdf[idx]
            height = page.get_height()
            tp = page.get_textpage()
            words = []          # (x0, top, text, x1)
            cur, wx, wtop, last_i = [], None, None, -1
            left, right, bottom, top_ = (ctypes.c_double() for _ in range(4))

            def flush():
                nonlocal cur, wx
                get_box(tp, last_i, left, right, bottom, top_)
                words.append((wx, wtop, "".join(cur), right.value))
                cur, wx = [], None

            for i in range(tp.count_chars()):
                code = get_unicode(tp, i)
                c = chr(code) if code else " "
                hyphen_end = c == "\x02"    # pdfium's marker for a hyphen that ends a line
                if hyphen_end:
                    c = "-"
                elif c.isspace() or c in "\ufffe\uffff":
                    if cur:
                        flush()
                    continue
                if not cur:
                    # Geometry is only read for the first char of a word — one
                    # ctypes call per char instead of three is most of the speed.
                    get_origin(tp, i, x, y)
                    wx = x.value
                    wtop = (height - y.value) - get_size(tp, i) * (1 + _PDFIUM_DESCENT)
                cur.append(c)
                last_i = i
                if hyphen_end:
                    # No line-break char follows a soft hyphen, so end the word
                    # here or the next line's first word would glue on.
                    flush()
            if cur:
                flush()
            tp.close()
            page.close()

            words.sort(key=lambda w: (w[1], w[0]))
            lines, last = [], None
            for w in words:
                if last is None or w[1] - last > _LINE_TOLERANCE:
                    lines.append([w])
                else:
                    lines[-1].append(w)
                last = w[1]
            lines = [sorted(ln, key=lambda w: w[0]) for ln in lines]

            crop_y = height * 0.54
            found = False
            for ln in lines:
                for a, b in zip(ln, ln[1:]):
                    if a[2].upper() == "TAX" and b[2].upper() == "INVOICE":
                        crop_y, found = max(0.0, a[1] - 6), True
                        break
                if found:
                    break

            # Horizontal extent of everything above the cut — lets a narrow label
            # (Flipkart's sits in the middle of an A4 page) be cropped to its
            # own edges, not just trimmed from the bottom.
            above = [w for w in words if w[1] < crop_y]
            label_bbox = (
                (min(w[0] for w in above), max(w[3] for w in above), min(w[1] for w in above))
                if above else None
            )

            out.append({
                "index": idx,
                "height": height,
                "crop_y": crop_y,
                "label_bbox": label_bbox,
                "tables": [],
                "full_text": "\n".join(" ".join(w[2] for w in ln) for ln in lines),
                "fast": True,
            })
    finally:
        pdf.close()
    return out


def extract_page_exact(pdf_bytes, index):
    """One page via pdfplumber — the slow, thorough path, used to double-check a
    page the fast engine couldn't make sense of."""
    page = extract_pages((pdf_bytes, index, index + 1))[0]
    page["fast"] = False
    return page


def page_count(pdf_bytes):
    import pdfplumber
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        return len(pdf.pages)


def extract_all_pages(pdf_bytes, max_workers=None):
    """
    Extract every page, in page order, using a process pool when the batch is
    big enough to pay for it.

    Returns (pages, meta) where meta records which path ran — useful for
    surfacing timing in the response and for diagnosing a deploy where
    subprocesses aren't permitted.

    Any failure in the parallel path falls back to serial extraction rather
    than failing the upload: a slow upload is recoverable, a lost one isn't.
    """
    started = time.perf_counter()
    if pdfium_available():
        try:
            import pypdfium2 as pdfium
            _doc = pdfium.PdfDocument(pdf_bytes)
            total = len(_doc)
            _doc.close()
            if total < MIN_PAGES_FOR_PARALLEL_FAST:
                pages = extract_pages_fast((pdf_bytes, 0, total))
                workers = 1
            else:
                workers = max(2, min(max_workers or MAX_WORKERS, (os.cpu_count() or 2) - 1, total))
                from concurrent.futures import ProcessPoolExecutor
                chunk = (total + workers - 1) // workers
                tasks = [(pdf_bytes, s, s + chunk) for s in range(0, total, chunk)]
                pages = []
                with ProcessPoolExecutor(max_workers=workers) as pool:
                    for part in pool.map(extract_pages_fast, tasks):
                        pages.extend(part)
                pages.sort(key=lambda p: p["index"])
            if len(pages) != total:
                raise RuntimeError(f"fast extraction returned {len(pages)} of {total} pages")
            return pages, {"total_pages": total, "mode": "fast", "engine": "pdfium", "workers": workers,
                           "seconds": round(time.perf_counter() - started, 3)}
        except Exception as exc:  # noqa: BLE001 — never lose an upload to the fast path
            fast_failure = f"{type(exc).__name__}: {exc}"[:200]
    else:
        fast_failure = "pypdfium2 not installed"

    total = page_count(pdf_bytes)
    meta = {"total_pages": total, "mode": "serial", "workers": 1, "engine": "pdfplumber",
            "fast_unavailable": fast_failure}

    if total < MIN_PAGES_FOR_PARALLEL:
        return extract_pages((pdf_bytes, 0, total)), meta

    cpus = os.cpu_count() or 2
    workers = max(2, min(max_workers or MAX_WORKERS, cpus - 1, total))

    try:
        from concurrent.futures import ProcessPoolExecutor

        chunk = (total + workers - 1) // workers
        tasks = [(pdf_bytes, s, s + chunk) for s in range(0, total, chunk)]
        collected = []
        with ProcessPoolExecutor(max_workers=workers) as pool:
            for part in pool.map(extract_pages, tasks):
                collected.extend(part)
        if len(collected) != total:
            raise RuntimeError(
                f"parallel extraction returned {len(collected)} of {total} pages"
            )
        collected.sort(key=lambda p: p["index"])
        meta.update(mode="parallel", workers=workers)
        return collected, meta
    except Exception as exc:  # noqa: BLE001 — any failure must degrade, not break
        meta["fallback_reason"] = f"{type(exc).__name__}: {exc}"[:200]
        return extract_pages((pdf_bytes, 0, total)), meta
