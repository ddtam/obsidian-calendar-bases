import { Platform } from "obsidian";
import { noteDecode, noteError, noteRequest } from "./thumbnail-stats";

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

// Mobile runs the same code under a per-app memory ceiling that desktop does
// not have, and every constant below was originally chosen on desktop. A
// single 12 MP photo is 48 MB once decoded, so three at once was fatal there
// long before the cache filled.
const MOBILE = Platform.isMobile;

const MAX_ENTRIES = MOBILE ? 64 : 256;
const DEFAULT_MAX_EDGE = MOBILE ? 160 : 320;
// Bound how many decodes run at once. Each one holds a compressed blob and a
// bitmap, so this multiplies whatever a single decode costs.
const MAX_CONCURRENT = MOBILE ? 1 : 3;
// A ceiling on the source an iOS device will attempt at all, whichever decode
// path is taken.
//
// It applied only where the engine refused to resize, on the reasoning that
// resize-on-decode makes the source size irrelevant. Measured 2026-09-11, that
// reasoning is wrong: this vault holds a 7200x5400 PNG, 155 MB once inflated,
// and honouring resizeWidth does not mean the decoder avoided inflating it.
// PNG especially, since the whole bitmap has to be reconstructed before
// anything can be scaled.
//
// 20 MP admits an ordinary phone photo (4032x3024 is 12.2 MP) with room to
// spare and refuses the pathological. Above it there is no thumbnail, which is
// the right trade: the event still renders and the app survives.
const MOBILE_PIXEL_BUDGET = 20_000_000;

// Map iteration order is insertion order, so it doubles as an LRU: on a hit we
// re-insert to mark most-recently-used, and evict from the front when over cap.
const cache = new Map<string, string | Promise<string>>();

/**
 * Whether createImageBitmap honours resizeWidth/resizeHeight here.
 *
 * When it does, the full-resolution bitmap is never materialised and a
 * multi-megapixel photo costs the same as a thumbnail. Chromium honours it,
 * which covers Obsidian on Android and desktop; WebKit has been patchy, so it
 * is probed once against a known 8x8 image rather than assumed from the
 * platform. A false here is what makes the pixel budget above load-bearing.
 */
let resizeSupport: Promise<boolean> | undefined;

// Which visible range the queue is working for. Flipping quickly left a
// backlog still decoding months already gone: measured as 14 decodes landing
// against 8 requests inside one flip's window, the surplus carried over from
// flips before it. A task reaching the front of the queue for a range nobody
// is looking at now is abandoned instead.
let generation = 0;

export function abandonQueuedDecodes(): void {
  generation++;
}

/**
 * Which decode path was taken, for the settings tab to report.
 *
 * On iOS there is no console to read without attaching a Mac, and the two
 * paths have very different characteristics, so the plugin says which one it
 * is on rather than leaving it to be inferred from whether it crashed.
 */
export type DecodePath = "unknown" | "resize-on-decode" | "full-then-downscale";
let decodePath: DecodePath = "unknown";

export function thumbnailDecodePath(): DecodePath {
  return decodePath;
}

export function canResizeOnDecode(): Promise<boolean> {
  if (resizeSupport === undefined) {
    resizeSupport = (async () => {
      try {
        const probe = document.createElement("canvas");
        probe.width = 8;
        probe.height = 8;
        const blob: Blob | null = await new Promise((resolve) =>
          probe.toBlob(resolve, "image/png"),
        );
        if (!blob) return false;
        const bmp = await createImageBitmap(blob, {
          resizeWidth: 4,
          resizeHeight: 4,
        });
        const honoured = bmp.width === 4 && bmp.height === 4;
        bmp.close();
        decodePath = honoured ? "resize-on-decode" : "full-then-downscale";
        return honoured;
      } catch {
        decodePath = "full-then-downscale";
        return false;
      }
    })();
  }
  return resizeSupport;
}

/**
 * Width and height read from the file header, without decoding it.
 *
 * Needed because the resize options want a target size and the only other way
 * to learn the source size is to decode, which is the cost being avoided.
 * JPEG and PNG are parsed exactly, since photos and screenshots are what
 * calendars carry; anything else returns undefined and takes the fallback
 * below, which caps one edge rather than both.
 */
async function intrinsicSize(
  blob: Blob,
): Promise<{ width: number; height: number } | undefined> {
  try {
    const head = new DataView(await blob.slice(0, 65536).arrayBuffer());
    if (head.byteLength < 24) return undefined;

    // PNG: an 8-byte signature, then IHDR carries width and height as u32.
    if (head.getUint32(0) === 0x89504e47 && head.getUint32(12) === 0x49484452) {
      return { width: head.getUint32(16), height: head.getUint32(20) };
    }

    // JPEG: walk the marker chain to a start-of-frame, which carries the size.
    // DHT/DAC/RST share the 0xC_ high nibble and are not frames.
    if (head.getUint16(0) === 0xffd8) {
      let i = 2;
      while (i + 9 < head.byteLength) {
        if (head.getUint8(i) !== 0xff) {
          i++;
          continue;
        }
        const marker = head.getUint8(i + 1);
        if (marker >= 0xc0 && marker <= 0xcf &&
            marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: head.getUint16(i + 5), width: head.getUint16(i + 7) };
        }
        if (marker === 0xd8 || marker === 0x01 ||
            (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        i += 2 + head.getUint16(i + 2);
      }
    }
  } catch {
    // A short read or a truncated file: fall through to the capped path.
  }
  return undefined;
}

function remember(key: string, value: string): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// --- priority concurrency gate -----------------------------------------------
// On-demand (visible) decodes take priority over prefetch: when a slot frees it
// goes to a waiting on-demand task first, so background prefetch of neighbouring
// months can never delay the thumbnails actually on screen.
let active = 0;
const hiWaiters: Array<() => void> = [];
const loWaiters: Array<() => void> = [];

function acquire(lowPriority: boolean): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) =>
    (lowPriority ? loWaiters : hiWaiters).push(resolve),
  );
}

