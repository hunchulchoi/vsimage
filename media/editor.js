(function() {
    const vscode = acquireVsCodeApi();
    let isDocumentEditor = false;
    let l10n = {};

    function t(key, replacements) {
        let message = l10n[key] || key;
        if (replacements) {
            Object.keys(replacements).forEach((name) => {
                message = message.replace(new RegExp(`\\{${name}\\}`, 'g'), replacements[name]);
            });
        }
        return message;
    }

    function parseFileSizeBytes(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : null;
    }

    function formatFileSize(bytes) {
        if (bytes === null || bytes === undefined) {
            return '—';
        }
        const size = Number(bytes);
        if (!Number.isFinite(size) || size < 0) {
            return '—';
        }
        if (size < 1024) {
            return `${size} B`;
        }
        const units = ['KB', 'MB', 'GB', 'TB'];
        let value = size / 1024;
        let unitIndex = 0;
        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex += 1;
        }
        return `${value.toFixed(1)} ${units[unitIndex]}`;
    }

    function setFileSizeLabel(bytes) {
        if (!lblFileSize) {
            return;
        }
        lblFileSize.textContent = formatFileSize(parseFileSizeBytes(bytes));
    }

    /** applyI18n rebuilds percent labels; always resolve spans by id (no cached refs). */
    function setPercentSpan(spanId, value) {
        const el = document.getElementById(spanId);
        if (el) {
            el.textContent = String(value);
        }
    }

    function syncPercentLabelsFromInputs() {
        const pairs = resizePanelLogic.PERCENT_LABEL_SYNC_PAIRS || [
            ['resizeScaleVal', 'rngResizeScale'],
            ['sharpenVal', 'rngSharpen'],
            ['qualityVal', 'rngQuality'],
            ['copyQualityVal', 'rngCopyQuality']
        ];
        pairs.forEach(([spanId, inputId]) => {
            const input = document.getElementById(inputId);
            if (input) {
                setPercentSpan(spanId, input.value);
            }
        });
    }

    function normalizeResizeDimensionInput(input) {
        if (!input) {
            return '';
        }
        const normalize = resizePanelLogic.normalizeResizeDimensionValue || ((value) => {
            if (value === '' || value === null || value === undefined) {
                return '';
            }
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) {
                return '';
            }
            return String(Math.max(1, Math.trunc(numeric)));
        });
        const normalized = normalize(input.value);
        if (normalized !== input.value) {
            input.value = normalized;
        }
        return normalized;
    }

    function applyI18n(root) {
        const scope = root || document;
        scope.querySelectorAll('[data-i18n]').forEach((el) => {
            el.textContent = t(el.getAttribute('data-i18n'));
        });
        scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
            el.innerHTML = t(el.getAttribute('data-i18n-html'));
        });
        scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
            el.title = t(el.getAttribute('data-i18n-title'));
        });
        scope.querySelectorAll('[data-i18n-alt]').forEach((el) => {
            el.alt = t(el.getAttribute('data-i18n-alt'));
        });
        scope.querySelectorAll('[data-i18n-label]').forEach((el) => {
            if (resizePanelLogic.rebuildPercentLabelHtml) {
                const rebuilt = resizePanelLogic.rebuildPercentLabelHtml(
                    t(el.getAttribute('data-i18n-label')),
                    el,
                    document
                );
                el.innerHTML = rebuilt.html;
            } else {
                const meta = resizePanelLogic.resolveI18nPercentLabel(el.innerHTML);
                const valueEl = el.querySelector(`#${meta.valueId}`);
                const value = valueEl ? valueEl.textContent : meta.defaultValue;
                el.innerHTML = `${t(el.getAttribute('data-i18n-label'))} (<span id="${meta.valueId}">${value}</span>%)`;
            }
        });
        syncPercentLabelsFromInputs();
    }

    function usesMacShortcuts() {
        const hostPlatform = document.body && document.body.dataset ? document.body.dataset.hostPlatform : '';
        if (hostPlatform === 'darwin') {
            return true;
        }
        if (hostPlatform === 'win32' || hostPlatform === 'linux') {
            return false;
        }
        return /Mac|iPhone|iPod|iPad/i.test(navigator.platform) || navigator.userAgent.includes('Mac');
    }

    function formatShortcut(spec) {
        if (!spec) {
            return '';
        }

        const mod = usesMacShortcuts() ? '⌘' : 'Ctrl';
        const alt = usesMacShortcuts() ? '⌥' : 'Alt';
        return spec
            .replace(/mod\+/gi, `${mod}+`)
            .replace(/alt\+/gi, `${alt}+`)
            .replace(/shift\+/gi, 'Shift+');
    }

    function applyShortcutHints() {
        document.querySelectorAll('[data-shortcut]').forEach((el) => {
            const label = formatShortcut(el.getAttribute('data-shortcut'));
            const badge = el.querySelector('.context-menu-shortcut, .ui-shortcut-badge');
            if (badge) {
                badge.textContent = label;
            }

            const titleKey = el.getAttribute('data-i18n-title');
            if (titleKey) {
                const base = t(titleKey);
                el.title = label ? `${base} (${label})` : base;
            }
        });
    }

    function setShortcutHintsVisible(visible) {
        if (visible && shortcutOverlayDismissed) {
            visible = false;
        }
        document.body.classList.toggle('show-shortcut-hints', visible);
        if (shortcutOverlay) {
            shortcutOverlay.style.display = visible ? 'block' : 'none';
        }
        if (!visible) {
            hideShortcutHintTooltip();
        }
    }

    function updateShortcutHintsFromEvent(e) {
        const modifiersHeld = !!(e && (e.metaKey || e.ctrlKey));
        setShortcutHintsVisible(modifiersHeld && !shortcutOverlayDismissed);
    }

    function dismissShortcutLayers() {
        shortcutOverlayDismissed = true;
        setShortcutHintsVisible(false);
        hideShortcutHintTooltip();
        hideToolRailTooltip();
        hideMarqueeShortcutTooltip();
        if (contextMenu) {
            contextMenu.style.display = 'none';
        }
    }

    function hideShortcutHintTooltip() {
        if (shortcutHintTooltip) {
            shortcutHintTooltip.style.display = 'none';
        }
    }

    function hideToolRailTooltip() {
        if (toolRailTooltip) {
            toolRailTooltip.style.display = 'none';
        }
    }

    function showShortcutHintTooltip(el, clientX, clientY) {
        if (!shortcutHintTooltip || !el) {
            return;
        }

        const label = formatShortcut(el.getAttribute('data-shortcut'));
        if (!label) {
            hideShortcutHintTooltip();
            return;
        }

        shortcutHintTooltip.textContent = label;
        shortcutHintTooltip.style.display = 'block';
        shortcutHintTooltip.style.left = `${clientX + 14}px`;
        shortcutHintTooltip.style.top = `${clientY + 14}px`;
    }

    function showToolRailTooltip(el, clientX, clientY) {
        if (!toolRailTooltip || !el) {
            return;
        }

        const titleKey = el.getAttribute('data-i18n-title');
        const baseLabel = titleKey ? t(titleKey) : '';
        const shortcut = formatShortcut(el.getAttribute('data-shortcut'));
        const text = shortcut ? `${baseLabel} (${shortcut})` : baseLabel;
        if (!text) {
            hideToolRailTooltip();
            return;
        }

        toolRailTooltip.textContent = text;
        toolRailTooltip.style.display = 'block';
        toolRailTooltip.style.left = `${clientX + 14}px`;
        toolRailTooltip.style.top = `${clientY + 14}px`;
    }

    function bindShortcutHintInteractions() {
        document.querySelectorAll('[data-shortcut]').forEach((el) => {
            el.addEventListener('mouseenter', (e) => {
                showShortcutHintTooltip(el, e.clientX, e.clientY);
            });
            el.addEventListener('mousemove', (e) => {
                if (shortcutHintTooltip && shortcutHintTooltip.style.display === 'block') {
                    showShortcutHintTooltip(el, e.clientX, e.clientY);
                }
            });
            el.addEventListener('mouseleave', hideShortcutHintTooltip);
        });
    }

    function bindToolRailTooltipInteractions() {
        document.querySelectorAll('.tool-rail-btn').forEach((el) => {
            el.addEventListener('mouseenter', (e) => {
                showToolRailTooltip(el, e.clientX, e.clientY);
            });
            el.addEventListener('mousemove', (e) => {
                if (toolRailTooltip && toolRailTooltip.style.display === 'block') {
                    showToolRailTooltip(el, e.clientX, e.clientY);
                }
            });
            el.addEventListener('mouseleave', hideToolRailTooltip);
        });
    }

    function hideMarqueeShortcutTooltip() {
        if (marqueeShortcutTooltip) {
            marqueeShortcutTooltip.style.display = 'none';
        }
    }

    function showMarqueeShortcutTooltip(clientX, clientY) {
        if (!marqueeShortcutTooltip) {
            return;
        }

        marqueeShortcutTooltip.style.display = 'flex';
        marqueeShortcutTooltip.style.left = `${clientX + 14}px`;
        marqueeShortcutTooltip.style.top = `${clientY + 14}px`;
    }

    async function loadWebviewL10n() {
        const body = document.body;
        const enUrl = body.getAttribute('data-l10n-en');
        if (!enUrl) {
            return {};
        }

        const en = await (await fetch(enUrl)).json();
        const lang = body.dataset.lang || 'en';
        if (lang === 'en') {
            return en;
        }

        const localizedUrl = body.getAttribute(`data-l10n-${lang}`);
        if (!localizedUrl) {
            return en;
        }

        try {
            const localized = await (await fetch(localizedUrl)).json();
            return { ...en, ...localized };
        } catch {
            return en;
        }
    }
    const toolRailLogic = globalThis.VsimageToolRailLogic || {
        DEFAULT_ACTIVE_TOOL: 'cursor',
        resolveToolForShortcutAction: (_action, currentTool) => currentTool,
        resolveToolAfterApply: (tool) => tool,
        shouldEnableCropForTool: (tool) => tool === 'crop' || tool === 'marquee',
        shouldBlockMarqueeCreation: (tool) => tool === 'move' || tool === 'cursor' || tool === 'resize' || tool === 'mosaic'
    };
    const webviewLoadingOverlay = document.getElementById('webviewLoadingOverlay');
    const imageEl = document.getElementById('image');
    const sidebar = document.getElementById('sidebar');
    const toolbar = document.getElementById('toolbar');
    const toolRail = document.getElementById('toolRail');
    const toolButtons = Array.from(document.querySelectorAll('[data-tool]'));
    const toolOptionPanels = {
        cursor: document.getElementById('toolOptionsCursor'),
        marquee: document.getElementById('toolOptionsMarquee'),
        crop: document.getElementById('toolOptionsCrop'),
        resize: document.getElementById('toolOptionsResize'),
        mosaic: document.getElementById('toolOptionsMosaic'),
        move: document.getElementById('toolOptionsMove')
    };
    
    const txtWidth = document.getElementById('txtWidth');
    const txtHeight = document.getElementById('txtHeight');
    const chkLockRatio = document.getElementById('chkLockRatio');
    const rngResizeScale = document.getElementById('rngResizeScale');
    const btnApplyResize = document.getElementById('btnApplyResize');
    const sharpenSection = document.getElementById('sharpenSection');
    const rngSharpen = document.getElementById('rngSharpen');
    const btnApplyCrop = document.getElementById('btnApplyCrop');
    const btnToolMosaic = document.getElementById('btnToolMosaic');
    const btnApplyMosaic = document.getElementById('btnApplyMosaic');
    const btnMosaicCancel = document.getElementById('btnMosaicCancel');
    const btnMosaicConfirm = document.getElementById('btnMosaicConfirm');
    const btnReset = document.getElementById('btnReset');
    const lblResetText = document.getElementById('lblResetText');

    const selFormat = document.getElementById('selFormat');
    const qualitySection = document.getElementById('qualitySection');
    const rngQuality = document.getElementById('rngQuality');

    const chkEnableCrop = document.getElementById('chkEnableCrop');
    const btnSidebarAutoCollapse = document.getElementById('btnSidebarAutoCollapse');
    const lblZoomPercent = document.getElementById('lblZoomPercent');

    const historyList = document.getElementById('historyList');

    let cropper = null;
    let originalWidth = 0;
    let originalHeight = 0;
    let resizeBaseWidth = 0;
    let resizeBaseHeight = 0;
    let sharpenBaseSrc = null;
    let sharpenPreviewTimer = null;
    let aspectRatio = 0;
    let isMarqueeMode = false;
    let scaleX = 1;
    let scaleY = 1;
    const MAX_HISTORY = 30;
    let historyStack = [];
    let sidebarAutoCollapseState = { enabled: false, collapsed: false };
    let sidebarAutoCollapseTimer = null;
    let activeTool = toolRailLogic.DEFAULT_ACTIVE_TOOL || 'cursor';
    let pendingStartupFile = null;
    let isBootstrapComplete = false;
    let suppressCropCheckboxToolSync = false;
    let initialImageSrc = '';
    let isEyedropperActive = false;
    let isColorPickerMode = false;
    let isMagicWandMode = false;
    let isApplyingMagicWandSelection = false;
    let magicWandMask = null;
    let magicWandBounds = null;
    let magicWandOverlayEl = null;
    let magicWandCanvas = null;
    let magicWandCtx = null;
    let isEyedropperShortcutPressed = false;
    let colorPickerCanvas = null;
    let colorPickerCtx = null;
    let lastPickerPreview = '';
    let eraseTargetBounds = null;
    let eyedropperCanvas = null;
    let eyedropperCtx = null;
    let lastSampledColor = null;
    let initialFitRatio = 1;
    const MOSAIC_MIN_BLOCK_SIZE = 4;
    const MOSAIC_MAX_BLOCK_SIZE = 64;
    const MOSAIC_DEFAULT_BLOCK_SIZE = 16;
    let mosaicPreviewState = null;
    let mosaicPreviewCanvas = null;
    let mosaicPreviewCtx = null;
    let mosaicPreviewSourceCanvas = null;
    let mosaicPreviewRaf = null;
    /** Natural-image crop rect; kept in sync on crop changes, not re-read after zoom. */
    let lastNaturalCropData = null;
    const eyedropperTooltip = document.getElementById('eyedropperTooltip');
    const colorPickerTooltip = document.getElementById('colorPickerTooltip');
    const colorPickerSwatch = document.getElementById('colorPickerSwatch');
    const colorPickerPreview = document.getElementById('colorPickerPreview');
    const zoomLoupePanel = document.getElementById('zoomLoupePanel');
    const zoomLoupeDragHandle = document.getElementById('zoomLoupeDragHandle');
    const zoomLoupeCanvas = document.getElementById('zoomLoupeCanvas');
    const zoomLoupeSelection = document.getElementById('zoomLoupeSelection');
    const toolbarDragHandle = document.getElementById('toolbarDragHandle');
    const zoomLoupeCtx = zoomLoupeCanvas ? zoomLoupeCanvas.getContext('2d') : null;
    const Z_LOUPE_PANEL_PX = 200;
    const Z_LOUPE_SPOT_RADIUS = 24;
    const Z_LOUPE_MIN_DRAG = 2;
    const colorModal = document.getElementById('colorModal');
    const colorModalBackdrop = document.getElementById('colorModalBackdrop');
    const colorModalClose = document.getElementById('colorModalClose');
    const colorModalSwatch = document.getElementById('colorModalSwatch');
    const copyModal = document.getElementById('copyModal');
    const copyModalBackdrop = document.getElementById('copyModalBackdrop');
    const copyModalClose = document.getElementById('copyModalClose');
    const copyFormatOptions = document.getElementById('copyFormatOptions');
    const copyQualitySection = document.getElementById('copyQualitySection');
    const rngCopyQuality = document.getElementById('rngCopyQuality');
    const btnCopyConfirm = document.getElementById('btnCopyConfirm');
    const rngMosaicSize = document.getElementById('rngMosaicSize');
    const mosaicSizeVal = document.getElementById('mosaicSizeVal');
    const marqueeShortcutTooltip = document.getElementById('marqueeShortcutTooltip');
    const copyScopeSection = document.getElementById('copyScopeSection');
    const chkCopySelectionOnly = document.getElementById('chkCopySelectionOnly');
    const copyScopeInfo = document.getElementById('copyScopeInfo');
    const colorFormatList = document.getElementById('colorFormatList');
    const rngMagicWandTolerance = document.getElementById('rngMagicWandTolerance');
    const magicWandToleranceVal = document.getElementById('magicWandToleranceVal');
    const btnMagicWand = document.getElementById('btnMagicWand');

    const lblDimensions = document.getElementById('lblDimensions');
    const lblFileSize = document.getElementById('lblFileSize');
    const lblMarqueeWidth = document.getElementById('lblMarqueeWidth');
    const lblMarqueeHeight = document.getElementById('lblMarqueeHeight');
    const lblMarqueeX = document.getElementById('lblMarqueeX');
    const lblMarqueeY = document.getElementById('lblMarqueeY');
    let currentFileSizeBytes = parseFileSizeBytes(document.body.dataset.initialFileSizeBytes);

    function setLoadingState(isLoading) {
        if (!webviewLoadingOverlay) {
            return;
        }
        webviewLoadingOverlay.classList.toggle('is-hidden', !isLoading);
        webviewLoadingOverlay.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
    }

    function queueStartupFile(file) {
        if (!file) {
            return;
        }
        pendingStartupFile = file;
        setLoadingState(true);
    }

    function flushPendingStartupFile() {
        if (!isBootstrapComplete || !pendingStartupFile) {
            return;
        }
        const file = pendingStartupFile;
        pendingStartupFile = null;
        loadFile(file);
    }

    const dashboard = document.getElementById('dashboard');
    const workspace = document.getElementById('workspace');
    const cardImport = document.getElementById('cardImport');
    const filePicker = document.getElementById('filePicker');
    const cardPaste = document.getElementById('cardPaste');

    const contextMenu = document.getElementById('contextMenu');
    const shortcutOverlay = document.getElementById('shortcutOverlay');
    const shortcutHintTooltip = document.getElementById('shortcutHintTooltip');
    const toolRailTooltip = document.getElementById('toolRailTooltip');
    let shortcutOverlayDismissed = false;

    function notifyDocumentChanged(labelKey) {
        if (!isDocumentEditor) {
            return;
        }
        vscode.postMessage({ command: 'document-changed', label: t(labelKey) });
    }

    function trimHistoryStack() {
        historyStack = historyLogic.trimSnapshots(historyStack, MAX_HISTORY);
    }

    function pushHistorySnapshot(labelKey) {
        if (!imageEl || !imageEl.src) {
            return;
        }
        historyStack.push({
            src: imageEl.src,
            label: labelKey ? t(labelKey) : t('edit.edit')
        });
        trimHistoryStack();
        renderHistoryPanel();
    }

    function renderHistoryPanel() {
        if (!historyList || !imageEl) {
            return;
        }

        historyList.innerHTML = '';

        const currentBtn = document.createElement('button');
        currentBtn.type = 'button';
        currentBtn.className = 'history-item history-item-current';
        currentBtn.disabled = true;
        currentBtn.appendChild(createHistoryThumb(imageEl.src));
        currentBtn.appendChild(createHistoryMeta(t('history.current')));
        historyList.appendChild(currentBtn);

        for (let i = historyStack.length - 1; i >= 0; i--) {
            const entry = historyStack[i];
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'history-item';
            btn.title = `${entry.label} (#${i + 1})`;
            btn.appendChild(createHistoryThumb(entry.src));
            btn.appendChild(createHistoryMeta(entry.label, `#${i + 1}`));
            btn.addEventListener('click', () => restoreHistorySnapshot(i));
            historyList.appendChild(btn);
        }
    }

    function createHistoryThumb(src) {
        const thumb = document.createElement('img');
        thumb.className = 'history-thumb';
        thumb.src = src;
        thumb.alt = '';
        thumb.loading = 'lazy';
        return thumb;
    }

    function createHistoryMeta(label, step) {
        const meta = document.createElement('div');
        meta.className = 'history-meta';
        const labelEl = document.createElement('span');
        labelEl.className = 'history-label';
        if (step) {
            labelEl.appendChild(document.createTextNode(label));
            const stepEl = document.createElement('span');
            stepEl.className = 'history-step';
            stepEl.textContent = ` · ${step}`;
            labelEl.appendChild(stepEl);
        } else {
            labelEl.textContent = label;
        }
        meta.appendChild(labelEl);
        return meta;
    }

    function formatSelectionMetric(value) {
        return Number.isFinite(value) ? `${Math.max(0, Math.round(value))} px` : '— px';
    }

    function setSelectionPanelValue(el, value) {
        if (!el) {
            return;
        }
        el.textContent = value;
        el.classList.toggle('is-empty', value === '— px');
    }

    function resetSelectionPanel() {
        setSelectionPanelValue(lblMarqueeWidth, '— px');
        setSelectionPanelValue(lblMarqueeHeight, '— px');
        setSelectionPanelValue(lblMarqueeX, '— px');
        setSelectionPanelValue(lblMarqueeY, '— px');
    }

    function updateSelectionPanelFromCrop() {
        if (!cropper || !chkEnableCrop.checked || !cropper.cropped) {
            resetSelectionPanel();
            return;
        }

        const cropData = cropper.getData(true);
        setSelectionPanelValue(lblMarqueeWidth, formatSelectionMetric(cropData.width));
        setSelectionPanelValue(lblMarqueeHeight, formatSelectionMetric(cropData.height));
    }

    function updateSelectionPanelFromPointer(e) {
        if (!cropper) {
            setSelectionPanelValue(lblMarqueeX, '— px');
            setSelectionPanelValue(lblMarqueeY, '— px');
            return;
        }

        const imageData = cropper.getImageData();
        if (!imageData || !imageData.width || !imageData.height) {
            setSelectionPanelValue(lblMarqueeX, '— px');
            setSelectionPanelValue(lblMarqueeY, '— px');
            return;
        }

        const rect = cropper.container.getBoundingClientRect();
        const xInContainer = e.clientX - rect.left;
        const yInContainer = e.clientY - rect.top;
        const xInImage = xInContainer - imageData.left;
        const yInImage = yInContainer - imageData.top;
        const naturalX = Math.round((xInImage / imageData.width) * imageData.naturalWidth);
        const naturalY = Math.round((yInImage / imageData.height) * imageData.naturalHeight);

        setSelectionPanelValue(lblMarqueeX, `${naturalX} px`);
        setSelectionPanelValue(lblMarqueeY, `${naturalY} px`);
    }

    resetSelectionPanel();

    function restoreHistorySnapshot(stackIndex) {
        const restored = historyLogic.restoreSnapshot(historyStack, stackIndex);
        if (!restored) {
            return;
        }
        const entry = restored.entry;
        historyStack = restored.remaining;
        initEditor(entry.src);
        vscode.postMessage({
            command: 'show-toast',
            text: t('toast.historyRestored', { label: entry.label })
        });
    }

    function pushUndoSnapshot(labelKey) {
        if (!cropper) {
            return;
        }

        if (!chkEnableCrop.checked) {
            cropper.crop();
            cropper.setData({
                x: 0,
                y: 0,
                width: originalWidth,
                height: originalHeight
            });
        }

        let canvas = cropper.getCroppedCanvas({
            width: originalWidth,
            height: originalHeight,
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high'
        });

        historyStack.push({
            src: canvas.toDataURL(),
            label: labelKey ? t(labelKey) : t('edit.edit')
        });
        trimHistoryStack();
        renderHistoryPanel();
    }

    function markTransformEdit(labelKey) {
        pushUndoSnapshot(labelKey);
        notifyDocumentChanged(labelKey);
    }

    function applyRotationAction(action) {
        if (!cropper) {
            return;
        }
        const delta = transformLogic.rotationDelta(action);
        if (delta == null) {
            return;
        }
        markTransformEdit('edit.rotate');
        cropper.rotate(delta);
        scheduleSyncLayout();
    }

    function applyFlipAction(action) {
        if (!cropper) {
            return;
        }
        const next = transformLogic.nextFlipState({ scaleX, scaleY }, action);
        markTransformEdit(action === 'flipH' ? 'edit.flipH' : 'edit.flipV');
        scaleX = next.scaleX;
        scaleY = next.scaleY;
        if (action === 'flipH') {
            cropper.scaleX(scaleX);
        } else if (action === 'flipV') {
            cropper.scaleY(scaleY);
        }
    }

    function respondWithImageData(requestId, mimeType) {
        if (!window.editorApi || !window.editorApi.getCanvasBlob) {
            vscode.postMessage({ command: 'image-data-response', requestId, arrayBuffer: null, mimeType: 'image/png' });
            return;
        }

        window.editorApi.getCanvasBlob((blob) => {
            if (!blob) {
                vscode.postMessage({ command: 'image-data-response', requestId, arrayBuffer: null, mimeType: 'image/png' });
                return;
            }

            const reader = new FileReader();
            reader.onloadend = () => {
                vscode.postMessage({
                    command: 'image-data-response',
                    requestId,
                    arrayBuffer: reader.result,
                    mimeType: blob.type
                });
            };
            reader.readAsArrayBuffer(blob);
        }, { format: mimeType });
    }

    function revertUntitledEditor() {
        historyStack = [];
        renderHistoryPanel();
        endEyedropper();
        endColorPickerMode();
        hideColorModal();
        invalidateColorPickerCanvas();
        invalidateMagicWandCanvas();
        clearMagicWandMask();
        endMagicWandMode(false);
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
        clearNaturalCropData();
        initialImageSrc = null;
        currentFileSizeBytes = null;
        setFileSizeLabel(currentFileSizeBytes);
        imageEl.removeAttribute('src');
        imageEl.src = '';
        hideEditorChrome();
        dashboard.style.display = 'flex';
        workspace.style.display = 'none';
    }

    function revertToSource(src, fileSizeBytes) {
        historyStack = [];
        renderHistoryPanel();
        endEyedropper();
        endColorPickerMode();
        hideColorModal();
        invalidateColorPickerCanvas();
        invalidateMagicWandCanvas();
        clearMagicWandMask();
        endMagicWandMode(false);
        initialImageSrc = src;
        currentFileSizeBytes = parseFileSizeBytes(fileSizeBytes);
        setFileSizeLabel(currentFileSizeBytes);
        setActiveTool(toolRailLogic.DEFAULT_ACTIVE_TOOL || 'cursor');
        initEditor(src, { preserveInitialSrc: true });
        vscode.postMessage({ command: 'show-toast', text: t('toast.reverted') });
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.command) {
            case 'request-image-data':
                respondWithImageData(message.requestId, message.mimeType);
                break;
            case 'revert-document':
                revertToSource(message.src, message.fileSizeBytes);
                break;
            case 'revert-untitled':
                revertUntitledEditor();
                break;
            case 'perform-undo':
                performUndo({ fromHost: true });
                break;
            case 'run-shortcut':
                vscode.postMessage({ command: 'shortcut-ack', action: message.action });
                runShortcutAction(message.action);
                break;
            case 'document-saved':
                if (Object.prototype.hasOwnProperty.call(message, 'fileSizeBytes')) {
                    currentFileSizeBytes = parseFileSizeBytes(message.fileSizeBytes);
                    setFileSizeLabel(currentFileSizeBytes);
                }
                break;
        }
    });

    // Rulers & scroll viewport
    const rulerH = document.getElementById('rulerH');
    const rulerV = document.getElementById('rulerV');
    const canvasScrollArea = document.getElementById('canvasScrollArea');
    const canvasScrollContent = document.getElementById('canvasScrollContent');
    const imageContainer = document.getElementById('imageContainer');
    const RULER_SIZE = 20; // px — must match CSS --ruler-size
    const RULER_V_WIDTH = 20; // px — match the top ruler thickness for a balanced frame
    const CANVAS_PADDING = 0; // px — must match .canvas-scroll-content padding
    let expandingContainer = false;
    let expandContainerFrame = null;
    let isSpacePressed = false;
    let isHandPressed = false;
    let marqueeGestureState = null;
    let marqueeCreateDragState = null;
    let isZLoupeActive = false;
    let isZLoupeDragging = false;
    let zLoupeDragStart = null;
    let isZoomLoupePanelDragging = false;
    let zoomLoupePanelDragState = null;
    let isToolbarDragging = false;
    let toolbarDragState = null;
    let isPanning = false;
    let lastPanClientX = 0;
    let lastPanClientY = 0;

    function scheduleSyncLayout() {
        if (expandContainerFrame !== null) {
            cancelAnimationFrame(expandContainerFrame);
        }
        expandContainerFrame = requestAnimationFrame(() => {
            expandContainerFrame = null;
            syncLayoutAfterZoom();
            if (toolbar && toolbar.style.position === 'absolute') {
                const currentPosition = getToolbarCurrentPosition();
                if (currentPosition) {
                    placeToolbar(currentPosition.left, currentPosition.top);
                }
            }
        });
    }

    function updateCropInteraction() {
        if (!cropper) {
            return;
        }
        if (marqueeCreateDragState) {
            cropper.setDragMode('none');
            return;
        }
        if (marqueeGestureState) {
            return;
        }
        if (mosaicPreviewState) {
            cropper.setDragMode('none');
            return;
        }
        if (isPanShortcutPressed() || isZLoupeActive || isEyedropperActive || isColorPickerMode || isMagicWandMode) {
            cropper.setDragMode('none');
            return;
        }
        cropper.setDragMode(chkEnableCrop.checked ? 'crop' : 'none');
    }

    function isPanShortcutPressed() {
        return activeTool === 'move' || isSpacePressed || isHandPressed;
    }

    function activateMarqueeOnDrag(startPoint) {
        if (!cropper || chkEnableCrop.checked || !startPoint || toolRailLogic.shouldBlockMarqueeCreation(activeTool)) {
            return false;
        }

        chkEnableCrop.checked = true;
        marqueeCreateDragState = { startPoint };
        isMarqueeMode = true;
        syncCropPresetUI();
        applyMarqueeShape();
        cropper.crop();
        cropper.setData(clampCropBox(startPoint.x, startPoint.y, 1, 1));
        updateCropInteraction();
        return true;
    }

    function updateMarqueeDragCreate(e) {
        if (!marqueeCreateDragState || !cropper || !e) {
            return;
        }

        const currentPoint = getClampedImagePointFromEvent(e);
        if (!currentPoint) {
            return;
        }

        const nextBox = cropMarqueeLogic.resolveDragMarqueeBox({
            startPoint: marqueeCreateDragState.startPoint,
            currentPoint,
            originalWidth,
            originalHeight
        });

        if (!nextBox) {
            return;
        }

        e.preventDefault();
        cropper.setData(nextBox);
    }

    function endMarqueeDragCreate() {
        if (!marqueeCreateDragState) {
            return;
        }

        marqueeCreateDragState = null;
        updateCropInteraction();
    }

    const canvasLayoutLogic = globalThis.VsimageCanvasLayoutLogic || {
        computeCanvasViewportLayout: (viewportW, viewportH, canvasW, canvasH) => ({
            contentWidth: Math.max(viewportW, canvasW),
            contentHeight: Math.max(viewportH, canvasH),
            marginLeft: 0,
            marginTop: 0
        })
    };
    const shortcutLogic = globalThis.VsimageShortcutLogic || {
        getShortcutAction: () => null,
        isPanHoldCode: (code) => code === 'Space' || code === 'KeyH',
        isEyedropperHoldCode: (code) => code === 'KeyI'
    };
    const zoomLogic = globalThis.VsimageZoomLogic || {
        getImageZoomRatioFromData: (data) => (data && data.naturalWidth ? data.width / data.naturalWidth : null),
        zoomRatioToPercent: (r) => Math.round(Number(r) * 100),
        computeRatioAfterCropperRelativeZoom: (current, delta) => (
            delta < 0 ? current / (1 - delta) : current * (1 + delta)
        ),
        ratioAfterZoomAction: (current, action) => (
            action === 'zoomIn'
                ? current * 1.1
                : action === 'zoomOut'
                    ? current / 1.1
                    : null
        ),
        getCanvasSizeForZoomRatio: (w, h, ratio) => ({ width: w * ratio, height: h * ratio }),
        resolveFinalZoomRatioAfterCropRestore: (intended, after) => intended ?? after ?? 1,
        isImageZoomBelowFull: (r) => Math.abs(r - 1) >= 0.005,
        resolveToggleZoomTargetRatio: (cur, fit) => (Math.abs(cur - 1) < 0.005 ? fit : 1)
    };
    const cropMarqueeLogic = globalThis.VsimageCropMarqueeLogic || {
        clampCropBox: (x, y, w, h, ow, oh) => ({ x, y, width: w, height: h }),
        isMarqueeFullImageNatural: () => false,
        isPointInCropSelection: () => false,
        resolveMarqueeKeyboardStep: (shiftKey) => (shiftKey ? 10 : 1),
        shouldInvokeMarqueeDblClickToggle: () => false,
        shouldInvokeImageZoomDblClick: () => false,
        shouldSnapshotCropForZoom: (cropped, data) => Boolean(cropped) && data && data.width > 0,
        cloneNaturalCropSnapshot: (data) => (data ? Object.assign({}, data) : null)
    };
    const resizePanelLogic = globalThis.VsimageResizePanelLogic || {
        buildResizePanelFromImage: (w, h) => ({
            baseWidth: Math.max(0, Math.round(w)),
            baseHeight: Math.max(0, Math.round(h)),
            width: Math.max(0, Math.round(w)),
            height: Math.max(0, Math.round(h)),
            scalePercent: 100,
            widthPlaceholder: ''
        }),
        buildResizePanelFromCrop: (c) => ({
            baseWidth: Math.max(1, Math.round(c?.width || 0)),
            baseHeight: Math.max(1, Math.round(c?.height || 0)),
            width: Math.max(1, Math.round(c?.width || 0)),
            height: Math.max(1, Math.round(c?.height || 0)),
            scalePercent: 100,
            widthPlaceholder: ''
        }),
        shouldSyncResizePanelFromImage: () => true,
        percentFromResizeWidth: () => null,
        dimensionsFromResizeScalePercent: (p, bw, bh) => ({
            width: Math.max(1, Math.round(bw * p / 100)),
            height: Math.max(1, Math.round(bh * p / 100))
        }),
        resolveI18nPercentLabel: () => ({ valueId: 'qualityVal', defaultValue: '80' }),
        resolvePercentLabelMeta: (el, html) => {
            const spanId = el && el.getAttribute && el.getAttribute('data-percent-id');
            if (spanId) {
                return {
                    valueId: spanId,
                    inputId: el.getAttribute('data-percent-input'),
                    defaultValue: el.getAttribute('data-percent-default') || '0'
                };
            }
            return { valueId: 'qualityVal', defaultValue: '80' };
        },
        getPercentLabelDisplayValue: (meta, el) => {
            if (meta.inputId) {
                const input = document.getElementById(meta.inputId);
                if (input) {
                    return String(input.value);
                }
            }
            const span = el && el.querySelector && el.querySelector(`#${meta.valueId}`);
            return span && span.textContent ? span.textContent.trim() : meta.defaultValue;
        },
        PERCENT_LABEL_SYNC_PAIRS: [
            ['resizeScaleVal', 'rngResizeScale'],
            ['sharpenVal', 'rngSharpen'],
            ['qualityVal', 'rngQuality'],
            ['copyQualityVal', 'rngCopyQuality']
        ],
        getViewportFillRatio: (aw, ah, iw, ih) => Math.min(aw / iw, ah / ih),
        resolveZoomRatioAfterResize: (fill, panelPct, preferred) => {
            if (panelPct == null || panelPct >= 100) {
                const capped = Math.min(fill, 1);
                const r = preferred != null && preferred > 0 ? preferred : capped;
                return Math.min(r, capped);
            }
            const prior = preferred != null && preferred > 0 ? preferred : 1;
            return fill < 1 || prior < 1 ? fill : Math.min(prior, fill);
        },
        rebuildPercentLabelHtml: (translated, el) => {
            const meta = el.getAttribute && el.getAttribute('data-percent-id')
                ? {
                    valueId: el.getAttribute('data-percent-id'),
                    inputId: el.getAttribute('data-percent-input'),
                    defaultValue: el.getAttribute('data-percent-default') || '80'
                }
                : { valueId: 'qualityVal', defaultValue: '80', inputId: null };
            const input = meta.inputId ? document.getElementById(meta.inputId) : null;
            const value = input ? String(input.value) : meta.defaultValue;
            return {
                html: `${translated} (<span id="${meta.valueId}">${value}</span>%)`,
                valueId: meta.valueId,
                value
            };
        },
        computeHalveDownscaleSteps: (sw, sh, tw, th) => {
            const steps = [];
            let w = sw;
            let h = sh;
            while (w > tw * 2 || h > th * 2) {
                w = Math.max(tw, Math.floor(w / 2));
                h = Math.max(th, Math.floor(h / 2));
                steps.push({ w, h });
            }
            if (!steps.length || steps[steps.length - 1].w !== tw || steps[steps.length - 1].h !== th) {
                steps.push({ w: tw, h: th });
            }
            return steps;
        },
        computeDownscaleSteps: (sw, sh, tw, th) => {
            const factor = 0.75;
            const steps = [];
            let w = sw;
            let h = sh;
            let guard = 0;
            while ((w > tw * 1.02 || h > th * 1.02) && guard++ < 80) {
                const nw = Math.max(tw, Math.floor(w * factor));
                const nh = Math.max(th, Math.floor(h * factor));
                if (nw === w && nh === h) {
                    break;
                }
                steps.push({ w: nw, h: nh });
                w = nw;
                h = nh;
            }
            if (w !== tw || h !== th) {
                steps.push({ w: tw, h: th });
            }
            return steps;
        }
    };

    const sharpenLogic = globalThis.VsimageSharpenLogic || {
        amountFromSlider: (p) => (Math.max(0, Math.min(100, Number(p) || 0)) / 100) * 0.85,
        applyUnsharpMask: (canvas) => canvas
    };
    const mosaicLogic = globalThis.VsimageMosaicLogic || {
        normalizeBlockSize: (blockSize) => {
            const size = Math.round(Number(blockSize));
            return Number.isFinite(size) ? Math.max(1, size) : 8;
        },
        clampMosaicRect: (rect, width, height) => {
            if (!rect || width <= 0 || height <= 0) {
                return null;
            }

            const rawX = Math.round(Number(rect.x) || 0);
            const rawY = Math.round(Number(rect.y) || 0);
            const rawRight = Math.round(rawX + (Number(rect.width) || 0));
            const rawBottom = Math.round(rawY + (Number(rect.height) || 0));
            const x = Math.max(0, Math.min(width, rawX));
            const y = Math.max(0, Math.min(height, rawY));
            const right = Math.max(x, Math.min(width, rawRight));
            const bottom = Math.max(y, Math.min(height, rawBottom));
            const rectWidth = right - x;
            const rectHeight = bottom - y;

            if (rectWidth <= 0 || rectHeight <= 0) {
                return null;
            }

            return { x, y, width: rectWidth, height: rectHeight };
        },
        applyMosaicToImageData: (imageData, rect, blockSize) => {
            if (!imageData || !imageData.data) {
                return imageData;
            }

            const width = imageData.width;
            const height = imageData.height;
            const clampedRect = mosaicLogic.clampMosaicRect(rect, width, height);
            if (!clampedRect) {
                return imageData;
            }

            const size = mosaicLogic.normalizeBlockSize(blockSize);
            const data = imageData.data;
            const rectRight = clampedRect.x + clampedRect.width;
            const rectBottom = clampedRect.y + clampedRect.height;

            for (let blockY = clampedRect.y; blockY < rectBottom; blockY += size) {
                for (let blockX = clampedRect.x; blockX < rectRight; blockX += size) {
                    const blockRight = Math.min(rectRight, blockX + size);
                    const blockBottom = Math.min(rectBottom, blockY + size);
                    let r = 0;
                    let g = 0;
                    let b = 0;
                    let a = 0;
                    let count = 0;

                    for (let y = blockY; y < blockBottom; y += 1) {
                        for (let x = blockX; x < blockRight; x += 1) {
                            const offset = ((y * width) + x) * 4;
                            r += data[offset];
                            g += data[offset + 1];
                            b += data[offset + 2];
                            a += data[offset + 3];
                            count += 1;
                        }
                    }

                    if (!count) {
                        continue;
                    }

                    const avgR = Math.round(r / count);
                    const avgG = Math.round(g / count);
                    const avgB = Math.round(b / count);
                    const avgA = Math.round(a / count);

                    for (let y = blockY; y < blockBottom; y += 1) {
                        for (let x = blockX; x < blockRight; x += 1) {
                            const offset = ((y * width) + x) * 4;
                            data[offset] = avgR;
                            data[offset + 1] = avgG;
                            data[offset + 2] = avgB;
                            data[offset + 3] = avgA;
                        }
                    }
                }
            }

            return imageData;
        },
        applyMosaicToCanvas: (canvas, rect, blockSize) => {
            if (!canvas || !canvas.width || !canvas.height) {
                return canvas;
            }

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return canvas;
            }

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            mosaicLogic.applyMosaicToImageData(imageData, rect, blockSize);
            ctx.putImageData(imageData, 0, 0);
            return canvas;
        },
        scaleNaturalRectToImageData: (rect, imageData) => {
            if (!rect || !imageData || !imageData.width || !imageData.height || !imageData.naturalWidth || !imageData.naturalHeight) {
                return null;
            }

            const xScale = imageData.width / imageData.naturalWidth;
            const yScale = imageData.height / imageData.naturalHeight;
            return mosaicLogic.clampMosaicRect({
                x: rect.x * xScale,
                y: rect.y * yScale,
                width: rect.width * xScale,
                height: rect.height * yScale
            }, imageData.width, imageData.height);
        }
    };
    const colorLogic = globalThis.VsimageColorLogic || {
        buildColorFormats: (r, g, b, a) => {
            const hexByte = (n) => n.toString(16).padStart(2, '0').toUpperCase();
            const alpha = a / 255;
            const hex = a < 255
                ? `#${hexByte(r)}${hexByte(g)}${hexByte(b)}${hexByte(a)}`
                : `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
            return [
                { label: 'HEX', value: hex },
                { label: 'RGB', value: `rgb(${r}, ${g}, ${b})` },
                { label: 'RGBA', value: `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})` }
            ];
        }
    };
    const magicWandLogic = globalThis.VsimageMagicWandLogic;
    const clipboardLogic = globalThis.VsimageClipboardLogic;
    const saveExportLogic = globalThis.VsimageSaveExportLogic || {
        resolveSaveStart: (type, documentEditor) => (
            type === 'save' && documentEditor
                ? { immediateMessage: { command: 'save-document' }, needsBlob: false }
                : { immediateMessage: null, needsBlob: true }
        ),
        commandForBlobType: (type) => (type === 'save' ? 'save-image' : 'export-image')
    };
    const sidebarAutoCollapseLogic = globalThis.VsimageSidebarAutoCollapseLogic || {
        SIDEBAR_AUTO_COLLAPSE_DELAY_MS: 240,
        getSidebarAutoCollapseDelayMs: () => 240,
        createSidebarAutoCollapseState: () => ({ enabled: false, collapsed: false }),
        setSidebarAutoCollapseEnabled: (_state, enabled) => ({
            enabled: !!enabled,
            collapsed: false
        }),
        handleSidebarAutoCollapseMouseEnter: (state) => (
            state && state.enabled
                ? { enabled: true, collapsed: false }
                : state
        ),
        handleSidebarAutoCollapseMouseLeave: (state) => (
            state && state.enabled
                ? { enabled: true, collapsed: true }
                : state
        )
    };
    sidebarAutoCollapseState = sidebarAutoCollapseLogic.createSidebarAutoCollapseState
        ? sidebarAutoCollapseLogic.createSidebarAutoCollapseState()
        : { enabled: false, collapsed: false };
    const historyLogic = globalThis.VsimageHistoryLogic || {
        trimSnapshots: (entries, max) => (
            entries.length > max ? entries.slice(entries.length - max) : entries.slice()
        ),
        restoreSnapshot: (entries, index) => (
            index < 0 || index >= entries.length
                ? null
                : { entry: entries[index], remaining: entries.slice(0, index) }
        )
    };
    const transformLogic = globalThis.VsimageTransformLogic || {
        rotationDelta: (action) => (
            action === 'rotateLeft' ? -90 : action === 'rotateRight' ? 90 : null
        ),
        nextFlipState: (state, action) => ({
            scaleX: action === 'flipH' ? -state.scaleX : state.scaleX,
            scaleY: action === 'flipV' ? -state.scaleY : state.scaleY
        })
    };
    const loupeLogic = globalThis.VsimageLoupeLogic;

    function clampCropBox(x, y, width, height) {
        return cropMarqueeLogic.clampCropBox(x, y, width, height, originalWidth, originalHeight);
    }

    function getClampedImagePointFromEvent(e) {
        if (!cropper || !e) {
            return null;
        }

        const imageData = cropper.getImageData();
        if (!imageData || !imageData.width || !imageData.height || !imageData.naturalWidth || !imageData.naturalHeight) {
            return null;
        }

        const rect = cropper.container.getBoundingClientRect();
        const xInContainer = e.clientX - rect.left;
        const yInContainer = e.clientY - rect.top;
        const xInImage = xInContainer - imageData.left;
        const yInImage = yInContainer - imageData.top;

        const naturalX = Math.round((xInImage / imageData.width) * imageData.naturalWidth);
        const naturalY = Math.round((yInImage / imageData.height) * imageData.naturalHeight);

        return {
            x: Math.max(0, Math.min(originalWidth - 1, naturalX)),
            y: Math.max(0, Math.min(originalHeight - 1, naturalY))
        };
    }

    function applyMarqueeFaceStyles(circular) {
        const face = document.querySelector('.cropper-face');
        if (face) {
            face.style.borderRadius = circular ? '50%' : '0';
            face.style.backgroundColor = 'transparent';
        }
    }

    function updateCropPresetActiveButton() {
        presetButtons.forEach(b => b.classList.remove('active'));
        const freeBtn = document.querySelector('#cropPresets button[data-ratio="NaN"]');
        if (freeBtn) {
            freeBtn.classList.add('active');
        }
    }

    function applyMarqueeShape() {
        if (!cropper) {
            return;
        }
        cropper.setAspectRatio(NaN);
        applyMarqueeFaceStyles(false);
        updateCropPresetActiveButton();
    }

    function handleMarqueeCropStart(detail) {
        if (!detail || !detail.originalEvent || !cropper) {
            return;
        }

        marqueeGestureState = {
            action: detail.action,
            startPoint: getClampedImagePointFromEvent(detail.originalEvent),
            startCropData: cropper.cropped ? cropper.getData(true) : null
        };
    }

    function handleMarqueeCropMove(e) {
        if (!marqueeGestureState || !cropper || !e.detail || !e.detail.originalEvent) {
            return;
        }

        const originalEvent = e.detail.originalEvent;
        const currentPoint = getClampedImagePointFromEvent(originalEvent);
        if (!currentPoint) {
            return;
        }

        const nextBox = cropMarqueeLogic.resolveModifierMarqueeBox({
            startCropData: marqueeGestureState.startCropData,
            startPoint: marqueeGestureState.startPoint,
            currentPoint,
            originalWidth,
            originalHeight,
            shiftKey: !!originalEvent.shiftKey,
            altKey: !!originalEvent.altKey,
            spacePressed: isSpacePressed
        });

        if (!nextBox) {
            return;
        }

        e.preventDefault();
        cropper.setData(nextBox);
    }

    function handleMarqueeCropEnd() {
        marqueeGestureState = null;
    }

    function initMarqueeToFullImage() {
        setMarqueeToFullImage();
    }

    function setMarqueeToFullImage() {
        if (!cropper) {
            return;
        }
        if (!cropper.cropped) {
            cropper.crop();
        }
        normalizeCanvasOrigin();
        cropper.setData(clampCropBox(0, 0, originalWidth, originalHeight));
        updateResizeInputsFromCrop();
        updateSelectionPanelFromCrop();
        cacheNaturalCropData();
        scheduleSyncLayout();
    }

    function isCropBoxMatchingCanvas(tolerance = 2) {
        if (!cropper || !cropper.cropped) {
            return false;
        }
        normalizeCanvasOrigin();
        const canvas = cropper.getCanvasData();
        const box = cropper.getCropBoxData();
        if (!canvas?.width || !box?.width) {
            return false;
        }
        return Math.abs(box.left - canvas.left) <= tolerance
            && Math.abs(box.top - canvas.top) <= tolerance
            && Math.abs(box.width - canvas.width) <= tolerance
            && Math.abs(box.height - canvas.height) <= tolerance;
    }

    function isMarqueeFullImageNatural(tolerance = 2) {
        if (!cropper || !cropper.cropped) {
            return false;
        }
        return cropMarqueeLogic.isMarqueeFullImageNatural(
            cropper.getData(true),
            originalWidth,
            originalHeight,
            tolerance
        );
    }

    function ensureCropMarqueeForKeyboard() {
        if (!cropper || !chkEnableCrop.checked) {
            return false;
        }

        if (!cropper.cropped) {
            initMarqueeToFullImage();
        }

        return cropper.cropped;
    }

    function focusCropKeyboardTarget() {
        if (workspace && workspace.style.display !== 'none') {
            workspace.focus({ preventScroll: true });
        }
    }

    function moveCropMarqueeWithArrow(key, shiftKey) {
        if (!ensureCropMarqueeForKeyboard()) {
            return false;
        }
        if (isPanShortcutPressed() || isZLoupeActive || isEyedropperActive || isColorPickerMode || isMagicWandMode) {
            return false;
        }

        const data = cropper.getData(true);
        const step = cropMarqueeLogic.resolveMarqueeKeyboardStep(shiftKey);
        let nextX = data.x;
        let nextY = data.y;

        switch (key) {
            case 'ArrowLeft':
                nextX -= step;
                break;
            case 'ArrowRight':
                nextX += step;
                break;
            case 'ArrowUp':
                nextY -= step;
                break;
            case 'ArrowDown':
                nextY += step;
                break;
            default:
                return false;
        }

        cropper.setData(clampCropBox(nextX, nextY, data.width, data.height));
        updateResizeInputsFromCrop();
        cacheNaturalCropData();
        focusCropKeyboardTarget();
        return true;
    }

    function resizeCropMarqueeByInset(inset, shiftKey) {
        if (!ensureCropMarqueeForKeyboard()) {
            return false;
        }
        if (isPanShortcutPressed() || isZLoupeActive || isEyedropperActive || isColorPickerMode || isMagicWandMode) {
            return false;
        }

        const data = cropper.getData(true);
        const step = cropMarqueeLogic.resolveMarqueeKeyboardStep(shiftKey);
        const normalizedInset = inset < 0 ? -step : step;
        const nextX = data.x + normalizedInset;
        const nextY = data.y + normalizedInset;
        const nextW = data.width - (normalizedInset * 2);
        const nextH = data.height - (normalizedInset * 2);

        if (nextW < 1 || nextH < 1) {
            return false;
        }

        const clamped = clampCropBox(nextX, nextY, nextW, nextH);
        if (clamped.width === data.width
            && clamped.height === data.height
            && clamped.x === data.x
            && clamped.y === data.y) {
            return false;
        }

        cropper.setData(clamped);
        updateResizeInputsFromCrop();
        cacheNaturalCropData();
        focusCropKeyboardTarget();
        return true;
    }

    function cacheNaturalCropData() {
        if (cropper && cropper.cropped) {
            lastNaturalCropData = cropper.getData(true);
        }
    }

    function snapshotNaturalCropForZoom() {
        if (!cropper || !cropper.cropped) {
            return null;
        }
        return cropMarqueeLogic.cloneNaturalCropSnapshot(cropper.getData(true));
    }

    /** Re-apply natural crop after zoom so the marquee scales with the image. */
    function restoreCropMarqueeAfterZoom(naturalData) {
        if (!cropper || !cropper.cropped || !cropMarqueeLogic.shouldSnapshotCropForZoom(true, naturalData)) {
            return;
        }
        cropper.setData(naturalData);
        updateResizeInputsFromCrop();
        cacheNaturalCropData();
    }

    function clearNaturalCropData() {
        lastNaturalCropData = null;
    }

    function setCropperContainerSize(w, h) {
        if (!cropper || !cropper.cropper) {
            return;
        }
        const el = cropper.cropper;
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        el.style.overflow = 'visible';
        cropper.containerData.width = w;
        cropper.containerData.height = h;
    }

    function normalizeCanvasOrigin() {
        if (!cropper) {
            return;
        }
        const canvas = cropper.getCanvasData();
        if (!canvas) {
            return;
        }
        const offsetX = canvas.left;
        const offsetY = canvas.top;
        if (Math.abs(offsetX) < 0.5 && Math.abs(offsetY) < 0.5) {
            return;
        }
        const w = canvas.width;
        const h = canvas.height;
        const box = cropper.cropped ? cropper.getCropBoxData() : null;
        cropper.setCanvasData({ left: 0, top: 0, width: w, height: h });
        if (box) {
            cropper.setCropBoxData({
                left: box.left - offsetX,
                top: box.top - offsetY,
                width: box.width,
                height: box.height
            });
        }
    }

    /** Keep cropper container, scroll area, and canvas in sync after zoom/rotate. */
    function syncLayoutAfterZoom() {
        if (!cropper || expandingContainer || isPanning) {
            return;
        }

        const canvasData = cropper.getCanvasData();
        if (!canvasData || !canvasData.width) {
            return;
        }

        normalizeCanvasOrigin();

        const syncedCanvas = cropper.getCanvasData();
        const w = Math.ceil(syncedCanvas.width);
        const h = Math.ceil(syncedCanvas.height);
        const imgContainerEl = imageContainer || document.querySelector('.image-container');
        if (!cropper.cropper || !imgContainerEl || !canvasScrollContent || !canvasScrollArea) {
            return;
        }

        expandingContainer = true;
        try {
            setCropperContainerSize(w, h);

            const viewportW = canvasScrollArea.clientWidth;
            const viewportH = canvasScrollArea.clientHeight;
            const layout = canvasLayoutLogic.computeCanvasViewportLayout(
                viewportW,
                viewportH,
                w,
                h
            );

            imgContainerEl.style.width = w + 'px';
            imgContainerEl.style.height = h + 'px';
            imgContainerEl.style.marginLeft = layout.marginLeft + 'px';
            imgContainerEl.style.marginTop = layout.marginTop + 'px';

            canvasScrollContent.style.width = layout.contentWidth + 'px';
            canvasScrollContent.style.height = layout.contentHeight + 'px';
        } finally {
            expandingContainer = false;
        }

        drawRulers();
        renderMagicWandOverlay();
        if (mosaicPreviewState) {
            scheduleMosaicPreviewRender();
        }
        updateZoomToggleButton();
    }

    function applyZoom(delta) {
        if (!cropper) {
            return;
        }
        const currentRatio = zoomLogic.getImageZoomRatioFromData(cropper.getImageData());
        const nextRatio = zoomLogic.computeRatioAfterCropperRelativeZoom(currentRatio, delta);
        if (nextRatio != null) {
            applyZoomTo(nextRatio);
        }
    }

    function applyZoomAction(action) {
        if (!cropper) {
            return;
        }
        const currentRatio = zoomLogic.getImageZoomRatioFromData(cropper.getImageData());
        const nextRatio = zoomLogic.ratioAfterZoomAction(currentRatio, action);
        if (nextRatio != null) {
            applyZoomTo(nextRatio);
        }
    }

    function applyZoomTo(ratio) {
        if (!cropper) {
            return;
        }
        cacheNaturalCropData();
        const cropSnap = snapshotNaturalCropForZoom();
        const cd = cropper.getCanvasData();
        if (cd && cd.naturalWidth) {
            const target = zoomLogic.getCanvasSizeForZoomRatio(cd.naturalWidth, cd.naturalHeight, ratio);
            if (target) {
                setCropperContainerSize(Math.ceil(target.width), Math.ceil(target.height));
            }
        }
        cropper.zoomTo(ratio);
        restoreCropMarqueeAfterZoom(cropSnap);
        syncLayoutAfterZoom();
        restoreCropMarqueeAfterZoom(cropSnap);
        const finalRatio = zoomLogic.resolveFinalZoomRatioAfterCropRestore(
            ratio,
            zoomLogic.getImageZoomRatioFromData(cropper.getImageData())
        );
        cropper.zoomTo(finalRatio);
        updateZoomIndicator();
    }

    function drawRulers() {
        if (!cropper || !rulerH || !rulerV) return;
        const imgData = cropper.getImageData();
        if (!imgData || !imgData.naturalWidth) return;

        // ── use actual DOM positions so coordinate math is always correct ──
        // The Cropper.js canvas element holds the rendered image
        const cropperCanvas = document.querySelector('.cropper-canvas');
        if (!cropperCanvas) return;

        const hRect  = rulerH.getBoundingClientRect();   // horizontal ruler position
        const vRect  = rulerV.getBoundingClientRect();   // vertical ruler position
        const imgRect = cropperCanvas.getBoundingClientRect(); // rendered image position

        // Where the image top-left is, relative to each ruler canvas
        const imgLeft = imgRect.left - hRect.left;
        const imgTop  = imgRect.top  - vRect.top;
        const dispW   = imgRect.width;
        const dispH   = imgRect.height;

        const cw = rulerH.offsetWidth;
        const ch = rulerV.offsetHeight;
        if (cw < 1 || ch < 1) return;

        // ── HiDPI: sync canvas pixel buffer to CSS size ──────────────────
        const dpr = window.devicePixelRatio || 1;
        if (rulerH.width !== Math.round(cw * dpr) || rulerH.height !== Math.round(RULER_SIZE * dpr)) {
            rulerH.width  = Math.round(cw * dpr);
            rulerH.height = Math.round(RULER_SIZE * dpr);
        }
        if (rulerV.width !== Math.round(RULER_V_WIDTH * dpr) || rulerV.height !== Math.round(ch * dpr)) {
            rulerV.width  = Math.round(RULER_V_WIDTH * dpr);
            rulerV.height = Math.round(ch * dpr);
        }

        const hCtx = rulerH.getContext('2d');
        const vCtx = rulerV.getContext('2d');
        hCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        vCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // ── colours ──────────────────────────────────────────────────────
        const BG      = '#1a1a1a';
        const TICK    = '#555';
        const IMGLINE = '#4da6ff';   // image boundary line colour
        const TEXT    = '#888';
        const FONT    = '9px monospace';

        // Clear
        hCtx.fillStyle = BG; hCtx.fillRect(0, 0, cw, RULER_SIZE);
        vCtx.fillStyle = BG; vCtx.fillRect(0, 0, RULER_V_WIDTH, ch);

        // Separator lines
        hCtx.strokeStyle = '#333'; hCtx.lineWidth = 1;
        hCtx.beginPath(); hCtx.moveTo(0, RULER_SIZE - 0.5); hCtx.lineTo(cw, RULER_SIZE - 0.5); hCtx.stroke();
        vCtx.strokeStyle = '#333'; vCtx.lineWidth = 1;
        vCtx.beginPath(); vCtx.moveTo(RULER_V_WIDTH - 0.5, 0); vCtx.lineTo(RULER_V_WIDTH - 0.5, ch); vCtx.stroke();

        // ── scale: natural image pixels per display pixel ─────────────────
        const scaleX = imgData.naturalWidth  / dispW;
        const scaleY = imgData.naturalHeight / dispH;

        // ── nice tick interval (in natural px) ───────────────────────────
        function niceStep(scale) {
            const MIN_SCREEN_GAP = 48; // min px between major ticks
            const rawStep = MIN_SCREEN_GAP * scale;
            const exp  = Math.pow(10, Math.floor(Math.log10(rawStep)));
            const frac = rawStep / exp;
            const nice = frac < 1.5 ? 1 : frac < 3.5 ? 2 : frac < 7.5 ? 5 : 10;
            return nice * exp;
        }
        const stepX = niceStep(scaleX);
        const stepY = niceStep(scaleY);

        // ── horizontal ticks ─────────────────────────────────────────────
        hCtx.font = FONT; hCtx.textBaseline = 'top';
        const startNatX = Math.ceil(-imgLeft * scaleX / stepX) * stepX;
        for (let n = startNatX; n <= imgData.naturalWidth; n += stepX) {
            const x = imgLeft + n / scaleX;
            if (x < 0 || x > cw) continue;
            const isMajor = (Math.round(n / stepX) % 5 === 0);
            const tickH   = isMajor ? 9 : 5;
            hCtx.strokeStyle = TICK; hCtx.lineWidth = 1;
            hCtx.beginPath(); hCtx.moveTo(x, RULER_SIZE - tickH); hCtx.lineTo(x, RULER_SIZE); hCtx.stroke();
            if (isMajor) {
                hCtx.fillStyle  = TEXT;
                hCtx.textAlign  = 'left';
                hCtx.fillText(String(Math.round(n)), x + 2, 2);
            }
        }

        // ── vertical ticks ───────────────────────────────────────────────
        vCtx.font = FONT; vCtx.textBaseline = 'middle';
        const startNatY = Math.ceil(-imgTop * scaleY / stepY) * stepY;
        for (let n = startNatY; n <= imgData.naturalHeight; n += stepY) {
            const y = imgTop + n / scaleY;
            if (y < 0 || y > ch) continue;
            const isMajor = (Math.round(n / stepY) % 5 === 0);
            const tickW   = isMajor ? 9 : 5;
            const tickRight = RULER_V_WIDTH;
            const tickLeft = tickRight - tickW;
            vCtx.strokeStyle = TICK; vCtx.lineWidth = 1;
            vCtx.beginPath(); vCtx.moveTo(tickLeft, y); vCtx.lineTo(tickRight, y); vCtx.stroke();
            if (isMajor) {
                vCtx.save();
                vCtx.fillStyle = TEXT;
                vCtx.translate(tickLeft - 2, y);
                vCtx.rotate(-Math.PI / 2);
                vCtx.textAlign = 'center';
                vCtx.fillText(String(Math.round(n)), 0, 0);
                vCtx.restore();
            }
        }

        // ── image boundary accent lines ───────────────────────────────────
        const imgRight  = imgLeft + dispW;
        const imgBottom = imgTop  + dispH;

        hCtx.strokeStyle = IMGLINE; hCtx.lineWidth = 1.5;
        [imgLeft, imgRight].forEach(x => {
            if (x >= 0 && x <= cw) {
                hCtx.beginPath(); hCtx.moveTo(x, 0); hCtx.lineTo(x, RULER_SIZE); hCtx.stroke();
            }
        });
        vCtx.strokeStyle = IMGLINE; vCtx.lineWidth = 1.5;
        [imgTop, imgBottom].forEach(y => {
            if (y >= 0 && y <= ch) {
                vCtx.beginPath(); vCtx.moveTo(0, y); vCtx.lineTo(RULER_V_WIDTH, y); vCtx.stroke();
            }
        });
    }

    // Show shortcut hints while Cmd / Ctrl is held down
    document.addEventListener('keydown', (e) => {
        updateShortcutHintsFromEvent(e);
    });
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Meta' || e.key === 'Control') {
            shortcutOverlayDismissed = false;
        }
        updateShortcutHintsFromEvent(e);
    });
    window.addEventListener('blur', () => {
        setShortcutHintsVisible(false);
        hideToolRailTooltip();
    });

    // Redraw rulers while panning/scrolling (RAF-throttled) — set up once
    let rulerRafId = null;
    function scheduleRulerRedraw() {
        if (rulerRafId !== null) {
            return;
        }
        rulerRafId = requestAnimationFrame(() => {
            drawRulers();
            rulerRafId = null;
        });
    }

    if (canvasScrollArea) {
        canvasScrollArea.addEventListener('scroll', scheduleRulerRedraw);

        canvasScrollArea.addEventListener('mousedown', () => {
            dismissShortcutLayers();
            focusCropKeyboardTarget();
        });

        canvasScrollArea.addEventListener('wheel', (e) => {
            if (!cropper) {
                return;
            }

            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                applyZoom(e.deltaY < 0 ? 0.1 : -0.1);
                return;
            }

            const canScrollX = canvasScrollArea.scrollWidth > canvasScrollArea.clientWidth + 1;
            const canScrollY = canvasScrollArea.scrollHeight > canvasScrollArea.clientHeight + 1;
            if (!canScrollX && !canScrollY) {
                return;
            }

            e.preventDefault();
            canvasScrollArea.scrollLeft += e.deltaX;
            canvasScrollArea.scrollTop += e.deltaY;
            scheduleRulerRedraw();
        }, { passive: false, capture: true });
    }

    if (imageContainer) {
        imageContainer.addEventListener('click', dismissShortcutLayers, true);
        imageContainer.addEventListener('mousedown', dismissShortcutLayers, true);
    }

    // Space + drag pan (hand tool)
    function isTypingTarget(el) {
        return el && (
            el.tagName === 'INPUT' ||
            el.tagName === 'SELECT' ||
            el.tagName === 'TEXTAREA' ||
            el.isContentEditable
        );
    }

    function isPanTargetVisible() {
        return workspace && workspace.style.display !== 'none';
    }

    function setPanMode(active) {
        if (canvasScrollArea) {
            canvasScrollArea.classList.toggle('pan-mode', active);
        }
        if (!active && canvasScrollArea) {
            canvasScrollArea.classList.remove('pan-grabbing');
        }
        updateCropInteraction();
    }

    function endPanning() {
        const wasPanning = isPanning;
        isPanning = false;
        if (canvasScrollArea) {
            canvasScrollArea.classList.remove('pan-grabbing');
        }
        if (wasPanning) {
            scheduleSyncLayout();
        }
    }

    document.addEventListener('keydown', (e) => {
        const isPanHoldKey = shortcutLogic.isPanHoldCode(e.code);
        if (!isPanHoldKey || e.repeat || isTypingTarget(document.activeElement)) {
            return;
        }
        if (marqueeGestureState) {
            if (e.code === 'Space') {
                isSpacePressed = true;
            }
            if (e.code === 'KeyH') {
                isHandPressed = true;
            }
            e.preventDefault();
            return;
        }
        if (!isPanTargetVisible()) {
            return;
        }
        e.preventDefault();
        if (isPanHoldKey && e.code === 'Space') {
            isSpacePressed = true;
        }
        if (isPanHoldKey && e.code === 'KeyH') {
            isHandPressed = true;
        }
        setPanMode(true);
        updateCropInteraction();
    });

    document.addEventListener('keyup', (e) => {
        if (!shortcutLogic.isPanHoldCode(e.code)) {
            return;
        }
        if (marqueeGestureState) {
            if (e.code === 'Space') {
                isSpacePressed = false;
            }
            if (e.code === 'KeyH') {
                isHandPressed = false;
            }
            return;
        }
        if (e.code === 'Space') {
            isSpacePressed = false;
        }
        if (e.code === 'KeyH') {
            isHandPressed = false;
        }
        if (!isPanShortcutPressed()) {
            endPanning();
        }
        setPanMode(isPanShortcutPressed());
        updateCropInteraction();
        scheduleSyncLayout();
    });

    window.addEventListener('blur', () => {
        isSpacePressed = false;
        isHandPressed = false;
        endPanning();
        setPanMode(false);
        setZLoupeActive(false);
        scheduleSyncLayout();
    });

    function canUseZLoupe() {
        return !!(cropper && isPanTargetVisible()
            && !isEyedropperActive
            && !isColorPickerMode
            && !isMagicWandMode
            && !isPanShortcutPressed());
    }

    function setZLoupeActive(active) {
        isZLoupeActive = active;
        if (!active) {
            endZLoupeDrag();
            hideZoomLoupe();
        }
        if (canvasScrollArea) {
            canvasScrollArea.classList.toggle('zoom-loupe-active', active && canUseZLoupe());
        }
        updateCropInteraction();
    }

    function endZLoupeDrag() {
        isZLoupeDragging = false;
        zLoupeDragStart = null;
        hideZoomLoupeSelectionOverlay();
    }

    function hideZoomLoupe() {
        stopZoomLoupePanelDrag();
        if (zoomLoupePanel) {
            zoomLoupePanel.style.display = 'none';
        }
    }

    function hideZoomLoupeSelectionOverlay() {
        if (zoomLoupeSelection) {
            zoomLoupeSelection.style.display = 'none';
        }
    }

    function getToolbarLayer() {
        return toolbar && toolbar.parentElement ? toolbar.parentElement : null;
    }

    function getToolbarBounds() {
        const layer = getToolbarLayer();
        if (!layer) {
            return null;
        }
        return {
            width: layer.clientWidth,
            height: layer.clientHeight
        };
    }

    function getToolbarSize() {
        if (!toolbar) {
            return null;
        }
        return {
            width: toolbar.offsetWidth,
            height: toolbar.offsetHeight
        };
    }

    function getToolbarCurrentPosition() {
        if (!toolbar) {
            return null;
        }
        const left = parseFloat(toolbar.style.left);
        const top = parseFloat(toolbar.style.top);
        if (Number.isFinite(left) && Number.isFinite(top)) {
            return { left, top };
        }
        const layer = getToolbarLayer();
        const size = getToolbarSize();
        if (!layer || !size) {
            return null;
        }
        return {
            left: Math.max(8, (layer.clientWidth - size.width) / 2),
            top: Math.max(8, layer.clientHeight - size.height - 20)
        };
    }

    function clampToolbarPosition(left, top) {
        const bounds = getToolbarBounds();
        const size = getToolbarSize();
        if (!bounds || !size || !Number.isFinite(left) || !Number.isFinite(top)) {
            return null;
        }

        const margin = 8;
        const maxLeft = Math.max(margin, bounds.width - size.width - margin);
        const maxTop = Math.max(margin, bounds.height - size.height - margin);

        return {
            left: Math.min(Math.max(margin, left), maxLeft),
            top: Math.min(Math.max(margin, top), maxTop)
        };
    }

    function placeToolbar(left, top) {
        if (!toolbar) {
            return;
        }
        const clamped = clampToolbarPosition(left, top);
        if (!clamped) {
            return;
        }
        toolbar.style.position = 'absolute';
        toolbar.style.left = `${clamped.left}px`;
        toolbar.style.top = `${clamped.top}px`;
        toolbar.style.right = 'auto';
        toolbar.style.bottom = 'auto';
        toolbar.style.transform = 'none';
    }

    function stopToolbarDrag() {
        isToolbarDragging = false;
        toolbarDragState = null;
    }

    function startToolbarDrag(e) {
        if (!toolbar || !toolbarDragHandle || e.button !== 0) {
            return;
        }
        const layer = getToolbarLayer();
        if (!layer) {
            return;
        }

        const toolbarRect = toolbar.getBoundingClientRect();
        e.preventDefault();
        e.stopPropagation();
        if (e.currentTarget && e.currentTarget.setPointerCapture) {
            e.currentTarget.setPointerCapture(e.pointerId);
        }

        placeToolbar(toolbarRect.left - layer.getBoundingClientRect().left, toolbarRect.top - layer.getBoundingClientRect().top);
        toolbarDragState = {
            pointerId: e.pointerId,
            offsetX: e.clientX - toolbarRect.left,
            offsetY: e.clientY - toolbarRect.top
        };
        isToolbarDragging = true;
    }

    function moveToolbarDrag(e) {
        if (!isToolbarDragging || !toolbarDragState || e.pointerId !== toolbarDragState.pointerId) {
            return;
        }
        const layer = getToolbarLayer();
        if (!layer) {
            return;
        }

        e.preventDefault();

        const layerRect = layer.getBoundingClientRect();
        placeToolbar(
            e.clientX - layerRect.left - toolbarDragState.offsetX,
            e.clientY - layerRect.top - toolbarDragState.offsetY
        );
    }

    function getZoomLoupePanelBounds() {
        if (!zoomLoupePanel || !workspace) {
            return null;
        }
        return {
            width: workspace.clientWidth,
            height: workspace.clientHeight
        };
    }

    function getZoomLoupePanelSize() {
        if (!zoomLoupePanel) {
            return null;
        }
        return {
            width: zoomLoupePanel.offsetWidth,
            height: zoomLoupePanel.offsetHeight
        };
    }

    function getZoomLoupePanelCurrentPosition() {
        if (!zoomLoupePanel) {
            return null;
        }
        const left = parseFloat(zoomLoupePanel.style.left);
        const top = parseFloat(zoomLoupePanel.style.top);
        if (Number.isFinite(left) && Number.isFinite(top)) {
            return { left, top };
        }
        const bounds = getZoomLoupePanelBounds();
        const size = getZoomLoupePanelSize();
        if (!bounds || !size) {
            return null;
        }
        return {
            left: Math.max(12, bounds.width - size.width - 12),
            top: Math.max(12, bounds.height - size.height - 12)
        };
    }

    function clampZoomLoupePanelPosition(left, top) {
        const bounds = getZoomLoupePanelBounds();
        const size = getZoomLoupePanelSize();
        if (!bounds || !size || !Number.isFinite(left) || !Number.isFinite(top)) {
            return null;
        }

        const margin = 12;
        const maxLeft = Math.max(margin, bounds.width - size.width - margin);
        const maxTop = Math.max(margin, bounds.height - size.height - margin);

        return {
            left: Math.min(Math.max(margin, left), maxLeft),
            top: Math.min(Math.max(margin, top), maxTop)
        };
    }

    function placeZoomLoupePanel(left, top) {
        if (!zoomLoupePanel) {
            return;
        }
        const clamped = clampZoomLoupePanelPosition(left, top);
        if (!clamped) {
            return;
        }
        zoomLoupePanel.style.left = `${clamped.left}px`;
        zoomLoupePanel.style.top = `${clamped.top}px`;
        zoomLoupePanel.style.right = 'auto';
        zoomLoupePanel.style.bottom = 'auto';
    }

    function stopZoomLoupePanelDrag() {
        isZoomLoupePanelDragging = false;
        zoomLoupePanelDragState = null;
    }

    function startZoomLoupePanelDrag(e) {
        if (!zoomLoupePanel || !workspace || e.button !== 0) {
            return;
        }

        const panelRect = zoomLoupePanel.getBoundingClientRect();
        const workspaceRect = workspace.getBoundingClientRect();
        const currentLeft = Number.isFinite(parseFloat(zoomLoupePanel.style.left))
            ? parseFloat(zoomLoupePanel.style.left)
            : panelRect.left - workspaceRect.left;
        const currentTop = Number.isFinite(parseFloat(zoomLoupePanel.style.top))
            ? parseFloat(zoomLoupePanel.style.top)
            : panelRect.top - workspaceRect.top;

        e.preventDefault();
        e.stopPropagation();
        if (e.currentTarget && e.currentTarget.setPointerCapture) {
            e.currentTarget.setPointerCapture(e.pointerId);
        }

        placeZoomLoupePanel(currentLeft, currentTop);
        zoomLoupePanelDragState = {
            pointerId: e.pointerId,
            offsetX: e.clientX - panelRect.left,
            offsetY: e.clientY - panelRect.top
        };
        isZoomLoupePanelDragging = true;
    }

    function moveZoomLoupePanelDrag(e) {
        if (!isZoomLoupePanelDragging || !zoomLoupePanelDragState || e.pointerId !== zoomLoupePanelDragState.pointerId || !workspace) {
            return;
        }

        e.preventDefault();

        const workspaceRect = workspace.getBoundingClientRect();
        placeZoomLoupePanel(
            e.clientX - workspaceRect.left - zoomLoupePanelDragState.offsetX,
            e.clientY - workspaceRect.top - zoomLoupePanelDragState.offsetY
        );
    }

    function clampNaturalRect(x, y, width, height) {
        return loupeLogic.clampNaturalRect(x, y, width, height, originalWidth, originalHeight);
    }

    function getNaturalRectFromPoints(start, end) {
        return loupeLogic.getNaturalRectFromPoints(
            start,
            end,
            Z_LOUPE_MIN_DRAG,
            originalWidth,
            originalHeight
        );
    }

    function naturalRectToClientBounds(rect) {
        if (!cropper) {
            return null;
        }
        const imageData = cropper.getImageData();
        const containerRect = cropper.container.getBoundingClientRect();
        return loupeLogic.naturalRectToClientBounds(rect, imageData, containerRect);
    }

    function drawZoomLoupeRegion(rect) {
        if (!zoomLoupePanel || !zoomLoupeCanvas || !zoomLoupeCtx || !ensureColorPickerCanvas()) {
            return;
        }
        zoomLoupePanel.style.display = 'flex';
        const currentPosition = getZoomLoupePanelCurrentPosition();
        if (currentPosition && Number.isFinite(parseFloat(zoomLoupePanel.style.left)) && Number.isFinite(parseFloat(zoomLoupePanel.style.top))) {
            placeZoomLoupePanel(currentPosition.left, currentPosition.top);
        }
        zoomLoupeCtx.imageSmoothingEnabled = true;
        zoomLoupeCtx.imageSmoothingQuality = 'high';
        zoomLoupeCtx.clearRect(0, 0, Z_LOUPE_PANEL_PX, Z_LOUPE_PANEL_PX);
        zoomLoupeCtx.drawImage(
            colorPickerCanvas,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            0,
            0,
            Z_LOUPE_PANEL_PX,
            Z_LOUPE_PANEL_PX
        );
    }

    function updateZoomLoupeSpot(point) {
        const half = Z_LOUPE_SPOT_RADIUS;
        const rect = clampNaturalRect(
            point.x - half,
            point.y - half,
            half * 2 + 1,
            half * 2 + 1
        );
        drawZoomLoupeRegion(rect);
        hideZoomLoupeSelectionOverlay();
    }

    function updateZoomLoupeDrag(start, end) {
        const rect = getNaturalRectFromPoints(start, end);
        drawZoomLoupeRegion(rect);
        const bounds = naturalRectToClientBounds(rect);
        if (!bounds || !zoomLoupeSelection) {
            return;
        }
        zoomLoupeSelection.style.display = 'block';
        zoomLoupeSelection.style.left = `${bounds.left}px`;
        zoomLoupeSelection.style.top = `${bounds.top}px`;
        zoomLoupeSelection.style.width = `${bounds.width}px`;
        zoomLoupeSelection.style.height = `${bounds.height}px`;
    }

    function onZLoupeMouseMove(e) {
        if (!isZLoupeActive || !canUseZLoupe()) {
            return;
        }
        if (isZLoupeDragging && zLoupeDragStart) {
            const point = getImagePointFromEvent(e);
            if (point) {
                updateZoomLoupeDrag(zLoupeDragStart, point);
            }
            return;
        }
        const point = getImagePointFromEvent(e);
        if (!point) {
            hideZoomLoupe();
            return;
        }
        updateZoomLoupeSpot(point);
    }

    function onZLoupeMouseDown(e) {
        if (!isZLoupeActive || !canUseZLoupe() || e.button !== 0) {
            return;
        }
        if (!canvasScrollArea || !canvasScrollArea.contains(e.target)) {
            return;
        }
        if (e.target.closest('.floating-toolbar')) {
            return;
        }
        const point = getImagePointFromEvent(e);
        if (!point) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        isZLoupeDragging = true;
        zLoupeDragStart = point;
        updateZoomLoupeDrag(point, point);
    }

    document.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyZ' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) {
            return;
        }
        if (isTypingTarget(document.activeElement)) {
            return;
        }
        if (!canUseZLoupe()) {
            return;
        }
        e.preventDefault();
        setZLoupeActive(true);
    });

    document.addEventListener('keyup', (e) => {
        if (e.code !== 'KeyZ') {
            return;
        }
        setZLoupeActive(false);
    });

    document.addEventListener('mousedown', onZLoupeMouseDown, true);
    document.addEventListener('mousemove', onZLoupeMouseMove);
    document.addEventListener('mouseup', () => {
        if (isZLoupeDragging) {
            endZLoupeDrag();
        }
    });

    function onPanMouseDown(e) {
        if (!isPanShortcutPressed() || !canvasScrollArea || e.button !== 0 || isEyedropperActive || isColorPickerMode || isZLoupeActive) {
            return;
        }
        if (!isPanTargetVisible()) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        syncLayoutAfterZoom();
        isPanning = true;
        lastPanClientX = e.clientX;
        lastPanClientY = e.clientY;
        canvasScrollArea.classList.add('pan-grabbing');
    }

    function onPanMouseMove(e) {
        if (!isPanning || !canvasScrollArea) {
            return;
        }
        e.preventDefault();

        const dx = e.clientX - lastPanClientX;
        const dy = e.clientY - lastPanClientY;
        lastPanClientX = e.clientX;
        lastPanClientY = e.clientY;

        canvasScrollArea.scrollLeft -= dx;
        canvasScrollArea.scrollTop -= dy;
        scheduleRulerRedraw();
    }

    document.addEventListener('mousedown', (e) => {
        if (!isPanShortcutPressed() || !canvasScrollArea || e.button !== 0 || isEyedropperActive || isColorPickerMode || isZLoupeActive) {
            return;
        }
        if (!isPanTargetVisible()) {
            return;
        }
        if (e.target.closest('.floating-toolbar')) {
            return;
        }
        if (!canvasScrollArea.contains(e.target)) {
            return;
        }
        onPanMouseDown(e);
    }, true);

    document.addEventListener('mousemove', onPanMouseMove);
    document.addEventListener('mouseup', endPanning);

    if (workspace) {
        const rulerResizeObserver = new ResizeObserver(() => {
            scheduleSyncLayout();
        });
        rulerResizeObserver.observe(workspace);
        if (canvasScrollArea) {
            rulerResizeObserver.observe(canvasScrollArea);
        }
    }

    function showEditorChrome() {
        if (toolRail) {
            toolRail.style.display = 'flex';
        }
        if (sidebar) {
            sidebar.style.display = 'flex';
        }
        if (toolbar) {
            toolbar.style.display = 'flex';
        }
        applySidebarAutoCollapseState();
    }

    function hideEditorChrome() {
        cancelSidebarAutoCollapseTimer();
        stopToolbarDrag();
        if (toolRail) {
            toolRail.style.display = 'none';
        }
        if (sidebar) {
            sidebar.style.display = 'none';
            sidebar.classList.remove('sidebar-controls-collapsed');
        }
        if (toolbar) {
            toolbar.style.display = 'none';
        }
    }

    function applySidebarAutoCollapseState() {
        if (!sidebar) {
            return;
        }
        sidebar.classList.toggle('sidebar-controls-collapsed', !!(sidebarAutoCollapseState.enabled && sidebarAutoCollapseState.collapsed));
        if (btnSidebarAutoCollapse) {
            btnSidebarAutoCollapse.setAttribute('aria-pressed', sidebarAutoCollapseState.enabled ? 'true' : 'false');
            const icon = btnSidebarAutoCollapse.querySelector('.sidebar-auto-collapse-toggle-icon');
            if (icon) {
                icon.textContent = sidebarAutoCollapseState.enabled ? '‹' : '›';
            }
        }
    }

    function setSidebarAutoCollapseState(nextState) {
        sidebarAutoCollapseState = nextState;
        applySidebarAutoCollapseState();
    }

    function cancelSidebarAutoCollapseTimer() {
        if (sidebarAutoCollapseTimer) {
            clearTimeout(sidebarAutoCollapseTimer);
            sidebarAutoCollapseTimer = null;
        }
    }

    function handleSidebarAutoCollapseMouseEnter() {
        if (!sidebarAutoCollapseState.enabled) {
            return;
        }
        cancelSidebarAutoCollapseTimer();
        setSidebarAutoCollapseState(
            sidebarAutoCollapseLogic.handleSidebarAutoCollapseMouseEnter
                ? sidebarAutoCollapseLogic.handleSidebarAutoCollapseMouseEnter(sidebarAutoCollapseState)
                : { enabled: true, collapsed: false }
        );
    }

    function handleSidebarAutoCollapseMouseLeave() {
        if (!sidebarAutoCollapseState.enabled) {
            return;
        }
        cancelSidebarAutoCollapseTimer();
        const delayMs = sidebarAutoCollapseLogic.getSidebarAutoCollapseDelayMs
            ? sidebarAutoCollapseLogic.getSidebarAutoCollapseDelayMs()
            : sidebarAutoCollapseLogic.SIDEBAR_AUTO_COLLAPSE_DELAY_MS || 240;
        sidebarAutoCollapseTimer = setTimeout(() => {
            sidebarAutoCollapseTimer = null;
            setSidebarAutoCollapseState(
                sidebarAutoCollapseLogic.handleSidebarAutoCollapseMouseLeave
                    ? sidebarAutoCollapseLogic.handleSidebarAutoCollapseMouseLeave(sidebarAutoCollapseState)
                    : { enabled: true, collapsed: true }
            );
        }, delayMs);
    }

    function bindSidebarAutoCollapse() {
        if (btnSidebarAutoCollapse) {
            btnSidebarAutoCollapse.setAttribute('aria-pressed', sidebarAutoCollapseState.enabled ? 'true' : 'false');
            btnSidebarAutoCollapse.addEventListener('click', () => {
                cancelSidebarAutoCollapseTimer();
                setSidebarAutoCollapseState(
                    sidebarAutoCollapseLogic.setSidebarAutoCollapseEnabled
                        ? sidebarAutoCollapseLogic.setSidebarAutoCollapseEnabled(sidebarAutoCollapseState, !sidebarAutoCollapseState.enabled)
                        : { enabled: !sidebarAutoCollapseState.enabled, collapsed: false }
                );
            });
        }

        if (sidebar) {
            sidebar.addEventListener('mouseenter', handleSidebarAutoCollapseMouseEnter);
            sidebar.addEventListener('mouseleave', handleSidebarAutoCollapseMouseLeave);
        }
    }

    function startEditorMode() {
        setActiveTool(toolRailLogic.DEFAULT_ACTIVE_TOOL || 'cursor');
        chkEnableCrop.checked = false;
        syncCropPresetUI();
        if (!imageEl || !imageEl.getAttribute('src') || imageEl.getAttribute('src') === '') {
            hideEditorChrome();
            dashboard.style.display = 'flex';
            workspace.style.display = 'none';
            setLoadingState(false);
            notifyHostEditorReady();
        } else {
            dashboard.style.display = 'none';
            workspace.style.display = 'grid';
            showEditorChrome();
            setLoadingState(true);
            initEditor(imageEl.src);
        }
    }

    async function bootstrap() {
        setLoadingState(true);
        try {
            l10n = await loadWebviewL10n();
        } catch (err) {
            console.error('[vsimage] Failed to load translations:', err);
            l10n = {};
        }

        isDocumentEditor = document.body.dataset.documentEditor === 'true';
        applyI18n();
        applyShortcutHints();
        bindShortcutHintInteractions();
        bindToolRailTooltipInteractions();
        bindSidebarAutoCollapse();
        setFileSizeLabel(currentFileSizeBytes);
        startEditorMode();
        isBootstrapComplete = true;
        flushPendingStartupFile();
    }

    bootstrap();

    // File import triggers
    cardImport.addEventListener('click', () => filePicker.click());
    filePicker.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            if (!isBootstrapComplete) {
                queueStartupFile(file);
                return;
            }
            loadFile(file);
        }
    });

    // Clipboard Paste trigger click
    cardPaste.addEventListener('click', () => {
        vscode.postMessage({ command: 'show-toast', text: t('toast.pasteHint') });
    });

    // Global Clipboard paste listener
    document.addEventListener('paste', (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let item of items) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (!isBootstrapComplete) {
                    queueStartupFile(file);
                    return;
                }
                loadFile(file);
                return;
            }
        }
    });

    // Global Drag & Drop listeners
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/')) {
                if (!isBootstrapComplete) {
                    queueStartupFile(file);
                    return;
                }
                loadFile(file);
            }
        }
    });

    function loadFile(file) {
        setLoadingState(true);
        const reader = new FileReader();
        reader.onerror = () => {
            setLoadingState(false);
        };
        reader.onload = (event) => {
            currentFileSizeBytes = parseFileSizeBytes(file.size);
            setFileSizeLabel(currentFileSizeBytes);
            dashboard.style.display = 'none';
            workspace.style.display = 'grid';
            showEditorChrome();
            setActiveTool(toolRailLogic.DEFAULT_ACTIVE_TOOL || 'cursor');
            initEditor(event.target.result);
            if (isDocumentEditor) {
                notifyDocumentChanged('edit.edit');
            }
        };
        reader.readAsDataURL(file);
    }

    function notifyHostEditorReady() {
        vscode.postMessage({ command: 'editor-ready' });
    }

    function getViewportAvailSize() {
        if (!canvasScrollArea) {
            return { availW: 1, availH: 1 };
        }
        return {
            availW: Math.max(1, canvasScrollArea.clientWidth - (CANVAS_PADDING * 2)),
            availH: Math.max(1, canvasScrollArea.clientHeight - (CANVAS_PADDING * 2))
        };
    }

    function getViewportFillRatio() {
        const { availW, availH } = getViewportAvailSize();
        if (resizePanelLogic.getViewportFillRatio) {
            return resizePanelLogic.getViewportFillRatio(availW, availH, originalWidth, originalHeight);
        }
        return Math.min(availW / originalWidth, availH / originalHeight);
    }

    function getViewportFitRatio() {
        return Math.min(getViewportFillRatio(), 1);
    }

    function applyZoomAfterResize(preferredRatio, resizePanelScalePercent) {
        if (!cropper) {
            return;
        }
        const fillRatio = getViewportFillRatio();
        const ratio = resizePanelLogic.resolveZoomRatioAfterResize
            ? resizePanelLogic.resolveZoomRatioAfterResize(
                fillRatio,
                resizePanelScalePercent,
                preferredRatio
            )
            : Math.min(preferredRatio != null ? preferredRatio : fillRatio, getViewportFitRatio());
        applyZoomTo(ratio);
        initialFitRatio = getViewportFitRatio();
        updateZoomIndicator();
    }

    function initEditor(src, options) {
        const preserveInitialSrc = options && options.preserveInitialSrc;
        const afterResize = options && options.afterResize;
        const preserveZoomRatio = options && options.preserveZoomRatio;
        const resizePanelScalePercent = options && options.resizePanelScalePercent;
        const preserveSharpenAdjust = options && options.preserveSharpenAdjust;
        const restoreCropData = options && options.restoreCropData;
        const keepCropEnabled = options && options.keepCropEnabled;
        const startEyedropper = options && options.startEyedropper;
        hideMosaicModal();
        if (!preserveSharpenAdjust) {
            resetSharpenAdjust();
        }
        invalidateColorPickerCanvas();
        invalidateMagicWandCanvas();
        clearMagicWandMask();
        endMagicWandMode(false);
        if (!initialImageSrc || preserveInitialSrc) {
            initialImageSrc = src;
        }
        setLoadingState(true);
        imageEl.src = src;
        
        imageEl.onload = () => {
            originalWidth = imageEl.naturalWidth;
            originalHeight = imageEl.naturalHeight;
            aspectRatio = originalWidth / originalHeight;
            scaleX = 1;
            scaleY = 1;

            lblDimensions.textContent = `${originalWidth} × ${originalHeight}`;
            syncResizeInputsToOriginal();

            showEditorChrome();
            renderHistoryPanel();

            // Destroy previous instance
            if (cropper) {
                cropper.destroy();
            }
            clearNaturalCropData();

            // Uncheck crop checkbox and disable aspect presets visually by default on loading a new image
            chkEnableCrop.checked = false;
            syncCropPresetUI();

            // Create Cropper
            cropper = new Cropper(imageEl, {
                aspectRatio: NaN,
                viewMode: 1,
                background: false,
                responsive: false,
                autoCrop: false,
                zoomOnWheel: false,
                zoomable: true,
                cropBoxMovable: true,
                cropBoxResizable: true,
                toggleDragModeOnDblclick: false,
                ready() {
                    let clampedRestoreCropData = null;
                    if (keepCropEnabled && restoreCropData) {
                        chkEnableCrop.checked = true;
                        syncCropPresetUI();
                        cropper.crop();
                        clampedRestoreCropData = clampCropBox(
                            restoreCropData.x,
                            restoreCropData.y,
                            restoreCropData.width,
                            restoreCropData.height
                        );
                        cropper.setData(clampedRestoreCropData);
                        updateResizeInputsFromCrop();
                        updateSelectionPanelFromCrop();
                        cacheNaturalCropData();
                    }
                    if (canvasScrollArea) {
                        canvasScrollArea.scrollLeft = 0;
                        canvasScrollArea.scrollTop = 0;
                        if (afterResize) {
                            applyZoomAfterResize(preserveZoomRatio, resizePanelScalePercent);
                        } else {
                            const fitRatio = getViewportFitRatio();
                            if (fitRatio < 1) {
                                applyZoomTo(fitRatio);
                            }
                        }
                    }
                    updateZoomIndicator();
                    scheduleSyncLayout();
                    requestAnimationFrame(() => {
                        scheduleSyncLayout();
                        if (!afterResize) {
                            captureInitialFitRatio();
                        }
                        updateZoomToggleButton();
                    });
                    updateCropInteraction();
                    if (resizePanelLogic.shouldSyncResizePanelFromImage(chkEnableCrop.checked, cropper.cropped)) {
                        syncResizeInputsToOriginal();
                    } else {
                        updateResizeInputsFromCrop();
                    }
                    if (startEyedropper && clampedRestoreCropData) {
                        beginEyedropperForSelection(clampedRestoreCropData);
                    }
                    setLoadingState(false);
                    notifyHostEditorReady();
                    focusCropKeyboardTarget();
                },
                cropmove() {
                    const data = cropper.getData(true);
                    const clamped = clampCropBox(data.x, data.y, data.width, data.height);
                    if (clamped.x !== data.x
                        || clamped.y !== data.y
                        || clamped.width !== data.width
                        || clamped.height !== data.height) {
                        cropper.setData(clamped);
                        return;
                    }
                    updateResizeInputsFromCrop();
                    updateSelectionPanelFromCrop();
                    cacheNaturalCropData();
                    if (mosaicPreviewState) {
                        mosaicPreviewState.cropData = cropper.getData(true);
                        scheduleMosaicPreviewRender();
                    }
                },
                crop() {
                    if (!isApplyingMagicWandSelection) {
                        clearMagicWandMask();
                    }
                    updateResizeInputsFromCrop();
                    updateSelectionPanelFromCrop();
                    cacheNaturalCropData();
                    if (mosaicPreviewState) {
                        mosaicPreviewState.cropData = cropper.getData(true);
                        scheduleMosaicPreviewRender();
                    }
                },
                zoom() {
                    updateZoomIndicator();
                    requestAnimationFrame(() => {
                        renderMagicWandOverlay();
                        if (mosaicPreviewState) {
                            scheduleMosaicPreviewRender();
                        }
                    });
                }
            });

            imageEl.addEventListener('cropstart', (e) => {
                handleMarqueeCropStart(e.detail);
            });
            imageEl.addEventListener('cropmove', (e) => {
                handleMarqueeCropMove(e);
            });
            imageEl.addEventListener('cropend', () => {
                handleMarqueeCropEnd();
            });
        };
        imageEl.onerror = () => {
            setLoadingState(false);
        };
    }

    function applyResizePanelState(panel) {
        const baseWidth = Math.max(0, Math.round(Number(panel.baseWidth) || 0));
        const baseHeight = Math.max(0, Math.round(Number(panel.baseHeight) || 0));
        const width = Math.max(0, Math.round(Number(panel.width) || 0));
        const height = Math.max(0, Math.round(Number(panel.height) || 0));
        const rawScalePercent = Number(panel.scalePercent);
        const scalePercent = resizePanelLogic.clampResizeScalePercent
            ? resizePanelLogic.clampResizeScalePercent(Number.isFinite(rawScalePercent) ? rawScalePercent : 100)
            : Math.round(Number.isFinite(rawScalePercent) ? rawScalePercent : 100);
        resizeBaseWidth = baseWidth;
        resizeBaseHeight = baseHeight;
        if (txtWidth) {
            txtWidth.value = width;
            txtWidth.placeholder = panel.widthPlaceholder != null
                ? panel.widthPlaceholder
                : (width > 0 ? String(width) : '');
        }
        if (txtHeight) {
            txtHeight.value = height;
            txtHeight.placeholder = height > 0 ? String(height) : '';
        }
        if (rngResizeScale) {
            rngResizeScale.value = scalePercent;
        }
        setPercentSpan('resizeScaleVal', scalePercent);
        updateResizeApplyButtonState(scalePercent);
    }

    function syncResizeInputsToOriginal() {
        applyResizePanelState(
            resizePanelLogic.buildResizePanelFromImage(originalWidth, originalHeight)
        );
    }

    function applyResizeScale(percent) {
        const dims = resizePanelLogic.dimensionsFromResizeScalePercent(
            percent,
            resizeBaseWidth,
            resizeBaseHeight
        );
        txtWidth.value = dims.width;
        txtHeight.value = dims.height;
        applyResizePreviewZoom(percent);
        updateResizeApplyButtonState(percent);
    }

    function updateResizeApplyButtonState(scalePercent) {
        if (!btnApplyResize) {
            return;
        }
        const shouldDisable = resizePanelLogic.shouldDisableResizeApplyButton
            ? resizePanelLogic.shouldDisableResizeApplyButton(scalePercent)
            : Math.round(Number(scalePercent) || 100) === 100;
        btnApplyResize.disabled = shouldDisable;
    }

    function applyResizePreviewZoom(scalePercent) {
        if (!cropper) {
            return;
        }
        const previewRatio = resizePanelLogic.resolveResizePreviewZoomRatio
            ? resizePanelLogic.resolveResizePreviewZoomRatio(scalePercent)
            : Math.max(0, Math.round(Number(scalePercent) || 100)) / 100;
        const fitRatio = getViewportFitRatio();
        applyZoomTo(Math.min(previewRatio, fitRatio));
    }

    function resetSharpenAdjust() {
        sharpenBaseSrc = null;
        if (sharpenSection) {
            sharpenSection.style.display = 'none';
        }
        if (rngSharpen) {
            rngSharpen.disabled = true;
            rngSharpen.value = '0';
        }
        setPercentSpan('sharpenVal', 0);
    }

    function enableSharpenAdjust(baseSrc) {
        sharpenBaseSrc = baseSrc;
        if (sharpenSection) {
            sharpenSection.style.display = 'block';
        }
        if (rngSharpen) {
            rngSharpen.disabled = false;
            rngSharpen.value = '0';
        }
        setPercentSpan('sharpenVal', 0);
    }

    function replaceEditorImageSrc(url) {
        if (cropper && typeof cropper.replace === 'function') {
            cropper.replace(url, true);
            return;
        }
        imageEl.src = url;
    }

    function applySharpenPreview(sliderPercent) {
        if (!sharpenBaseSrc) {
            return;
        }
        const percent = Math.max(0, Math.min(100, Math.round(Number(sliderPercent) || 0)));
        setPercentSpan('sharpenVal', percent);
        if (percent <= 0) {
            replaceEditorImageSrc(sharpenBaseSrc);
            return;
        }
        const img = new Image();
        img.onload = () => {
            if (!sharpenBaseSrc) {
                return;
            }
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const amount = sharpenLogic.amountFromSlider(percent);
            sharpenLogic.applyUnsharpMask(canvas, amount);
            replaceEditorImageSrc(canvas.toDataURL());
        };
        img.src = sharpenBaseSrc;
    }

    /** Downscale in ~50% steps to reduce blur from one-shot canvas resize. */
    function resizeCanvasStepped(source, targetW, targetH) {
        const srcW = source.width;
        const srcH = source.height;
        if (srcW === targetW && srcH === targetH) {
            return source;
        }

        function drawToSize(src, w, h) {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(src, 0, 0, w, h);
            return canvas;
        }

        const steps = resizePanelLogic.computeHalveDownscaleSteps(
            srcW, srcH, targetW, targetH
        );
        let current = source;
        for (const step of steps) {
            current = drawToSize(current, step.w, step.h);
        }
        return current;
    }

    function getCroppedCanvasResized(targetW, targetH) {
        const canvas = cropper.getCroppedCanvas({
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high'
        });
        return resizeCanvasStepped(canvas, targetW, targetH);
    }

    function updateResizeScaleFromInputs() {
        if (!rngResizeScale || resizeBaseWidth <= 0) {
            return;
        }
        const percent = resizePanelLogic.percentFromResizeWidth(txtWidth.value, resizeBaseWidth);
        if (percent == null) {
            return;
        }
        rngResizeScale.value = percent;
        setPercentSpan('resizeScaleVal', percent);
        applyResizePreviewZoom(percent);
        updateResizeApplyButtonState(percent);
    }

    function updateResizeInputsFromCrop() {
        if (!cropper || !resizePanelLogic.shouldUpdateResizeInputsFromCrop
            || !resizePanelLogic.shouldUpdateResizeInputsFromCrop(chkEnableCrop.checked, cropper.cropped)) {
            return;
        }
        applyResizePanelState(resizePanelLogic.buildResizePanelFromCrop(cropper.getData()));
    }

    function updateZoomIndicator(syncToggleLabel = true) {
        if (!cropper) return;
        const ratio = zoomLogic.getImageZoomRatioFromData(cropper.getImageData());
        if (ratio != null) {
            lblZoomPercent.textContent = `${zoomLogic.zoomRatioToPercent(ratio)}%`;
        }
        if (syncToggleLabel) {
            updateZoomToggleButton();
        }
    }

    function updateZoomToggleButton() {
        if (!btnReset || !cropper) {
            return;
        }

        const currentRatio = zoomLogic.getImageZoomRatioFromData(cropper.getImageData());
        const fitRatio = getViewportFitRatio();
        const isActualPixelsTarget = isActualPixelsZoomTarget(currentRatio, fitRatio);
        setZoomToggleButtonLabel(isActualPixelsTarget);
    }

    function isActualPixelsZoomTarget(currentRatio, fitRatio) {
        const targetRatio = zoomLogic.resolveToggleZoomTargetRatio(currentRatio, fitRatio);
        return Math.abs(targetRatio - 1) < zoomLogic.DEFAULT_ZOOM_EPSILON;
    }

    function setZoomToggleButtonLabel(isActualPixelsTarget) {
        if (!btnReset) {
            return;
        }

        if (lblResetText) {
            lblResetText.textContent = isActualPixelsTarget ? '100%' : t('shortcuts.zoomFit');
        }
        btnReset.title = isActualPixelsTarget ? t('shortcuts.zoomActualPixels') : t('shortcuts.zoomFit');
    }

    function captureInitialFitRatio() {
        initialFitRatio = getViewportFitRatio();
    }

    function toggleZoomView() {
        if (!cropper) {
            return;
        }

        const data = cropper.getImageData();
        if (!data || !data.naturalWidth) {
            return;
        }

        const currentRatio = zoomLogic.getImageZoomRatioFromData(data);
        const fitRatio = getViewportFitRatio();
        const isActualPixelsTarget = isActualPixelsZoomTarget(currentRatio, fitRatio);

        const targetRatio = zoomLogic.resolveToggleZoomTargetRatio(currentRatio, fitRatio);
        applyZoomTo(targetRatio);
        setZoomToggleButtonLabel(!isActualPixelsTarget);
        updateZoomIndicator(false);
    }

    function syncCropPresetUI() {
        const isEnabled = chkEnableCrop.checked;
        if (workspace) {
            workspace.classList.toggle('crop-active', isEnabled);
        }
        presetButtons.forEach(btn => {
            btn.disabled = !isEnabled;
        });
        if (btnApplyCrop) {
            btnApplyCrop.disabled = !isEnabled;
        }
        if (btnApplyMosaic) {
            btnApplyMosaic.disabled = !isEnabled || !cropper || !cropper.cropped;
        }
        syncMosaicAvailability();
        updateCropInteraction();
        if (isEnabled) {
            updateSelectionPanelFromCrop();
        } else {
            resetSelectionPanel();
        }
    }

    function syncMosaicAvailability() {
        const canUseMosaic = !!(cropper && chkEnableCrop.checked && cropper.cropped);
        const getMosaicTitle = (btn) => {
            if (canUseMosaic) {
                const titleKey = btn && btn.getAttribute('data-i18n-title');
                return titleKey ? t(titleKey) : '';
            }
            return t('sidebar.mosaicNeedsMarquee');
        };

        [btnToolMosaic, btnApplyMosaic].forEach((btn) => {
            if (!btn) {
                return;
            }
            btn.classList.toggle('is-disabled', !canUseMosaic);
            btn.setAttribute('aria-disabled', canUseMosaic ? 'false' : 'true');
            btn.tabIndex = canUseMosaic ? 0 : -1;
            btn.title = getMosaicTitle(btn);
        });
    }

    // Crop Toggle Checkbox listener
    chkEnableCrop.addEventListener('change', () => {
        if (chkEnableCrop.checked) {
            if (cropper) {
                initMarqueeToFullImage();
                // Highlight Free preset by default when crop is checked on
                applyMarqueeShape();
                isMarqueeMode = false;
                updateResizeInputsFromCrop();
            }
        } else {
            if (cropper) {
                cropper.clear();
            }
            syncResizeInputsToOriginal();
            clearNaturalCropData();
            applyMarqueeShape();
            isMarqueeMode = false;
        }
        syncCropPresetUI();
        syncMosaicAvailability();
        if (suppressCropCheckboxToolSync) {
            return;
        }
        setActiveTool(chkEnableCrop.checked ? (isMarqueeMode ? 'marquee' : 'crop') : 'cursor', {
            setMarqueeMode: isMarqueeMode && chkEnableCrop.checked
        });
    });

    function toggleCropModeWithKey() {
        if (!cropper) {
            return;
        }

        endMagicWandMode(false);
        endColorPickerMode();
        isMarqueeMode = false;

        const turningOn = !chkEnableCrop.checked;
        chkEnableCrop.checked = turningOn;
        chkEnableCrop.dispatchEvent(new Event('change'));
        focusCropKeyboardTarget();
        vscode.postMessage({
            command: 'show-toast',
            text: t(turningOn ? 'toast.cropActive' : 'toast.cropInactive')
        });
    }

    function toggleMarqueeModeWithKey() {
        if (!cropper) {
            return;
        }

        endMagicWandMode(false);
        endColorPickerMode();
        isMarqueeMode = true;

        if (!chkEnableCrop.checked) {
            chkEnableCrop.checked = true;
            syncCropPresetUI();
            initMarqueeToFullImage();
        }

        applyMarqueeShape();
        setActiveTool('marquee', { setMarqueeMode: true });
        focusCropKeyboardTarget();
        vscode.postMessage({
            command: 'show-toast',
            text: t('toast.marqueeActive')
        });
    }

    // Preset Aspect Ratios
    const presetButtons = document.querySelectorAll('#cropPresets button');
    presetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            setActiveTool('crop');
            ensureCropModeEnabled();

            presetButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (btn.dataset.auto === 'true') {
                autoCropToContent();
                return;
            }

            if (cropper) {
                cropper.crop();
            }

            applyMarqueeShape();
            isMarqueeMode = false;
            const ratio = parseFloat(btn.dataset.ratio);
            cropper.setAspectRatio(isNaN(ratio) ? NaN : ratio);
        });
    });

    const CONTENT_ALPHA_THRESHOLD = 12;

    function resetCropFaceStyles() {
        const face = document.querySelector('.cropper-face');
        if (face) {
            face.style.borderRadius = '0';
            face.style.backgroundColor = 'transparent';
        }
    }

    function getContentBoundsFromRegion(regionX, regionY, regionW, regionH, useCircle) {
        if (!ensureMagicWandCanvas()) {
            return null;
        }

        const x0 = Math.max(0, Math.round(regionX));
        const y0 = Math.max(0, Math.round(regionY));
        const w = Math.min(originalWidth - x0, Math.round(regionW));
        const h = Math.min(originalHeight - y0, Math.round(regionH));

        if (w <= 0 || h <= 0) {
            return null;
        }

        const pixels = magicWandCtx.getImageData(x0, y0, w, h).data;
        const centerX = w / 2;
        const centerY = h / 2;
        const circleRadius = Math.min(w, h) / 2;
        let minX = w;
        let minY = h;
        let maxX = -1;
        let maxY = -1;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (useCircle) {
                    const dx = x + 0.5 - centerX;
                    const dy = y + 0.5 - centerY;
                    if ((dx * dx) + (dy * dy) > circleRadius * circleRadius) {
                        continue;
                    }
                }

                const alpha = pixels[((y * w) + x) * 4 + 3];
                if (alpha <= CONTENT_ALPHA_THRESHOLD) {
                    continue;
                }

                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }

        if (maxX < 0) {
            return null;
        }

        return {
            x: x0 + minX,
            y: y0 + minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1
        };
    }

    function applyCropBounds(bounds) {
        clearMagicWandMask();
        normalizeCanvasOrigin();
        cropper.setData(bounds);
        updateResizeInputsFromCrop();
        updateSelectionPanelFromCrop();
        cacheNaturalCropData();
        scheduleSyncLayout();
    }

    function ensureCropModeEnabled() {
        if (!chkEnableCrop.checked) {
            chkEnableCrop.checked = true;
            syncCropPresetUI();
            if (cropper) {
                initMarqueeToFullImage();
            }
        }
    }

    function syncToolOptionsVisibility() {
        Object.keys(toolOptionPanels).forEach((tool) => {
            const panel = toolOptionPanels[tool];
            if (panel) {
                panel.classList.toggle('active', tool === activeTool);
            }
        });
    }

    function syncToolRailButtons() {
        toolButtons.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tool === activeTool);
        });
    }

    function setActiveTool(nextTool, options = {}) {
        const resolvedTool = nextTool || toolRailLogic.DEFAULT_ACTIVE_TOOL || 'cursor';
        activeTool = resolvedTool;
        syncToolRailButtons();
        syncToolOptionsVisibility();

        if (toolRailLogic.shouldEnableCropForTool(activeTool) && !chkEnableCrop.checked) {
            ensureCropModeEnabled();
        } else if (!toolRailLogic.shouldEnableCropForTool(activeTool) && chkEnableCrop.checked && !options.keepCropEnabled) {
            suppressCropCheckboxToolSync = true;
            chkEnableCrop.checked = false;
            chkEnableCrop.dispatchEvent(new Event('change'));
            suppressCropCheckboxToolSync = false;
        }

        if (options.setMarqueeMode === true) {
            isMarqueeMode = true;
        } else if (options.setMarqueeMode === false) {
            isMarqueeMode = false;
        }

        if (activeTool === 'move') {
            setPanMode(true);
        } else {
            setPanMode(isPanShortcutPressed());
        }

        updateCropInteraction();
    }

    function autoCropToContent() {
        if (!cropper) {
            return false;
        }

        ensureCropModeEnabled();

        applyMarqueeShape(false);
        cropper.crop();

        invalidateMagicWandCanvas();
        const bounds = getContentBoundsFromRegion(0, 0, originalWidth, originalHeight, false);
        if (!bounds) {
            vscode.postMessage({ command: 'show-toast', text: t('toast.trimCropEmpty') });
            return false;
        }

        applyCropBounds(bounds);
        vscode.postMessage({ command: 'show-toast', text: t('toast.trimCropDone') });
        return true;
    }

    function isPointInCropSelection(point) {
        if (!cropper || !chkEnableCrop.checked || !cropper.cropped) {
            return false;
        }
        return cropMarqueeLogic.isPointInCropSelection(point, cropper.getData(true));
    }

    function isMarqueeFullImage() {
        return isMarqueeFullImageNatural();
    }

    function expandCropSelectionToFullImage() {
        if (!cropper || !chkEnableCrop.checked) {
            return false;
        }
        if (isMarqueeFullImage()) {
            return false;
        }
        setMarqueeToFullImage();
        if (!isMarqueeFullImage()) {
            return false;
        }
        applyZoomTo(1);
        updateZoomIndicator();
        applyMarqueeShape(false);
        vscode.postMessage({ command: 'show-toast', text: t('toast.trimCropFull') });
        return true;
    }

    function toggleCropMarqueeFullContent() {
        if (!cropper || !chkEnableCrop.checked || !cropper.cropped) {
            return false;
        }

        if (isMarqueeFullImage()) {
            return trimCropSelectionToContent();
        }

        return expandCropSelectionToFullImage();
    }

    function trimCropSelectionToContent() {
        if (!cropper || !chkEnableCrop.checked || !cropper.cropped) {
            return false;
        }

        const cropData = cropper.getData(true);
        const regionX = Math.max(0, Math.round(cropData.x));
        const regionY = Math.max(0, Math.round(cropData.y));
        const regionW = Math.min(originalWidth - regionX, Math.round(cropData.width));
        const regionH = Math.min(originalHeight - regionY, Math.round(cropData.height));

        if (regionW <= 0 || regionH <= 0) {
            return false;
        }

        invalidateMagicWandCanvas();
        const bounds = getContentBoundsFromRegion(regionX, regionY, regionW, regionH, false);
        if (!bounds) {
            vscode.postMessage({ command: 'show-toast', text: t('toast.trimCropEmpty') });
            return false;
        }

        if (bounds.x === regionX && bounds.y === regionY && bounds.width === regionW && bounds.height === regionH) {
            vscode.postMessage({ command: 'show-toast', text: t('toast.trimCropNoChange') });
            return false;
        }

        applyCropBounds(bounds);
        vscode.postMessage({ command: 'show-toast', text: t('toast.trimCropDone') });
        return true;
    }

    function getWorkspaceDblClickState(e) {
        const imagePoint = getImagePointFromEvent(e);
        return {
            hasCropper: !!cropper,
            cropEnabled: chkEnableCrop.checked,
            cropped: !!(cropper && cropper.cropped),
            activeTool,
            eyedropperActive: isEyedropperActive,
            magicWandMode: isMagicWandMode,
            colorPickerMode: isColorPickerMode,
            spacePressed: isPanShortcutPressed(),
            zLoupeActive: isZLoupeActive,
            targetOnImage: !!imagePoint,
            targetInCanvas: !!(
                (canvasScrollArea && canvasScrollArea.contains(e.target))
                || e.target.closest('.cropper-container')
            ),
            targetInToolbar: !!e.target.closest('.floating-toolbar'),
            targetInModal: !!(e.target.closest('.color-modal') || e.target.closest('.copy-modal'))
        };
    }

    function onWorkspaceDblClick(e) {
        if (isZLoupeActive) {
            return;
        }
        const point = getImagePointFromEvent(e);
        const cropData = cropper && cropper.cropped ? cropper.getData(true) : null;
        const state = getWorkspaceDblClickState(e);
        const marqueeTargetHit = !!e.target.closest('.cropper-crop-box, .cropper-face, .cropper-view-box');

        if (cropMarqueeLogic.shouldInvokeMarqueeDblClickToggle(state, point, cropData, { marqueeTargetHit })) {
            e.preventDefault();
            e.stopPropagation();
            const zoomRatio = zoomLogic.getImageZoomRatioFromData(cropper.getImageData()) ?? 1;
            if (zoomLogic.isImageZoomBelowFull(zoomRatio)) {
                applyZoomTo(1);
                return;
            }
            toggleCropMarqueeFullContent();
            return;
        }

        if (cropMarqueeLogic.shouldInvokeImageZoomDblClick(state, point, cropData)) {
            e.preventDefault();
            e.stopPropagation();
            toggleZoomView();
        }
    }

    workspace.addEventListener('dblclick', onWorkspaceDblClick, true);

    // Aspect Ratio Lock and Dimension synchronization
    txtWidth.addEventListener('input', () => {
        normalizeResizeDimensionInput(txtWidth);
        if (chkLockRatio.checked && aspectRatio) {
            txtHeight.value = Math.round(txtWidth.value / aspectRatio);
            normalizeResizeDimensionInput(txtHeight);
        }
        updateResizeScaleFromInputs();
    });

    txtHeight.addEventListener('input', () => {
        normalizeResizeDimensionInput(txtHeight);
        if (chkLockRatio.checked && aspectRatio) {
            txtWidth.value = Math.round(txtHeight.value * aspectRatio);
            normalizeResizeDimensionInput(txtWidth);
        }
        updateResizeScaleFromInputs();
    });

    if (rngResizeScale) {
        rngResizeScale.addEventListener('input', () => {
            const percent = resizePanelLogic.clampResizeScalePercent
                ? resizePanelLogic.clampResizeScalePercent(rngResizeScale.value)
                : Math.max(10, Math.min(200, Math.round(Number(rngResizeScale.value) || 100)));
            rngResizeScale.value = String(percent);
            setPercentSpan('resizeScaleVal', String(percent));
            applyResizeScale(percent);
        });
    }

    if (zoomLoupeDragHandle) {
        zoomLoupeDragHandle.addEventListener('pointerdown', startZoomLoupePanelDrag);
        window.addEventListener('pointermove', moveZoomLoupePanelDrag);
        window.addEventListener('pointerup', stopZoomLoupePanelDrag);
        window.addEventListener('pointercancel', stopZoomLoupePanelDrag);
    }

    if (toolbarDragHandle) {
        toolbarDragHandle.addEventListener('pointerdown', startToolbarDrag);
        window.addEventListener('pointermove', moveToolbarDrag);
        window.addEventListener('pointerup', stopToolbarDrag);
        window.addEventListener('pointercancel', stopToolbarDrag);
    }

    // Toolbar zoom / rotate
    document.getElementById('btnZoomIn').addEventListener('click', () => {
        if (cropper) {
            applyZoomAction('zoomIn');
        }
    });
    document.getElementById('btnZoomOut').addEventListener('click', () => {
        if (cropper) {
            applyZoomAction('zoomOut');
        }
    });
    document.getElementById('btnRotateLeft').addEventListener('click', () => {
        applyRotationAction('rotateLeft');
    });
    document.getElementById('btnRotateRight').addEventListener('click', () => {
        applyRotationAction('rotateRight');
    });
    document.getElementById('btnFlipH').addEventListener('click', () => {
        applyFlipAction('flipH');
    });
    document.getElementById('btnFlipV').addEventListener('click', () => {
        applyFlipAction('flipV');
    });
    document.getElementById('btnReset').addEventListener('click', () => {
        toggleZoomView();
    });

    toolButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const tool = btn.dataset.tool || 'cursor';
            if (tool === 'mosaic' && btn.getAttribute('aria-disabled') === 'true') {
                return;
            }
            if (tool === 'crop') {
                setActiveTool('crop');
                return;
            }
            if (tool === 'cursor') {
                setActiveTool('cursor');
                return;
            }
            if (tool === 'marquee') {
                setActiveTool('marquee', { setMarqueeMode: true });
                return;
            }
            if (tool === 'resize') {
                setActiveTool('resize');
                return;
            }
            if (tool === 'mosaic') {
                setActiveTool('mosaic', { keepCropEnabled: true });
                showMosaicModal();
                return;
            }
            if (tool === 'move') {
                setActiveTool('move');
            }
        });
    });

    // Format changes display quality slider
    selFormat.addEventListener('change', () => {
        const val = selFormat.value;
        if (val === 'image/jpeg' || val === 'image/webp') {
            qualitySection.style.display = 'block';
        } else {
            qualitySection.style.display = 'none';
        }
    });

    rngQuality.addEventListener('input', () => {
        setPercentSpan('qualityVal', rngQuality.value);
    });

    if (rngSharpen) {
        rngSharpen.addEventListener('input', () => {
            clearTimeout(sharpenPreviewTimer);
            sharpenPreviewTimer = setTimeout(() => {
                applySharpenPreview(parseInt(rngSharpen.value, 10));
            }, 40);
        });
        rngSharpen.addEventListener('change', () => {
            const percent = parseInt(rngSharpen.value, 10);
            if (sharpenBaseSrc && percent > 0) {
                notifyDocumentChanged('edit.sharpen');
            }
        });
    }

    // Apply manual resize dimension changes (destructively crops and resizes on screen)
    btnApplyResize.addEventListener('click', () => {
        if (!cropper) return;
        const targetWidth = parseInt(txtWidth.value, 10);
        const targetHeight = parseInt(txtHeight.value, 10);
        if (targetWidth > 0 && targetHeight > 0) {
            pushHistorySnapshot('edit.resize');

            // If crop mode is NOT enabled, select the entire image bounds to get a clean full-image resize!
            if (!chkEnableCrop.checked) {
                cropper.crop();
                cropper.setData({
                    x: 0,
                    y: 0,
                    width: originalWidth,
                    height: originalHeight
                });
            }

            let canvas = getCroppedCanvasResized(targetWidth, targetHeight);

            const newSrc = canvas.toDataURL();
            let preserveZoomRatio = null;
            if (cropper) {
                const imgData = cropper.getImageData();
                if (imgData && imgData.naturalWidth) {
                    preserveZoomRatio = imgData.width / imgData.naturalWidth;
                }
            }
            const resizePanelScalePercent = resizePanelLogic.percentFromResizeWidth(
                targetWidth,
                resizeBaseWidth
            );
            enableSharpenAdjust(newSrc);
            initEditor(newSrc, {
                afterResize: true,
                preserveZoomRatio,
                resizePanelScalePercent,
                preserveSharpenAdjust: true
            });
            notifyDocumentChanged('edit.resize');
            vscode.postMessage({ command: 'show-toast', text: t('toast.resizeApplied') });
        }
    });

    // Apply 1:1 original crop selections (destructively crops on screen keeping original selection pixels scale)
    btnApplyCrop.addEventListener('click', () => {
        if (!cropper) return;
        if (magicWandMask && magicWandBounds) {
            applyMagicWandCrop();
            return;
        }
        if (!chkEnableCrop.checked || !cropper.cropped) {
            vscode.postMessage({ command: 'show-toast', text: t('toast.cropSelectFirst') });
            return;
        }

        pushHistorySnapshot('edit.crop');
        let canvas = cropper.getCroppedCanvas({
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high'
        });

        const newSrc = canvas.toDataURL();
        chkEnableCrop.checked = false;
        syncCropPresetUI();
        initEditor(newSrc);
        activeTool = toolRailLogic.resolveToolAfterApply(activeTool, 'crop');
        setActiveTool(activeTool);

        notifyDocumentChanged('edit.crop');
        vscode.postMessage({ command: 'show-toast', text: t('toast.cropApplied') });
    });

    if (btnApplyMosaic) {
        btnApplyMosaic.addEventListener('click', () => {
            if (btnApplyMosaic.getAttribute('aria-disabled') === 'true') {
                return;
            }
            setActiveTool('mosaic', { keepCropEnabled: true });
            showMosaicModal();
        });
    }

    // Hook up saving triggers
    const btnSave = document.getElementById('btnSave');
    const btnExport = document.getElementById('btnExport');

    btnSave.addEventListener('click', () => triggerSave('save'));
    btnExport.addEventListener('click', () => triggerSave('export'));

    const COPY_FORMAT_STORAGE_KEY = 'vsimage.copyFormat';
    const COPY_QUALITY_STORAGE_KEY = 'vsimage.copyQuality';
    const COPY_SCOPE_STORAGE_KEY = 'vsimage.copyScopeSelection';
    let selectedCopyFormat = 'image/png';

    function hasActiveCopySelection() {
        return !!(cropper && chkEnableCrop.checked && cropper.cropped);
    }

    function updateCopyScopeUI() {
        const hasSelection = hasActiveCopySelection();
        if (copyScopeSection) {
            copyScopeSection.style.display = hasSelection ? 'block' : 'none';
        }
        if (!hasSelection || !copyScopeInfo) {
            return;
        }

        const data = cropper.getData(true);
        const width = Math.round(data.width);
        const height = Math.round(data.height);
        copyScopeInfo.textContent = t('copyModal.selectionSize', {
            width: String(width),
            height: String(height)
        });
    }

    function getCopyFormatLabel(mimeType) {
        switch (mimeType) {
            case 'image/jpeg':
                return t('copyModal.formatJpeg');
            case 'image/webp':
                return t('copyModal.formatWebp');
            default:
                return t('copyModal.formatPng');
        }
    }

    function syncCopyQualityVisibility() {
        if (!copyQualitySection) {
            return;
        }
        const showQuality = clipboardLogic.shouldShowQuality(selectedCopyFormat);
        copyQualitySection.style.display = showQuality ? 'block' : 'none';
    }

    function setSelectedCopyFormat(format) {
        selectedCopyFormat = clipboardLogic.resolveCopyFormat(format);
        if (copyFormatOptions) {
            copyFormatOptions.querySelectorAll('.copy-format-btn').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.format === selectedCopyFormat);
            });
        }
        syncCopyQualityVisibility();
    }

    function hideCopyModal() {
        if (copyModal) {
            copyModal.style.display = 'none';
        }
    }

    function showCopyModal() {
        if (!copyModal || !cropper) {
            return;
        }

        const savedFormat = clipboardLogic.resolveCopyFormat(sessionStorage.getItem(COPY_FORMAT_STORAGE_KEY));
        setSelectedCopyFormat(savedFormat);

        const savedQuality = sessionStorage.getItem(COPY_QUALITY_STORAGE_KEY);
        const quality = clipboardLogic.resolveCopyQuality(savedQuality, parseInt(rngQuality.value, 10));
        if (rngCopyQuality) {
            rngCopyQuality.value = String(quality);
        }
        setPercentSpan('copyQualityVal', quality);

        if (chkCopySelectionOnly) {
            const savedScope = sessionStorage.getItem(COPY_SCOPE_STORAGE_KEY);
            chkCopySelectionOnly.checked = clipboardLogic.resolveSelectionOnly(hasActiveCopySelection(), savedScope);
        }
        updateCopyScopeUI();

        copyModal.style.display = 'flex';
        if (btnCopyConfirm) {
            btnCopyConfirm.focus();
        }
    }

    function performCopyToClipboard(format, qualityPercent, selectionOnly) {
        if (!cropper) {
            return;
        }

        const quality = qualityPercent / 100;
        const useSelection = !!(selectionOnly && hasActiveCopySelection());
        sessionStorage.setItem(COPY_FORMAT_STORAGE_KEY, format);
        sessionStorage.setItem(COPY_QUALITY_STORAGE_KEY, String(qualityPercent));
        sessionStorage.setItem(COPY_SCOPE_STORAGE_KEY, useSelection ? 'selection' : 'full');

        function getCopySuccessToastText() {
            if (useSelection) {
                const data = cropper.getData(true);
                return t('toast.imageCopiedSelection', {
                    format: getCopyFormatLabel(format),
                    width: String(Math.round(data.width)),
                    height: String(Math.round(data.height))
                });
            }
            return t('toast.imageCopiedAs', { format: getCopyFormatLabel(format) });
        }

        function requestHostClipboardCopyDataUrl(dataUrl, successText) {
            vscode.postMessage({ command: 'host-clipboard-request' });
            vscode.postMessage({
                command: 'copy-image',
                dataUrl,
                successText
            });
            hideCopyModal();
        }

        if (!window.editorApi || !window.editorApi.getCanvasBlob) {
            vscode.postMessage({ command: 'show-toast', text: t('toast.noImageCopy') });
            return;
        }

        const toastText = getCopySuccessToastText();
        if (usesMacShortcuts()) {
            try {
                const dataUrl = window.editorApi.getCanvasDataUrl
                    ? window.editorApi.getCanvasDataUrl({ format, quality, copySelectionOnly: useSelection })
                    : null;
                if (!dataUrl) {
                    vscode.postMessage({ command: 'show-toast', text: t('toast.noImageCopy') });
                    return;
                }
                requestHostClipboardCopyDataUrl(dataUrl, toastText);
            } catch (err) {
                vscode.postMessage({ command: 'show-toast', text: t('toast.clipboardFailed', { error: String(err) }) });
            }
            return;
        }

        try {
            window.editorApi.getCanvasBlob((blob) => {
                if (!blob) {
                    vscode.postMessage({ command: 'show-toast', text: t('toast.noImageCopy') });
                    return;
                }

                const clipboard = navigator.clipboard;
                const ClipboardItemCtor = window.ClipboardItem;
                if (!clipboardLogic.canWriteClipboardImage(clipboard && clipboard.write, ClipboardItemCtor)) {
                    vscode.postMessage({ command: 'show-toast', text: t('toast.clipboardUnavailable') });
                    return;
                }

                clipboard.write([
                    new ClipboardItemCtor({
                        [blob.type]: blob
                    })
                ]).then(() => {
                    hideCopyModal();
                    vscode.postMessage({ command: 'show-toast', text: toastText });
                }).catch((err) => {
                    vscode.postMessage({
                        command: 'show-toast',
                        text: t('toast.clipboardFailed', { error: String(err) })
                    });
                });
        }, { format, quality, copySelectionOnly: useSelection });
        } catch (err) {
            vscode.postMessage({ command: 'show-toast', text: t('toast.clipboardFailed', { error: String(err) }) });
        }
    }

    function confirmCopyToClipboard() {
        const qualityPercent = rngCopyQuality
            ? parseInt(rngCopyQuality.value, 10)
            : parseInt(rngQuality.value, 10);
        const selectionOnly = chkCopySelectionOnly ? chkCopySelectionOnly.checked : false;
        performCopyToClipboard(selectedCopyFormat, qualityPercent, selectionOnly);
    }

    function ensureMosaicPreviewCanvas() {
        if (!mosaicPreviewCanvas) {
            mosaicPreviewCanvas = document.getElementById('mosaicPreviewCanvas');
        }
        if (mosaicPreviewCanvas && cropper && cropper.cropper) {
            const cropperCanvasHost = cropper.cropper.querySelector('.cropper-canvas');
            if (cropperCanvasHost && mosaicPreviewCanvas.parentElement !== cropperCanvasHost) {
                cropperCanvasHost.appendChild(mosaicPreviewCanvas);
            }
        }
        if (mosaicPreviewCanvas && !mosaicPreviewCtx) {
            mosaicPreviewCtx = mosaicPreviewCanvas.getContext('2d');
        }
        return !!(mosaicPreviewCanvas && mosaicPreviewCtx);
    }

    function normalizeMosaicBlockSize(value) {
        const size = Math.round(Number(value));
        return Number.isFinite(size)
            ? Math.max(MOSAIC_MIN_BLOCK_SIZE, Math.min(MOSAIC_MAX_BLOCK_SIZE, size))
            : MOSAIC_DEFAULT_BLOCK_SIZE;
    }

    function getMosaicBlockSize() {
        if (!rngMosaicSize) {
            return MOSAIC_DEFAULT_BLOCK_SIZE;
        }
        return normalizeMosaicBlockSize(rngMosaicSize.value);
    }

    function setMosaicBlockSize(value) {
        const size = normalizeMosaicBlockSize(value);
        if (rngMosaicSize) {
            rngMosaicSize.value = String(size);
        }
        if (mosaicSizeVal) {
            mosaicSizeVal.textContent = String(size);
        }
        return size;
    }

    function hideMosaicPreview() {
        if (mosaicPreviewRaf !== null) {
            cancelAnimationFrame(mosaicPreviewRaf);
            mosaicPreviewRaf = null;
        }
        if (mosaicPreviewCanvas) {
            mosaicPreviewCanvas.style.display = 'none';
        }
    }

    function renderMosaicPreview() {
        if (!mosaicPreviewState || !cropper || !imageEl || !ensureMosaicPreviewCanvas()) {
            hideMosaicPreview();
            return;
        }

        const imageData = cropper.getImageData();
        if (!imageData || !imageData.width || !imageData.height || !imageData.naturalWidth || !imageData.naturalHeight) {
            hideMosaicPreview();
            return;
        }

        const previewWidth = Math.max(1, Math.round(imageData.width));
        const previewHeight = Math.max(1, Math.round(imageData.height));
        mosaicPreviewCanvas.width = previewWidth;
        mosaicPreviewCanvas.height = previewHeight;
        mosaicPreviewCanvas.style.left = `${Math.round(imageData.left || 0)}px`;
        mosaicPreviewCanvas.style.top = `${Math.round(imageData.top || 0)}px`;
        mosaicPreviewCanvas.style.width = `${previewWidth}px`;
        mosaicPreviewCanvas.style.height = `${previewHeight}px`;
        mosaicPreviewCanvas.style.display = 'block';

        if (!mosaicPreviewSourceCanvas
            || mosaicPreviewSourceCanvas.width !== imageData.naturalWidth
            || mosaicPreviewSourceCanvas.height !== imageData.naturalHeight) {
            mosaicPreviewSourceCanvas = document.createElement('canvas');
            mosaicPreviewSourceCanvas.width = imageData.naturalWidth;
            mosaicPreviewSourceCanvas.height = imageData.naturalHeight;
        }

        const sourceCtx = mosaicPreviewSourceCanvas.getContext('2d');
        sourceCtx.clearRect(0, 0, mosaicPreviewSourceCanvas.width, mosaicPreviewSourceCanvas.height);
        sourceCtx.drawImage(imageEl, 0, 0, mosaicPreviewSourceCanvas.width, mosaicPreviewSourceCanvas.height);
        mosaicLogic.applyMosaicToCanvas(
            mosaicPreviewSourceCanvas,
            mosaicPreviewState.cropData,
            mosaicPreviewState.blockSize
        );

        const ctx = mosaicPreviewCtx;
        ctx.clearRect(0, 0, previewWidth, previewHeight);
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.translate(previewWidth / 2, previewHeight / 2);
        ctx.rotate(((Number(imageData.rotate) || 0) * Math.PI) / 180);
        ctx.scale(Number(imageData.scaleX) || 1, Number(imageData.scaleY) || 1);
        ctx.drawImage(mosaicPreviewSourceCanvas, -previewWidth / 2, -previewHeight / 2, previewWidth, previewHeight);
        ctx.restore();
    }

    function scheduleMosaicPreviewRender() {
        if (!mosaicPreviewState) {
            hideMosaicPreview();
            return;
        }
        if (mosaicPreviewRaf !== null) {
            return;
        }
        mosaicPreviewRaf = requestAnimationFrame(() => {
            mosaicPreviewRaf = null;
            renderMosaicPreview();
        });
    }

    function hideMosaicModal() {
        mosaicPreviewState = null;
        hideMarqueeShortcutTooltip();
        hideMosaicPreview();
        updateCropInteraction();
    }

    function showMosaicModal() {
        hideMarqueeShortcutTooltip();
        if (!cropper || !chkEnableCrop.checked || !cropper.cropped) {
            vscode.postMessage({ command: 'show-toast', text: t('toast.cropSelectFirst') });
            return false;
        }

        clearMagicWandMask();
        endMagicWandMode(false);
        endColorPickerMode();
        mosaicPreviewState = {
            cropData: cropper.getData(true),
            blockSize: setMosaicBlockSize(rngMosaicSize ? rngMosaicSize.value : MOSAIC_DEFAULT_BLOCK_SIZE)
        };

        updateCropInteraction();
        scheduleMosaicPreviewRender();
        return true;
    }

    function commitMosaicSelection() {
        if (!cropper || !mosaicPreviewState || !chkEnableCrop.checked || !cropper.cropped) {
            return false;
        }

        pushHistorySnapshot('edit.mosaic');

        const cropData = cropper.getData(true);
        const canvas = document.createElement('canvas');
        canvas.width = originalWidth;
        canvas.height = originalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageEl, 0, 0);
        mosaicLogic.applyMosaicToCanvas(canvas, cropData, getMosaicBlockSize());

        const newSrc = canvas.toDataURL();
        replaceEditorImageSrc(newSrc);
        hideMosaicModal();
        setActiveTool('cursor');
        updateSelectionPanelFromCrop();
        cacheNaturalCropData();
        notifyDocumentChanged('edit.mosaic');
        vscode.postMessage({ command: 'show-toast', text: t('toast.mosaicApplied') });
        return true;
    }

    // Clipboard Copy Engine
    function copyImageToClipboard() {
        vscode.postMessage({ command: 'copy-function-enter' });
        if (!cropper) {
            vscode.postMessage({ command: 'show-toast', text: t('toast.noImageCopy') });
            return;
        }
        const format = clipboardLogic.resolveCopyFormat(sessionStorage.getItem(COPY_FORMAT_STORAGE_KEY) || selectedCopyFormat);
        const savedQuality = sessionStorage.getItem(COPY_QUALITY_STORAGE_KEY);
        const qualityPercent = clipboardLogic.resolveCopyQuality(savedQuality, parseInt(rngQuality.value, 10));
        const savedScope = sessionStorage.getItem(COPY_SCOPE_STORAGE_KEY);
        const selectionOnly = clipboardLogic.resolveSelectionOnly(hasActiveCopySelection(), savedScope);
        performCopyToClipboard(format, qualityPercent, selectionOnly);
    }

    function shouldLetNativeTextCopyProceed(activeEl) {
        if (!activeEl) {
            return false;
        }

        if (activeEl.isContentEditable) {
            const selection = window.getSelection && window.getSelection();
            return !!(selection && !selection.isCollapsed && String(selection).length > 0);
        }

        if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
            const start = typeof activeEl.selectionStart === 'number' ? activeEl.selectionStart : null;
            const end = typeof activeEl.selectionEnd === 'number' ? activeEl.selectionEnd : null;
            return start !== null && end !== null && end > start;
        }

        return false;
    }

    if (copyFormatOptions) {
        copyFormatOptions.addEventListener('click', (e) => {
            const btn = e.target.closest('.copy-format-btn');
            if (!btn || !btn.dataset.format) {
                return;
            }
            setSelectedCopyFormat(btn.dataset.format);
        });
    }

    if (rngCopyQuality) {
        rngCopyQuality.addEventListener('input', () => {
            setPercentSpan('copyQualityVal', rngCopyQuality.value);
        });
    }

    if (btnCopyConfirm) {
        btnCopyConfirm.addEventListener('click', confirmCopyToClipboard);
    }

    if (copyModalClose) {
        copyModalClose.addEventListener('click', hideCopyModal);
    }
    if (copyModalBackdrop) {
        copyModalBackdrop.addEventListener('click', hideCopyModal);
    }

    if (rngMosaicSize) {
        rngMosaicSize.addEventListener('input', () => {
            const size = setMosaicBlockSize(rngMosaicSize.value);
            if (mosaicPreviewState) {
                mosaicPreviewState.blockSize = size;
                scheduleMosaicPreviewRender();
            }
        });
    }

    if (btnMosaicConfirm) {
        btnMosaicConfirm.addEventListener('click', commitMosaicSelection);
    }
    if (btnMosaicCancel) {
        btnMosaicCancel.addEventListener('click', hideMosaicModal);
    }

    // ── Color Picker (Photoshop I key) ─────────────────────────────────────

    function ensureColorPickerCanvas() {
        if (!cropper || !imageEl) {
            return false;
        }
        if (!colorPickerCanvas || colorPickerCanvas.width !== originalWidth || colorPickerCanvas.height !== originalHeight) {
            colorPickerCanvas = document.createElement('canvas');
            colorPickerCanvas.width = originalWidth;
            colorPickerCanvas.height = originalHeight;
            colorPickerCtx = colorPickerCanvas.getContext('2d');
            colorPickerCtx.drawImage(imageEl, 0, 0);
        }
        return true;
    }

    function getImagePointFromEvent(e) {
        if (!cropper) {
            return null;
        }

        const imageData = cropper.getImageData();
        const rect = cropper.container.getBoundingClientRect();
        const xInContainer = e.clientX - rect.left;
        const yInContainer = e.clientY - rect.top;
        const xInImage = xInContainer - imageData.left;
        const yInImage = yInContainer - imageData.top;

        const onImage = xInImage >= -1 && xInImage <= imageData.width + 1
            && yInImage >= -1 && yInImage <= imageData.height + 1;
        if (!onImage) {
            return null;
        }

        const naturalX = Math.round((xInImage / imageData.width) * imageData.naturalWidth);
        const naturalY = Math.round((yInImage / imageData.height) * imageData.naturalHeight);

        return {
            x: Math.max(0, Math.min(originalWidth - 1, naturalX)),
            y: Math.max(0, Math.min(originalHeight - 1, naturalY))
        };
    }

    function sampleColorAtEvent(e) {
        if (!ensureColorPickerCanvas()) {
            return null;
        }

        const point = getImagePointFromEvent(e);
        if (!point) {
            return null;
        }

        const pixel = colorPickerCtx.getImageData(point.x, point.y, 1, 1).data;
        return {
            r: pixel[0],
            g: pixel[1],
            b: pixel[2],
            a: pixel[3]
        };
    }

    function invalidateColorPickerCanvas() {
        colorPickerCanvas = null;
        colorPickerCtx = null;
    }

    function startColorPickerMode() {
        if (!cropper || isEyedropperActive || !isPanTargetVisible()) {
            return;
        }
        if (isMagicWandMode) {
            return;
        }
        if (isColorPickerMode) {
            return;
        }

        isColorPickerMode = true;
        lastPickerPreview = '';
        ensureColorPickerCanvas();
        workspace.classList.add('color-picker-active');
        if (cropper) {
            updateCropInteraction();
        }

        if (colorPickerTooltip) {
            colorPickerTooltip.style.display = 'flex';
            colorPickerTooltip.style.left = '-1000px';
            colorPickerTooltip.style.top = '-1000px';
        }
    }

    function endColorPickerMode() {
        if (!isColorPickerMode) {
            return;
        }

        isColorPickerMode = false;
        lastPickerPreview = '';
        workspace.classList.remove('color-picker-active');

        if (colorPickerTooltip) {
            colorPickerTooltip.style.display = 'none';
        }

        updateCropInteraction();
    }

    function updateColorPickerPreview(e) {
        if (!isColorPickerMode || !colorPickerTooltip) {
            return;
        }

        colorPickerTooltip.style.left = `${e.clientX + 14}px`;
        colorPickerTooltip.style.top = `${e.clientY + 14}px`;

        const color = sampleColorAtEvent(e);
        if (!color) {
            if (colorPickerPreview) {
                colorPickerPreview.textContent = '—';
            }
            if (colorPickerSwatch) {
                colorPickerSwatch.style.backgroundColor = 'transparent';
            }
            return;
        }

        const formats = colorLogic.buildColorFormats(color.r, color.g, color.b, color.a);
        const preview = formats[0].value;
        const cssColor = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;

        if (preview !== lastPickerPreview) {
            lastPickerPreview = preview;
            if (colorPickerPreview) {
                colorPickerPreview.textContent = preview;
            }
            if (colorPickerSwatch) {
                colorPickerSwatch.style.backgroundColor = cssColor;
            }
        }
    }

    function hideColorModal() {
        if (colorModal) {
            colorModal.style.display = 'none';
        }
        if (colorFormatList) {
            colorFormatList.innerHTML = '';
        }
    }

    function copyTextToClipboard(text) {
        return navigator.clipboard.writeText(text).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        });
    }

    function showColorModal(r, g, b, a) {
        if (!colorModal || !colorFormatList) {
            return;
        }

        const cssColor = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
        const formats = colorLogic.buildColorFormats(r, g, b, a);

        if (colorModalSwatch) {
            colorModalSwatch.style.backgroundColor = cssColor;
        }

        colorFormatList.innerHTML = '';
        formats.forEach((fmt) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'color-format-item';
            btn.innerHTML = `
                <span class="color-format-label">${fmt.label}</span>
                <span class="color-format-value">${fmt.value}</span>
                <span class="color-format-copy">${t('colorModal.copy')}</span>
            `;
            btn.addEventListener('click', () => {
                copyTextToClipboard(fmt.value).then(() => {
                    colorFormatList.querySelectorAll('.color-format-item').forEach((el) => el.classList.remove('copied'));
                    btn.classList.add('copied');
                    btn.querySelector('.color-format-copy').textContent = t('colorModal.copied');
                    vscode.postMessage({ command: 'show-toast', text: t('toast.colorCopied', { format: fmt.label, value: fmt.value }) });
                }).catch(() => {
                    vscode.postMessage({ command: 'show-toast', text: t('toast.colorCopyFailed') });
                });
            });
            colorFormatList.appendChild(btn);
        });

        colorModal.style.display = 'flex';
    }

    function onColorPickerClick(e) {
        if (!isColorPickerMode || isEyedropperActive) {
            return;
        }
        if (e.button !== 0) {
            return;
        }
        if (!canvasScrollArea || !canvasScrollArea.contains(e.target)) {
            return;
        }
        if (e.target.closest('.floating-toolbar') || e.target.closest('.color-modal')) {
            return;
        }

        const color = sampleColorAtEvent(e);
        if (!color) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        showColorModal(color.r, color.g, color.b, color.a);
    }

    document.addEventListener('keydown', (e) => {
        if (!shortcutLogic.isEyedropperHoldCode(e.code) || e.repeat || e.metaKey || e.ctrlKey || e.altKey
            || isTypingTarget(document.activeElement)) {
            return;
        }
        if (colorModal && colorModal.style.display === 'flex') {
            return;
        }
        isEyedropperShortcutPressed = true;
        startColorPickerMode();
    });

    document.addEventListener('keyup', (e) => {
        if (!shortcutLogic.isEyedropperHoldCode(e.code)) {
            return;
        }
        isEyedropperShortcutPressed = false;
        endColorPickerMode();
    });

    window.addEventListener('blur', () => {
        isEyedropperShortcutPressed = false;
        endColorPickerMode();
    });

    if (workspace) {
        workspace.addEventListener('mousemove', (e) => {
            if (isColorPickerMode && !isEyedropperActive) {
                updateColorPickerPreview(e);
            }
        }, true);

        workspace.addEventListener('click', onColorPickerClick, true);
    }

    if (colorModalClose) {
        colorModalClose.addEventListener('click', hideColorModal);
    }
    if (colorModalBackdrop) {
        colorModalBackdrop.addEventListener('click', hideColorModal);
    }

    // Selection Erase & Eyedropper Color-Fill Engine
    function endEyedropper() {
        isEyedropperActive = false;
        eraseTargetBounds = null;
        eyedropperCanvas = null;
        eyedropperCtx = null;
        lastSampledColor = null;
        workspace.classList.remove('eyedropper-active');
        if (eyedropperTooltip) {
            eyedropperTooltip.style.display = 'none';
        }
        const face = document.querySelector('.cropper-face');
        if (face) {
            face.style.backgroundColor = 'transparent';
        }
        if (isEyedropperShortcutPressed) {
            startColorPickerMode();
        }
    }

    function beginEyedropperForSelection(bounds) {
        if (!cropper || !bounds) {
            return;
        }

        isEyedropperActive = true;
        endColorPickerMode();
        eraseTargetBounds = bounds;

        eyedropperCanvas = document.createElement('canvas');
        eyedropperCanvas.width = originalWidth;
        eyedropperCanvas.height = originalHeight;
        eyedropperCtx = eyedropperCanvas.getContext('2d');
        eyedropperCtx.drawImage(imageEl, 0, 0);

        lastSampledColor = null;

        if (eyedropperTooltip) {
            eyedropperTooltip.style.display = 'none';
            eyedropperTooltip.style.left = '-1000px';
            eyedropperTooltip.style.top = '-1000px';
        }

        const face = document.querySelector('.cropper-face');
        if (face) {
            face.style.backgroundColor = 'transparent';
        }

        workspace.classList.add('eyedropper-active');
    }

    // ── Magic Wand (W key) ───────────────────────────────────────────────

    function invalidateMagicWandCanvas() {
        magicWandCanvas = null;
        magicWandCtx = null;
    }

    function ensureMagicWandCanvas() {
        if (!imageEl || !originalWidth || !originalHeight) {
            return false;
        }
        if (magicWandCanvas
            && (magicWandCanvas.width !== originalWidth || magicWandCanvas.height !== originalHeight)) {
            invalidateMagicWandCanvas();
        }
        if (!magicWandCanvas) {
            magicWandCanvas = document.createElement('canvas');
            magicWandCanvas.width = originalWidth;
            magicWandCanvas.height = originalHeight;
            magicWandCtx = magicWandCanvas.getContext('2d', { willReadFrequently: true });
            magicWandCtx.drawImage(imageEl, 0, 0);
        }
        return true;
    }

    function clearMagicWandMask() {
        magicWandMask = null;
        magicWandBounds = null;
        if (magicWandOverlayEl) {
            magicWandOverlayEl.remove();
            magicWandOverlayEl = null;
        }
    }

    function getMagicWandTolerance() {
        if (!rngMagicWandTolerance) {
            return 32;
        }
        return parseInt(rngMagicWandTolerance.value, 10) || 0;
    }

    function floodFillMagicWand(startX, startY, tolerance) {
        if (!ensureMagicWandCanvas()) {
            return null;
        }

        const w = originalWidth;
        const h = originalHeight;
        const pixels = magicWandCtx.getImageData(0, 0, w, h).data;
        return magicWandLogic.floodFillPixels(pixels, w, h, startX, startY, tolerance);
    }

    function ensureMagicWandOverlay() {
        if (!cropper) {
            return null;
        }
        if (!magicWandOverlayEl) {
            magicWandOverlayEl = document.createElement('canvas');
            magicWandOverlayEl.className = 'magic-wand-overlay';
            cropper.container.appendChild(magicWandOverlayEl);
        }
        return magicWandOverlayEl;
    }

    function renderMagicWandOverlay() {
        if (!magicWandMask || !cropper) {
            if (magicWandOverlayEl) {
                magicWandOverlayEl.style.display = 'none';
            }
            return;
        }

        const overlay = ensureMagicWandOverlay();
        const imgData = cropper.getImageData();
        if (!imgData || !imgData.width) {
            return;
        }

        overlay.width = Math.max(1, Math.ceil(imgData.width));
        overlay.height = Math.max(1, Math.ceil(imgData.height));
        overlay.style.width = `${imgData.width}px`;
        overlay.style.height = `${imgData.height}px`;
        overlay.style.left = `${imgData.left}px`;
        overlay.style.top = `${imgData.top}px`;
        overlay.style.display = 'block';

        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = originalWidth;
        maskCanvas.height = originalHeight;
        const maskCtx = maskCanvas.getContext('2d');
        const highlight = maskCtx.createImageData(originalWidth, originalHeight);
        // Draw the selected region in white so the overlay's difference blend reads like a complement/inversion.
        for (let i = 0; i < magicWandMask.length; i++) {
            if (magicWandMask[i]) {
                const j = i * 4;
                highlight.data[j] = 255;
                highlight.data[j + 1] = 255;
                highlight.data[j + 2] = 255;
                highlight.data[j + 3] = 205;
            }
        }
        maskCtx.putImageData(highlight, 0, 0);

        const ctx = overlay.getContext('2d');
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        ctx.drawImage(maskCanvas, 0, 0, overlay.width, overlay.height);
    }

    function applyMagicWandMaskToCanvas(canvas, bounds) {
        if (!magicWandMask || !bounds || !canvas) {
            return canvas;
        }

        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        const fullW = originalWidth;

        for (let y = 0; y < bounds.height; y++) {
            for (let x = 0; x < bounds.width; x++) {
                const maskIdx = (bounds.y + y) * fullW + (bounds.x + x);
                if (!magicWandMask[maskIdx]) {
                    const i = (y * bounds.width + x) * 4;
                    data[i + 3] = 0;
                }
            }
        }

        ctx.putImageData(imgData, 0, 0);
        return canvas;
    }

    function applyMagicWandSelection(result) {
        magicWandMask = result.mask;
        magicWandBounds = result.bounds;

        if (!chkEnableCrop.checked) {
            chkEnableCrop.checked = true;
            syncCropPresetUI();
        }

        isApplyingMagicWandSelection = true;
        cropper.crop();
        cropper.setData({
            x: result.bounds.x,
            y: result.bounds.y,
            width: result.bounds.width,
            height: result.bounds.height
        });
        isApplyingMagicWandSelection = false;
        cacheNaturalCropData();

        applyMarqueeShape(false);

        updateResizeInputsFromCrop();
        renderMagicWandOverlay();
        notifyDocumentChanged('edit.magicWandSelect');
        vscode.postMessage({
            command: 'show-toast',
            text: t('toast.magicWandSelected', { count: result.count })
        });
    }

    function endMagicWandMode(showToast) {
        if (!isMagicWandMode) {
            return;
        }

        isMagicWandMode = false;
        workspace.classList.remove('magic-wand-active');
        if (btnMagicWand) {
            btnMagicWand.classList.remove('active');
        }
        updateCropInteraction();

        if (showToast) {
            vscode.postMessage({ command: 'show-toast', text: t('toast.magicWandInactive') });
        }
    }

    function toggleMagicWandMode(forceState) {
        const next = forceState !== undefined ? forceState : !isMagicWandMode;
        if (next === isMagicWandMode) {
            return;
        }

        if (next) {
            if (!cropper) {
                return;
            }
            endColorPickerMode();
            endEyedropper();
            isMagicWandMode = true;
            workspace.classList.add('magic-wand-active');
            if (btnMagicWand) {
                btnMagicWand.classList.add('active');
            }
            updateCropInteraction();
            vscode.postMessage({ command: 'show-toast', text: t('toast.magicWandActive') });
            return;
        }

        endMagicWandMode(true);
    }

    function onMagicWandClick(e) {
        if (!isMagicWandMode || e.button !== 0) {
            return;
        }
        if (!canvasScrollArea || !canvasScrollArea.contains(e.target)) {
            return;
        }
        if (e.target.closest('.floating-toolbar') || e.target.closest('.color-modal')) {
            return;
        }

        const point = getImagePointFromEvent(e);
        if (!point) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const result = floodFillMagicWand(point.x, point.y, getMagicWandTolerance());
        if (!result) {
            vscode.postMessage({ command: 'show-toast', text: t('toast.magicWandNoSelection') });
            return;
        }

        applyMagicWandSelection(result);
    }

    function eraseMagicWandSelection() {
        if (!magicWandMask) {
            return;
        }

        pushHistorySnapshot('edit.eraseSelection');
        const data = imgData.data;
        for (let i = 0; i < magicWandMask.length; i++) {
            if (magicWandMask[i]) {
                data[i * 4 + 3] = 0;
            }
        }
        ctx.putImageData(imgData, 0, 0);

        const newSrc = canvas.toDataURL();
        initEditor(newSrc);
        notifyDocumentChanged('edit.eraseSelection');
        vscode.postMessage({ command: 'show-toast', text: t('toast.selectionErased') });
    }

    function applyMagicWandCrop() {
        if (!cropper || !magicWandMask || !magicWandBounds) {
            return;
        }

        pushHistorySnapshot('edit.crop');

        let canvas = cropper.getCroppedCanvas({
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high'
        });
        canvas = applyMagicWandMaskToCanvas(canvas, magicWandBounds);

        const newSrc = canvas.toDataURL();
        chkEnableCrop.checked = false;
        syncCropPresetUI();
        initEditor(newSrc);
        activeTool = toolRailLogic.resolveToolAfterApply(activeTool, 'crop');
        setActiveTool(activeTool);
        notifyDocumentChanged('edit.crop');
        vscode.postMessage({ command: 'show-toast', text: t('toast.cropApplied') });
    }

    if (rngMagicWandTolerance) {
        rngMagicWandTolerance.addEventListener('input', () => {
            const el = document.getElementById('magicWandToleranceVal');
            if (el) {
                el.textContent = rngMagicWandTolerance.value;
            }
        });
    }

    if (btnMagicWand) {
        btnMagicWand.addEventListener('click', () => toggleMagicWandMode());
    }

    workspace.addEventListener('click', onMagicWandClick, true);

    // Selection Erase & Eyedropper Color-Fill Engine
    function eraseSelection() {
        if (!cropper) return;
        if (!chkEnableCrop.checked || !cropper.cropped) {
            vscode.postMessage({ command: 'show-toast', text: t('toast.eraseSelectFirst') });
            return;
        }

        clearMagicWandMask();
        endMagicWandMode(false);
        endEyedropper();

        const eraseBounds = cropper.getData(true);
        pushHistorySnapshot('edit.eraseSelection');

        const canvas = document.createElement('canvas');
        canvas.width = originalWidth;
        canvas.height = originalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageEl, 0, 0);
        ctx.clearRect(eraseBounds.x, eraseBounds.y, eraseBounds.width, eraseBounds.height);

        const newSrc = canvas.toDataURL();
        initEditor(newSrc, {
            restoreCropData: eraseBounds,
            keepCropEnabled: true,
            startEyedropper: true
        });
        notifyDocumentChanged('edit.eraseSelection');
        vscode.postMessage({ command: 'show-toast', text: t('toast.selectionErased') });
    }

    workspace.addEventListener('mousemove', (e) => {
        updateSelectionPanelFromPointer(e);
    }, true);

    workspace.addEventListener('mouseleave', () => {
        setSelectionPanelValue(lblMarqueeX, '— px');
        setSelectionPanelValue(lblMarqueeY, '— px');
        hideMarqueeShortcutTooltip();
    }, true);

    workspace.addEventListener('mousemove', (e) => {
        const onMarqueeFace = !!(cropper && chkEnableCrop.checked && cropper.cropped && !marqueeGestureState
            && !mosaicPreviewState
            && !(copyModal && copyModal.style.display === 'flex')
            && !(colorModal && colorModal.style.display === 'flex')
            && e.target.closest('.cropper-face')
            && !e.target.closest('.cropper-point, .cropper-line, .cropper-center'));

        if (!onMarqueeFace) {
            hideMarqueeShortcutTooltip();
            return;
        }

        showMarqueeShortcutTooltip(e.clientX, e.clientY);
    }, true);

    const onMarqueeDragStart = (e) => {
        if (!cropper || !e.target.closest('.cropper-container')) {
            return;
        }
        if (e.button !== 0) {
            return;
        }
        if (toolRailLogic.shouldBlockMarqueeCreation(activeTool)) {
            return;
        }

        if (!cropMarqueeLogic.shouldAutoEnableMarqueeOnDrag(getWorkspaceDblClickState(e))) {
            return;
        }

        const startPoint = getClampedImagePointFromEvent(e);
        if (!activateMarqueeOnDrag(startPoint)) {
            return;
        }

        e.stopPropagation();
        e.preventDefault();
    };

    workspace.addEventListener('pointerdown', onMarqueeDragStart, true);
    workspace.addEventListener('mousedown', onMarqueeDragStart, true);
    document.addEventListener('pointermove', updateMarqueeDragCreate, true);
    document.addEventListener('mousemove', updateMarqueeDragCreate, true);
    document.addEventListener('pointerup', endMarqueeDragCreate, true);
    document.addEventListener('mouseup', endMarqueeDragCreate, true);

    // Workspace mousemove handler during capture phase to implement Eyedropper real-time live preview and tooltip tracking
    workspace.addEventListener('mousemove', (e) => {
        if (!isEyedropperActive || !eraseTargetBounds) return;

        // Position tooltip to follow the cursor (translate offset slightly)
        if (eyedropperTooltip) {
            eyedropperTooltip.style.display = 'block';
            eyedropperTooltip.style.left = `${e.clientX + 12}px`;
            eyedropperTooltip.style.top = `${e.clientY + 12}px`;
        }

        const imageData = cropper.getImageData();
        const rect = cropper.container.getBoundingClientRect();
        
        const xInContainer = e.clientX - rect.left;
        const yInContainer = e.clientY - rect.top;
        
        const xInImage = xInContainer - imageData.left;
        const yInImage = yInContainer - imageData.top;

        const isMouseOnImage = xInImage >= 0 && xInImage <= imageData.width && yInImage >= 0 && yInImage <= imageData.height;

        let color = '';
        if (isMouseOnImage && eyedropperCtx) {
            const naturalX = Math.round((xInImage / imageData.width) * imageData.naturalWidth);
            const naturalY = Math.round((yInImage / imageData.height) * imageData.naturalHeight);
            
            const clampedX = Math.max(0, Math.min(originalWidth - 1, naturalX));
            const clampedY = Math.max(0, Math.min(originalHeight - 1, naturalY));

            const pixel = eyedropperCtx.getImageData(clampedX, clampedY, 1, 1).data;
            color = `rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${pixel[3] / 255})`;
        } else {
            // Outside: translucent white erase transparent preview hint
            color = 'rgba(255, 255, 255, 0.35)';
        }

        // DOM Write Guard: Only update style if color changed
        if (color !== lastSampledColor) {
            lastSampledColor = color;
            const face = document.querySelector('.cropper-face');
            if (face) {
                face.style.backgroundColor = color;
            }
        }
    }, true);

    // Workspace click handler during capture phase to implement Eyedropper sampling
    workspace.addEventListener('click', (e) => {
        if (!isEyedropperActive || !eraseTargetBounds) return;
        
        // Prevent cropper from intercepting the click and closing
        e.stopPropagation();
        e.preventDefault();

        const imageData = cropper.getImageData();
        const rect = cropper.container.getBoundingClientRect();
        
        const xInContainer = e.clientX - rect.left;
        const yInContainer = e.clientY - rect.top;
        
        const xInImage = xInContainer - imageData.left;
        const yInImage = yInContainer - imageData.top;

        // Check if the click lies inside the actual responsive boundary of the image
        const isClickOnImage = xInImage >= 0 && xInImage <= imageData.width && yInImage >= 0 && yInImage <= imageData.height;

        pushHistorySnapshot(isClickOnImage ? 'edit.fillSelection' : 'edit.eraseSelection');

        const canvas = document.createElement('canvas');
        canvas.width = originalWidth;
        canvas.height = originalHeight;
        const ctx = canvas.getContext('2d');

        // Draw current image
        ctx.drawImage(imageEl, 0, 0);

        if (isClickOnImage && eyedropperCtx) {
            const naturalX = Math.round((xInImage / imageData.width) * imageData.naturalWidth);
            const naturalY = Math.round((yInImage / imageData.height) * imageData.naturalHeight);
            
            const clampedX = Math.max(0, Math.min(originalWidth - 1, naturalX));
            const clampedY = Math.max(0, Math.min(originalHeight - 1, naturalY));

            const pixel = eyedropperCtx.getImageData(clampedX, clampedY, 1, 1).data;
            const color = `rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${pixel[3] / 255})`;

            // Fill target marquee selection with the sampled color
            ctx.fillStyle = color;
            ctx.clearRect(eraseTargetBounds.x, eraseTargetBounds.y, eraseTargetBounds.width, eraseTargetBounds.height);
            ctx.fillRect(eraseTargetBounds.x, eraseTargetBounds.y, eraseTargetBounds.width, eraseTargetBounds.height);

            vscode.postMessage({ command: 'show-toast', text: t('toast.selectionFilled') });
        } else {
            // Erase target marquee selection to transparent
            ctx.clearRect(eraseTargetBounds.x, eraseTargetBounds.y, eraseTargetBounds.width, eraseTargetBounds.height);

            vscode.postMessage({ command: 'show-toast', text: t('toast.selectionErased') });
        }

        const newSrc = canvas.toDataURL();
        initEditor(newSrc);
        notifyDocumentChanged(isClickOnImage ? 'edit.fillSelection' : 'edit.eraseSelection');

        // Turn off eyedropper mode
        endEyedropper();

        // Reset crop mode checkbox
        chkEnableCrop.checked = false;
        syncCropPresetUI();
    }, true); // Capture phase is critical to intercept clicks over Cropper overlays!

    // Custom Context Menu event listeners
    workspace.addEventListener('contextmenu', (e) => {
        if (workspace.style.display === 'none') return;
        e.preventDefault();
        
        // Display context menu at mouse client position
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;
        contextMenu.style.display = 'block';
    });

    // Close shortcut overlay / context menu when clicking on the canvas or elsewhere
    document.addEventListener('mousedown', (e) => {
        if (e.target.closest('.context-menu')
            || e.target.closest('.color-modal-panel')
            || e.target.closest('.copy-modal')
            || e.target.closest('.mosaic-modal')) {
            return;
        }
        dismissShortcutLayers();
    }, true);

    // Close context menu on click (legacy fallback)
    document.addEventListener('click', () => {
        if (contextMenu) {
            contextMenu.style.display = 'none';
        }
    });

    document.getElementById('ctxCopy').addEventListener('click', (e) => {
        e.stopPropagation();
        contextMenu.style.display = 'none';
        copyImageToClipboard();
    });

    document.getElementById('ctxErase').addEventListener('click', (e) => {
        e.stopPropagation();
        contextMenu.style.display = 'none';
        eraseSelection();
    });

    document.getElementById('ctxFlipH').addEventListener('click', (e) => {
        e.stopPropagation();
        contextMenu.style.display = 'none';
        applyFlipAction('flipH');
    });

    document.getElementById('ctxFlipV').addEventListener('click', (e) => {
        e.stopPropagation();
        contextMenu.style.display = 'none';
        applyFlipAction('flipV');
    });

    document.getElementById('ctxMosaic').addEventListener('click', (e) => {
        e.stopPropagation();
        contextMenu.style.display = 'none';
        showMosaicModal();
    });

    document.getElementById('ctxSave').addEventListener('click', (e) => {
        e.stopPropagation();
        contextMenu.style.display = 'none';
        triggerSave('save');
    });

    document.getElementById('ctxUndo').addEventListener('click', (e) => {
        e.stopPropagation();
        contextMenu.style.display = 'none';
        if (isDocumentEditor) {
            vscode.postMessage({ command: 'undo-request' });
        } else {
            performUndo();
        }
    });

    document.getElementById('ctxReset').addEventListener('click', (e) => {
        e.stopPropagation();
        contextMenu.style.display = 'none';
        applyZoomTo(getViewportFitRatio());
        updateZoomIndicator();
    });

    function selectFullImageCropSelection() {
        if (!cropper) {
            return;
        }
        if (!chkEnableCrop.checked) {
            chkEnableCrop.checked = true;
            syncCropPresetUI();
        }
        cropper.crop();
        cropper.setData({
            x: 0,
            y: 0,
            width: originalWidth,
            height: originalHeight
        });
        updateSelectionPanelFromCrop();
        applyMarqueeShape(false);
    }

    function runShortcutAction(shortcutAction, options = {}) {
        if (!shortcutAction) {
            return false;
        }

        if (options.inputFocused && !shortcutLogic.canRunWhenInputFocused(shortcutAction)) {
            return false;
        }

        if (shortcutAction === 'save') {
            triggerSave('save');
            return true;
        }
        if (shortcutAction === 'undo') {
            if (isDocumentEditor) {
                vscode.postMessage({ command: 'undo-request' });
            } else {
                performUndo();
            }
            return true;
        }
        if (shortcutAction === 'copy') {
            copyImageToClipboard();
            return true;
        }
        if (shortcutAction === 'selectAll') {
            selectFullImageCropSelection();
            return true;
        }
        if (shortcutAction === 'crop') {
            toggleCropModeWithKey();
            return true;
        }
        if (shortcutAction === 'marquee') {
            toggleMarqueeModeWithKey();
            return true;
        }
        if (shortcutAction === 'mosaic') {
            setActiveTool('mosaic', { keepCropEnabled: true });
            showMosaicModal();
            return true;
        }
        if (shortcutAction === 'magicWand') {
            toggleMagicWandMode();
            return true;
        }
        if (shortcutAction === 'zoomIn' || shortcutAction === 'zoomOut') {
            if (cropper) {
                applyZoomAction(shortcutAction);
            }
            return true;
        }
        if (shortcutAction === 'rotateLeft' || shortcutAction === 'rotateRight') {
            applyRotationAction(shortcutAction);
            return true;
        }
        if (shortcutAction === 'fitViewport') {
            applyZoomTo(getViewportFitRatio());
            return true;
        }
        if (shortcutAction === 'actualPixels') {
            applyZoomTo(1);
            return true;
        }

        return false;
    }

    // Global keyboard listener
    document.addEventListener('keydown', (e) => {
        if (mosaicPreviewState) {
            if (e.key === 'Escape') {
                e.preventDefault();
                hideMosaicModal();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                commitMosaicSelection();
            }
            return;
        }

        // Guard input elements so typing is not hijacked
        const activeEl = document.activeElement;
        const isInput = activeEl && (
            activeEl.tagName === 'INPUT' || 
            activeEl.tagName === 'SELECT' || 
            activeEl.tagName === 'TEXTAREA' || 
            activeEl.isContentEditable
        );
        const shortcutAction = shortcutLogic.getShortcutAction(e);

        if (e.key === 'Escape') {
            e.preventDefault();
            if (isZLoupeActive) {
                setZLoupeActive(false);
                return;
            }
            if (mosaicPreviewState) {
                hideMosaicModal();
                return;
            }
            if (copyModal && copyModal.style.display === 'flex') {
                hideCopyModal();
                return;
            }
            if (colorModal && colorModal.style.display === 'flex') {
                hideColorModal();
                return;
            }
            if (isColorPickerMode) {
                isEyedropperShortcutPressed = false;
                endColorPickerMode();
                return;
            }
            if (magicWandMask) {
                clearMagicWandMask();
                if (cropper) {
                    chkEnableCrop.checked = false;
                    syncCropPresetUI();
                    cropper.clear();
                    syncResizeInputsToOriginal();
                }
                setActiveTool('cursor');
                return;
            }
            if (isMagicWandMode) {
                endMagicWandMode(true);
                return;
            }
            if (isEyedropperActive && eraseTargetBounds) {
                endEyedropper();
                return;
            }
            if (cropper) {
                chkEnableCrop.checked = false;
                syncCropPresetUI();
                cropper.clear();
                syncResizeInputsToOriginal();
                applyMarqueeShape(false);
                setActiveTool('cursor');
            }
            return;
        }

        if (isInput) {
            // Still allow core editor shortcuts inside input focus.
            if (runShortcutAction(shortcutAction, { inputFocused: true })) {
                e.preventDefault();
            }
            return;
        }

        if (runShortcutAction(shortcutAction)) {
            e.preventDefault();
            return;
        }

        // Selection Erase: Delete / Backspace
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (magicWandMask) {
                e.preventDefault();
                eraseMagicWandSelection();
            } else if (chkEnableCrop.checked && cropper && cropper.cropped) {
                e.preventDefault();
                eraseSelection();
            }
            return;
        }

        const isBracketLeft = e.key === '[' || e.code === 'BracketLeft';
        const isBracketRight = e.key === ']' || e.code === 'BracketRight';

        // Shrink crop marquee: [ (Shift = 10px per side)
        if (isBracketLeft && !e.metaKey && !e.ctrlKey && !e.altKey) {
            if (chkEnableCrop.checked && cropper && resizeCropMarqueeByInset(1, e.shiftKey)) {
                e.preventDefault();
            }
            return;
        }

        // Expand crop marquee: ] (Shift = 10px per side)
        if (isBracketRight && !e.metaKey && !e.ctrlKey && !e.altKey) {
            if (chkEnableCrop.checked && cropper && resizeCropMarqueeByInset(-1, e.shiftKey)) {
                e.preventDefault();
            }
            return;
        }

        // Move crop marquee: Arrow keys (Shift = 10px)
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            if (chkEnableCrop.checked && cropper) {
                if (moveCropMarqueeWithArrow(e.key, e.shiftKey)) {
                    e.preventDefault();
                }
            }
            return;
        }

        // Enter: apply crop selection if crop mode is active
        if (e.key === 'Enter') {
            if (mosaicPreviewState) {
                e.preventDefault();
                commitMosaicSelection();
                return;
            }
            if (copyModal && copyModal.style.display === 'flex') {
                e.preventDefault();
                confirmCopyToClipboard();
                return;
            }
            if (chkEnableCrop.checked && cropper && cropper.cropped) {
                e.preventDefault();
                btnApplyCrop.click();
            }
            return;
        }
    });

    document.addEventListener('copy', (e) => {
        const activeEl = document.activeElement;
        if (shouldLetNativeTextCopyProceed(activeEl)) {
            return;
        }

        if (!cropper) {
            return;
        }

        e.preventDefault();
        copyImageToClipboard();
    });

    function performUndo(options) {
        const fromHost = options && options.fromHost;
        if (historyStack.length > 0) {
            const entry = historyStack.pop();
            initEditor(entry.src);
            if (!fromHost) {
                vscode.postMessage({ command: 'show-toast', text: t('toast.undoSuccess') });
            }
        } else if (!fromHost) {
            vscode.postMessage({ command: 'show-toast', text: t('toast.nothingToUndo') });
        }
    }

    function triggerSave(type) {
        const start = saveExportLogic.resolveSaveStart(type, isDocumentEditor);
        if (start.immediateMessage) {
            vscode.postMessage(start.immediateMessage);
            return;
        }
    }

    function buildCanvasForExport(options) {
        if (!cropper) {
            return null;
        }

        const targetWidth = parseInt(txtWidth.value, 10) || originalWidth;
        const targetHeight = parseInt(txtHeight.value, 10) || originalHeight;
        const hasSelection = chkEnableCrop.checked && cropper.cropped;
        const copySelectionOnly = options && options.copySelectionOnly;

        let canvas;

        if (copySelectionOnly && hasSelection) {
            canvas = cropper.getCroppedCanvas({
                imageSmoothingEnabled: true,
                imageSmoothingQuality: 'high'
            });
        } else if (copySelectionOnly === false) {
            canvas = document.createElement('canvas');
            canvas.width = originalWidth;
            canvas.height = originalHeight;
            canvas.getContext('2d').drawImage(imageEl, 0, 0);
        } else {
            if (!chkEnableCrop.checked) {
                cropper.crop();
                cropper.setData({
                    x: 0,
                    y: 0,
                    width: originalWidth,
                    height: originalHeight
                });
            }

            canvas = getCroppedCanvasResized(targetWidth, targetHeight);
        }

        if (!canvas) {
            return null;
        }

        if (magicWandMask && magicWandBounds && !(options && options.copySelectionOnly === false)) {
            canvas = applyMagicWandMaskToCanvas(canvas, magicWandBounds);
        }

        return canvas;
    }

    // Expose variables for save & import protocols
    window.editorApi = {
        initEditor,
        getCanvasDataUrl: function(options) {
            const canvas = buildCanvasForExport(options);
            if (!canvas) {
                return null;
            }

            const format = (options && options.format) || selFormat.value;
            const quality = (options && options.quality != null)
                ? options.quality
                : parseFloat(rngQuality.value) / 100;
            return canvas.toDataURL(format, quality);
        },
        getCanvasBlob: function(callback, options) {
            const canvas = buildCanvasForExport(options);
            if (!canvas) {
                callback(null);
                return;
            }
            const format = (options && options.format) || selFormat.value;
            const quality = (options && options.quality != null)
                ? options.quality
                : parseFloat(rngQuality.value) / 100;
            canvas.toBlob(callback, format, quality);
        }
    };
})();
