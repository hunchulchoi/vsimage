# Tool Rail Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each tool rail button's menu name and shortcut on hover, and reveal shortcut badges when Ctrl/Cmd is held.

**Architecture:** Reuse the existing shortcut hint system that already formats `data-shortcut` values, sets `title` text, and toggles `show-shortcut-hints` while modifier keys are held. Add shortcut metadata and badge spans to the tool rail buttons so the same pipeline covers both hover labels and modifier-key overlays.

**Tech Stack:** VS Code webview HTML/CSS/JS, existing shortcut formatting helpers, mocha contract tests

---

### Task 1: Add shortcut metadata to tool rail buttons

**Files:**
- Modify: `src/ImageCustomEditorProvider.ts`
- Modify: `src/test/suite/webviewContract.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test('adds shortcut metadata and badges to tool rail buttons', () => {
    assert.ok(provider.includes('id="btnToolCursor" data-shortcut="V"'));
    assert.ok(provider.includes('id="btnToolMarquee" data-shortcut="M"'));
    assert.ok(provider.includes('id="btnToolCrop" data-shortcut="C"'));
    assert.ok(provider.includes('id="btnToolResize" data-shortcut="R"'));
    assert.ok(provider.includes('id="btnToolMosaic" data-shortcut="X"'));
    assert.ok(provider.includes('id="btnToolMove" data-shortcut="H"'));
    assert.ok(provider.includes('<span class="ui-shortcut-badge"></span>'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --grep "Webview contracts"`
Expected: FAIL because the tool rail buttons do not yet expose shortcut metadata or badges.

- [ ] **Step 3: Write minimal implementation**

```tsx
<button ... data-shortcut="V">...<span class="ui-shortcut-badge"></span></button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --grep "Webview contracts"`
Expected: PASS

- [ ] **Step 5: Verify syntax**

Run: `node -c media/editor.js`
Expected: exit 0