function release(): void {
  const next = hiWaiters.shift() ?? loWaiters.shift();
  if (next) {
    next(); // hand off the slot without decrementing/incrementing `active`
  } else {
    active--;
  }
}

/**
 * Return a small (downscaled) data URL for `url`, decoding at most once per URL.
 * The longest edge is capped to a fixed size, preserving aspect ratio. Falls back
 * to the original `url` if decoding fails (e.g. a cross-origin external image
 * that can't be fetched) so the event still shows something. Pass
 * `{ prefetch: true }` for background warming — those decodes yield the pool to
 * on-demand (visible) ones.
 */
export function getScaledThumbnail(
  url: string,
  opts?: { prefetch?: boolean },
): Promise<string> {
  const key = url;
  noteRequest();
  const existing = cache.get(key);
  if (existing !== undefined) {
    if (typeof existing === "string") remember(key, existing); // refresh LRU
    return Promise.resolve(existing);
  }

  const task = scaleImage(url, !!opts?.prefetch, generation)
    .then((dataUrl) => {
      remember(key, dataUrl);
      return dataUrl;
    })
    .catch((e: unknown) => {
      noteError(e instanceof Error ? e.message : String(e));
      // Don't cache the failure, so a transient one is retried.
      cache.delete(key);
      // Desktop can afford to paint the original; mobile cannot. Falling back
      // to the full-resolution url there would hand the compositor exactly the
      // decode this module exists to avoid, which is how a safety valve turns
      // into the crash it was guarding. No thumbnail instead.
      return MOBILE ? "" : url;
    });

  cache.set(key, task);
  return task;
}

async function scaleImage(
  url: string,
  lowPriority: boolean,
  bornAt: number,
): Promise<string> {
  await acquire(lowPriority);
  try {
    // Waited behind other decodes, and the calendar has moved on since.
    if (bornAt !== generation) throw new Error("stale: range changed");
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
    const blob = await resp.blob();
    const sniffed = await intrinsicSize(blob);
    noteDecode(blob.size, blob.type || "unknown", sniffed?.width, sniffed?.height);

    // Checked against the header, the last point at which this costs nothing.
    if (MOBILE && sniffed &&
        sniffed.width * sniffed.height > MOBILE_PIXEL_BUDGET) {
      throw new Error(
        `${(sniffed.width * sniffed.height / 1e6).toFixed(1)} MP exceeds the ` +
          "mobile decode ceiling",
      );
    }

    const bitmap = await decodeSmall(blob);
    try {
      // Cap here as well as at decode. On the path where the engine resized
      // for us this is a 1:1 copy; on the path where it would not, this is
      // where the downscale actually happens.
      const scale = Math.min(
        1,
        DEFAULT_MAX_EDGE / Math.max(bitmap.width, bitmap.height),
      );
      const tw = Math.max(1, Math.round(bitmap.width * scale));
      const th = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d canvas context");
      ctx.drawImage(bitmap, 0, 0, tw, th);
      // JPEG keeps the data URL small; thumbnails are decorative so lossy is fine.
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      // Drop the backing store now rather than waiting for collection. A
      // canvas holds its pixels outside the JS heap, so a run of them can
      // outlive the garbage collector's interest in the small objects that
      // reference them.
      canvas.width = 0;
      canvas.height = 0;
      return dataUrl;
    } finally {
      bitmap.close();
    }
  } finally {
    // Yield before handing the slot on, so a long run of decodes gives the
    // engine a chance to reclaim the blobs and canvases behind it instead of
    // allocating the next one immediately on top.
    if (MOBILE) await new Promise((r) => window.setTimeout(r, 0));
    release();
  }
}

/** A bitmap no larger than DEFAULT_MAX_EDGE, decoded as cheaply as possible. */
async function decodeSmall(blob: Blob): Promise<ImageBitmap> {
  const edge = DEFAULT_MAX_EDGE;

  if (await canResizeOnDecode()) {
    const size = await intrinsicSize(blob);
    if (size) {
      // Known dimensions: ask for the exact target, and never upscale, since
      // an image already smaller than a thumbnail costs nothing to leave be.
      const scale = Math.min(1, edge / Math.max(size.width, size.height));
      return createImageBitmap(blob, {
        resizeWidth: Math.max(1, Math.round(size.width * scale)),
        resizeHeight: Math.max(1, Math.round(size.height * scale)),
        resizeQuality: "medium",
      });
    }
    // Unknown format. Capping width alone still bounds the decode: the height
    // that comes back is the source aspect times the cap, so a tall image is
    // taller than a thumbnail but nowhere near full resolution.
    return createImageBitmap(blob, { resizeWidth: edge, resizeQuality: "medium" });
  }

  // The size ceiling already ran against the header in scaleImage. What can
  // still arrive here is a format whose header we cannot read, and with no
  // resize to lean on there is no way to bound what decoding it would cost.
  if (MOBILE && !(await intrinsicSize(blob))) {
    throw new Error("unknown format, no safe way to bound the decode");
  }
  // Returned at full size deliberately: the caller downscales it onto the
  // canvas, because the resize options are exactly what this branch cannot use.
  return createImageBitmap(blob);
}

/** Drop all cached thumbnails (called on plugin unload). */
export function clearThumbnailCache(): void {
  cache.clear();
}
