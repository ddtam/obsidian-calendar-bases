## Calendar Bases (Fork)

A personal fork of [edrickleong/obsidian-calendar-bases](https://github.com/edrickleong/obsidian-calendar-bases)
that adds a calendar layout to [Obsidian Bases](https://help.obsidian.md/bases),
with a number of workflow and aesthetic improvements. It installs alongside the
original (it uses a distinct plugin id and Bases view type), so you can run
either.

![](./screenshot.png)

Built on [FullCalendar](https://github.com/fullcalendar/fullcalendar).

### Core (from upstream)

- Dynamically display entries that match your filters on their dates.
- Drag-and-drop to reschedule — updates the note frontmatter automatically.
- Single-day and multi-day events (with an optional end date).
- Click entries to open them, or use the context menu for more options.

### What this fork adds

- **Lands on the most relevant month** when opened — the soonest upcoming event,
  else the most recent past event — instead of always jumping to today.
- **Faster navigation** — prev/next **year** buttons and a **Month / Week** toggle.
- **Fixed window** — pin the view to a date range (`windowStart`/`windowEnd`);
  days outside the window are faded.
- **Display modes** — full **blocks** or compact **dots**; multi-day events show
  as a thin spanning bar in dot mode.
- **Rich coloring**, in precedence order: an explicit per-note `color`
  (right-click → **Set color**), a per-base color property, vault-wide
  **value→color rules**, **color from a linked category note** (e.g.
  `type: "[[restaurant]]"` → `restaurant.md`'s `color`), and a configurable
  **default color** (theme accent by default).
- **Image thumbnails** from a property or the note's first embed.
- **Title cleanup** — a per-base regex to strip text (e.g. a leading date) from
  event titles.
- **Density control** — a per-day **max events** cap with a themed "+N more"
  popover.
- **Settings tab** — global defaults for color, display mode, and week start, an
  editable color palette, and the linked-note / value→color configuration.

## Installation

Requires Obsidian v1.10.0 or later.

### Via BRAT

1. Install the [BRAT plugin](obsidian://show-plugin?id=obsidian42-brat).
2. In BRAT settings choose "Add beta plugin" and enter this repository's URL:
   `https://github.com/ddtam/obsidian-calendar-bases`.
3. Pick the latest version and add the plugin.

### Manual

Copy `main.js`, `manifest.json`, and `styles.css` from a release into
`<vault>/.obsidian/plugins/calendar-bases-fork/`, then enable the plugin.

## Documentation

### Date properties

Configure a **start date** property in the view options; it must contain a valid
date string. Add an optional **end date** for multi-day events.

```yaml
startDate: 2025-10-15
startDate: 2025-10-15T10:00:00
endDate: 2025-10-18
```

Any JavaScript-parseable date format is supported.

## Credits

- Original plugin by [Edrick Leong](https://github.com/edrickleong/obsidian-calendar-bases)
  — please support the upstream author:
  <a href='https://ko-fi.com/W7W71T4JPP' target='_blank'>Buy them a coffee</a>.
- Calendar rendering by [FullCalendar](https://github.com/fullcalendar/fullcalendar).

## License

MIT.
