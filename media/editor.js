(function() {
    const vscode = acquireVsCodeApi();
    const isDocumentEditor = !!window.__vsimageDocumentEditor;
    const imageEl = document.getElementById('image');
    const sidebar = document.getElementById('sidebar');
    const toolbar = document.getElementById('toolbar');
    
    const txtWidth = document.getElementById('txtWidth');
    const txtHeight = document.getElementById('txtHeight');
    const chkLockRatio = document.getElementById('chkLockRatio');
    const btnApplyResize = document.getElementById('btnApplyResize');
    const btnApplyCrop = document.getElementById('btnApplyCrop');

    const selFormat = document.getElementById('selFormat');
    const qualitySection = document.getElementById('qualitySection');
    const rngQuality = document.getElementById('rngQuality');
    const qualityVal = document.getElementById('qualityVal');

    const chkEnableCrop = document.getElementById('chkEnableCrop');
    const lblZoomPercent = document.getElementById('lblZoomPercent');

    let cropper = null;
    let originalWidth = 0;
    let originalHeight = 0;
    let aspectRatio = 0;
    let isCircular = false;
    let scaleX = 1;
    let scaleY = 1;
    let undoStack = [];
    let initialImageSrc = '';
    let isEyedropperActive = false;
    let isColorPickerMode = false;
    let isOptionPressed = false;
    let colorPickerCanvas = null;
    let colorPickerCtx = null;
    let lastPickerPreview = '';
    let eraseTargetBounds = null;
    let eyedropperCanvas = null;
    let eyedropperCtx = null;
    let lastSampledColor = null;
    let initialFitRatio = 1;
    const eyedropperTooltip = document.getElementById('eyedropperTooltip');
    const colorPickerTooltip = document.getElementById('colorPickerTooltip');
    const colorPickerSwatch = document.getElementById('colorPickerSwatch');
    const colorPickerPreview = document.getElementById('colorPickerPreview');
    const colorModal = document.getElementById('colorModal');
    const colorModalBackdrop = document.getElementById('colorModalBackdrop');
    const colorModalClose = document.getElementById('colorModalClose');
    const colorModalSwatch = document.getElementById('colorModalSwatch');
    const colorFormatList = document.getElementById('colorFormatList');

    const lblDimensions = document.getElementById('lblDimensions');
    const lblFilename = document.getElementById('lblFilename');

    const dashboard = document.getElementById('dashboard');
    const workspace = document.getElementById('workspace');
    const cardImport = document.getElementById('cardImport');
    const filePicker = document.getElementById('filePicker');
    const cardPaste = document.getElementById('cardPaste');

    const contextMenu = document.getElementById('contextMenu');
    const shortcutOverlay = document.getElementById('shortcutOverlay');

    function notifyDocumentChanged(label) {
        if (!isDocumentEditor) {
            return;
        }
        vscode.postMessage({ command: 'document-changed', label: label || 'Edit' });
    }

    function pushUndoSnapshot() {
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

        if (isCircular) {
            const circleCanvas = document.createElement('canvas');
            circleCanvas.width = canvas.width;
            circleCanvas.height = canvas.height;
            const ctx = circleCanvas.getContext('2d');

            ctx.beginPath();
            ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(canvas, 0, 0);
            canvas = circleCanvas;
        }

        undoStack.push(canvas.toDataURL());
    }

    function markTransformEdit(label) {
        pushUndoSnapshot();
        notifyDocumentChanged(label);
    }

    function respondWithImageData(requestId) {
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
        });
    }

    function revertToSource(src, filename) {
        undoStack = [];
        endEyedropper();
        endColorPickerMode();
        hideColorModal();
        invalidateColorPickerCanvas();
        initialImageSrc = src;
        if (filename && lblFilename) {
            lblFilename.textContent = filename;
        }
        initEditor(src, { preserveInitialSrc: true });
        vscode.postMessage({ command: 'show-toast', text: 'Reverted to last saved version.' });
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.command) {
            case 'request-image-data':
                respondWithImageData(message.requestId);
                break;
            case 'revert-document':
                revertToSource(message.src, message.filename);
                break;
            case 'perform-undo':
                performUndo({ fromHost: true });
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
    const CANVAS_PADDING = 20; // px — must match .canvas-scroll-content padding
    let expandingContainer = false;
    let expandContainerFrame = null;
    let isSpacePressed = false;
    let isPanning = false;
    let lastPanClientX = 0;
    let lastPanClientY = 0;

    function scheduleExpandContainerToCanvas() {
        if (expandContainerFrame !== null) {
            cancelAnimationFrame(expandContainerFrame);
        }
        expandContainerFrame = requestAnimationFrame(() => {
            expandContainerFrame = null;
            expandContainerToCanvas();
        });
    }

    /** Expand the Cropper.js container to the actual zoomed canvas size so the
     *  scroll area shows the full image. Called after every zoom/ready event. */
    function expandContainerToCanvas() {
        if (!cropper || expandingContainer || isPanning) {
            return;
        }

        const imgData = cropper.getImageData();
        if (!imgData || !imgData.width) {
            return;
        }

        const cropperContEl = document.querySelector('.cropper-container');
        const imgContainerEl = imageContainer || document.querySelector('.image-container');
        if (!cropperContEl || !imgContainerEl || !canvasScrollContent || !canvasScrollArea) {
            return;
        }

        expandingContainer = true;
        try {
            resetCanvasOrigin();

            const w = Math.ceil(imgData.width);
            const h = Math.ceil(imgData.height);
            const viewportW = canvasScrollArea.clientWidth;
            const viewportH = canvasScrollArea.clientHeight;
            const totalW = w + (CANVAS_PADDING * 2);
            const totalH = h + (CANVAS_PADDING * 2);
            const contentW = Math.max(viewportW, totalW);
            const contentH = Math.max(viewportH, totalH);

            cropperContEl.style.width = w + 'px';
            cropperContEl.style.height = h + 'px';
            cropperContEl.style.overflow = 'hidden';

            imgContainerEl.style.width = w + 'px';
            imgContainerEl.style.height = h + 'px';
            imgContainerEl.style.marginLeft = contentW > totalW ? Math.floor((contentW - totalW) / 2) + 'px' : '0';
            imgContainerEl.style.marginTop = contentH > totalH ? Math.floor((contentH - totalH) / 2) + 'px' : '0';

            canvasScrollContent.style.width = contentW + 'px';
            canvasScrollContent.style.height = contentH + 'px';
        } finally {
            expandingContainer = false;
        }

        drawRulers();
    }

    function resetCanvasOrigin() {
        if (!cropper) {
            return;
        }
        const cd = cropper.getCanvasData();
        if (!cd) {
            return;
        }
        if (Math.abs(cd.left) > 0.5 || Math.abs(cd.top) > 0.5) {
            cropper.move(-cd.left, -cd.top);
        }
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
        if (rulerV.width !== Math.round(RULER_SIZE * dpr) || rulerV.height !== Math.round(ch * dpr)) {
            rulerV.width  = Math.round(RULER_SIZE * dpr);
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
        vCtx.fillStyle = BG; vCtx.fillRect(0, 0, RULER_SIZE, ch);

        // Separator lines
        hCtx.strokeStyle = '#333'; hCtx.lineWidth = 1;
        hCtx.beginPath(); hCtx.moveTo(0, RULER_SIZE - 0.5); hCtx.lineTo(cw, RULER_SIZE - 0.5); hCtx.stroke();
        vCtx.strokeStyle = '#333'; vCtx.lineWidth = 1;
        vCtx.beginPath(); vCtx.moveTo(RULER_SIZE - 0.5, 0); vCtx.lineTo(RULER_SIZE - 0.5, ch); vCtx.stroke();

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
            vCtx.strokeStyle = TICK; vCtx.lineWidth = 1;
            vCtx.beginPath(); vCtx.moveTo(RULER_SIZE - tickW, y); vCtx.lineTo(RULER_SIZE, y); vCtx.stroke();
            if (isMajor) {
                vCtx.save();
                vCtx.fillStyle = TEXT;
                vCtx.translate(RULER_SIZE - tickW - 2, y);
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
                vCtx.beginPath(); vCtx.moveTo(0, y); vCtx.lineTo(RULER_SIZE, y); vCtx.stroke();
            }
        });
    }

    // Show shortcut cheatsheet while Cmd / Ctrl is held down
    document.addEventListener('keydown', (e) => {
        if ((e.key === 'Meta' || e.key === 'Control') && shortcutOverlay) {
            shortcutOverlay.style.display = 'block';
        }
    });
    document.addEventListener('keyup', (e) => {
        if ((e.key === 'Meta' || e.key === 'Control') && shortcutOverlay) {
            shortcutOverlay.style.display = 'none';
        }
    });
    // Also hide if window loses focus (e.g. Cmd+Tab)
    window.addEventListener('blur', () => {
        if (shortcutOverlay) shortcutOverlay.style.display = 'none';
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

        canvasScrollArea.addEventListener('wheel', (e) => {
            if (!cropper) {
                return;
            }

            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                cropper.zoom(e.deltaY < 0 ? 0.1 : -0.1);
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
        if (cropper) {
            cropper.setDragMode(active ? 'none' : 'crop');
        }
    }

    function endPanning() {
        const wasPanning = isPanning;
        isPanning = false;
        if (canvasScrollArea) {
            canvasScrollArea.classList.remove('pan-grabbing');
        }
        if (wasPanning) {
            scheduleExpandContainerToCanvas();
        }
    }

    document.addEventListener('keydown', (e) => {
        if (e.code !== 'Space' || e.repeat || isTypingTarget(document.activeElement)) {
            return;
        }
        if (!isPanTargetVisible()) {
            return;
        }
        e.preventDefault();
        isSpacePressed = true;
        setPanMode(true);
    });

    document.addEventListener('keyup', (e) => {
        if (e.code !== 'Space') {
            return;
        }
        isSpacePressed = false;
        endPanning();
        setPanMode(false);
        scheduleExpandContainerToCanvas();
    });

    window.addEventListener('blur', () => {
        isSpacePressed = false;
        endPanning();
        setPanMode(false);
        scheduleExpandContainerToCanvas();
    });

    function onPanMouseDown(e) {
        if (!isSpacePressed || !canvasScrollArea || e.button !== 0 || isEyedropperActive || isColorPickerMode) {
            return;
        }
        if (!isPanTargetVisible()) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        expandContainerToCanvas();
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
        if (!isSpacePressed || !canvasScrollArea || e.button !== 0 || isEyedropperActive || isColorPickerMode) {
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
            scheduleExpandContainerToCanvas();
        });
        rulerResizeObserver.observe(workspace);
        if (canvasScrollArea) {
            rulerResizeObserver.observe(canvasScrollArea);
        }
    }

    // Mode dispatcher
    if (!imageEl || !imageEl.getAttribute('src') || imageEl.getAttribute('src') === '') {
        // Empty editor launcher mode
        dashboard.style.display = 'flex';
        workspace.style.display = 'none';
    } else {
        // Normal file editor mode
        dashboard.style.display = 'none';
        workspace.style.display = 'grid';
        initEditor(imageEl.src);
    }

    // File import triggers
    cardImport.addEventListener('click', () => filePicker.click());
    filePicker.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            loadFile(e.target.files[0]);
        }
    });

    // Clipboard Paste trigger click
    cardPaste.addEventListener('click', () => {
        vscode.postMessage({ command: 'show-toast', text: 'Press Cmd+V / Ctrl+V to paste your clipboard image.' });
    });

    // Global Clipboard paste listener
    document.addEventListener('paste', (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let item of items) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
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
                loadFile(file);
            }
        }
    });

    function loadFile(file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            lblFilename.textContent = file.name || 'Pasted Image';
            dashboard.style.display = 'none';
            workspace.style.display = 'grid';
            initEditor(event.target.result);
        };
        reader.readAsDataURL(file);
    }

    function initEditor(src, options) {
        const preserveInitialSrc = options && options.preserveInitialSrc;
        invalidateColorPickerCanvas();
        if (!initialImageSrc || preserveInitialSrc) {
            initialImageSrc = src;
        }
        imageEl.src = src;
        
        imageEl.onload = () => {
            originalWidth = imageEl.naturalWidth;
            originalHeight = imageEl.naturalHeight;
            aspectRatio = originalWidth / originalHeight;
            scaleX = 1;
            scaleY = 1;

            lblDimensions.textContent = `${originalWidth} × ${originalHeight}`;
            txtWidth.value = originalWidth;
            txtHeight.value = originalHeight;

            // Show UI panes
            sidebar.style.display = 'flex';
            toolbar.style.display = 'flex';

            // Destroy previous instance
            if (cropper) {
                cropper.destroy();
            }

            // Uncheck crop checkbox and disable aspect presets visually by default on loading a new image
            chkEnableCrop.checked = false;
            syncCropPresetUI();

            // Create Cropper
            cropper = new Cropper(imageEl, {
                aspectRatio: NaN,
                viewMode: 0,
                background: false,
                responsive: false,
                autoCrop: false,
                zoomOnWheel: false,
                ready() {
                    if (canvasScrollArea) {
                        canvasScrollArea.scrollLeft = 0;
                        canvasScrollArea.scrollTop = 0;
                        const availW = Math.max(1, canvasScrollArea.clientWidth - (CANVAS_PADDING * 2));
                        const availH = Math.max(1, canvasScrollArea.clientHeight - (CANVAS_PADDING * 2));
                        const fitRatio = Math.min(availW / originalWidth, availH / originalHeight, 1);
                        if (fitRatio < 1) {
                            cropper.zoomTo(fitRatio);
                        }
                    }
                    updateZoomIndicator();
                    scheduleExpandContainerToCanvas();
                    requestAnimationFrame(() => {
                        scheduleExpandContainerToCanvas();
                        captureInitialFitRatio();
                    });
                    if (isSpacePressed) {
                        cropper.setDragMode('none');
                    }
                    if (cropper.cropped) {
                        updateResizeInputsFromCrop();
                    }
                },
                crop() {
                    if (cropper && cropper.cropped && !chkEnableCrop.checked) {
                        chkEnableCrop.checked = true;
                        syncCropPresetUI();
                        presetButtons.forEach(b => b.classList.remove('active'));
                        const freeBtn = document.querySelector('#cropPresets button[data-ratio="NaN"]');
                        if (freeBtn) freeBtn.classList.add('active');
                    }
                    updateResizeInputsFromCrop();
                },
                zoom() {
                    updateZoomIndicator();
                    scheduleExpandContainerToCanvas();
                    requestAnimationFrame(() => scheduleExpandContainerToCanvas());
                }
            });
        };
    }

    function updateResizeInputsFromCrop() {
        if (!cropper) return;
        const data = cropper.getData();
        txtWidth.value = Math.round(data.width);
        txtHeight.value = Math.round(data.height);
    }

    function updateZoomIndicator() {
        if (!cropper) return;
        const data = cropper.getImageData();
        if (data && data.naturalWidth) {
            const percent = Math.round((data.width / data.naturalWidth) * 100);
            lblZoomPercent.textContent = `${percent}%`;
        }
    }

    function captureInitialFitRatio() {
        if (!cropper) {
            return;
        }
        const data = cropper.getImageData();
        if (data && data.naturalWidth) {
            initialFitRatio = data.width / data.naturalWidth;
        }
    }

    function toggleZoomView() {
        if (!cropper) {
            return;
        }

        const data = cropper.getImageData();
        if (!data || !data.naturalWidth) {
            return;
        }

        const currentRatio = data.width / data.naturalWidth;
        const at100Percent = Math.abs(currentRatio - 1) < 0.005;

        cropper.zoomTo(at100Percent ? initialFitRatio : 1);
        scheduleExpandContainerToCanvas();
        updateZoomIndicator();
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
    }

    // Crop Toggle Checkbox listener
    chkEnableCrop.addEventListener('change', () => {
        if (chkEnableCrop.checked) {
            if (cropper) {
                cropper.crop();
                // Highlight Free preset by default when crop is checked on
                presetButtons.forEach(b => b.classList.remove('active'));
                const freeBtn = document.querySelector('#cropPresets button[data-ratio="NaN"]');
                if (freeBtn) freeBtn.classList.add('active');
                cropper.setAspectRatio(NaN);
                isCircular = false;
                const face = document.querySelector('.cropper-face');
                if (face) face.style.borderRadius = '0';
                updateResizeInputsFromCrop();
            }
        } else {
            if (cropper) {
                cropper.clear();
                // Reset inputs to original dimensions when exiting crop mode
                txtWidth.value = originalWidth;
                txtHeight.value = originalHeight;
            }
            isCircular = false;
            presetButtons.forEach(b => b.classList.remove('active'));
        }
        syncCropPresetUI();
    });

    // Preset Aspect Ratios
    const presetButtons = document.querySelectorAll('#cropPresets button');
    presetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (!chkEnableCrop.checked) {
                chkEnableCrop.checked = true;
                syncCropPresetUI();
            }

            presetButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (cropper) {
                cropper.crop();
            }

            isCircular = btn.dataset.circle === 'true';

            if (isCircular) {
                // Circle cropping uses 1:1 aspect ratio constraint visually
                cropper.setAspectRatio(1);
                // Apply circle mask preview to crop box
                const face = document.querySelector('.cropper-face');
                if (face) face.style.borderRadius = '50%';
            } else {
                const face = document.querySelector('.cropper-face');
                if (face) face.style.borderRadius = '0';
                
                const ratio = parseFloat(btn.dataset.ratio);
                cropper.setAspectRatio(isNaN(ratio) ? NaN : ratio);
            }
        });
    });

    // Aspect Ratio Lock and Dimension synchronization
    txtWidth.addEventListener('input', () => {
        if (chkLockRatio.checked && aspectRatio) {
            txtHeight.value = Math.round(txtWidth.value / aspectRatio);
        }
    });

    txtHeight.addEventListener('input', () => {
        if (chkLockRatio.checked && aspectRatio) {
            txtWidth.value = Math.round(txtHeight.value * aspectRatio);
        }
    });

    // Toolbar zoom / rotate
    document.getElementById('btnZoomIn').addEventListener('click', () => {
        if (cropper) {
            cropper.zoom(0.1);
        }
    });
    document.getElementById('btnZoomOut').addEventListener('click', () => {
        if (cropper) {
            cropper.zoom(-0.1);
        }
    });
    document.getElementById('btnRotateLeft').addEventListener('click', () => {
        if (cropper) {
            markTransformEdit('Rotate');
            cropper.rotate(-90);
            scheduleExpandContainerToCanvas();
        }
    });
    document.getElementById('btnRotateRight').addEventListener('click', () => {
        if (cropper) {
            markTransformEdit('Rotate');
            cropper.rotate(90);
            scheduleExpandContainerToCanvas();
        }
    });
    document.getElementById('btnFlipH').addEventListener('click', () => {
        if (cropper) {
            markTransformEdit('Flip Horizontal');
            scaleX = -scaleX;
            cropper.scaleX(scaleX);
        }
    });
    document.getElementById('btnFlipV').addEventListener('click', () => {
        if (cropper) {
            markTransformEdit('Flip Vertical');
            scaleY = -scaleY;
            cropper.scaleY(scaleY);
        }
    });
    document.getElementById('btnReset').addEventListener('click', () => {
        toggleZoomView();
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
        qualityVal.textContent = rngQuality.value;
    });

    // Apply manual resize dimension changes (destructively crops and resizes on screen)
    btnApplyResize.addEventListener('click', () => {
        if (!cropper) return;
        const targetWidth = parseInt(txtWidth.value, 10);
        const targetHeight = parseInt(txtHeight.value, 10);
        if (targetWidth > 0 && targetHeight > 0) {
            // Push current source to undo stack before mutation
            undoStack.push(imageEl.src);

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

            // Export cropped & resized image to base64
            let canvas = cropper.getCroppedCanvas({
                width: targetWidth,
                height: targetHeight,
                imageSmoothingEnabled: true,
                imageSmoothingQuality: 'high'
            });

            // Apply circular mask if circle crop is active
            if (isCircular) {
                const circleCanvas = document.createElement('canvas');
                circleCanvas.width = canvas.width;
                circleCanvas.height = canvas.height;
                const ctx = circleCanvas.getContext('2d');
                
                ctx.beginPath();
                ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(canvas, 0, 0);
                canvas = circleCanvas;
            }

            const newSrc = canvas.toDataURL();
            initEditor(newSrc);
            notifyDocumentChanged('Resize');
            vscode.postMessage({ command: 'show-toast', text: 'Resize applied. Press Ctrl+Z to undo.' });
        }
    });

    // Apply 1:1 original crop selections (destructively crops on screen keeping original selection pixels scale)
    btnApplyCrop.addEventListener('click', () => {
        if (!cropper) return;
        if (!chkEnableCrop.checked || !cropper.cropped) {
            vscode.postMessage({ command: 'show-toast', text: 'Please enable crop and select a region first.' });
            return;
        }

        // Push current source to undo stack before mutation
        undoStack.push(imageEl.src);

        // Get cropped canvas at original selection pixel bounds
        let canvas = cropper.getCroppedCanvas({
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high'
        });

        // Apply circular mask if circle crop is active
        if (isCircular) {
            const circleCanvas = document.createElement('canvas');
            circleCanvas.width = canvas.width;
            circleCanvas.height = canvas.height;
            const ctx = circleCanvas.getContext('2d');
            
            ctx.beginPath();
            ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(canvas, 0, 0);
            canvas = circleCanvas;
        }

        const newSrc = canvas.toDataURL();
        initEditor(newSrc);
        
        // Reset crop mode checkbox
        chkEnableCrop.checked = false;
        syncCropPresetUI();

        notifyDocumentChanged('Crop');
        vscode.postMessage({ command: 'show-toast', text: 'Crop applied. Press Ctrl+Z to undo.' });
    });

    // Hook up saving triggers
    const btnSave = document.getElementById('btnSave');
    const btnExport = document.getElementById('btnExport');

    btnSave.addEventListener('click', () => triggerSave('save'));
    btnExport.addEventListener('click', () => triggerSave('export'));

    // Clipboard Copy Engine
    function copyImageToClipboard() {
        if (!cropper) return;
        
        window.editorApi.getCanvasBlob((blob) => {
            if (!blob) {
                vscode.postMessage({ command: 'show-toast', text: 'No image data to copy' });
                return;
            }
            
            navigator.clipboard.write([
                new ClipboardItem({
                    [blob.type]: blob
                })
            ]).then(() => {
                vscode.postMessage({ command: 'show-toast', text: 'Image copied to clipboard!' });
            }).catch((err) => {
                vscode.postMessage({ command: 'show-toast', text: 'Clipboard write failed: ' + err });
            });
        });
    }

    // ── Color Picker (Option/Alt key) ──────────────────────────────────────

    function toHexByte(n) {
        return n.toString(16).padStart(2, '0').toUpperCase();
    }

    function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;

        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / d + 2) / 6; break;
                case b: h = ((r - g) / d + 4) / 6; break;
            }
        }

        return {
            h: Math.round(h * 360),
            s: Math.round(s * 100),
            l: Math.round(l * 100)
        };
    }

    function rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;

        if (max !== min) {
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / d + 2) / 6; break;
                case b: h = ((r - g) / d + 4) / 6; break;
            }
        }

        return {
            h: Math.round(h * 360),
            s: max === 0 ? 0 : Math.round((d / max) * 100),
            v: Math.round(max * 100)
        };
    }

    function rgbToCmyk(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const k = 1 - Math.max(r, g, b);
        if (k >= 0.999) {
            return { c: 0, m: 0, y: 0, k: 100 };
        }
        const c = (1 - r - k) / (1 - k);
        const m = (1 - g - k) / (1 - k);
        const y = (1 - b - k) / (1 - k);
        return {
            c: Math.round(c * 100),
            m: Math.round(m * 100),
            y: Math.round(y * 100),
            k: Math.round(k * 100)
        };
    }

    function buildColorFormats(r, g, b, a) {
        const alpha = a / 255;
        const hex = a < 255
            ? `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}${toHexByte(a)}`
            : `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
        const hsl = rgbToHsl(r, g, b);
        const hsv = rgbToHsv(r, g, b);
        const cmyk = rgbToCmyk(r, g, b);

        return [
            { label: 'HEX', value: hex },
            { label: 'RGB', value: `rgb(${r}, ${g}, ${b})` },
            { label: 'RGBA', value: `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})` },
            { label: 'HSL', value: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` },
            { label: 'HSV', value: `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)` },
            { label: 'CMYK', value: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)` }
        ];
    }

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

        const onImage = xInImage >= 0 && xInImage <= imageData.width && yInImage >= 0 && yInImage <= imageData.height;
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
        if (isColorPickerMode) {
            return;
        }

        isColorPickerMode = true;
        lastPickerPreview = '';
        ensureColorPickerCanvas();
        workspace.classList.add('color-picker-active');
        if (cropper) {
            cropper.setDragMode('none');
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

        if (cropper && !isSpacePressed) {
            cropper.setDragMode('crop');
        } else if (cropper && isSpacePressed) {
            cropper.setDragMode('none');
        }
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

        const formats = buildColorFormats(color.r, color.g, color.b, color.a);
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
        const formats = buildColorFormats(r, g, b, a);

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
                <span class="color-format-copy">복사</span>
            `;
            btn.addEventListener('click', () => {
                copyTextToClipboard(fmt.value).then(() => {
                    colorFormatList.querySelectorAll('.color-format-item').forEach((el) => el.classList.remove('copied'));
                    btn.classList.add('copied');
                    btn.querySelector('.color-format-copy').textContent = '복사됨';
                    vscode.postMessage({ command: 'show-toast', text: `${fmt.label} 복사됨: ${fmt.value}` });
                }).catch(() => {
                    vscode.postMessage({ command: 'show-toast', text: '클립보드 복사에 실패했습니다.' });
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
        if (e.key !== 'Alt' || e.repeat || isTypingTarget(document.activeElement)) {
            return;
        }
        if (colorModal && colorModal.style.display === 'flex') {
            return;
        }
        isOptionPressed = true;
        startColorPickerMode();
    });

    document.addEventListener('keyup', (e) => {
        if (e.key !== 'Alt') {
            return;
        }
        isOptionPressed = false;
        endColorPickerMode();
    });

    window.addEventListener('blur', () => {
        isOptionPressed = false;
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
        if (isOptionPressed) {
            startColorPickerMode();
        }
    }

    // Selection Erase & Eyedropper Color-Fill Engine
    function eraseSelection() {
        if (!cropper) return;
        if (!chkEnableCrop.checked || !cropper.cropped) {
            vscode.postMessage({ command: 'show-toast', text: 'Please select a crop region to erase first.' });
            return;
        }

        const data = cropper.getData();
        isEyedropperActive = true;
        endColorPickerMode();
        eraseTargetBounds = data;
        
        // Cache offscreen representation of the image
        eyedropperCanvas = document.createElement('canvas');
        eyedropperCanvas.width = originalWidth;
        eyedropperCanvas.height = originalHeight;
        eyedropperCtx = eyedropperCanvas.getContext('2d');
        eyedropperCtx.drawImage(imageEl, 0, 0);

        lastSampledColor = null;

        if (eyedropperTooltip) {
            eyedropperTooltip.style.display = 'block';
            eyedropperTooltip.style.left = '-1000px'; // initially position offscreen to avoid jump
            eyedropperTooltip.style.top = '-1000px';
        }

        // Set visual cursor classes
        workspace.classList.add('eyedropper-active');
        vscode.postMessage({ 
            command: 'show-toast', 
            text: 'Eyedropper active. Click on the image to fill with color, or click on the grid to make it transparent.' 
        });
    }

    // Workspace mousemove handler during capture phase to implement Eyedropper real-time live preview and tooltip tracking
    workspace.addEventListener('mousemove', (e) => {
        if (!isEyedropperActive || !eraseTargetBounds) return;

        // Position tooltip to follow the cursor (translate offset slightly)
        if (eyedropperTooltip) {
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

        // Backup current source to undo stack before erase/fill mutation
        undoStack.push(imageEl.src);

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
            if (isCircular) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(eraseTargetBounds.x + eraseTargetBounds.width / 2, eraseTargetBounds.y + eraseTargetBounds.height / 2, eraseTargetBounds.width / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.clearRect(eraseTargetBounds.x, eraseTargetBounds.y, eraseTargetBounds.width, eraseTargetBounds.height);
                ctx.fillRect(eraseTargetBounds.x, eraseTargetBounds.y, eraseTargetBounds.width, eraseTargetBounds.height);
                ctx.restore();
            } else {
                ctx.clearRect(eraseTargetBounds.x, eraseTargetBounds.y, eraseTargetBounds.width, eraseTargetBounds.height);
                ctx.fillRect(eraseTargetBounds.x, eraseTargetBounds.y, eraseTargetBounds.width, eraseTargetBounds.height);
            }

            vscode.postMessage({ command: 'show-toast', text: 'Selection filled with color. Press Ctrl+Z to undo.' });
        } else {
            // Erase target marquee selection to transparent
            if (isCircular) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(eraseTargetBounds.x + eraseTargetBounds.width / 2, eraseTargetBounds.y + eraseTargetBounds.height / 2, eraseTargetBounds.width / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.clearRect(eraseTargetBounds.x, eraseTargetBounds.y, eraseTargetBounds.width, eraseTargetBounds.height);
                ctx.restore();
            } else {
                ctx.clearRect(eraseTargetBounds.x, eraseTargetBounds.y, eraseTargetBounds.width, eraseTargetBounds.height);
            }

            vscode.postMessage({ command: 'show-toast', text: 'Selection erased to transparent. Press Ctrl+Z to undo.' });
        }

        const newSrc = canvas.toDataURL();
        initEditor(newSrc);
        notifyDocumentChanged(isClickOnImage ? 'Fill Selection' : 'Erase Selection');

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

    // Close menu when clicking elsewhere
    document.addEventListener('click', () => {
        contextMenu.style.display = 'none';
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
        if (cropper) {
            markTransformEdit('Flip Horizontal');
            scaleX = -scaleX;
            cropper.scaleX(scaleX);
        }
    });

    document.getElementById('ctxFlipV').addEventListener('click', (e) => {
        e.stopPropagation();
        contextMenu.style.display = 'none';
        if (cropper) {
            markTransformEdit('Flip Vertical');
            scaleY = -scaleY;
            cropper.scaleY(scaleY);
        }
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
        document.getElementById('btnReset').click();
    });

    // Global keyboard listener
    document.addEventListener('keydown', (e) => {
        // Guard input elements so typing is not hijacked
        const activeEl = document.activeElement;
        const isInput = activeEl && (
            activeEl.tagName === 'INPUT' || 
            activeEl.tagName === 'SELECT' || 
            activeEl.tagName === 'TEXTAREA' || 
            activeEl.isContentEditable
        );

        if (isInput) {
            // Still allow Save (Cmd+S) and Undo (Cmd+Z) inside input focus
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                triggerSave('save');
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                e.preventDefault();
                if (isDocumentEditor) {
                    vscode.postMessage({ command: 'undo-request' });
                } else {
                    performUndo();
                }
            }
            return;
        }

        // Save: Cmd+S / Ctrl+S
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            triggerSave('save');
            return;
        }

        // Undo: Cmd+Z / Ctrl+Z
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
            e.preventDefault();
            if (isDocumentEditor) {
                vscode.postMessage({ command: 'undo-request' });
            } else {
                performUndo();
            }
            return;
        }

        // Copy: Cmd+C / Ctrl+C
        if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
            e.preventDefault();
            copyImageToClipboard();
            return;
        }

        // Selection Erase: Delete / Backspace
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (chkEnableCrop.checked && cropper && cropper.cropped) {
                e.preventDefault();
                eraseSelection();
            }
            return;
        }

        // Zoom In: Cmd/Ctrl + = or Cmd/Ctrl + + or simple key +
        if (((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) || e.key === '+') {
            e.preventDefault();
            if (cropper) {
                cropper.zoom(0.1);
            }
            return;
        }

        // Zoom Out: Cmd/Ctrl + - or Cmd/Ctrl + _ or simple key -
        if (((e.metaKey || e.ctrlKey) && (e.key === '-' || e.key === '_')) || e.key === '-') {
            e.preventDefault();
            if (cropper) {
                cropper.zoom(-0.1);
            }
            return;
        }

        // Rotate Left: [ or Cmd/Ctrl + [
        if (((e.metaKey || e.ctrlKey) && e.key === '[') || e.key === '[') {
            e.preventDefault();
            if (cropper) {
                markTransformEdit('Rotate');
                cropper.rotate(-90);
                scheduleExpandContainerToCanvas();
            }
            return;
        }

        // Rotate Right: ] or Cmd/Ctrl + ]
        if (((e.metaKey || e.ctrlKey) && e.key === ']') || e.key === ']') {
            e.preventDefault();
            if (cropper) {
                markTransformEdit('Rotate');
                cropper.rotate(90);
                scheduleExpandContainerToCanvas();
            }
            return;
        }

        // Toggle 100% ↔ initial fit: Cmd/Ctrl + 0
        if ((e.metaKey || e.ctrlKey) && e.key === '0') {
            e.preventDefault();
            toggleZoomView();
            return;
        }

        // Select All (Full image crop selection): Cmd/Ctrl + A
        if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
            e.preventDefault();
            if (cropper) {
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
                presetButtons.forEach(b => b.classList.remove('active'));
                const freeBtn = document.querySelector('#cropPresets button[data-ratio="NaN"]');
                if (freeBtn) freeBtn.classList.add('active');
            }
            return;
        }

        // Escape: close color modal, clear selection, cancel eyedropper, or uncheck crop box
        if (e.key === 'Escape') {
            e.preventDefault();
            if (colorModal && colorModal.style.display === 'flex') {
                hideColorModal();
                return;
            }
            if (isColorPickerMode) {
                isOptionPressed = false;
                endColorPickerMode();
                return;
            }
            if (isEyedropperActive && eraseTargetBounds) {
                // Backup current source to undo stack before erase mutation
                undoStack.push(imageEl.src);

                const canvas = document.createElement('canvas');
                canvas.width = originalWidth;
                canvas.height = originalHeight;
                const ctx = canvas.getContext('2d');

                // Draw current image
                ctx.drawImage(imageEl, 0, 0);

                // Erase target marquee selection to transparent
                if (isCircular) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(eraseTargetBounds.x + eraseTargetBounds.width / 2, eraseTargetBounds.y + eraseTargetBounds.height / 2, eraseTargetBounds.width / 2, 0, Math.PI * 2);
                    ctx.clip();
                    ctx.clearRect(eraseTargetBounds.x, eraseTargetBounds.y, eraseTargetBounds.width, eraseTargetBounds.height);
                    ctx.restore();
                } else {
                    ctx.clearRect(eraseTargetBounds.x, eraseTargetBounds.y, eraseTargetBounds.width, eraseTargetBounds.height);
                }

                const newSrc = canvas.toDataURL();
                initEditor(newSrc);
                notifyDocumentChanged('Erase Selection');

                endEyedropper();

                // Reset crop mode checkbox
                chkEnableCrop.checked = false;
                syncCropPresetUI();

                vscode.postMessage({ command: 'show-toast', text: 'Selection erased to transparent. Press Ctrl+Z to undo.' });
                return;
            }
            if (cropper) {
                chkEnableCrop.checked = false;
                syncCropPresetUI();
                cropper.clear();
                txtWidth.value = originalWidth;
                txtHeight.value = originalHeight;
                isCircular = false;
                presetButtons.forEach(b => b.classList.remove('active'));
            }
            return;
        }

        // Enter: apply crop selection if crop mode is active
        if (e.key === 'Enter') {
            if (chkEnableCrop.checked && cropper && cropper.cropped) {
                e.preventDefault();
                btnApplyCrop.click();
            }
            return;
        }
    });

    function performUndo(options) {
        const fromHost = options && options.fromHost;
        if (undoStack.length > 0) {
            const prevSrc = undoStack.pop();
            initEditor(prevSrc);
            if (!fromHost) {
                vscode.postMessage({ command: 'show-toast', text: 'Undo successful' });
            }
        } else if (!fromHost) {
            vscode.postMessage({ command: 'show-toast', text: 'Nothing to undo' });
        }
    }

    function triggerSave(type) {
        if (window.editorApi && window.editorApi.getCanvasBlob) {
            window.editorApi.getCanvasBlob((blob) => {
                if (!blob) return;
                const reader = new FileReader();
                reader.onloadend = () => {
                    vscode.postMessage({
                        command: type === 'save' ? 'save-image' : 'export-image',
                        arrayBuffer: reader.result,
                        mimeType: blob.type
                    });
                };
                reader.readAsArrayBuffer(blob);
            });
        }
    }

    // Expose variables for save & import protocols
    window.editorApi = {
        initEditor,
        getCanvasBlob: function(callback) {
            if (!cropper) return;
            const format = selFormat.value;
            const quality = parseFloat(rngQuality.value) / 100;
            const targetWidth = parseInt(txtWidth.value, 10) || originalWidth;
            const targetHeight = parseInt(txtHeight.value, 10) || originalHeight;

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

            // Apply cropping with resizing
            let canvas = cropper.getCroppedCanvas({
                width: targetWidth,
                height: targetHeight,
                imageSmoothingEnabled: true,
                imageSmoothingQuality: 'high'
            });

            // Apply circular mask if circle crop is active
            if (isCircular) {
                const circleCanvas = document.createElement('canvas');
                circleCanvas.width = canvas.width;
                circleCanvas.height = canvas.height;
                const ctx = circleCanvas.getContext('2d');
                
                ctx.beginPath();
                ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(canvas, 0, 0);
                canvas = circleCanvas;
            }

            canvas.toBlob(callback, format, quality);
        }
    };
})();
