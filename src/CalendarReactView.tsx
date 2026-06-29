import type {
  EventApi,
  EventClickArg,
  EventContentArg,
  EventDropArg,
} from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import { App, BasesEntry, BasesPropertyId, DateValue, Value } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef } from "react";

import { useApp } from "./hooks";

export interface CalendarHandle {
  updateSize(): void;
}

export type CalendarDisplayMode = "block" | "dot";

interface CalendarReactViewProps {
  entries: CalendarEntry[];
  weekStartDay: number;
  properties: BasesPropertyId[];
  displayMode: CalendarDisplayMode;
  colorProperty: BasesPropertyId | null;
  colorByProperty: string;
  colorMap: Record<string, string>;
  categoryProperty: string;
  linkedColorProperty: string;
  showThumbnail: boolean;
  imageProperty: BasesPropertyId | null;
  titleRegex: string;
  maxEventsPerDay: number;
  windowStart: string;
  windowEnd: string;
  onEntryClick: (entry: BasesEntry, isModEvent: boolean) => void;
  onEntryContextMenu: (evt: React.MouseEvent, entry: BasesEntry) => void;
  onEventDrop?: (
    entry: BasesEntry,
    newStart: Date,
    newEnd?: Date,
  ) => Promise<void>;
  editable: boolean;
  calendarHandleRef?: React.RefObject<CalendarHandle | null>;
}

