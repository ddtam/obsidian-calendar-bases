// What the thumbnail path actually did, persisted so it survives the crash.
//
// An out-of-memory kill on iOS takes the WebView with it, so counters held in
// memory die with the evidence. These are flushed to plugin data on a short
// debounce, which means that after a crash the last write is at most a second
// stale and says what was in flight. There is no console on iOS without
// attaching a Mac, so the settings tab is where they are read.
//
// Diagnostic only. Remove once the cause is settled.

export interface ThumbnailStats {
  /** When the calendar last changed its visible range. */
  lastFlip: string;
  /** Thumbnails asked for since that flip, and how many were cache misses. */
  requested: number;
  decoded: number;
  /** Source bytes fetched since that flip. */
  bytes: number;
  /** The largest source seen, by pixel count, and its dimensions. */
  maxPixels: number;
  maxDims: string;
  /** Formats seen, by sniffed header. */
  formats: string[];
  /** Decodes that threw, with the first message. */
  errors: number;
  firstError: string;
}

const EMPTY: ThumbnailStats = {
  lastFlip: "never",
  requested: 0,
  decoded: 0,
  bytes: 0,
  maxPixels: 0,
  maxDims: "-",
  formats: [],
  errors: 0,
  firstError: "",
};

let stats: ThumbnailStats = { ...EMPTY };
let flush: ((s: ThumbnailStats) => void) | undefined;
let timer = 0;

/** The plugin supplies the writer; without one the counters are in-memory only. */
export function setStatsWriter(fn: (s: ThumbnailStats) => void): void {
  flush = fn;
}

function schedule(): void {
  if (timer || !flush) return;
  timer = window.setTimeout(() => {
    timer = 0;
    flush?.({ ...stats, formats: [...stats.formats] });
  }, 500);
}

export function noteFlip(label: string): void {
  stats = { ...EMPTY, lastFlip: label };
  schedule();
}

export function noteRequest(): void {
  stats.requested++;
  schedule();
}

export function noteDecode(
  bytes: number,
  format: string,
  width?: number,
  height?: number,
): void {
  stats.decoded++;
  stats.bytes += bytes;
  if (!stats.formats.includes(format)) stats.formats.push(format);
  if (width && height && width * height > stats.maxPixels) {
    stats.maxPixels = width * height;
    stats.maxDims = `${width}x${height}`;
  }
  schedule();
}

export function noteError(message: string): void {
  stats.errors++;
  if (!stats.firstError) stats.firstError = message.slice(0, 120);
  schedule();
}

export function readStats(saved?: Partial<ThumbnailStats>): ThumbnailStats {
  // Prefer the persisted copy: after a crash it is the only one that exists.
  return { ...EMPTY, ...(saved ?? {}) };
}
