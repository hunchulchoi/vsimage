# Marquee Mosaic Design

## Goal

Allow users to apply a mosaic effect to the current marquee selection, changing the image pixels so save, copy, export, undo, and VS Code dirty tracking all see the edited image.

## Design

The existing Cropper.js crop box is the marquee source of truth. A new pure helper module computes and applies pixelation to a natural-image rectangle on a canvas. `editor.js` owns editor state: it validates that a crop selection exists, pushes an undo snapshot, draws the full image to a canvas, applies the mosaic helper to the selected natural rectangle, replaces the image with the edited data URI, and reinitializes the editor while preserving document-change notification.

The sidebar gets a small mosaic control near the selection/crop tools. The button is disabled by behavior, not visual state: if no selection exists, clicking does nothing and shows the existing information flow via no document change. The first version uses a fixed block size so the feature is quick and predictable; a slider can be added later without changing the helper boundary.

## Testing

Add a unit test for the pure mosaic helper to prove pixels inside the selected area are block-averaged while pixels outside remain unchanged. Add a webview contract test to ensure the helper script loads before `editor.js` and the button is wired through the editor action.
