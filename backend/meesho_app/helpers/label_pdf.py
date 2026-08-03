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

import io
import os

# Parallelism is only worth its ~0.4s pool-startup cost on larger batches.
MIN_PAGES_FOR_PARALLEL = 12
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
    total = page_count(pdf_bytes)
    meta = {"total_pages": total, "mode": "serial", "workers": 1}

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