export const CalendarReactView: React.FC<CalendarReactViewProps> = ({
  entries,
  weekStartDay,
  properties,
  displayMode,
  colorProperty,
  colorByProperty,
  colorMap,
  categoryProperty,
  linkedColorProperty,
  showThumbnail,
  imageProperty,
  titleRegex,
  maxEventsPerDay,
  windowStart,
  windowEnd,
  onEntryClick,
  onEntryContextMenu,
  onEventDrop,
  editable,
  calendarHandleRef,
}) => {
  const app = useApp();
  const calendarRef = useRef<FullCalendar>(null);

  // On a fresh open, land on the most relevant month instead of always today:
  // the soonest upcoming event, else the most recent past event, else today.
  // Computed once at mount (empty deps) and passed as initialDate, which
  // FullCalendar only honours on mount — so later data refreshes never yank the
  // view away from where the user has navigated.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialDate = useMemo(() => computeRelevantDate(entries), []);

  // A fixed visible window (start–end). When set, the calendar shows exactly
  // this span instead of landing on the most relevant month. The range is
  // snapped to whole weeks so the grid wraps into clean week rows rather than
  // one long horizontal strip.
  const windowRange = useMemo(() => {
    const startRaw = parseLocalDate(windowStart);
    const endRaw = parseLocalDate(windowEnd);
    if (!startRaw || !endRaw) return null;
    const startOfWeek = (d: Date): Date => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      x.setDate(x.getDate() - ((x.getDay() - weekStartDay + 7) % 7));
      return x;
    };
    const start = startOfWeek(startRaw);
    const endExclusive = startOfWeek(endRaw);
    endExclusive.setDate(endExclusive.getDate() + 7); // week after the end week
    return { start, end: endExclusive };
  }, [windowStart, windowEnd, weekStartDay]);

  // The exact (un-snapped) window, used to fade days outside it.
  const exactWindow = useMemo(() => {
    const start = parseLocalDate(windowStart);
    const end = parseLocalDate(windowEnd);
    return start && end ? { start, end } : null;
  }, [windowStart, windowEnd]);

  const headerToolbar = {
    left: windowRange ? "" : "dayGridMonth,dayGridWeek",
    center: "title",
    right: "prevYear,prev,today,next,nextYear",
  };

  // When a fixed window is set, the grid is snapped to whole weeks, so
  // FullCalendar's auto title would show the snapped range. Override the title
  // formatter to show the actual clamped window dates instead. (Done via
  // titleFormat rather than mutating the DOM, which fights FullCalendar's own
  // render and duplicates the title.)
  const titleFormat = exactWindow
    ? () => formatWindowTitle(exactWindow.start, exactWindow.end)
    : undefined;
  // Shared hover parent so Page Preview can manage popover lifecycle —
  // when a new popover opens, the old one on the same parent is dismissed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hoverParentRef = useRef<{ hoverPopover: any }>({ hoverPopover: null });

  // Expose updateSize to the parent view for resize/tab-switch handling
  useEffect(() => {
    if (calendarHandleRef) {
      (calendarHandleRef as React.RefObject<CalendarHandle | null>).current = {
        updateSize: () => calendarRef.current?.getApi().updateSize(),
      };
    }
    return () => {
      if (calendarHandleRef) {
        (calendarHandleRef as React.RefObject<CalendarHandle | null>).current = null;
      }
    };
  }, [calendarHandleRef]);

  const events = entries.map((calEntry) => {
    // FullCalendar treats end dates as exclusive when allDay is true
    // We need to add one day to the end date to make it inclusive
    // But if start and end are the same day, we don't set an end date (single day event)
    let adjustedEndDate = calEntry.endDate;
    if (calEntry.endDate) {
      const startDateOnly = new Date(
        calEntry.startDate.getFullYear(),
        calEntry.startDate.getMonth(),
        calEntry.startDate.getDate(),
      );
      const endDateOnly = new Date(
        calEntry.endDate.getFullYear(),
        calEntry.endDate.getMonth(),
        calEntry.endDate.getDate(),
      );

      if (startDateOnly.getTime() === endDateOnly.getTime()) {
        // Same day event - don't set end date to avoid showing as multi-day
        adjustedEndDate = undefined;
      } else {
        // Multi-day event - add one day to make end date inclusive
        adjustedEndDate = new Date(calEntry.endDate);
        adjustedEndDate.setDate(adjustedEndDate.getDate() + 1);
      }
    }

    const color = app
      ? extractColor(app, calEntry.entry, {
          colorProperty,
          colorByProperty,
          colorMap,
          categoryProperty,
          linkedColorProperty,
        })
      : undefined;
    const thumbnailUrl =
      showThumbnail && app
        ? resolveThumbnailUrl(app, calEntry.entry, imageProperty)
        : undefined;

    const isMultiDay = adjustedEndDate !== undefined;

    return {
      id: calEntry.entry.file.path,
      title: cleanTitle(calEntry.entry.file.basename, titleRegex),
      start: calEntry.startDate,
      end: adjustedEndDate,
      allDay: true,
      // In dot mode, single-day events render as a dot (list-item) while
      // multi-day events render as a spanning bar (block) so they read as
      // multi-day. Block mode uses the default ("auto").
      display:
        displayMode === "dot"
          ? isMultiDay
            ? "block"
            : "list-item"
          : undefined,
      // `color` sets both background and border; leaving it undefined falls back
      // to the default event background defined in styles.css.
      ...(color ? { color } : {}),
      extendedProps: {
        entry: calEntry.entry,
        originalEndDate: calEntry.endDate, // Keep track of original end date for drag operations
        dotColor: color,
        thumbnailUrl,
        isMultiDay,
      },
    };
  });

  const handleEventClick = useCallback(
    (clickInfo: EventClickArg) => {
      const target = clickInfo.jsEvent.target as HTMLElement;
      const entry = clickInfo.event.extendedProps.entry as BasesEntry;
      const isModEvent = clickInfo.jsEvent.ctrlKey || clickInfo.jsEvent.metaKey;

      // Let interactive elements inside the event handle the click instead of opening the note
      const clickedTag = target.closest("a.tag");
      if (clickedTag) {
        return;
      }

      const clickedLink = target.closest(".internal-link") as HTMLElement | null;
      if (clickedLink) {
        return;
      }

      const clickedExternal = target.closest("a.external-link") as
        | HTMLAnchorElement
        | undefined;
      if (clickedExternal?.href) {
        return;
      }

      // Default: open the event's note
      clickInfo.jsEvent.preventDefault();
      onEntryClick(entry, isModEvent);
    },
    [app, onEntryClick],
  );

  // Track contextmenu listeners per element to prevent duplicates across hover cycles
  const contextMenuListenersRef = useRef(new WeakMap<HTMLElement, (evt: Event) => void>());

  const handleEventMouseEnter = useCallback(
    (mouseEnterInfo: { event: EventApi; el: HTMLElement; jsEvent: MouseEvent }) => {
      const entry = mouseEnterInfo.event.extendedProps.entry as BasesEntry;
      const el = mouseEnterInfo.el;

      if (app) {
        app.workspace.trigger("hover-link", {
          event: mouseEnterInfo.jsEvent,
          source: "bases",
          hoverParent: hoverParentRef.current,
          targetEl: el,
          linktext: entry.file.path,
        });
      }

      // Remove previous contextmenu listener if one exists (prevents duplicates)
      const prevHandler = contextMenuListenersRef.current.get(el);
      if (prevHandler) {
        el.removeEventListener("contextmenu", prevHandler);
      }

      const contextMenuHandler = (evt: Event) => {
        evt.preventDefault();
        const syntheticEvent = {
          nativeEvent: evt as MouseEvent,
          currentTarget: el,
          target: evt.target as HTMLElement,
          preventDefault: () => evt.preventDefault(),
          stopPropagation: () => evt.stopPropagation(),
        } as unknown as React.MouseEvent;
        onEntryContextMenu(syntheticEvent, entry);
      };
      contextMenuListenersRef.current.set(el, contextMenuHandler);
      el.addEventListener("contextmenu", contextMenuHandler);
    },
    [app, onEntryContextMenu],
  );

  const handleEventDrop = useCallback(
    async (dropInfo: EventDropArg) => {
      if (!onEventDrop) {
        dropInfo.revert();
        return;
      }

      const entry = dropInfo.event.extendedProps.entry as BasesEntry;
      const originalEndDate = dropInfo.event.extendedProps.originalEndDate as
        | Date
        | undefined;
      const newStart = dropInfo.event.start;
      const newEnd = dropInfo.event.end;

      if (!newStart) {
        dropInfo.revert();
        return;
      }

      // Calculate the actual end date to save
      let actualEndDate: Date | undefined = undefined;
      if (originalEndDate) {
        if (newEnd) {
          // FullCalendar gave us an adjusted end date, we need to subtract one day to get the actual end date
          actualEndDate = new Date(newEnd);
          actualEndDate.setDate(actualEndDate.getDate() - 1);
        } else {
          // Single day event - use the start date as the end date
          actualEndDate = new Date(newStart);
        }
      }

      try {
        await onEventDrop(entry, newStart, actualEndDate);
      } catch {
        dropInfo.revert();
      }
    },
    [onEventDrop],
  );

  const hasNonEmptyValue = useCallback((value: Value): boolean => {
    if (!value || !value.isTruthy()) return false;
    const str = value.toString();
    return Boolean(str && str.trim().length > 0);
  }, []);

  const PropertyValue: React.FC<{ value: Value }> = ({ value }) => {
    const elementRef = useCallback(
      (node: HTMLElement | null) => {
        if (node && app) {
          // Remove previous content (due to React strict mode causing double calls)
          while (node.firstChild) {
            node.removeChild(node.firstChild);
          }

          if (!(value instanceof DateValue)) {
            value.renderTo(node, app.renderContext);
            return;
          }

          // Special handling for DateValue to show in a more compact format
          if ("date" in value && value.date && value.date instanceof Date) {
            if ("time" in value && value.time) {
              node.appendChild(
                document.createTextNode(
                  value.date.toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                ),
              );
            } else {
              node.appendChild(
                document.createTextNode(
                  value.date.toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  }),
                ),
              );
            }

            return;
          }
        }
      },
      [value],
    );

    return <span ref={elementRef} />;
  };

  const renderEventContent = useCallback(
    (eventInfo: EventContentArg) => {
      if (!app) return null;

      const entry = eventInfo.event.extendedProps.entry as BasesEntry;

      // Compact dot display — single-day events show a colored dot + title;
      // multi-day events render as a thin spanning bar (just the title) so they
      // clearly read as multi-day.
      if (displayMode === "dot") {
        const isMultiDay = eventInfo.event.extendedProps.isMultiDay as boolean;
        if (isMultiDay) {
          return (
            <div className="cbfork-event-dot-bar">
              {eventInfo.event.title}
            </div>
          );
        }
        const dotColor = eventInfo.event.extendedProps.dotColor as
          | string
          | undefined;
        return (
          <div className="cbfork-event-dot-row">
            <span
              className="cbfork-event-dot"
              style={dotColor ? { backgroundColor: dotColor } : undefined}
            />
            <span className="cbfork-event-dot-title">
              {eventInfo.event.title}
            </span>
          </div>
        );
      }

      const thumbnailUrl = eventInfo.event.extendedProps.thumbnailUrl as
        | string
        | undefined;

      const validProperties: { propertyId: BasesPropertyId; value: Value }[] =
        [];
      for (const prop of properties) {
        const value = tryGetValue(entry, prop);
        if (value && hasNonEmptyValue(value)) {
          validProperties.push({ propertyId: prop, value });
        }
      }

      // Render a property value, but substitute the cleaned event title for the
      // file.name property so the title-regex (date removal) takes effect.
      const renderProp = (propertyId: BasesPropertyId, value: Value) =>
        propertyId === "file.name" ? (
          <>{eventInfo.event.title}</>
        ) : (
          <PropertyValue value={value} />
        );

      const body =
        validProperties.length > 0 ? (
          <>
            <div className="cbfork-event-title">
              {renderProp(
                validProperties[0].propertyId,
                validProperties[0].value,
              )}
            </div>
            {validProperties.length > 1 && (
              <div className="cbfork-event-properties">
                {validProperties.slice(1).map(({ propertyId: prop, value }) => (
                  <div key={prop} className="cbfork-event-property">
                    <span className="cbfork-event-property-value">
                      {renderProp(prop, value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          // Fallback to the (cleaned) event title if no properties
          <div className="cbfork-event-title">
            {eventInfo.event.title}
          </div>
        );

      // With a thumbnail, render an image card: the image fills the event box
      // and the text sits on a translucent band of the event's color.
      if (thumbnailUrl) {
        const evColor = eventInfo.event.extendedProps.dotColor as
          | string
          | undefined;
        return (
          <div
            className="cbfork-event-card"
            style={{ backgroundImage: `url("${cssUrl(thumbnailUrl)}")` }}
          >
            <div
              className="cbfork-event-overlay"
              style={
                evColor
                  ? {
                      background: `color-mix(in srgb, ${evColor} 80%, transparent)`,
                    }
                  : undefined
              }
            >
              {body}
            </div>
          </div>
        );
      }

      return (
        <div className="cbfork-event-content">
          <div className="cbfork-event-body">{body}</div>
        </div>
      );
    },
    [properties, app, hasNonEmptyValue, displayMode],
  );

  return (
    <FullCalendar
      ref={calendarRef}
      // Remount when mount-time view config changes (window span, week start,
      // display mode) so initialView/initialDate/visibleRange re-apply — without
      // this, setting or clearing the window leaves a stale single-day view.
      // The key excludes `entries`, so ordinary data updates don't remount and
      // the user's navigation is preserved.
      key={`${windowStart}|${windowEnd}|${weekStartDay}|${displayMode}`}
      plugins={[dayGridPlugin, interactionPlugin]}
      initialView={windowRange ? "dayGrid" : "dayGridMonth"}
      initialDate={windowRange ? undefined : initialDate}
      visibleRange={windowRange ?? undefined}
      firstDay={weekStartDay}
      headerToolbar={headerToolbar}
      titleFormat={titleFormat}
      buttonText={{
        today: "Today",
        month: "Month",
        week: "Week",
      }}
      navLinks={false}
      events={events}
      eventContent={renderEventContent}
      dayMaxEvents={maxEventsPerDay > 0 ? maxEventsPerDay : false}
      dayCellClassNames={(arg) => {
        if (!exactWindow) return [];
        const t = arg.date.getTime();
        return t < exactWindow.start.getTime() || t > exactWindow.end.getTime()
          ? ["cb-out-of-window"]
          : [];
      }}
      eventClassNames={(arg) => {
        const cls: string[] = [];
        if (displayMode === "dot" && arg.event.extendedProps.isMultiDay) {
          cls.push("cb-dot-bar");
        }
        if (displayMode !== "dot" && arg.event.extendedProps.thumbnailUrl) {
          cls.push("cbfork-has-thumb");
        }
        return cls;
      }}
      eventClick={handleEventClick}
      eventMouseEnter={handleEventMouseEnter}
      eventDrop={(info) => void handleEventDrop(info)}
      height="auto"
      views={{
        // 6-week fixed height in month view; a single week in week view
        // (fixedWeekCount defaults to true and would otherwise expand the
        // week view to a full month grid).
        dayGridMonth: { fixedWeekCount: true },
        dayGridWeek: { fixedWeekCount: false },
      }}
      fixedMirrorParent={document.body ?? undefined}
      eventDurationEditable={false}
      editable={editable}
    />
  );
};

interface CalendarEntry {
  entry: BasesEntry;
  startDate: Date;
  endDate?: Date;
}

function tryGetValue(entry: BasesEntry, propId: BasesPropertyId): Value | null {
  try {
    return entry.getValue(propId);
  } catch {
    return null;
  }
}

/** Escape a URL for safe use inside a CSS url("...") value. */
function cssUrl(url: string): string {
  return url.replace(/["\\]/g, (c) => "\\" + c);
}

/** Format a window range like FullCalendar's title, e.g. "Jul 4 – 12, 2026". */
function formatWindowTitle(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const startStr = start.toLocaleDateString(undefined, opts);
  const sameMonth =
    start.getMonth() === end.getMonth() &&
    start.getFullYear() === end.getFullYear();
  const endStr = sameMonth
    ? String(end.getDate())
    : end.toLocaleDateString(undefined, opts);
  return `${startStr} – ${endStr}, ${end.getFullYear()}`;
}

/** Parse a "YYYY-MM-DD" string to a local Date, or null if invalid. */
function parseLocalDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((value || "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Strip matches of a user-supplied regex from the event title (e.g. remove a
 * leading date from the file name). Invalid patterns are ignored.
 */
function cleanTitle(name: string, pattern: string): string {
  if (!pattern) return name;
  try {
    const cleaned = name.replace(new RegExp(pattern, "g"), "").trim();
    return cleaned.length > 0 ? cleaned : name;
  } catch {
    return name;
  }
}

/**
 * Choose the most relevant month to land on when the calendar opens fresh:
 * the soonest upcoming event, else the most recent past event, else today.
 */
function computeRelevantDate(entries: CalendarEntry[]): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  let soonestUpcoming: Date | null = null;
  let mostRecentPast: Date | null = null;

  for (const { startDate } of entries) {
    const day = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate(),
    );
    if (day.getTime() >= todayMs) {
      if (!soonestUpcoming || day < soonestUpcoming) soonestUpcoming = day;
    } else {
      if (!mostRecentPast || day > mostRecentPast) mostRecentPast = day;
    }
  }

  return soonestUpcoming ?? mostRecentPast ?? today;
}

interface ColorConfig {
  colorProperty: BasesPropertyId | null;
  colorByProperty: string;
  colorMap: Record<string, string>;
  categoryProperty: string;
  linkedColorProperty: string;
}

/**
 * Resolve an event color, in order of precedence:
 *  1. An explicit `color` frontmatter value (what right-click → Set color writes).
 *  2. A literal color (hex or CSS name) read from `colorProperty`.
 *  3. A value→color rule: `colorByProperty` looked up in `colorMap` (e.g. type
 *     "meeting" → blue). Multi-value properties match the whole value, then any
 *     comma-separated token.
 *  4. A linked-note color: follow `categoryProperty`'s [[link]] and read the
 *     target note's `linkedColorProperty` (e.g. type: [[restaurant]] → orange).
 * Returns undefined when nothing matches (the CSS default/accent then applies).
 */
function extractColor(
  app: App,
  entry: BasesEntry,
  cfg: ColorConfig,
): string | undefined {
  // 1. Explicit per-note color frontmatter (set via right-click).
  const explicit = app.metadataCache.getCache(entry.file.path)?.frontmatter
    ?.color;
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }

  // 2. Configured literal color property.
  if (cfg.colorProperty) {
    const value = tryGetValue(entry, cfg.colorProperty);
    if (value && value.isTruthy()) {
      const str = value.toString().trim();
      if (str.length > 0) return str;
    }
  }

  // 3. value→color rules (global): match the named frontmatter property's
  // value(s) against the rule map.
  if (cfg.colorByProperty && Object.keys(cfg.colorMap).length > 0) {
    const raw = app.metadataCache.getCache(entry.file.path)?.frontmatter?.[
      cfg.colorByProperty
    ];
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      if (typeof v !== "string") continue;
      const key = v.trim().toLowerCase();
      if (key && cfg.colorMap[key]) return cfg.colorMap[key];
    }
  }

  // 4. Color from a linked category note.
  if (cfg.categoryProperty) {
    const linked = resolveLinkedColor(
      app,
      entry,
      cfg.categoryProperty,
      cfg.linkedColorProperty,
    );
    if (linked) return linked;
  }

  return undefined;
}

/**
 * Follow a frontmatter property that links to a category note (e.g.
 * `type: "[[restaurant]]"`) and read a color property from that note
 * (e.g. restaurant.md → `color: orange`). Mirrors the user's vault pattern.
 */
function resolveLinkedColor(
  app: App,
  entry: BasesEntry,
  categoryProperty: string,
  linkedColorProperty: string,
): string | undefined {
  const sourcePath = entry.file.path;
  const fm = app.metadataCache.getCache(sourcePath)?.frontmatter;
  if (!fm) return undefined;

  const rawValue = fm[categoryProperty];
  if (rawValue === undefined || rawValue === null) return undefined;
  const first = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof first !== "string" || !first.trim()) return undefined;

  // Strip a [[wikilink]] (optionally with alias) down to its linkpath.
  const wiki = first.match(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
  const linkpath = (wiki ? wiki[1] : first).trim();
  if (!linkpath) return undefined;

  const dest = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
  if (!dest) return undefined;

  const targetColor = app.metadataCache.getFileCache(dest)?.frontmatter?.[
    linkedColorProperty
  ];
  return typeof targetColor === "string" && targetColor.trim()
    ? targetColor.trim()
    : undefined;
}

/**
 * Resolve a thumbnail URL for an entry: the configured image property if set
 * (wikilink, vault path, or external URL), otherwise the note's first embed.
 */
function resolveThumbnailUrl(
  app: App,
  entry: BasesEntry,
  imageProperty: BasesPropertyId | null,
): string | undefined {
  const sourcePath = entry.file.path;

  const resolveLinkpath = (linkpath: string): string | undefined => {
    const dest = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    return dest ? app.vault.getResourcePath(dest) : undefined;
  };

  if (imageProperty) {
    const value = tryGetValue(entry, imageProperty);
    if (value && value.isTruthy()) {
      let raw = value.toString().trim();
      if (raw.length > 0) {
        if (/^https?:\/\//i.test(raw)) return raw;
        // Strip wikilink/markdown-image wrappers: [[img]], ![[img]], ![](img)
        const wiki = raw.match(/!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
        if (wiki) raw = wiki[1].trim();
        const md = raw.match(/!?\[[^\]]*\]\(([^)]+)\)/);
        if (md) raw = md[1].trim();
        if (/^https?:\/\//i.test(raw)) return raw;
        const resolved = resolveLinkpath(raw);
        if (resolved) return resolved;
      }
    }
  }

  // Fall back to the first embed in the note body.
  const cache = app.metadataCache.getCache(sourcePath);
  const firstEmbed = cache?.embeds?.[0];
  if (firstEmbed) {
    return resolveLinkpath(firstEmbed.link);
  }

  return undefined;
}
