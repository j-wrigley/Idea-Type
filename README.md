# Idea-Type

An experimental, lightweight glyph editor for open type design tooling. Upload any `.otf`, `.ttf`, or `.woff` font — or start from scratch — and use a full suite of vector editing tools, design sliders, kerning controls, and a component system to create and refine typefaces.

Built with React, TypeScript, Electron, and HTML5 Canvas.

![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)

---

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm

### Install

```bash
cd font-vector-editor
npm install
```

### Development

Run with hot reload:

```bash
npm run dev
```

### Build & Package

Production build:

```bash
npm run build
```

Package as a macOS `.dmg`:

```bash
npm run package
```

The packaged app will be in the `release/` directory.

---

## Features

### Import & Export

- **Open fonts** — drag and drop `.otf`, `.ttf`, or `.woff` files, or use the file dialog (`Cmd+O`)
- **Create from scratch** — start with a blank font (`Cmd+N`)
- **Export** — save as TTF or WOFF with full metadata (family name, style, version, copyright, designer, description, license)
- **Kerning export** — all kerning pair adjustments are embedded in the exported font's kern table

### Drawing Tools

| Tool | Shortcut | Description |
|------|----------|-------------|
| Select | `V` | Select, move, and edit individual anchor points and control handles |
| Shape Select | `A` | Select and manipulate entire contours as a unit |
| Pen | `P` | Draw bezier paths — click for corners, click-and-drag for curves |
| Rectangle | `R` | Draw rectangles by clicking and dragging |
| Ellipse | `E` | Draw ellipses by clicking and dragging |
| Slice | `X` | Cut paths with a drawn line |

### Point & Segment Editing

- **Select points** — click to select, `Shift+Click` to add to selection, `Cmd+A` to select all
- **Move points** — drag selected points or use arrow keys (1 unit, `Shift` = 10 units)
- **Toggle smooth/corner** — double-click a point
- **Delete points** — `Delete` or `Backspace`
- **Add point to segment** — double-click a segment
- **Break segment** — `Shift+Double-click` or right-click a segment
- **Convert segment type** — `1` = Line, `2` = Quadratic, `3` = Cubic

### Contour Operations

- **Reverse direction** — `Shift+R`
- **Flip horizontal** — `Shift+H`
- **Flip vertical** — `Shift+Alt+V`
- **Make cutout / fill / indent** — right-click context menu
- **Copy / paste contours** — `Cmd+C` / `Cmd+V`
- **Duplicate contours** — `Cmd+D`
- **Extract to component** — save contours as reusable components

### Transform Panel

Apply geometric transforms to individual glyphs or the entire font:

- **Scale X / Y** — 0.1x to 3x
- **Rotation** — -180° to 180°
- **Shift X / Y** — -500 to 500 units
- **Skew X / Y** — -45° to 45°
- **Apply to All** — apply the current transform to every glyph in the font

### Design Tools

Professional type design sliders that adjust glyph outlines using outline-normal computation:

| Tool | Range | Description |
|------|-------|-------------|
| Weight | -100 to 100 | Make strokes thicker or thinner by offsetting points along outline normals |
| Width | -100% to 100% | Horizontally scale from the glyph center |
| Contrast | -100 to 100 | Increase/decrease the difference between vertical and horizontal stroke widths |
| Slant | -30° to 30° | Apply italic/oblique shear anchored at the baseline |
| x-Height | -100 to 100 | Scale the zone between baseline and x-height |
| Ascender | -100 to 100 | Extend or shorten ascenders above x-height |
| Descender | -100 to 100 | Extend or shorten descenders below baseline |
| Overshoot | -50 to 50 | Push round shapes beyond alignment zones for optical correction |
| Roundness | -100 to 100 | Adjust curvature of bezier control handles |
| Ink Trap | 0 to 100 | Add ink trap notches at acute interior joints |
| Serif | 0 to 100 | Add serif-like extensions at stroke terminals |
| Optical Size | -50 to 50 | Open up counters to mimic small optical size adjustments |
| Spacing | -100 to 100 | Adjust sidebearings and advance width |

All design tools offer live preview, per-glyph application, and **Apply to All** for batch changes.

### Kerning

- **Add kerning pairs** — type two characters and click `+`
- **Drag-to-kern** — drag the preview canvas left/right to adjust values
- **Slider & numeric input** — fine-tune kern values (-500 to 500)
- **Filter & search** — find pairs by character
- **Global tracking** — adjust spacing across all glyphs at once
- **Side bearings** — visual editor with drag handles for LSB, RSB, and advance width

### Component System

- **Create components** — from selected contours or blank
- **Component library** — sidebar with previews, rename, and delete
- **Insert instances** — place component instances into any glyph
- **Transform instances** — move, scale, and rotate
- **Decompose** — flatten instances back to editable paths

### Glyph Management

- **Glyph grid** — browse by category (All, Basic, Extended, Numbers/Symbols, Other)
- **Filter & sort** — search by character, name, or hex code; sort by Unicode, name, or width
- **Add / remove glyphs** — add single characters or remove existing ones
- **Rename glyphs** — double-click a glyph name
- **Navigate** — `Tab` / `Shift+Tab` to move between glyphs
- **Font metrics display** — Units/Em, ascender, descender, advance width, point count

