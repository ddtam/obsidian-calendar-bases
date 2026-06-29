import { Plugin, QueryController } from "obsidian";
import { CalendarView, CalendarViewType } from "./calendar-view";
import {
  CalendarBasesSettings,
  CalendarBasesSettingTab,
  DEFAULT_SETTINGS,
} from "./settings";

export default class ObsidianCalendarPlugin extends Plugin {
  settings: CalendarBasesSettings = { ...DEFAULT_SETTINGS };
  private views: Set<CalendarView> = new Set();

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    // Register "bases" as a hover source that doesn't require CMD/CTRL
    // so Page Preview shows on regular hover over calendar events
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.app.workspace as any).hoverLinkSources["bases"] = {
      display: "Calendar Bases",
      defaultMod: false,
    };

    const viewConfig = {
      name: "Calendar",
      icon: "lucide-calendar",
      factory: (controller: QueryController, containerEl: HTMLElement) =>
        new CalendarView(controller, containerEl, this),
      options: () => CalendarView.getViewOptions(),
    };
    // Primary: the same view type as the original plugin (drop-in).
    this.registerBasesView(CalendarViewType, viewConfig);
    // Backward-compat alias so bases still on the old `calendar-fork` type (or
    // restored to it by sync) keep rendering instead of erroring.
    this.registerBasesView("calendar-fork", {
      ...viewConfig,
      name: "Calendar (legacy type)",
    });

    this.addSettingTab(new CalendarBasesSettingTab(this.app, this));
  }

  onunload() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (this.app.workspace as any).hoverLinkSources["bases"];
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshViews();
  }

  registerCalendarView(view: CalendarView): void {
    this.views.add(view);
  }

  unregisterCalendarView(view: CalendarView): void {
    this.views.delete(view);
  }

  /** Re-render all open calendar views (e.g. after a settings change). */
  refreshViews(): void {
    for (const view of this.views) {
      view.onDataUpdated();
    }
  }
}
