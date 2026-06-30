import { App, getIconIds, Modal, setIcon } from "obsidian";
import type ObsidianCalendarPlugin from "./main";

const LUCIDE_NAME_RE = /^[a-z0-9-]+$/;
const MAX_RECENTS = 24;
const MAX_RESULTS = 60;

/** Render an icon value into an element: Lucide name via setIcon, else text. */
function renderIconInto(el: HTMLElement, value: string): void {
  el.textContent = "";
  if (!value) return;
  if (LUCIDE_NAME_RE.test(value)) {
    setIcon(el, value);
    if (!el.firstElementChild) el.textContent = value;
  } else {
    el.textContent = value;
  }
}

/** All Lucide icon names (deduped, "lucide-" prefix stripped). Computed once. */
let lucideNamesCache: string[] | null = null;
function lucideNames(): string[] {
  if (lucideNamesCache) return lucideNamesCache;
  const seen = new Set<string>();
  for (const id of getIconIds()) {
    const name = id.replace(/^lucide-/, "");
    if (LUCIDE_NAME_RE.test(name)) seen.add(name);
  }
  lucideNamesCache = [...seen].sort();
  return lucideNamesCache;
}

/**
 * Pick an icon for a single event. `onSubmit` receives the icon string, or null
 * to clear it. The value can be an emoji/symbol or a Lucide icon name. Shows
 * recently-used icons by default and searches Lucide icons as you type; picks
 * are recorded to the plugin's recent-icons list.
 */
export class IconPickerModal extends Modal {
  private value: string;

  constructor(
    app: App,
    private plugin: ObsidianCalendarPlugin,
    initial: string,
    private onSubmit: (icon: string | null) => void,
  ) {
    super(app);
    this.value = initial && initial.trim() ? initial.trim() : "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Set event icon" });
    contentEl.createEl("p", {
      cls: "cb-icon-hint",
      text: "Search Lucide icons by name, or type/paste an emoji and press Enter. Recently used shown below.",
    });

    const preview = contentEl.createDiv({ cls: "cb-icon-preview" });
    renderIconInto(preview, this.value);

    const search = contentEl.createEl("input", {
      cls: "cb-icon-search",
      attr: { type: "text", placeholder: "Search icons, or type an emoji…" },
    });
    search.value = this.value;

    const grid = contentEl.createDiv({ cls: "cb-icon-results" });

    const renderResults = (query: string) => {
      grid.empty();
      const q = query.trim().toLowerCase();
      let items: string[];
      if (!q) {
        items = this.plugin.settings.recentIcons.slice(0, MAX_RECENTS);
        if (!items.length) {
          grid.createEl("div", {
            cls: "cb-icon-empty",
            text: "No recent icons yet — search above or type an emoji.",
          });
          return;
        }
      } else {
        // Prefix matches first, then substring matches.
        const names = lucideNames();
        const prefix = names.filter((n) => n.startsWith(q));
        const sub = names.filter((n) => !n.startsWith(q) && n.includes(q));
        items = [...prefix, ...sub].slice(0, MAX_RESULTS);
        if (!items.length) {
          grid.createEl("div", {
            cls: "cb-icon-empty",
            text: "No matching Lucide icons. Type/paste an emoji and press Enter.",
          });
          return;
        }
      }
      for (const value of items) {
        const b = grid.createEl("button", {
          cls: "cb-icon-result",
          attr: { "aria-label": value, title: value },
        });
        renderIconInto(b, value);
        b.onclick = () => void this.pick(value);
      }
    };

    search.addEventListener("input", () => {
      this.value = search.value;
      renderIconInto(preview, this.value.trim());
      renderResults(search.value);
    });
    search.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const v = search.value.trim();
        if (v) void this.pick(v);
      }
    });

    const actions = contentEl.createDiv({ cls: "cb-icon-actions" });
    const clearBtn = actions.createEl("button", { text: "Clear icon" });
    clearBtn.addClass("mod-warning");
    clearBtn.onclick = () => {
      this.onSubmit(null);
      this.close();
    };
    const cancelBtn = actions.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => this.close();

    renderResults("");
    window.setTimeout(() => search.focus(), 0);
  }

  private async pick(value: string): Promise<void> {
    const recents = this.plugin.settings.recentIcons.filter((x) => x !== value);
    recents.unshift(value);
    this.plugin.settings.recentIcons = recents.slice(0, MAX_RECENTS);
    await this.plugin.saveSettings();
    this.onSubmit(value);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