### Text Preview

Four preview modes available below the editor canvas:

- **Type** — single-line preview with adjustable font size and kerning toggle
- **Paragraph** — multi-line text preview with auto-wrapping
- **Waterfall** — view text at multiple sizes (12px through 96px)
- **Grid** — all glyphs in a grid layout

### View Controls

- **Zoom** — scroll to zoom at cursor, or use toolbar buttons; percentage display
- **Pan** — `Space+Drag` or `Option+Drag`
- **Grid** — toggle visibility and snapping; sizes from 10 to 500 units
- **Rulers** — toggle horizontal/vertical rulers
- **Path direction arrows** — visualize contour winding
- **Fill preview** — toggle between outline and filled view (`F`)
- **Guidelines** — built-in baseline, ascender, descender, x-height, cap height, with editable positions and custom guidelines
- **Dark / Light theme** — toggle in the toolbar

### Undo / Redo

Full history system with `Cmd+Z` to undo and `Cmd+Shift+Z` to redo. Per-glyph history that tracks all point and path modifications.

---

## Keyboard Shortcuts

### File

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New font |
| `Cmd+O` | Open font |
| `Cmd+S` | Export font |

### Tools

| Shortcut | Action |
|----------|--------|
| `V` | Select tool |
| `A` | Shape select tool |
| `P` | Pen tool |
| `R` | Rectangle tool |
| `E` | Ellipse tool |
| `X` | Slice tool |

### Editing

| Shortcut | Action |
|----------|--------|
| `Cmd+Z` | Undo |
| `Cmd+Shift+Z` | Redo |
| `Cmd+A` | Select all points |
| `Cmd+C` | Copy |
| `Cmd+V` | Paste |
| `Cmd+D` | Duplicate contours |
| `Delete` / `Backspace` | Delete selected |
| `Esc` | Deselect |
| `Arrow keys` | Nudge 1 unit |
| `Shift+Arrow keys` | Nudge 10 units |

### Segments & Contours

| Shortcut | Action |
|----------|--------|
| `1` | Convert to line |
| `2` | Convert to quadratic |
| `3` | Convert to cubic |
| `Shift+R` | Reverse contour |
| `Shift+H` | Flip horizontal |
| `Shift+Alt+V` | Flip vertical |
| `F` | Toggle fill preview |
| `Tab` | Next glyph |
| `Shift+Tab` | Previous glyph |

---

## Tech Stack

| Technology | Purpose |
|-----------|---------|
| [Electron](https://www.electronjs.org/) | Desktop app shell with native file dialogs |
| [React 18](https://react.dev/) | UI framework |
| [TypeScript](https://www.typescriptlang.org/) | Type-safe development |
| [Vite](https://vitejs.dev/) | Build tooling and dev server |
| [opentype.js](https://opentype.js.org/) | Font parsing, glyph path extraction, and manipulation |
| [fonteditor-core](https://github.com/nicolo-ribaudo/fonteditor-core) | Font binary encoding for TTF/WOFF export |
| [polygon-clipping](https://github.com/mfogel/polygon-clipping) | Boolean polygon operations for indent/cutout |
| HTML5 Canvas | Glyph rendering and interactive editing |

---

## Project Structure

```
font-vector-editor/
├── electron/              # Electron main process and preload
│   ├── main.ts
│   └── preload.ts
├── src/
│   ├── App.tsx            # Main application component and state
│   ├── App.css            # Application styles
│   ├── main.tsx           # React entry point
│   ├── components/
│   │   ├── ExportDialog.tsx    # Export modal with metadata fields
│   │   ├── FontUploader.tsx    # Drag-and-drop font import screen
│   │   ├── GlyphEditor.tsx     # Canvas-based glyph editing surface
│   │   ├── GlyphGrid.tsx       # Glyph browser sidebar
│   │   ├── KerningPanel.tsx    # Kerning pairs, tracking, side bearings
│   │   ├── SliderPanel.tsx     # Transforms, design tools, font metrics
│   │   ├── TextPreview.tsx     # Text preview tabs (type, paragraph, waterfall, grid)
│   │   └── Toolbar.tsx         # Top toolbar with tool buttons and view controls
│   ├── hooks/
│   │   ├── useComponents.ts    # Component library and instance management
│   │   ├── useFont.ts          # Font loading and state
│   │   └── useHistory.ts       # Undo/redo history stack
│   ├── types/
│   │   └── index.ts            # Shared TypeScript interfaces
│   └── utils/
│       ├── coordMapping.ts     # Screen ↔ glyph coordinate conversion
│       ├── fontExport.ts       # Font binary export (TTF/WOFF)
│       ├── hitTesting.ts       # Point/segment hit detection
│       ├── pathTransforms.ts   # Path transforms, design tools, contour ops
│       └── slicePath.ts        # Slice tool path splitting
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── electron-builder.yml       # macOS packaging config
```

---

## License

MIT
