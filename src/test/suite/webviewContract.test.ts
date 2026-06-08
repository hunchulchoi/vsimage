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
        assert.ok(editor.includes("vscode.postMessage(start.immediateMessage);"));
        assert.ok(editor.includes("window.editorApi.getCanvasBlob((blob) => {"));
        assert.ok(provider.includes("webview.postMessage({ command: 'request-image-data', requestId, mimeType });"));
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

    test('guards image clipboard writes and always routes copy outcomes through toasts', () => {
        assert.ok(editor.includes('function copyImageToClipboard() {'));
        assert.ok(editor.includes("vscode.postMessage({ command: 'copy-function-enter' });"));
        assert.ok(editor.includes("if (!cropper) {\n            vscode.postMessage({ command: 'show-toast', text: t('toast.noImageCopy') });"));
        assert.ok(editor.includes('performCopyToClipboard(format, qualityPercent, selectionOnly);'));
        assert.ok(!editor.includes("function copyImageToClipboard() {\n        if (!cropper) {\n            return;\n        }\n        showCopyModal();"));
        assert.ok(editor.includes('const clipboard = navigator.clipboard;'));
        assert.ok(editor.includes('const ClipboardItemCtor = window.ClipboardItem;'));
        assert.ok(editor.includes('clipboard.write(['));
        assert.ok(editor.includes('new ClipboardItemCtor({'));
        assert.ok(editor.includes('if (usesMacShortcuts()) {'));
        assert.ok(provider.includes("translate(this.webviewL10n(), 'toast.clipboardUnavailable')"));
        assert.ok(editor.includes('try {'));
        assert.ok(editor.includes('requestHostClipboardCopyDataUrl(dataUrl, toastText);'));
        assert.ok(editor.includes("command: 'copy-image'"));
        assert.ok(editor.includes('dataUrl,'));
        assert.ok(provider.includes("case 'copy-image':"));
        assert.ok(provider.includes('copyImageMessageToClipboard(message, message.successText)'));
        assert.ok(provider.includes('parseClipboardDataUrl'));
        assert.ok(provider.includes("this.execFileAsync('sips'"));
        assert.ok(provider.includes("this.execFileAsync('swift'"));
        assert.ok(provider.includes('NSPasteboard.general'));
        assert.ok(provider.includes('writeObjects([image])'));
        assert.ok(provider.includes("this.execFileAsync('osascript'"));
        assert.ok(provider.includes('buildMacClipboardAppleScript'));
        assert.ok(provider.includes('catch (swiftError)'));
        assert.ok(editor.includes("t('toast.imageCopiedAs'"));
        assert.ok(editor.includes("t('toast.imageCopiedSelection'"));
        assert.ok(editor.includes("t('toast.clipboardFailed', { error: String(err) })"));
        assert.ok(editor.includes('} catch (err) {'));
    });

    test('handles browser copy events directly so marquee copy still runs when keybindings are skipped', () => {
        assert.ok(editor.includes("document.addEventListener('copy', (e) => {"));
        assert.ok(editor.includes('shouldLetNativeTextCopyProceed(activeEl)'));
        assert.ok(editor.includes('e.preventDefault();'));
        assert.ok(editor.includes('copyImageToClipboard();'));
    });

    test('shows the extension version next to the properties title', () => {
        assert.ok(provider.includes('section-title-with-version'));
        assert.ok(provider.includes('section-title-version'));
        assert.ok(provider.includes("path.join(this.context.extensionPath, 'package.json')"));
    });

    test('uses the vsimage icon in the empty dashboard hero', () => {
        assert.ok(provider.includes('iconUri'));
        assert.ok(provider.includes("path.join(this.context.extensionPath, 'media', 'icon.jpg')"));
        assert.ok(provider.includes('dashboard-brand-icon'));
        assert.ok(provider.includes('data-i18n-alt="dashboard.brandAlt"'));
        assert.ok(styles.includes('.dashboard-brand-icon'));
        assert.ok(editor.includes("scope.querySelectorAll('[data-i18n-alt]').forEach((el) => {"));
    });

    test('shows checkerboard only behind the image area while keeping outer canvas solid', () => {
        assert.ok(styles.includes('.canvas-scroll-area {'));
        assert.ok(styles.includes('background-color: #383838;'));
        assert.ok(styles.includes('.image-container {'));
        assert.ok(styles.includes('background-color: #2f2f2f;'));
        assert.ok(styles.includes('linear-gradient(45deg'));
        assert.ok(styles.includes('background-size: 16px 16px;'));
    });

    test('shows a loading spinner while the webview bootstraps and images initialize', () => {
        assert.ok(provider.includes('webviewLoadingOverlay'));
        assert.ok(provider.includes('webview-loading-spinner'));
        assert.ok(provider.includes('dashboard.loading'));
        assert.ok(styles.includes('.webview-loading-overlay'));
        assert.ok(styles.includes('.webview-loading-spinner'));
        assert.ok(editor.includes('function setLoadingState(isLoading) {'));
        assert.ok(editor.includes('setLoadingState(true);'));
        assert.ok(editor.includes('setLoadingState(false);'));
    });

    test('queues pasted images that arrive before bootstrap finishes', () => {
        assert.ok(editor.includes('let pendingStartupFile = null;'));
        assert.ok(editor.includes('let isBootstrapComplete = false;'));
        assert.ok(editor.includes('function queueStartupFile(file) {'));
        assert.ok(editor.includes('function flushPendingStartupFile() {'));
        assert.ok(editor.includes('if (!isBootstrapComplete) {'));
        assert.ok(editor.includes('pendingStartupFile = file;'));
        assert.ok(editor.includes('flushPendingStartupFile();'));
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
        assert.ok(provider.includes('id="btnToolMarquee"'));
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
        assert.ok(provider.includes('id="toolOptionsMarquee"'));
        assert.ok(provider.includes('id="toolOptionsCrop"'));
        assert.ok(provider.includes('id="chkEnableCrop" hidden aria-hidden="true"'));
        assert.ok(!provider.includes('data-shortcut="C / M"'));
        assert.ok(provider.includes('id="toolOptionsResize"'));
        assert.ok(provider.includes('id="toolOptionsMosaic"'));
        assert.ok(provider.includes('id="toolOptionsMove"'));
        assert.ok(provider.includes('id="rngMosaicSize"'));
        assert.ok(provider.includes('id="btnMosaicConfirm"'));
        assert.ok(provider.includes('id="btnMosaicCancel"'));
        assert.ok(provider.includes('properties-zoom-row'));
        assert.ok(provider.includes('toolbar.cursor'));
        assert.ok(provider.includes('toolbar.marqueeSelect'));
        assert.ok(provider.includes('sidebar.mosaicSize'));
        assert.ok(provider.includes('sidebar.mosaicCancel'));
        assert.ok(provider.includes('sidebar.mosaicConfirm'));
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
        assert.ok(editor.includes("marquee: document.getElementById('toolOptionsMarquee')"));
        assert.ok(editor.includes("setActiveTool(toolRailLogic.DEFAULT_ACTIVE_TOOL || 'cursor')"));
        assert.ok(editor.includes("setActiveTool('cursor')"));
        assert.ok(editor.includes("toolButtons.forEach((btn) => {"));
        assert.ok(editor.includes("const tool = btn.dataset.tool || 'cursor';"));
        assert.ok(editor.includes("if (tool === 'marquee') {"));
        assert.ok(editor.includes("setActiveTool('marquee', { setMarqueeMode: true });"));
        assert.ok(editor.includes('function syncMosaicAvailability() {'));
        assert.ok(editor.includes("sidebar.mosaicNeedsMarquee"));
        assert.ok(editor.includes('aria-disabled'));
        assert.ok(editor.includes("[btnToolMosaic, btnApplyMosaic].forEach((btn) => {"));
        assert.ok(editor.includes("btn.classList.toggle('is-disabled', !canUseMosaic);"));
        assert.ok(editor.includes("btn.title = getMosaicTitle(btn);"));
        assert.ok(editor.includes("setActiveTool('mosaic', { keepCropEnabled: true });"));
        assert.ok(editor.includes("btnApplyCrop.addEventListener('click', () => {"));
        assert.ok(editor.includes('btnApplyCrop.click();'));
        assert.ok(editor.includes("activeTool = toolRailLogic.resolveToolAfterApply(activeTool, 'crop');"));
        assert.ok(editor.includes('setActiveTool(activeTool);'));
        assert.ok(editor.includes('let suppressCropCheckboxToolSync = false;'));
        assert.ok(editor.includes('if (suppressCropCheckboxToolSync) {'));
        assert.ok(editor.includes("chkEnableCrop.dispatchEvent(new Event('change'));"));
        assert.ok(editor.includes('toolRailLogic.shouldBlockMarqueeCreation(activeTool)'));
        assert.ok(editor.includes("setActiveTool('marquee', { setMarqueeMode: true });"));
        const escapeIndex = editor.indexOf("if (e.key === 'Escape')");
        const inputGuardIndex = editor.indexOf('if (isInput) {');
        assert.ok(escapeIndex >= 0);
        assert.ok(inputGuardIndex >= 0);
        assert.ok(escapeIndex < inputGuardIndex);
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
        assert.ok(provider.includes('shortcuts.marqueeResize'));
        assert.ok(provider.includes('shortcuts.moveMarquee'));
        assert.ok(provider.includes('Shift + [ / ]'));
        assert.ok(provider.includes('Shift + ↑ ↓ ← →'));
        assert.ok(styles.includes('.marquee-shortcut-tooltip'));
        assert.ok(styles.includes('.marquee-shortcut-tooltip-row'));
        assert.ok(editor.includes('showMarqueeShortcutTooltip'));
        assert.ok(editor.includes('hideMarqueeShortcutTooltip'));
        assert.ok(editor.includes("e.target.closest('.cropper-face')"));
    });

    test('erases the marquee immediately before enabling fill preview mode', () => {
        assert.ok(editor.includes("const eraseBounds = cropper.getData(true);"));
        assert.ok(editor.includes("pushHistorySnapshot('edit.eraseSelection');"));
        assert.ok(editor.includes('ctx.clearRect(eraseBounds.x, eraseBounds.y, eraseBounds.width, eraseBounds.height);'));
        assert.ok(editor.includes('restoreCropData: eraseBounds'));
        assert.ok(editor.includes('keepCropEnabled: true'));
        assert.ok(editor.includes('startEyedropper: true'));
        assert.ok(editor.includes('beginEyedropperForSelection(clampedRestoreCropData);'));
        assert.ok(!editor.includes("text: t('toast.eyedropperActive')"));
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

    test('keeps marquee above the mosaic preview layer', () => {
        assert.ok(styles.includes('.canvas-workspace.crop-active .image-container .cropper-container'));
    });

    test('adds shortcut metadata and badges to the tool rail', () => {
        assert.ok(provider.includes('id="btnToolMarquee" data-tool="marquee" data-shortcut="M"'));
        assert.ok(provider.includes('id="btnToolCrop" data-tool="crop" data-shortcut="C"'));
        assert.ok(provider.includes('id="btnToolMosaic" data-tool="mosaic" data-shortcut="X"'));
        assert.ok(provider.includes('id="btnToolMove" data-tool="move" data-shortcut="H"'));
        assert.ok(provider.includes('<span class="ui-shortcut-badge"></span>'));
    });

    test('shows a visible tooltip for tool rail button names', () => {
        assert.ok(provider.includes('id="toolRailTooltip"'));
        assert.ok(editor.includes('function showToolRailTooltip('));
        assert.ok(editor.includes('function bindToolRailTooltipInteractions('));
        assert.ok(editor.includes('toolRailTooltip'));
        assert.ok(styles.includes('.tool-rail-tooltip'));
    });

    test('blocks mosaic tool clicks while the button is disabled', () => {
        assert.ok(editor.includes("if (tool === 'mosaic') {"));
        assert.ok(editor.includes("if (tool === 'mosaic' && btn.getAttribute('aria-disabled') === 'true') {"));
    });

    test('wires the marquee mosaic action through the webview', () => {
        assert.ok(provider.includes('mosaicLogicUri'));
        assert.ok(provider.includes('btnApplyMosaic'));
        assert.ok(provider.includes('sidebar.applyMosaic'));
        assert.ok(provider.includes('sidebar.mosaicHint'));
        assert.ok(provider.includes('btnMosaicConfirm'));
        assert.ok(provider.includes('btnMosaicCancel'));
        assert.ok(editor.includes('const mosaicLogic = globalThis.VsimageMosaicLogic || {'));
        assert.ok(editor.includes('applyMosaicToImageData: (imageData, rect, blockSize) => {'));
        assert.ok(editor.includes('ctx.putImageData(imageData, 0, 0);'));
        assert.ok(editor.includes('scaleNaturalRectToImageData'));
        assert.ok(editor.includes('function showMosaicModal()'));
        assert.ok(editor.includes('function renderMosaicPreview()'));
        assert.ok(editor.includes('function hideMosaicModal()'));
        assert.ok(editor.includes("if (tool === 'mosaic') {"));
        assert.ok(editor.includes("setActiveTool('mosaic', { keepCropEnabled: true });"));
        assert.ok(editor.includes('showMosaicModal();'));
        assert.ok(editor.includes('mosaicPreviewSourceCanvas'));
        assert.ok(editor.includes('applyMosaicToCanvas('));
        assert.ok(editor.includes('ctx.drawImage(mosaicPreviewSourceCanvas'));
        assert.ok(editor.includes("btnApplyMosaic.addEventListener('click', () => {"));
        assert.ok(editor.includes("if (shortcutAction === 'mosaic') {"));
        assert.ok(editor.includes("setActiveTool('mosaic', { keepCropEnabled: true });"));
        assert.ok(provider.includes('shortcuts.mosaicSelection'));
        assert.ok(!provider.includes('id="mosaicModal"'));
    });

    test('returns to the cursor tool after applying mosaic', () => {
        assert.ok(editor.includes("hideMosaicModal();\n        setActiveTool('cursor');"));
        assert.ok(editor.includes("vscode.postMessage({ command: 'show-toast', text: t('toast.mosaicApplied') });"));
    });

    test('keeps mosaic slider preview synced to the live marquee and slider value', () => {
        assert.ok(editor.includes("const cropperCanvasHost = cropper.cropper.querySelector('.cropper-canvas');"));
        assert.ok(editor.includes('cropperCanvasHost.appendChild(mosaicPreviewCanvas);'));
        assert.ok(editor.includes('mosaicPreviewState.cropData = cropper.getData(true);'));
        assert.ok(editor.includes('mosaicLogic.applyMosaicToCanvas('));
        assert.ok(editor.includes('mosaicPreviewState.cropData,'));
        assert.ok(editor.includes('mosaicPreviewState.blockSize'));
        assert.ok(editor.includes("rngMosaicSize.addEventListener('input', () => {"));
        assert.ok(editor.includes('mosaicPreviewState.blockSize = size;'));
        assert.ok(editor.includes('scheduleMosaicPreviewRender();'));
    });

    test('hides the magic wand UI while leaving the feature wiring dormant', () => {
        assert.ok(!provider.includes('id="btnMagicWand"'));
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

    test('queues host shortcuts until the webview reports that the editor is ready', () => {
        assert.ok(editor.includes("vscode.postMessage({ command: 'editor-ready' });"));
        assert.ok(provider.includes("case 'editor-ready':"));
        assert.ok(provider.includes('const activeUri = this.getActiveTabUri();'));
        assert.ok(provider.includes('data-host-platform="${process.platform}"'));
        assert.ok(provider.includes('private readonly readyWebviews = new Map<string, boolean>();'));
        assert.ok(provider.includes('private readonly pendingShortcuts = new Map<string, string[]>();'));
        assert.ok(provider.includes('flushPendingShortcuts'));
        assert.ok(editor.includes("const hostPlatform = document.body && document.body.dataset ? document.body.dataset.hostPlatform : '';"));
    });

    test('handles shifted bracket marquee resize using physical key codes', () => {
        assert.ok(editor.includes("e.code === 'BracketLeft'"));
        assert.ok(editor.includes("e.code === 'BracketRight'"));
    });
});
