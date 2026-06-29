import { App, PluginSettingTab, Setting } from "obsidian";
import { toHex } from "./color-modal";
import type ObsidianCalendarPlugin from "./main";

export interface CalendarBasesSettings {
  /** Color for events that have no color of their own. Empty = theme accent. */
  defaultColor: string;
  /**
   * A frontmatter property whose [[linked note]] holds the event color
   * (e.g. "type" or "location type"). Empty disables linked-note coloring.
   */
  categoryProperty: string;
  /** The property on the linked category note that holds the color. */
  linkedColorProperty: string;
  /** A frontmatter property whose value is matched against colorRules. */
  colorByProperty: string;
  /** value→color rules applied vault-wide (matched against colorByProperty). */
  colorRules: { value: string; color: string }[];
  /** Preset swatches shown in the right-click "Set color" picker. */
  palette: string[];
  /** Default display mode for calendar views that don't set their own. */
  defaultDisplayMode: "block" | "dot";
  /** Default week start (day name) for views that don't set their own. */
  defaultWeekStart: string;
  /** In dot mode, an event's icon replaces the colored dot. */
  iconReplacesDot: boolean;
}

export const DEFAULT_PALETTE: string[] = [
  "#e0533d",
  "#e0813d",
  "#e0c23d",
  "#3da35d",
  "#4f8ef7",
  "#9b59b6",
  "#8a8a8a",
];

export const DEFAULT_SETTINGS: CalendarBasesSettings = {
  defaultColor: "",
  categoryProperty: "",
  linkedColorProperty: "color",
  colorByProperty: "",
  colorRules: [],
  palette: [...DEFAULT_PALETTE],
  defaultDisplayMode: "block",
  defaultWeekStart: "sunday",
  iconReplacesDot: true,
};

/** Resolve the current theme accent color to a hex string for the color picker. */
function getAccentHex(): string {
  const probe = document.body.createSpan();
  probe.style.color = "var(--interactive-accent)";
  probe.style.display = "none";
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return "#7c3aed";
  return (
    "#" +
    m
      .slice(0, 3)
      .map((x) => Number(x).toString(16).padStart(2, "0"))
      .join("")
  );
}

export class CalendarBasesSettingTab extends PluginSettingTab {
  plugin: ObsidianCalendarPlugin;

