import {
  BasesAllOptions,
  BasesEntry,
  BasesPropertyId,
  BasesView,
  DateValue,
  Menu,
  parsePropertyId,
  QueryController,
} from "obsidian";
import React, { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";
import {
  CalendarDisplayMode,
  CalendarHandle,
  CalendarReactView,
} from "./CalendarReactView";
import { AppContext } from "./context";
import { ColorPickerModal } from "./color-modal";
import type ObsidianCalendarPlugin from "./main";

export const CalendarViewType = "calendar-fork";

interface CalendarEntry {
  entry: BasesEntry;
  startDate: Date;
  endDate?: Date;
}

/**
 * Parse "value=color" color rules into a lowercased lookup map. Accepts the
 * multitext form (string[] of "meeting=#4f8ef7"), a single string with newline-
 * or comma-separated rules, or a YAML object map written directly in the base.
 */
function parseColorRules(value: unknown): Record<string, string> {
  const map: Record<string, string> = {};

  const addRule = (raw: string): void => {
    const sep = raw.search(/[=:]/);
    if (sep === -1) return;
    const key = raw.slice(0, sep).trim().toLowerCase();
    const color = raw.slice(sep + 1).trim();
    if (key && color) map[key] = color;
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") addRule(item);
    }
  } else if (typeof value === "string") {
    for (const line of value.split(/[\n,]/)) addRule(line);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) {
        map[k.trim().toLowerCase()] = v.trim();
      }
    }
  }

  return map;
}

/**
 * Coerce a config value to a "YYYY-MM-DD" string. Obsidian's YAML parses an
 * unquoted date like `2026-07-04` into a Date object, so handle both that and
 * plain/ISO strings; anything else becomes "".
 */
function toDateString(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  return m ? m[1] : "";
}

export class CalendarView extends BasesView {
  type = CalendarViewType;
  scrollEl: HTMLElement;
  containerEl: HTMLElement;
  root: Root | null = null;
  calendarHandleRef = React.createRef<CalendarHandle | null>();

  // Internal rendering data
  private entries: CalendarEntry[] = [];
  private startDateProp: BasesPropertyId | null = null;
  private endDateProp: BasesPropertyId | null = null;
  private weekStartDay: number = 1;
  private displayMode: CalendarDisplayMode = "block";
  private colorProp: BasesPropertyId | null = null;
  private colorByProp: BasesPropertyId | null = null;
  private colorMap: Record<string, string> = {};
  private showThumbnail: boolean = false;
  private imageProp: BasesPropertyId | null = null;
  private titleRegex: string = "";
  private maxEventsPerDay: number = 0;
  private windowStart: string = "";
  private windowEnd: string = "";
  // Global settings (linked-note color), read from the plugin in loadConfig.
  private categoryProperty: string = "";
  private linkedColorProperty: string = "color";

  constructor(
    controller: QueryController,
    scrollEl: HTMLElement,
    private plugin: ObsidianCalendarPlugin,
  ) {
    super(controller);
    this.scrollEl = scrollEl;
    this.containerEl = scrollEl.createDiv({
      cls: "bases-calendar-container is-loading",
      attr: { tabIndex: 0 },
    });
  }

  onload(): void {
    this.plugin.registerCalendarView(this);
  }

  onunload() {
    this.plugin.unregisterCalendarView(this);
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    this.entries = [];
  }

  onResize(): void {
    // Tell FullCalendar to recalculate dimensions (e.g. after tab switch)
    this.calendarHandleRef.current?.updateSize();
  }

  public focus(): void {
    this.containerEl.focus({ preventScroll: true });
  }

  public onDataUpdated(): void {
    this.containerEl.removeClass("is-loading");
    this.loadConfig();
    this.updateCalendar();
  }

  private loadConfig(): void {
    this.startDateProp = this.config.getAsPropertyId("startDate");
    this.endDateProp = this.config.getAsPropertyId("endDate");

    const dayNameToNumber: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };

    // Per-base value, else the global default, else Sunday.
    const weekStartName =
      (this.config.get("weekStartDay") as string) ||
      this.plugin.settings.defaultWeekStart ||
      "sunday";
    this.weekStartDay = dayNameToNumber[weekStartName] ?? 0;

    // Per-base value, else the global default, else block.
    const displayModeValue =
      (this.config.get("displayMode") as string) ||
      this.plugin.settings.defaultDisplayMode ||
      "block";
    this.displayMode = displayModeValue === "dot" ? "dot" : "block";

