import { App, Platform, PluginSettingTab, Setting } from "obsidian";
import { toHex } from "./color-modal";
import type ObsidianCalendarPlugin from "./main";
import {
  canResizeOnDecode,
  setMobilePixelBudget,
  thumbnailDecodePath,
} from "./thumbnail-cache";
import { readStats } from "./thumbnail-stats";

export interface CalendarBasesSettings {
  /** Color for events that have no color of their own. Empty = theme accent. */
  defaultColor: string;
  /** Preset swatches shown in the right-click "Set color" picker. */
  palette: string[];
  /** Default display mode for calendar views that don't set their own. */
  defaultDisplayMode: "block" | "dot";
  /** Default week start (day name) for views that don't set their own. */
  defaultWeekStart: string;
  /** In dot mode, an event's icon replaces the colored dot. */
  iconReplacesDot: boolean;
  /** Most-recently-used icons (emoji or Lucide names) for the icon picker. */
  recentIcons: string[];
  /**
   * Largest source image, in megapixels, a phone will try to decode.
   *
   * Not a preference so much as a safety valve. A figure rendered at 300 DPI
   * is around 39 MP and inflates to 155 MB whatever its file size, which is
   * enough to have the app killed outright on iOS.
   */
  mobilePixelCeilingMP: number;
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
  palette: [...DEFAULT_PALETTE],
  defaultDisplayMode: "block",
  defaultWeekStart: "sunday",
  iconReplacesDot: true,
  recentIcons: [],
  mobilePixelCeilingMP: 20,
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
      .setName("Per-event color & icon")
      .setDesc(
        "Set a Color property and Icon property per calendar view (in its view options). Point them at a frontmatter field — or a Bases formula that pulls a value from a type/category note (e.g. list(note.type)[0].asFile().properties.color), exactly like the map view's marker color/icon.",
      );

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

    if (Platform.isMobile) {
      // Two decode paths with very different memory characteristics, and no
      // console on iOS without attaching a Mac. Report which one this device
      // took rather than leaving it to be inferred from whether it crashed.
      const row = new Setting(containerEl)
        .setName("Image decoding")
        .setDesc("Checking...");
      void canResizeOnDecode().then(() => {
        row.setDesc(
          thumbnailDecodePath() === "resize-on-decode"
            ? "Resizes while decoding. A photo costs the same as a thumbnail."
            : "Decodes at full size, then downscales. One image at a time, and "
              + "anything over 24 megapixels is skipped rather than decoded.",
        );
      });
    }

    if (Platform.isMobile) {
      new Setting(containerEl)
        .setName("Largest image to decode")
        .setDesc(
          "Megapixels. Above this a phone shows no thumbnail rather than " +
            "decoding, because a large image can cost far more memory than " +
            "its file size suggests: a 300 DPI figure is 39 MP and 155 MB " +
            "decoded at under 2 MB on disk. Raise it to find out whether this " +
            "device can handle more; the cost of being wrong is a crash.",
        )
        .addSlider((sl) =>
          sl
            .setLimits(4, 80, 4)
            .setValue(this.plugin.settings.mobilePixelCeilingMP)
            .setDynamicTooltip()
            .onChange(async (value) => {
              this.plugin.settings.mobilePixelCeilingMP = value;
              setMobilePixelBudget(value);
              await this.plugin.saveSettings();
            }),
        );
    }

    const st = readStats(this.plugin.thumbnailStats);
    new Setting(containerEl).setName("Thumbnail diagnostics").setHeading();
    new Setting(containerEl)
      .setName("Last month flip")
      .setDesc(
        `${st.lastFlip}: ${st.requested} requested, ${st.decoded} decoded, ` +
          `${(st.bytes / 1e6).toFixed(1)} MB fetched`,
      );
    new Setting(containerEl)
      .setName("Largest source")
      .setDesc(
        `${st.maxDims}` +
          (st.maxPixels ? ` (${(st.maxPixels / 1e6).toFixed(1)} MP)` : "") +
          (st.formats.length ? `, formats: ${st.formats.join(", ")}` : ""),
      );
    if (st.errors > 0) {
      new Setting(containerEl)
        .setName("Decode errors")
        .setDesc(`${st.errors}, first: ${st.firstError}`);
    }

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
