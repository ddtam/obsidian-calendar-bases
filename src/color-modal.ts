import { App, Modal, Setting } from "obsidian";

/** Best-effort conversion of any CSS color (name/rgb/hex) to a hex string. */
export function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const probe = document.body.createSpan();
  probe.style.color = color;
  probe.style.display = "none";
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return "#4f8ef7";
  return (
    "#" +
    m
      .slice(0, 3)
      .map((x) => Number(x).toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Pick a color for a single event. `onSubmit` receives a color string, or null
 * to clear the explicit color. Closing without choosing does nothing.
 */
export class ColorPickerModal extends Modal {
  private color: string;

  constructor(
    app: App,
    initial: string,
    private presets: string[],
    private onSubmit: (color: string | null) => void,
  ) {
    super(app);
    this.color = initial && initial.trim() ? initial.trim() : "#4f8ef7";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Set event color" });

    if (this.presets.length > 0) {
      const swatches = contentEl.createDiv({ cls: "cb-color-swatches" });
      for (const preset of this.presets) {
        const sw = swatches.createEl("button", {
          cls: "cb-color-swatch",
          attr: { "aria-label": preset, title: preset },
        });
        sw.style.backgroundColor = preset;
        sw.onclick = () => {
          this.onSubmit(preset);
          this.close();
        };
      }
    }

    new Setting(contentEl).setName("Custom color").addColorPicker((cp) => {
      cp.setValue(toHex(this.color));
      cp.onChange((value) => {
        this.color = value;
      });
    });

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText("Save")
          .setCta()
          .onClick(() => {
            this.onSubmit(this.color);
            this.close();
          }),
      )
      .addButton((b) =>
        b
          .setButtonText("Clear color")
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
