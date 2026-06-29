import { Plugin } from "obsidian";
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

    // Drop-in: register the same `calendar` view type as the original plugin.
    this.registerBasesView(CalendarViewType, {
      name: "Calendar",
      icon: "lucide-calendar",
      factory: (controller, containerEl) =>
        new CalendarView(controller, containerEl, this),
      options: () => CalendarView.getViewOptions(),
    });

    this.addSettingTab(new CalendarBasesSettingTab(this.app, this));

    // Self-heal bases that still use (or are reverted by sync to) the old
    // `calendar-fork` view type, so they render and we don't need to register a
    // second "(legacy)" entry in the view picker.
    this.app.workspace.onLayoutReady(() => void this.migrateLegacyViewType());
  }

  onunload() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (this.app.workspace as any).hoverLinkSources["bases"];
  }

  /** Rewrite any `type: calendar-fork` in .base files to `type: calendar`. */
  private async migrateLegacyViewType(): Promise<void> {
    const files = this.app.vault
      .getFiles()
      .filter((f) => f.extension === "base");
    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        if (content.includes("calendar-fork")) {
          await this.app.vault.modify(
            file,
            content.replace(/(type:\s*)calendar-fork\b/g, "$1calendar"),
          );
        }
      } catch {
        // ignore unreadable/locked files
      }
    }
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
