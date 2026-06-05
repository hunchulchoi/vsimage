import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const root = path.join(__dirname, '../../../../');
const provider = fs.readFileSync(path.join(root, 'src/ImageCustomEditorProvider.ts'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'media/editor.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'media/editor.css'), 'utf8');
const extension = fs.readFileSync(path.join(root, 'src/extension.ts'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    contributes?: {
        keybindings?: Array<{ command: string; key: string; mac?: string; when?: string; args?: unknown }>;
        customEditors?: Array<{ viewType: string; selector?: Array<{ filenamePattern?: string }> }>;
    };
};

suite('Webview contracts', () => {
    test('loads every feature module before the editor adapter', () => {
        const editorScriptIndex = provider.indexOf('<script src="${scriptUri}"></script>');
        assert.ok(editorScriptIndex >= 0);

        [
            'canvasLayoutLogicUri',
            'shortcutLogicUri',
            'zoomLogicUri',
            'cropMarqueeLogicUri',
            'resizePanelLogicUri',
            'sharpenLogicUri',
            'mosaicLogicUri',
            'colorLogicUri',
            'magicWandLogicUri',
            'clipboardLogicUri',
            'saveExportLogicUri',
            'historyLogicUri',
            'transformLogicUri',
            'loupeLogicUri',
            'sidebarAutoCollapseLogicUri',
            'toolRailLogicUri'
        ].forEach(uri => {
            const scriptIndex = provider.indexOf(`<script src="\${${uri}}"></script>`);
            assert.ok(scriptIndex >= 0, `${uri} script tag is missing`);
            assert.ok(scriptIndex < editorScriptIndex, `${uri} must load before editor.js`);
        });
    });

    test('routes toolbar and keyboard zoom through the shared action adapter', () => {
        assert.ok(editor.includes("applyZoomAction('zoomIn')"));
        assert.ok(editor.includes("applyZoomAction('zoomOut')"));
        assert.ok(editor.includes('applyZoomAction(shortcutAction)'));
    });

    test('syncs the bottom zoom toggle label from the live zoom state', () => {
        assert.ok(editor.includes('updateZoomToggleButton()'));
        assert.ok(editor.includes('isActualPixelsZoomTarget(currentRatio, fitRatio)'));
        assert.ok(editor.includes('setZoomToggleButtonLabel(isActualPixelsTarget);'));
        assert.ok(editor.includes('setZoomToggleButtonLabel(!isActualPixelsTarget);'));
        assert.ok(editor.includes('updateZoomIndicator(false);'));
        assert.ok(editor.includes('resolveToggleZoomTargetRatio(currentRatio, fitRatio)'));
        assert.ok(editor.includes("document.getElementById('btnReset').addEventListener('click'"));
        assert.ok(provider.includes('lblResetText'));
    });

    test('routes rotate and flip entry points through shared adapters', () => {
        assert.ok(editor.includes("applyRotationAction('rotateLeft')"));
        assert.ok(editor.includes("applyRotationAction('rotateRight')"));
        assert.ok(editor.includes("applyFlipAction('flipH')"));
        assert.ok(editor.includes("applyFlipAction('flipV')"));
        assert.ok(editor.includes('applyRotationAction(shortcutAction)'));
    });

    test('keeps stable save and context-menu reset contracts', () => {
        assert.ok(editor.includes('saveExportLogic.commandForBlobType(type)'));
        assert.ok(editor.includes("applyZoomTo(getViewportFitRatio())"));
        assert.ok(provider.includes('ctxMosaic'));
        assert.ok(provider.includes('data-shortcut="X"'));
    });

    test('keeps core edit actions working if optional helper globals are missing', () => {
        assert.ok(editor.includes('const historyLogic = globalThis.VsimageHistoryLogic || {'));
        assert.ok(editor.includes('trimSnapshots: (entries, max) =>'));
        assert.ok(editor.includes('restoreSnapshot: (entries, index) =>'));
        assert.ok(editor.includes('const transformLogic = globalThis.VsimageTransformLogic || {'));
        assert.ok(editor.includes('const saveExportLogic = globalThis.VsimageSaveExportLogic || {'));
    });

    test('shows the extension version next to the properties title', () => {
        assert.ok(provider.includes('section-title-with-version'));
        assert.ok(provider.includes('section-title-version'));
        assert.ok(provider.includes("path.join(this.context.extensionPath, 'package.json')"));
    });

    test('keeps properties and save sticky while placing history near the top', () => {
        const propertiesIndex = provider.indexOf('section-card-properties');
        const historyIndex = provider.indexOf('section-card-history');
        const saveIndex = provider.indexOf('section-card-save');

        assert.ok(provider.includes('sidebar.fileSize'));
        assert.ok(provider.includes('btnSidebarAutoCollapse'));
        assert.ok(propertiesIndex >= 0);
        assert.ok(historyIndex >= 0);
        assert.ok(saveIndex >= 0);
        assert.ok(propertiesIndex < historyIndex);
        assert.ok(historyIndex < saveIndex);
    });

    test('replaces static resize and crop cards with a tool rail and shared tool options', () => {
        assert.ok(provider.includes('id="toolRail"'));
        assert.ok(provider.includes('id="btnToolCursor"'));
        assert.ok(provider.includes('id="btnToolCrop"'));
        assert.ok(provider.includes('id="btnToolResize"'));
        assert.ok(provider.includes('id="btnToolMosaic"'));
        assert.ok(provider.includes('id="btnToolMove"'));
        assert.ok(provider.includes('id="btnRotateLeft"'));
        assert.ok(provider.includes('id="btnRotateRight"'));
        assert.ok(provider.includes('id="btnFlipH"'));
        assert.ok(provider.includes('id="btnFlipV"'));
        assert.ok(provider.includes('id="toolOptionsSection"'));
        assert.ok(provider.includes('id="toolOptionsCursor"'));
        assert.ok(provider.includes('id="toolOptionsCrop"'));
        assert.ok(provider.includes('id="toolOptionsResize"'));
        assert.ok(provider.includes('id="toolOptionsMosaic"'));
        assert.ok(provider.includes('id="toolOptionsMove"'));
        assert.ok(provider.includes('properties-zoom-row'));
        assert.ok(provider.includes('toolbar.marqueeSelect'));
        assert.ok(styles.includes('.tool-rail'));
        assert.ok(styles.includes('.tool-rail-btn.active'));
        assert.ok(styles.includes('.tool-rail-secondary'));
        assert.ok(styles.includes('.properties-zoom-row'));
        assert.ok(styles.includes('.tool-options-panel.active'));
    });

    test('wires active tool state through the webview runtime', () => {
        assert.ok(editor.includes("let activeTool = toolRailLogic.DEFAULT_ACTIVE_TOOL || 'cursor'"));
        assert.ok(!editor.includes("select: document.getElementById('toolOptionsSelect')"));
        assert.ok(editor.includes("cursor: document.getElementById('toolOptionsCursor')"));
        assert.ok(editor.includes("setActiveTool(toolRailLogic.DEFAULT_ACTIVE_TOOL || 'cursor')"));
        assert.ok(editor.includes("setActiveTool('cursor')"));
        assert.ok(editor.includes("toolButtons.forEach((btn) => {"));
        assert.ok(editor.includes("const tool = btn.dataset.tool || 'cursor';"));
        assert.ok(editor.includes("btnApplyCrop.addEventListener('click', () => {"));
        assert.ok(editor.includes('btnApplyCrop.click();'));
        assert.ok(editor.includes("activeTool = toolRailLogic.resolveToolAfterApply(activeTool, 'crop');"));
        assert.ok(editor.includes('setActiveTool(activeTool);'));
        assert.ok(editor.includes('let suppressCropCheckboxToolSync = false;'));
        assert.ok(editor.includes('if (suppressCropCheckboxToolSync) {'));
        assert.ok(editor.includes("chkEnableCrop.dispatchEvent(new Event('change'));"));
        assert.ok(editor.includes('toolRailLogic.shouldBlockMarqueeCreation(activeTool)'));
    });

    test('shows a live selection panel for marquee size and pointer coordinates', () => {
        assert.ok(provider.includes('sidebar.selection'));
        assert.ok(provider.includes('sidebar.selectionHint'));
        assert.ok(provider.includes('lblMarqueeWidth'));
        assert.ok(provider.includes('lblMarqueeHeight'));
        assert.ok(provider.includes('lblMarqueeX'));
        assert.ok(provider.includes('lblMarqueeY'));
        assert.ok(provider.includes('selection-info-line'));
        assert.ok(styles.includes('.selection-info-grid'));
        assert.ok(styles.includes('.selection-info-line'));
        assert.ok(styles.includes('.selection-info-value.is-empty'));
        assert.ok(editor.includes('updateSelectionPanelFromCrop()'));
        assert.ok(editor.includes('updateSelectionPanelFromPointer(e)'));
        assert.ok(editor.includes('resetSelectionPanel();'));
    });

    test('shows shortcut tooltips when hovering inside the marquee selection', () => {
        assert.ok(provider.includes('marqueeShortcutTooltip'));
        assert.ok(provider.includes('marquee-shortcut-tooltip-row'));
        assert.ok(provider.includes('shortcuts.eraseSelection'));
        assert.ok(provider.includes('shortcuts.mosaicSelection'));
        assert.ok(provider.includes('shortcuts.cancel'));
        assert.ok(styles.includes('.marquee-shortcut-tooltip'));
        assert.ok(styles.includes('.marquee-shortcut-tooltip-row'));
        assert.ok(editor.includes('showMarqueeShortcutTooltip'));
        assert.ok(editor.includes('hideMarqueeShortcutTooltip'));
        assert.ok(editor.includes("e.target.closest('.cropper-face')"));
    });

    test('turns image drags into marquee activation when crop is off and no selection exists', () => {
        assert.ok(editor.includes('shouldAutoEnableMarqueeOnDrag'));
        assert.ok(editor.includes("workspace.addEventListener('mousedown'"));
        assert.ok(editor.includes('resolveDragMarqueeBox'));
        assert.ok(editor.includes('cropper.setData(nextBox)'));
    });

    test('re-clamps marquee moves so the selection stays inside the image canvas', () => {
        assert.ok(editor.includes('const clamped = clampCropBox(data.x, data.y, data.width, data.height);'));
        assert.ok(editor.includes('cropper.setData(clamped);'));
    });

    test('keeps the collapsed sidebar strip wired for hover reopen', () => {
        assert.ok(editor.includes('sidebar-controls-collapsed'));
        assert.ok(editor.includes('handleSidebarAutoCollapseMouseEnter'));
        assert.ok(editor.includes('handleSidebarAutoCollapseMouseLeave'));
        assert.ok(editor.includes('bindSidebarAutoCollapse'));
        assert.ok(provider.includes('btnSidebarAutoCollapse'));
        assert.ok(styles.includes('.sidebar-auto-collapse-toggle'));
        assert.ok(provider.includes('sidebar.autoCollapse'));
    });

    test('moves zoom controls into the properties panel', () => {
        assert.ok(provider.includes('properties-zoom-row'));
        assert.ok(provider.includes('btnZoomOut'));
        assert.ok(provider.includes('lblZoomPercent'));
        assert.ok(provider.includes('btnZoomIn'));
        assert.ok(provider.includes('btnReset'));
    });

    test('dismisses shortcut hints when the canvas image is clicked', () => {
        assert.ok(editor.includes('canvasScrollArea.addEventListener(\'mousedown\', () => {'));
        assert.ok(editor.includes('dismissShortcutLayers();'));
        assert.ok(editor.includes('imageContainer.addEventListener(\'mousedown\', dismissShortcutLayers, true);'));
        assert.ok(editor.includes('imageContainer.addEventListener(\'click\', dismissShortcutLayers, true);'));
    });

    test('keeps crop disabled until the initial image load settles', () => {
        assert.ok(editor.includes('chkEnableCrop.checked = false;'));
    });

    test('does not auto-recheck crop from crop events', () => {
        assert.ok(!editor.includes('if (!suppressCropCheckboxAutoEnable && cropper && cropper.cropped && !chkEnableCrop.checked)'));
    });

    test('hides cropper overlay layers when crop mode is off', () => {
        assert.ok(styles.includes('.canvas-workspace:not(.crop-active) .cropper-drag-box'));
        assert.ok(styles.includes('.canvas-workspace:not(.crop-active) .cropper-modal'));
        assert.ok(styles.includes('display: none !important;'));
    });

    test('makes marquee corner handles easier to grab', () => {
        assert.ok(styles.includes('.canvas-workspace.crop-active .cropper-point'));
        assert.ok(styles.includes('width: 14px;'));
        assert.ok(styles.includes('height: 14px;'));
    });

    test('wires the marquee mosaic action through the webview', () => {
        assert.ok(provider.includes('mosaicLogicUri'));
        assert.ok(provider.includes('btnApplyMosaic'));
        assert.ok(provider.includes('sidebar.applyMosaic'));
        assert.ok(provider.includes('mosaicModal'));
        assert.ok(provider.includes('rngMosaicSize'));
        assert.ok(provider.includes('btnMosaicConfirm'));
        assert.ok(provider.includes('btnMosaicCancel'));
        assert.ok(editor.includes('const mosaicLogic = globalThis.VsimageMosaicLogic || {'));
        assert.ok(editor.includes('applyMosaicToImageData: (imageData, rect, blockSize) => {'));
        assert.ok(editor.includes('ctx.putImageData(imageData, 0, 0);'));
        assert.ok(editor.includes('scaleNaturalRectToImageData'));
        assert.ok(editor.includes('function showMosaicModal()'));
        assert.ok(editor.includes('function renderMosaicPreview()'));
        assert.ok(editor.includes('function hideMosaicModal()'));
        assert.ok(editor.includes("btnApplyMosaic.addEventListener('click', () => {"));
        assert.ok(editor.includes("setActiveTool('mosaic');"));
        assert.ok(editor.includes('showMosaicModal();'));
        assert.ok(editor.includes("if (shortcutAction === 'mosaic') {"));
        assert.ok(editor.includes("setActiveTool('mosaic');"));
        assert.ok(provider.includes('shortcuts.mosaicSelection'));
    });

    test('hides the magic wand UI while leaving the feature wiring dormant', () => {
        assert.ok(styles.includes('#btnMagicWand'));
        assert.ok(styles.includes('.magic-wand-controls'));
        assert.ok(styles.includes('.magic-wand-shortcut-row'));
        assert.ok(styles.includes('display: none !important;'));
    });

    test('slows the sidebar collapse transition down a bit', () => {
        assert.ok(styles.includes('transition: width 480ms ease, min-width 480ms ease, flex-basis 480ms ease, padding 480ms ease;'));
        assert.ok(styles.includes('transition-duration: 240ms;'));
    });

    test('normalizes resize scale slider display to integer percentages', () => {
        assert.ok(editor.includes('resizePanelLogic.clampResizeScalePercent'));
        assert.ok(editor.includes("rngResizeScale.value = String(percent)"));
        assert.ok(editor.includes("setPercentSpan('resizeScaleVal', String(percent))"));
    });

    test('live resize preview resizes the visible canvas and caps it to the viewport', () => {
        assert.ok(!provider.includes('lblResizePreview'));
        assert.ok(editor.includes('applyResizePreviewZoom(percent)'));
        assert.ok(editor.includes('const previewRatio = resizePanelLogic.resolveResizePreviewZoomRatio'));
        assert.ok(editor.includes('applyZoomTo(Math.min(previewRatio, fitRatio))'));
        assert.ok(editor.includes('updateResizeApplyButtonState(percent)'));
    });

    test('disables the resize apply button when the scale is 100%', () => {
        assert.ok(editor.includes('shouldDisableResizeApplyButton'));
        assert.ok(editor.includes('btnApplyResize.disabled = shouldDisable'));
        assert.ok(editor.includes('updateResizeApplyButtonState(scalePercent)'));
    });

    test('rounds resize panel width and height before writing them into inputs', () => {
        assert.ok(editor.includes('Math.max(0, Math.round(Number(panel.width) || 0))'));
        assert.ok(editor.includes('Math.max(0, Math.round(Number(panel.height) || 0))'));
    });

    test('declares custom editor selectors per image extension', () => {
        const editorContribution = manifest.contributes?.customEditors?.find(item => item.viewType === 'vsimage.editor');
        const patterns = editorContribution?.selector?.map(item => item.filenamePattern) ?? [];

        for (const pattern of ['*.png', '*.jpg', '*.jpeg', '*.webp', '*.gif']) {
            assert.ok(patterns.includes(pattern), `${pattern} selector is missing`);
        }
    });

    test('bridges VS Code webview keybindings into editor shortcuts', () => {
        const keybindings = manifest.contributes?.keybindings ?? [];
        const bridgedActions = ['save', 'undo', 'copy', 'selectAll', 'marquee', 'crop', 'mosaic', 'rotateLeft', 'rotateRight', 'zoomIn', 'zoomOut', 'fitViewport', 'actualPixels'];

        for (const action of bridgedActions) {
            const binding = keybindings.find(item => item.command === 'vsimage.runShortcut' && (item.args as { action?: string } | undefined)?.action === action);
            assert.ok(binding, `${action} keybinding is missing`);
            assert.strictEqual(binding.when, "activeEditor == 'vsimage.editor' || activeCustomEditorId == 'vsimage.editor' || activeWebviewPanelId == 'vsimage.editor'");
        }

        const cropBindings = keybindings.filter(item => item.command === 'vsimage.runShortcut' && (item.args as { action?: string } | undefined)?.action === 'crop');
        assert.ok(cropBindings.some(item => item.key === 'c'));

        const marqueeBindings = keybindings.filter(item => item.command === 'vsimage.runShortcut' && (item.args as { action?: string } | undefined)?.action === 'marquee');
        assert.ok(marqueeBindings.some(item => item.key === 'm'));

        const mosaicBindings = keybindings.filter(item => item.command === 'vsimage.runShortcut' && (item.args as { action?: string } | undefined)?.action === 'mosaic');
        assert.ok(mosaicBindings.some(item => item.key === 'x'));
        assert.ok(!keybindings.some(item => item.command === 'vsimage.runShortcut' && (item.args as { action?: string } | undefined)?.action === 'magicWand'));

        assert.ok(extension.includes("provider.runShortcut(action)"));
        assert.ok(provider.includes("postMessage({ command: 'run-shortcut', action })"));
        assert.ok(editor.includes("case 'run-shortcut':"));
        assert.ok(editor.includes('runShortcutAction(message.action)'));
        assert.ok(editor.includes('toggleMarqueeModeWithKey()'));
    });
});