    this.colorProp = this.config.getAsPropertyId("colorProperty");
    this.colorByProp = this.config.getAsPropertyId("colorByProperty");
    this.colorMap = parseColorRules(this.config.get("colorRules"));
    this.showThumbnail = Boolean(this.config.get("showThumbnail"));
    this.imageProp = this.config.getAsPropertyId("imageProperty");
    this.titleRegex = (this.config.get("titleRegex") as string) || "";
    this.maxEventsPerDay =
      parseInt(this.config.get("maxEventsPerDay") as string, 10) || 0;
    this.windowStart = toDateString(this.config.get("windowStart"));
    this.windowEnd = toDateString(this.config.get("windowEnd"));

    // Linked-note color comes from global plugin settings.
    this.categoryProperty = this.plugin.settings.categoryProperty;
    this.linkedColorProperty =
      this.plugin.settings.linkedColorProperty || "color";
  }

  private updateCalendar(): void {
    if (!this.data || !this.startDateProp) {
      this.root?.unmount();
      this.root = null;
      this.containerEl.empty();
      this.containerEl.createDiv("bases-calendar-empty").textContent =
        "Configure a start date property to display entries";
      return;
    }

    this.entries = [];
    for (const entry of this.data.data) {
      const startDate = this.extractDate(entry, this.startDateProp);
      if (startDate) {
        const endDate = this.endDateProp
          ? (this.extractDate(entry, this.endDateProp) ?? undefined)
          : undefined;
        this.entries.push({
          entry,
          startDate,
          endDate,
        });
      }
    }

    this.renderReactCalendar();
  }

  private renderReactCalendar(): void {
    if (!this.root) {
      this.root = createRoot(this.containerEl);
    }

    // Override the default (uncolored) event color via a CSS variable; empty
    // falls back to the theme accent (see styles.css).
    const defaultColor = this.plugin.settings.defaultColor;
    if (defaultColor) {
      this.containerEl.style.setProperty("--cb-default-color", defaultColor);
    } else {
      this.containerEl.style.removeProperty("--cb-default-color");
    }

    this.root.render(
      <StrictMode>
        <AppContext.Provider value={this.app}>
          <CalendarReactView
            entries={this.entries}
            weekStartDay={this.weekStartDay}
            properties={this.config.getOrder() || []}
            displayMode={this.displayMode}
            colorProperty={this.colorProp}
            colorByProperty={this.colorByProp}
            colorMap={this.colorMap}
            categoryProperty={this.categoryProperty}
            linkedColorProperty={this.linkedColorProperty}
            showThumbnail={this.showThumbnail}
            imageProperty={this.imageProp}
            titleRegex={this.titleRegex}
            maxEventsPerDay={this.maxEventsPerDay}
            windowStart={this.windowStart}
            windowEnd={this.windowEnd}
            onEntryClick={(entry, isModEvent) => {
              void this.app.workspace.openLinkText(
                entry.file.path,
                "",
                isModEvent,
              );
            }}
            onEntryContextMenu={(evt, entry) => {
              evt.preventDefault();
              this.showEntryContextMenu(evt.nativeEvent, entry);
            }}
            onEventDrop={(entry, newStart, newEnd) =>
              this.updateEntryDates(entry, newStart, newEnd)
            }
            editable={this.isEditable()}
            calendarHandleRef={this.calendarHandleRef}
          />
        </AppContext.Provider>
      </StrictMode>,
    );
  }

  private isEditable(): boolean {
    if (!this.startDateProp) return false;
    const startDateProperty = parsePropertyId(this.startDateProp);
    if (startDateProperty.type !== "note") return false;

    if (!this.endDateProp) return true;
    const endDateProperty = parsePropertyId(this.endDateProp);
    if (endDateProperty.type !== "note") return false;

    return true;
  }

  private extractDate(entry: BasesEntry, propId: BasesPropertyId): Date | null {
    try {
      const value = entry.getValue(propId);
      if (!value) return null;
      if (!(value instanceof DateValue)) return null;
      // Private API
      if ("date" in value && value.date && value.date instanceof Date) {
        return value.date;
      }

      return null;
    } catch (error) {
      console.error(`Error extracting date for ${entry.file.name}:`, error);
      return null;
    }
  }

  private showEntryContextMenu(evt: MouseEvent, entry: BasesEntry): void {
    const file = entry.file;
    const menu = Menu.forEvent(evt);

    this.app.workspace.handleLinkContextMenu(menu, file.path, "");

    menu.addItem((item) =>
      item
        .setSection("action")
        .setTitle("Set color…")
        .setIcon("lucide-palette")
        .onClick(() => {
          const current =
            this.app.metadataCache.getCache(file.path)?.frontmatter?.color ??
            "";
          new ColorPickerModal(
            this.app,
            String(current),
            this.plugin.settings.palette,
            (color) => {
              void this.setEntryColor(entry, color);
            },
          ).open();
        }),
    );

    menu.addItem((item) =>
      item
        .setSection("danger")
        .setTitle("Delete file")
        .setIcon("lucide-trash-2")
        .setWarning(true)
        .onClick(() => this.app.fileManager.promptForDeletion(file)),
    );
  }

  private async setEntryColor(
    entry: BasesEntry,
    color: string | null,
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(entry.file, (frontmatter) => {
      if (color) {
        frontmatter.color = color;
      } else {
        delete frontmatter.color;
      }
    });
  }

  private async updateEntryDates(
    entry: BasesEntry,
    newStart: Date,
    newEnd?: Date,
  ): Promise<void> {
    if (!this.startDateProp) return;

    const file = entry.file;
    const startPropName = this.startDateProp;
    const endPropName = this.endDateProp;

    const extractedStartProp = startPropName.startsWith("note.")
      ? startPropName.slice(5)
      : null;

    const extractedEndProp = endPropName?.startsWith("note.")
      ? endPropName.slice(5)
      : null;

    const shouldUpdate =
      extractedStartProp !== null &&
      (!this.endDateProp || extractedEndProp !== null);

    if (!shouldUpdate) {
      return;
    }

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const formatDate = (date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      };

      frontmatter[extractedStartProp] = formatDate(newStart);
      if (this.endDateProp && newEnd && extractedEndProp) {
        frontmatter[extractedEndProp] = formatDate(newEnd);
      }
    });
  }

  public setEphemeralState(state: unknown): void {
    // State management could be extended for React component
  }

  public getEphemeralState(): unknown {
    return {};
  }

  static getViewOptions(): BasesAllOptions[] {
    return [
      {
        displayName: "Date properties",
        type: "group",
        items: [
          {
            displayName: "Start date",
            type: "property",
            key: "startDate",
            placeholder: "Property",
          },
          {
            displayName: "End date (optional)",
            type: "property",
            key: "endDate",
            placeholder: "Property",
          },
        ],
      },
      {
        displayName: "Calendar options",
        type: "group",
        items: [
          {
            displayName: "Week starts on",
            type: "dropdown",
            key: "weekStartDay",
            default: "",
            options: {
              "": "Use global default",
              sunday: "Sunday",
              monday: "Monday",
              tuesday: "Tuesday",
              wednesday: "Wednesday",
              thursday: "Thursday",
              friday: "Friday",
              saturday: "Saturday",
            },
          },
          {
            displayName: "Window start (YYYY-MM-DD)",
            type: "text",
            key: "windowStart",
            placeholder: "e.g. 2026-08-01",
          },
          {
            displayName: "Window end (YYYY-MM-DD)",
            type: "text",
            key: "windowEnd",
            placeholder: "e.g. 2026-09-30",
          },
        ],
      },
      {
        displayName: "Display",
        type: "group",
        items: [
          {
            displayName: "Display mode",
            type: "dropdown",
            key: "displayMode",
            default: "",
            options: {
              "": "Use global default",
              block: "Block",
              dot: "Dot",
            },
          },
          {
            displayName: "Color property",
            type: "property",
            key: "colorProperty",
            placeholder: "Property",
          },
          {
            displayName: "Color by property",
            type: "property",
            key: "colorByProperty",
            placeholder: "Property",
          },
          {
            displayName: "Color rules (value=color)",
            type: "multitext",
            key: "colorRules",
          },
          {
            displayName: "Show image thumbnail",
            type: "toggle",
            key: "showThumbnail",
            default: false,
          },
          {
            displayName: "Remove from title (regex)",
            type: "text",
            key: "titleRegex",
            placeholder: "^\\d{4}-\\d{2}-\\d{2}\\s*",
          },
          {
            displayName: "Image property (optional)",
            type: "property",
            key: "imageProperty",
            placeholder: "Property",
          },
          {
            displayName: "Max events per day",
            type: "text",
            key: "maxEventsPerDay",
            placeholder: "unlimited",
          },
        ],
      },
    ];
  }
}