  constructor(app: App, plugin: ObsidianCalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("New view defaults").setHeading();

    new Setting(containerEl)
      .setName("Default display mode")
      .setDesc("Used by calendar views that don't set their own display mode.")
      .addDropdown((d) => {
        d.addOptions({ block: "Block", dot: "Dot" })
          .setValue(this.plugin.settings.defaultDisplayMode)
          .onChange(async (value) => {
            this.plugin.settings.defaultDisplayMode =
              value === "dot" ? "dot" : "block";
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Default week starts on")
      .setDesc("Used by calendar views that don't set their own week start.")
      .addDropdown((d) => {
        d.addOptions({
          sunday: "Sunday",
          monday: "Monday",
          tuesday: "Tuesday",
          wednesday: "Wednesday",
          thursday: "Thursday",
          friday: "Friday",
          saturday: "Saturday",
        })
          .setValue(this.plugin.settings.defaultWeekStart)
          .onChange(async (value) => {
            this.plugin.settings.defaultWeekStart = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Icon replaces the dot")
      .setDesc(
        "In dot mode, an event's icon (from its Icon property) replaces the colored dot. Turn off to keep the dot and show the icon before the title.",
      )
      .addToggle((t) => {
        t.setValue(this.plugin.settings.iconReplacesDot).onChange(
          async (value) => {
            this.plugin.settings.iconReplacesDot = value;
            await this.plugin.saveSettings();
          },
        );
      });

    new Setting(containerEl).setName("Colors").setHeading();

    new Setting(containerEl)
      .setName("Default event color")
      .setDesc(
        "Color for events that have no color of their own (applies to both dot and block display). Reset to use the theme accent color.",
      )
      .addColorPicker((cp) => {
        cp.setValue(this.plugin.settings.defaultColor || getAccentHex());
        cp.onChange(async (value) => {
          this.plugin.settings.defaultColor = value;
          await this.plugin.saveSettings();
        });
      })
      .addExtraButton((btn) => {
        btn
          .setIcon("rotate-ccw")
          .setTooltip("Reset to theme accent")
          .onClick(async () => {
            this.plugin.settings.defaultColor = "";
            await this.plugin.saveSettings();
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Color by linked note — category property")
      .setDesc(
        'A frontmatter property whose [[linked note]] holds the color, e.g. "type" or "location type". The linked note\'s color property (below) is used to color the event. Leave empty to disable.',
      )
      .addText((t) => {
        t.setPlaceholder("e.g. type")
          .setValue(this.plugin.settings.categoryProperty)
          .onChange(async (value) => {
            this.plugin.settings.categoryProperty = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Color by linked note — color property")
      .setDesc("The property on the linked category note that holds the color.")
      .addText((t) => {
        t.setPlaceholder("color")
          .setValue(this.plugin.settings.linkedColorProperty)
          .onChange(async (value) => {
            this.plugin.settings.linkedColorProperty = value.trim() || "color";
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName("Color by value").setHeading();

    new Setting(containerEl)
      .setName("Property")
      .setDesc(
        'A frontmatter property whose value selects a color from the rules below (e.g. "type" → meeting/trip/…). Leave empty to disable.',
      )
      .addText((t) => {
        t.setPlaceholder("e.g. type")
          .setValue(this.plugin.settings.colorByProperty)
          .onChange(async (value) => {
            this.plugin.settings.colorByProperty = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Rules")
      .setDesc("Map each property value to a color.")
      .addButton((b) =>
        b.setButtonText("Add rule").onClick(async () => {
          this.plugin.settings.colorRules.push({ value: "", color: "#4f8ef7" });
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    this.plugin.settings.colorRules.forEach((rule, i) => {
      new Setting(containerEl)
        .addText((t) => {
          t.setPlaceholder("value (e.g. meeting)")
            .setValue(rule.value)
            .onChange(async (value) => {
              this.plugin.settings.colorRules[i].value = value;
              await this.plugin.saveSettings();
            });
        })
        .addColorPicker((cp) => {
          cp.setValue(toHex(rule.color));
          cp.onChange(async (value) => {
            this.plugin.settings.colorRules[i].color = value;
            await this.plugin.saveSettings();
          });
        })
        .addExtraButton((b) =>
          b
            .setIcon("trash-2")
            .setTooltip("Remove")
            .onClick(async () => {
              this.plugin.settings.colorRules.splice(i, 1);
              await this.plugin.saveSettings();
              this.display();
            }),
        );
    });

    new Setting(containerEl).setName("Color palette").setHeading();

    new Setting(containerEl)
      .setName("Preset swatches")
      .setDesc(
        'The quick-pick swatches shown in the right-click "Set color" picker.',
      )
      .addButton((b) =>
        b.setButtonText("Add color").onClick(async () => {
          this.plugin.settings.palette.push("#4f8ef7");
          await this.plugin.saveSettings();
          this.display();
        }),
      )
      .addExtraButton((b) =>
        b
          .setIcon("rotate-ccw")
          .setTooltip("Reset palette to defaults")
          .onClick(async () => {
            this.plugin.settings.palette = [...DEFAULT_PALETTE];
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    this.plugin.settings.palette.forEach((color, i) => {
      new Setting(containerEl)
        .setName(`Color ${i + 1}`)
        .addColorPicker((cp) => {
          cp.setValue(toHex(color));
          cp.onChange(async (value) => {
            this.plugin.settings.palette[i] = value;
            await this.plugin.saveSettings();
          });
        })
        .addExtraButton((b) =>
          b
            .setIcon("trash-2")
            .setTooltip("Remove")
            .onClick(async () => {
              this.plugin.settings.palette.splice(i, 1);
              await this.plugin.saveSettings();
              this.display();
            }),
        );
    });
  }
}
