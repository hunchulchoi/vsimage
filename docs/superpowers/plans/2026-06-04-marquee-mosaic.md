# Marquee Mosaic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mosaic action that applies pixelation to the current marquee selection.

**Architecture:** Put pixel math in `media/mosaicLogic.js` for focused unit coverage. Wire the webview UI in `src/ImageCustomEditorProvider.ts` and call the helper from `media/editor.js` using the existing cropper, history, and document-change patterns.

**Tech Stack:** VS Code custom editor webview, Cropper.js, canvas pixel APIs, Mocha/TDD tests.

---

### Task 1: Mosaic Helper

**Files:**
- Create: `media/mosaicLogic.js`
- Create: `src/test/suite/mosaicLogic.test.ts`

- [ ] Write a failing test that applies mosaic to a 2x2 area and verifies outside pixels stay unchanged.
- [ ] Run `npm run compile-tests && npx mocha "out/src/test/suite/mosaicLogic.test.js" --ui tdd`; expect failure because the helper does not exist.
- [ ] Implement `clampMosaicRect`, `normalizeBlockSize`, and `applyMosaicToCanvas`.
- [ ] Re-run the focused test and expect pass.

### Task 2: Webview Wiring

**Files:**
- Modify: `src/ImageCustomEditorProvider.ts`
- Modify: `media/editor.js`
- Modify: `media/l10n/en.json`
- Modify: `media/l10n/ko.json`
- Modify: `src/test/suite/webviewContract.test.ts`

- [ ] Add failing contract assertions for the mosaic script tag, `btnApplyMosaic`, and `applyMosaicToSelection`.
- [ ] Run the focused contract test and expect failure.
- [ ] Load `mosaicLogic.js` before `editor.js`, add a mosaic button in the crop tool section, add localized strings, and implement `applyMosaicToSelection`.
- [ ] Re-run focused tests and `npm run test:unit`.
