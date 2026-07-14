// In-memory downscale cache for calendar event thumbnails.
//
// Event thumbnail sources can be full-resolution photos (many megapixels).
// Painting one directly as a CSS background forces the browser to decode the
// full bitmap on every paint/navigation — which saturates the raster/compositor
// pipeline and holds hundreds of MB per image. Instead we decode each image
// once (off the main thread via createImageBitmap), downscale it, and keep a
// small JPEG data URL that is cheap to paint forever after.
//
// Nothing is written to disk: the cache is module-level, bounded, and resets on
// plugin reload. The cache key is the resource URL, which Obsidian stamps with
// the file mtime (e.g. `app://…/img.png?1780363958931`), so an edited image gets
// a fresh entry and deleted images simply age out of the LRU.

const MAX_ENTRIES = 256;
const DEFAULT_MAX_EDGE = 320;
// Bound how many full-res decodes run at once so first-open of a month can't
// spike memory with a dozen simultaneous multi-megapixel bitmaps.
const MAX_CONCURRENT = 3;

// Map iteration order is insertion order, so it doubles as an LRU: on a hit we
// re-insert to mark most-recently-used, and evict from the front when over cap.
const cache = new Map<string, string | Promise<string>>();

function remember(key: string, value: string): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// --- tiny concurrency gate ---------------------------------------------------
let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  if (next) {
    next(); // hand off the slot without decrementing/incrementing `active`
  } else {
    active--;
  }
}

/**
 * Return a small (downscaled) data URL for `url`, decoding at most once per URL.
 * The longest edge is capped to `maxEdge`, preserving aspect ratio. Falls back
 * to the original `url` if decoding fails (e.g. a cross-origin external image
 * that can't be fetched) so the event still shows something.
 */
export function getScaledThumbnail(
  url: string,
  maxEdge: number = DEFAULT_MAX_EDGE,
): Promise<string> {
  const key = `${url}|${maxEdge}`;
  const existing = cache.get(key);
  if (existing !== undefined) {
    if (typeof existing === "string") remember(key, existing); // refresh LRU
    return Promise.resolve(existing);
  }

  const task = scaleImage(url, maxEdge)
    .then((dataUrl) => {
      remember(key, dataUrl);
      return dataUrl;
    })
    .catch(() => {
      // Don't cache the failure — fall back to the original url this time.
      cache.delete(key);
      return url;
    });

  cache.set(key, task);
  return task;
}

async function scaleImage(url: string, maxEdge: number): Promise<string> {
  await acquire();
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
    const blob = await resp.blob();

    // Decode off the main thread. Downscale to the target size, releasing the
    // full-res bitmap immediately afterward.
    const bitmap = await createImageBitmap(blob);
    try {
      const { width, height } = bitmap;
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      const tw = Math.max(1, Math.round(width * scale));
      const th = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d canvas context");
      ctx.drawImage(bitmap, 0, 0, tw, th);
      // JPEG keeps the data URL small; thumbnails are decorative so lossy is fine.
      return canvas.toDataURL("image/jpeg", 0.82);
    } finally {
      bitmap.close();
    }
  } finally {
    release();
  }
}

/** Drop all cached thumbnails (called on plugin unload). */
export function clearThumbnailCache(): void {
  cache.clear();
}
