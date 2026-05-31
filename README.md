# VS Code Image Editor (vsimage)

Edit PNG, JPEG, WebP, and GIF images directly inside VS Code — crop, resize, rotate, flip, export, and pick colors without leaving the editor.

## Features

- **Custom image editor** for `png`, `jpg`, `jpeg`, `webp`, `gif`
- **Crop** with presets (1:1, 16:9, 4:3, circle, free)
- **Resize** with optional aspect-ratio lock
- **Transform** — rotate, flip horizontal/vertical, zoom, pan (Space + drag)
- **Export** as PNG, JPEG, or WebP with quality control
- **Clipboard** — paste images in, copy edited images out
- **Color picker** — hold **Option/Alt** over the image, click to sample, copy as HEX / RGB / RGBA / HSL / HSV / CMYK
- **Pixel rulers** with zoom-aware ticks
- **Undo** support for destructive edits

## Usage

1. Open an image file in the workspace — it opens in the VS Code Image Editor.
2. Or run **Command Palette → `vsimage: Create Empty Image Editor`** to start from clipboard / drag-and-drop.
3. Use the sidebar for crop, resize, and export. Use the floating toolbar for zoom and rotation.

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + S` | Save |
| `Cmd/Ctrl + Z` | Undo |
| `Cmd/Ctrl + C` | Copy image to clipboard |
| `Cmd/Ctrl + A` | Select all (crop) |
| `Space + Drag` | Pan |
| `Option/Alt + Click` | Pick color |
| `Del / Backspace` | Erase / fill selection (crop mode) |
| `Esc` | Cancel / clear |

## Install

- **VS Code Marketplace:** search for `VS Code Image Editor` (publisher: `myside`)
- **Open VSX:** search for `vsimage` (for VSCodium / compatible editors)

## Development

```bash
npm install
npm run compile
# Press F5 in VS Code to launch Extension Development Host
```

## Publish

```bash
npm run package
npm run publish:vsce   # VS Code Marketplace
npm run publish:ovsx   # Open VSX
```

Requires `VSCE_PAT` (Azure DevOps PAT with Marketplace **Manage**) and `OVSX_PAT` (from [open-vsx.org](https://open-vsx.org)).

## License

MIT © [choihunchul](https://github.com/hunchulchoi)
