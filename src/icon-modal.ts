import { App, Modal, setIcon, Setting } from "obsidian";

const PRESET_ICONS: string[] = [
  "📌",
  "⭐",
  "✅",
  "📍",
  "🍽️",
  "✈️",
  "🏨",
  "🎉",
  "💼",
  "🏠",
  "📞",
  "🏷️",
];

/** Render an icon value into an element: Lucide name via setIcon, else text. */
function renderIconInto(el: HTMLElement, value: string): void {
  el.textContent = "";
  if (!value) return;
  if (/^[a-z0-9-]+$/.test(value)) {
    setIcon(el, value);
    if (!el.firstElementChild) el.textContent = value;
  } else {
    el.textContent = value;
  }
}

/**
 * Pick an icon for a single event. `onSubmit` receives the icon string, or null
 * to clear it. The value can be an emoji/symbol or a Lucide icon name.
 */
export class IconPickerModal extends Modal {
  private value: string;

  constructor(
    app: App,
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
      text: "An emoji/symbol, or a Lucide icon name (e.g. utensils, bed, plane).",
    });

    const preview = contentEl.createDiv({ cls: "cb-icon-preview" });
    renderIconInto(preview, this.value);

    const swatches = contentEl.createDiv({ cls: "cb-icon-swatches" });
    for (const emoji of PRESET_ICONS) {
      const sw = swatches.createEl("button", {
        cls: "cb-icon-swatch",
        text: emoji,
      });
      sw.onclick = () => {
        this.onSubmit(emoji);
        this.close();
      };
    }

    new Setting(contentEl).setName("Icon").addText((t) => {
      t.setPlaceholder("emoji or lucide name")
        .setValue(this.value)
        .onChange((v) => {
          this.value = v;
          renderIconInto(preview, v.trim());
        });
    });

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText("Save")
          .setCta()
          .onClick(() => {
            this.onSubmit(this.value.trim());
            this.close();
          }),
      )
      .addButton((b) =>
        b
          .setButtonText("Clear icon")
          .setWarning()
          .onClick(() => {
            this.onSubmit(null);
            this.close();
          }),
      )
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
