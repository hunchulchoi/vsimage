(function() {
    const vscode = acquireVsCodeApi();
    const imageEl = document.getElementById('image');
    const sidebar = document.getElementById('sidebar');
    const toolbar = document.getElementById('toolbar');
    
    const txtWidth = document.getElementById('txtWidth');
    const txtHeight = document.getElementById('txtHeight');
    const chkLockRatio = document.getElementById('chkLockRatio');
    const btnApplyResize = document.getElementById('btnApplyResize');

    const selFormat = document.getElementById('selFormat');
    const qualitySection = document.getElementById('qualitySection');
    const rngQuality = document.getElementById('rngQuality');
    const qualityVal = document.getElementById('qualityVal');

    let cropper = null;
    let originalWidth = 0;
    let originalHeight = 0;
    let aspectRatio = 0;
    let isCircular = false;
    let undoStack = [];
    let initialImageSrc = '';

    const lblDimensions = document.getElementById('lblDimensions');
    const lblFilename = document.getElementById('lblFilename');

    const dashboard = document.getElementById('dashboard');
    const workspace = document.getElementById('workspace');
    const cardImport = document.getElementById('cardImport');
    const filePicker = document.getElementById('filePicker');
    const cardPaste = document.getElementById('cardPaste');

    // Mode dispatcher
    if (!imageEl || !imageEl.getAttribute('src') || imageEl.getAttribute('src') === '') {
        // Empty editor launcher mode
        dashboard.style.display = 'flex';
        workspace.style.display = 'none';
    } else {
        // Normal file editor mode
        dashboard.style.display = 'none';
        workspace.style.display = 'flex';
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
            workspace.style.display = 'flex';
            initEditor(event.target.result);
        };
        reader.readAsDataURL(file);
    }

    function initEditor(src) {
        if (!initialImageSrc) {
            initialImageSrc = src;
        }
        imageEl.src = src;
        
        imageEl.onload = () => {
            originalWidth = imageEl.naturalWidth;
            originalHeight = imageEl.naturalHeight;
            aspectRatio = originalWidth / originalHeight;

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

            // Create Cropper
            cropper = new Cropper(imageEl, {
                aspectRatio: NaN,
                viewMode: 1,
                background: false,
                responsive: true,
                autoCrop: false, // Clean preview on startup, crop overlay appears only when dragging or selecting presets
                ready() {
                    if (cropper.cropped) {
                        updateResizeInputsFromCrop();
                    }
                },
                crop(event) {
                    updateResizeInputsFromCrop();
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

    // Preset Aspect Ratios
    const presetButtons = document.querySelectorAll('#cropPresets button');
    presetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            presetButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Activate crop overlay box when preset is selected
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
    document.getElementById('btnZoomIn').addEventListener('click', () => cropper && cropper.zoom(0.1));
    document.getElementById('btnZoomOut').addEventListener('click', () => cropper && cropper.zoom(-0.1));
    document.getElementById('btnRotateLeft').addEventListener('click', () => cropper && cropper.rotate(-90));
    document.getElementById('btnRotateRight').addEventListener('click', () => cropper && cropper.rotate(90));
    document.getElementById('btnReset').addEventListener('click', () => {
        if (cropper) {
            if (imageEl.src !== initialImageSrc) {
                undoStack.push(imageEl.src);
                initEditor(initialImageSrc);
            } else {
                cropper.reset();
            }
            isCircular = false;
            presetButtons.forEach(b => b.classList.remove('active'));
            document.querySelector('#cropPresets button[data-ratio="NaN"]').classList.add('active');
            const face = document.querySelector('.cropper-face');
            if (face) face.style.borderRadius = '0';
        }
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

            // If no crop box is active, temporarily select the entire image bounds to get a clean full-image resize!
            if (!cropper.cropped) {
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
            vscode.postMessage({ command: 'show-toast', text: 'Resize applied. Press Ctrl+Z to undo.' });
        }
    });

    // Hook up saving triggers
    const btnSave = document.getElementById('btnSave');
    const btnExport = document.getElementById('btnExport');

    btnSave.addEventListener('click', () => triggerSave('save'));
    btnExport.addEventListener('click', () => triggerSave('export'));

    // Global keyboard listener for Save (Cmd+S / Ctrl+S) and Undo (Cmd+Z / Ctrl+Z)
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            triggerSave('save');
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
            e.preventDefault();
            performUndo();
        }
    });

    function performUndo() {
        if (undoStack.length > 0) {
            const prevSrc = undoStack.pop();
            initEditor(prevSrc);
            vscode.postMessage({ command: 'show-toast', text: 'Undo successful' });
        } else {
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

            // If no crop box is active, temporarily select the entire image bounds to get a clean full-image resize!
            if (!cropper.cropped) {
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
