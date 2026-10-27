# Reading Line for Zotero

A lightweight Zotero plugin that displays a horizontal guide line following the mouse cursor in the PDF reader, helping you keep your eyes on the current line while reading.

## Features

- Shows a horizontal line at the cursor's row after the mouse becomes idle
- Covers only the PDF page width, leaving toolbars, sidebars, and page gaps untouched
- Hides immediately on mouse move, text selection, mouse press, scroll, or key press
- Three line styles: solid, wave, dashed
- Seven preset colors and 1–5px line width
- Three appearance effects: instant, fade, zoom-fade
- Idle delay selectable from 100–1000ms

## Installation

### Build from source

Requires Node.js and Zotero 7 or 10.

```bash
git clone https://github.com/pf-z/zotero-reading-line.git
cd zotero-reading-line
npm install
```

Copy `.env.example` to `.env` and fill in your Zotero path and development profile path:

```
ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/Applications/Zotero.app/Contents/MacOS/zotero
ZOTERO_PLUGIN_PROFILE_PATH=/Users/yourname/Library/Application Support/Zotero/Profiles/your-dev-profile
```

Start the development environment:

```bash
npm start
```

Build the `.xpi` package:

```bash
npm run build
```

The build output is in `.scaffold/build/`. Install it in Zotero via `Tools → Add-ons → Gear → Install Add-on From File`.

## Settings

After installation, open Zotero Preferences (`Cmd+,` / `Ctrl+,`) and find **Reading Line** at the bottom of the left sidebar.

| Setting    | Options                                               |
| ---------- | ----------------------------------------------------- |
| Line style | Solid / Wave / Dashed                                 |
| Color      | Rose, Sapphire, Emerald, Violet, Orange, Slate, Black |
| Line width | 1–5 px                                                |
| Appearance | Instant / Fade / Zoom-fade                            |
| Idle delay | 100–1000 ms                                           |

Changes apply to open PDFs after you adjust them.

## How it works

The plugin injects an absolutely positioned element into the PDF reader's inner iframe and updates its position on mouse move. When the mouse stays idle for the configured delay and the cursor is over a PDF page with no active selection, the line fades in. Any interaction hides the line immediately and cancels any pending show timer.

## Compatibility

- Zotero 7.x
- Zotero 10.x

The plugin relies on some internal reader structures (`_iframeWindow`, `.page` containers). Future Zotero versions that change these structures may require adjustments.

## Development

Based on [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template).

```
addon/          Runtime resources (manifest, prefs, preferences pane, locales)
src/hooks.ts    Plugin lifecycle and core reading line logic
src/utils/      Utility functions
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/).

## License

AGPL-3.0-or-later
