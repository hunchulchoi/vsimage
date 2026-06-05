# Mosaic Marquee Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the crop marquee visible while the mosaic preview is open, without re-enabling marquee interaction.

**Architecture:** Raise the cropper overlay above the mosaic preview canvas with a minimal CSS stacking change. Leave `updateCropInteraction()` in charge of locking drag behavior so the marquee remains visible but non-interactive during mosaic apply.

**Tech Stack:** VS Code webview HTML/CSS/JS, Cropper.js, Node test suite

---

### Task 1: Keep crop overlay above the mosaic preview

**Files:**
- Modify: `media/editor.css`
- Modify: `src/test/suite/webviewContract.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test('keeps marquee above the mosaic preview layer', () => {
    assert.ok(styles.includes('.canvas-workspace.crop-active .image-container .cropper-container'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --grep "Webview contracts"`
Expected: FAIL because the cropper container does not yet have an explicit stacking rule above the mosaic preview.

- [ ] **Step 3: Write minimal implementation**

```css
.canvas-workspace.crop-active .image-container .cropper-container {
    position: relative;
    z-index: 21;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --grep "Webview contracts"`
Expected: PASS

- [ ] **Step 5: Verify syntax**

Run: `node -c media/editor.js`
Expected: exit 0
