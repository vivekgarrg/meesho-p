/**
 * Upload photos to object storage (Cloudflare R2) and link them to a parent
 * SKU — the browser half of listing_images_views.py.
 *
 *   1. hash each photo, so the server can spot one it already has
 *   2. presign: the server numbers every photo, picks the folder, and hands
 *      back one short-lived signed upload url per photo
 *   3. PUT each photo straight to R2, three at a time
 *   4. confirm: the server checks each photo really is in the bucket, and
 *      only then counts it as linked
 *
 * Used by SKU Pricing's per-parent "Upload photos". Returns a summary rather
 * than throwing, so a caller can always say what happened.
 */
import { API_BASE as API } from "./apiBase";

export const UPLOADABLE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Is this a file the server will accept? Returns a reason if not. */
export function rejectReason(file) {
  if (!UPLOADABLE_TYPES.includes(file.type)) return `${file.name} isn't a JPG, PNG or WebP`;
  if (!file.size) return `${file.name} is empty`;
  if (file.size > MAX_IMAGE_BYTES) return `${file.name} is over 15 MB`;
  return null;
}

/** Hex SHA-256 of a blob. crypto.subtle only exists on https or localhost. */
export async function sha256Hex(blob) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser can't hash images here — open the app over https (or localhost) to upload.");
  }
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function runPool(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

/**
 * @param files        [{ blob, mime }]
 * @param parentId     the parent SKU the photos are linked to
 * @param productName  names the folder and the files — "<name>/<name>-<no>.jpg"
 * @param onProgress   ({ done, total }) as uploads finish
 * @returns { ok, error?, folder, total, linked, failed, alreadyStored, reason }
 */
export async function uploadListingImages({ files, parentId, productName, onProgress }) {
  let presign;
  try {
    const hashes = await Promise.all(files.map((f) => sha256Hex(f.blob)));
    const res = await fetch(`${API}/listing-images/presign/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parent_id: parentId,
        create_parent: false,
        product_name: productName,
        files: files.map((f, i) => ({ sha256: hashes[i], content_type: f.mime, bytes: f.blob.size })),
      }),
    });
    presign = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: presign.error || `upload could not start (${res.status})` };
  } catch (err) {
    return { ok: false, error: err.message || "upload could not start" };
  }

  const results = presign.results || [];
  const reasons = [];

  // One PUT per distinct photo: the same photo twice in a batch shares an id.
  const toPut = [];
  const seen = new Set();
  results.forEach((r, i) => {
    if (r.needs_upload && !seen.has(r.id)) { seen.add(r.id); toPut.push({ r, file: files[i] }); }
  });

  let done = 0;
  onProgress?.({ done, total: toPut.length });
  const putOk = new Set();
  await runPool(toPut, 3, async ({ r, file }) => {
    try {
      const put = await fetch(r.put_url, { method: "PUT", headers: { "Content-Type": file.mime }, body: file.blob });
      if (put.ok) putOk.add(r.id);
      else reasons.push(`storage refused the upload (HTTP ${put.status})`);
    } catch {
      // fetch() throws instead of returning a status when the browser blocks
      // the request — for a direct-to-bucket PUT, nearly always CORS.
      reasons.push(`the browser blocked the upload — the bucket's CORS policy must allow ${window.location.origin}`);
    }
    done += 1;
    onProgress?.({ done, total: toPut.length });
  });

  // Already-stored photos count as linked; everything else only once the
  // server has seen it in the bucket.
  const confirmed = new Set(
    results.filter((r) => r.duplicate && !r.needs_upload && r.status === "uploaded").map((r) => r.id)
  );
  const alreadyStored = confirmed.size;
  if (putOk.size) {
    try {
      const c = await fetch(`${API}/listing-images/confirm/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...putOk] }),
      });
      const d = await c.json().catch(() => ({}));
      (d.confirmed || []).forEach((id) => confirmed.add(id));
      (d.failed || []).forEach((f) => f.reason && reasons.push(f.reason));
    } catch {
      reasons.push("couldn't reach the server to confirm the uploads");
    }
  }

  const linked = results.filter((r) => confirmed.has(r.id)).length;
  // The most common reason: one cause (bad key, CORS) usually fails them all.
  const counts = reasons.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const reason = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  return {
    ok: true,
    folder: presign.folder,
    total: results.length,
    linked,
    failed: results.length - linked,
    alreadyStored,
    reason: results.length - linked ? reason : "",
  };
}
