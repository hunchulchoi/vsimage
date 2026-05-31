import * as vscode from 'vscode';
import * as path from 'path';

interface ImageDataResponse {
    buffer: Uint8Array;
    mimeType: string;
}

interface PendingImageRequest {
    resolve: (value: ImageDataResponse) => void;
    reject: (reason?: unknown) => void;
}

export class ImageCustomEditorProvider implements vscode.CustomEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new ImageCustomEditorProvider(context);
        return vscode.window.registerCustomEditorProvider(ImageCustomEditorProvider.viewType, provider);
    }

    private static readonly viewType = 'vsimage.editor';

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<vscode.CustomDocument>>();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    private readonly webviews = new Map<string, vscode.WebviewPanel>();
    private readonly pendingImageRequests = new Map<number, PendingImageRequest>();
    private nextRequestId = 0;

    constructor(private readonly context: vscode.ExtensionContext) {}

    async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        return {
            uri,
            dispose: () => {}
        };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const documentKey = document.uri.toString();
        this.webviews.set(documentKey, webviewPanel);

        webviewPanel.onDidDispose(() => {
            this.webviews.delete(documentKey);
        });

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
            ]
        };

        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document.uri, true);

        webviewPanel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'save-image':
                    try {
                        if (message.arrayBuffer) {
                            await vscode.workspace.fs.writeFile(
                                document.uri,
                                new Uint8Array(message.arrayBuffer as ArrayBuffer)
                            );
                        } else {
                            await this.saveCustomDocument(document, new vscode.CancellationTokenSource().token);
                        }
                        vscode.window.showInformationMessage('Image saved successfully.');
                    } catch {
                        vscode.window.showErrorMessage('Failed to save image.');
                    }
                    return;
                case 'export-image':
                    await this.exportImage(message.arrayBuffer, message.mimeType);
                    return;
                case 'document-changed':
                    this.notifyDocumentChanged(document, message.label);
                    return;
                case 'image-data-response':
                    this.resolveImageDataRequest(message.requestId, message.arrayBuffer, message.mimeType);
                    return;
                case 'undo-request':
                    await vscode.commands.executeCommand('undo');
                    return;
                case 'show-toast':
                    vscode.window.showInformationMessage(message.text);
                    return;
            }
        });
    }

    async saveCustomDocument(document: vscode.CustomDocument, cancellation: vscode.CancellationToken): Promise<void> {
        const panel = this.webviews.get(document.uri.toString());
        if (!panel) {
            return;
        }

        const { buffer } = await this.requestImageData(panel.webview, cancellation);
        await vscode.workspace.fs.writeFile(document.uri, buffer);
    }

    async saveCustomDocumentAs(
        document: vscode.CustomDocument,
        destination: vscode.Uri,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        const panel = this.webviews.get(document.uri.toString());
        if (!panel) {
            const data = await vscode.workspace.fs.readFile(document.uri);
            await vscode.workspace.fs.writeFile(destination, data);
            return;
        }

        const { buffer } = await this.requestImageData(panel.webview, cancellation);
        await vscode.workspace.fs.writeFile(destination, buffer);
    }

    async revertCustomDocument(document: vscode.CustomDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        const panel = this.webviews.get(document.uri.toString());
        if (!panel) {
            return;
        }

        const imageUri = panel.webview.asWebviewUri(document.uri);
        panel.webview.postMessage({
            command: 'revert-document',
            src: imageUri.toString(),
            filename: path.basename(document.uri.fsPath)
        });
    }

    async backupCustomDocument(
        document: vscode.CustomDocument,
        context: vscode.CustomDocumentBackupContext,
        cancellation: vscode.CancellationToken
    ): Promise<vscode.CustomDocumentBackup> {
        const panel = this.webviews.get(document.uri.toString());
        const backupUri = context.destination;

        if (panel) {
            const { buffer } = await this.requestImageData(panel.webview, cancellation);
            await vscode.workspace.fs.writeFile(backupUri, buffer);
        } else {
            const data = await vscode.workspace.fs.readFile(document.uri);
            await vscode.workspace.fs.writeFile(backupUri, data);
        }

        return {
            id: backupUri.toString(),
            delete: async () => {
                try {
                    await vscode.workspace.fs.delete(backupUri);
                } catch {
                    // Backup may already have been cleaned up.
                }
            }
        };
    }

    private notifyDocumentChanged(document: vscode.CustomDocument, label = 'Edit'): void {
        this._onDidChangeCustomDocument.fire({
            document,
            label,
            undo: async () => {
                const panel = this.webviews.get(document.uri.toString());
                panel?.webview.postMessage({ command: 'perform-undo' });
            },
            redo: async () => {
                // Redo is not supported in the webview editor yet.
            }
        });
    }

    private requestImageData(
        webview: vscode.Webview,
        cancellation: vscode.CancellationToken
    ): Promise<ImageDataResponse> {
        return new Promise((resolve, reject) => {
            const requestId = ++this.nextRequestId;

            const cancellationListener = cancellation.onCancellationRequested(() => {
                this.pendingImageRequests.delete(requestId);
                cancellationListener.dispose();
                reject(new Error('Save cancelled'));
            });

            this.pendingImageRequests.set(requestId, {
                resolve: (value) => {
                    cancellationListener.dispose();
                    resolve(value);
                },
                reject: (reason) => {
                    cancellationListener.dispose();
                    reject(reason);
                }
            });

            webview.postMessage({ command: 'request-image-data', requestId });
        });
    }

    private resolveImageDataRequest(
        requestId: number,
        arrayBuffer: ArrayBuffer | null | undefined,
        mimeType: string
    ): void {
        const pending = this.pendingImageRequests.get(requestId);
        if (!pending) {
            return;
        }

        this.pendingImageRequests.delete(requestId);

        if (!arrayBuffer) {
            pending.reject(new Error('No image data available'));
            return;
        }

        pending.resolve({
            buffer: new Uint8Array(arrayBuffer),
            mimeType: mimeType || 'image/png'
        });
    }

    private async exportImage(buffer: ArrayBuffer, mimeType: string) {
        const extension = mimeType.split('/')[1] || 'png';
        const options: vscode.SaveDialogOptions = {
            filters: {
                'Images': [extension]
            },
            saveLabel: 'Export Image'
        };

        const fileUri = await vscode.window.showSaveDialog(options);
        if (fileUri) {
            await vscode.workspace.fs.writeFile(fileUri, new Uint8Array(buffer));
            vscode.window.showInformationMessage(`Image exported successfully to ${path.basename(fileUri.fsPath)}`);
        }
    }

    public createUntitledEditor(): void {
        const panel = vscode.window.createWebviewPanel(
            'vsimage.untitled',
            'Untitled Image Editor',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
                ]
            }
        );

        panel.webview.html = this.getHtmlForWebview(panel.webview, undefined, false);

        panel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'save-image':
                    await this.exportImage(message.arrayBuffer, message.mimeType);
                    return;
                case 'export-image':
                    await this.exportImage(message.arrayBuffer, message.mimeType);
                    return;
                case 'show-toast':
                    vscode.window.showInformationMessage(message.text);
                    return;
            }
        });
    }

    private getHtmlForWebview(
        webview: vscode.Webview,
        imageUri?: vscode.Uri,
        isDocumentEditor = false
    ): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'editor.js')));
        const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'editor.css')));
        const cropperJsUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'cropper.min.js')));
        const cropperCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'cropper.min.css')));
        const imgWebviewUri = imageUri ? webview.asWebviewUri(imageUri) : '';
        const filename = imageUri ? path.basename(imageUri.fsPath) : 'Untitled';

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};">
                <link href="${cropperCssUri}" rel="stylesheet">
                <link href="${styleUri}" rel="stylesheet">
            </head>
            <body>
                <script>window.__vsimageDocumentEditor = ${isDocumentEditor};</script>
                <div class="editor-wrapper">
                    <!-- Landing Dashboard Empty State -->
                    <div class="dashboard-empty" id="dashboard" style="display: none;">
                        <div style="font-size: 3rem; margin-bottom: 12px;">🖼️</div>
                        <h2 style="margin: 0 0 10px 0;">Start Editing Image</h2>
                        <p style="color: #aaa; margin-bottom: 20px; max-width: 400px; font-size: 0.9rem;">
                            Drag & Drop a local image file here, browse workspace files, or paste an image/screenshot from your clipboard.
                        </p>
                        <div class="empty-card-container">
                            <div class="empty-card" id="cardImport">
                                <h3 style="margin: 0 0 6px 0; font-size: 1rem;">📂 Import File</h3>
                                <p style="font-size: 0.75rem; color: #858585;">Choose an image from disk to open.</p>
                                <input type="file" id="filePicker" accept="image/*" style="display: none;">
                            </div>
                            <div class="empty-card" id="cardPaste">
                                <h3 style="margin: 0 0 6px 0; font-size: 1rem;">📋 Paste Image</h3>
                                <p style="font-size: 0.75rem; color: #858585;">Press <span class="kbd">Cmd + V</span> or <span class="kbd">Ctrl + V</span> to load clipboard image.</p>
                            </div>
                        </div>
                    </div>

                    <!-- Workspace Area (grid: ruler-corner | rulerH / rulerV | scrollable canvas) -->
                    <div class="canvas-workspace" id="workspace" style="display: none;">
                        <div class="ruler-corner" id="rulerCorner"></div>
                        <canvas class="ruler ruler-h" id="rulerH"></canvas>
                        <canvas class="ruler ruler-v" id="rulerV"></canvas>
                        <!-- Scrollable canvas viewport -->
                        <div class="canvas-scroll-area" id="canvasScrollArea">
                            <div class="canvas-scroll-content" id="canvasScrollContent">
                                <div class="image-container" id="imageContainer">
                                    <img id="image" ${imgWebviewUri ? `src="${imgWebviewUri}"` : ''}>
                                </div>
                            </div>
                        </div>
                        <div class="canvas-toolbar-layer">
                            <div class="floating-toolbar" id="toolbar" style="display: none;">
                                <button class="tb-btn" id="btnZoomOut" title="Zoom Out (-)">-</button>
                                <span class="zoom-indicator" id="lblZoomPercent">--%</span>
                                <button class="tb-btn" id="btnZoomIn" title="Zoom In (+)">+</button>
                                <div class="tb-divider"></div>
                                <button class="tb-btn" id="btnRotateLeft" title="Rotate Left ([)">⟲</button>
                                <button class="tb-btn" id="btnRotateRight" title="Rotate Right (])">⟳</button>
                                <button class="tb-btn" id="btnFlipH" title="Flip Horizontal">↔</button>
                                <button class="tb-btn" id="btnFlipV" title="Flip Vertical">↕</button>
                                <div class="tb-divider"></div>
                                <button class="tb-btn" id="btnReset" title="100% ↔ Fit (Ctrl+0)">Reset</button>
                            </div>
                        </div>
                    </div>

                    <!-- Control Panel -->
                    <div class="sidebar-controls" id="sidebar" style="display: none;">
                        <div class="section-card">
                            <div class="section-title">📄 Properties</div>
                            <div style="font-size: 0.8rem; line-height: 1.5; color: #aaa;">
                                <div>Name: <span id="lblFilename">${filename}</span></div>
                                <div>Dimensions: <span id="lblDimensions">0 x 0</span> px</div>
                            </div>
                        </div>

                        <div class="section-card">
                            <div class="section-title" style="display: flex; align-items: center; justify-content: space-between;">
                                <span>✂️ Crop Presets</span>
                                <div style="display: flex; align-items: center; gap: 4px; text-transform: none;">
                                    <input type="checkbox" id="chkEnableCrop" style="margin: 0; cursor: pointer;">
                                    <label for="chkEnableCrop" style="font-size: 0.75rem; user-select: none; cursor: pointer; color: #ccc;">Enable</label>
                                </div>
                            </div>
                            <div class="btn-grid" id="cropPresets" style="margin-bottom: 8px;">
                                <button class="btn-secondary" data-ratio="NaN">Free</button>
                                <button class="btn-secondary" data-ratio="1">1:1</button>
                                <button class="btn-secondary" data-ratio="1.77777777778">16:9</button>
                                <button class="btn-secondary" data-ratio="1.33333333333">4:3</button>
                                <button class="btn-secondary" data-circle="true">Circle</button>
                            </div>
                            <button class="btn-accent" id="btnApplyCrop">Apply Crop</button>
                        </div>

                        <div class="section-card">
                            <div class="section-title">📐 Resize</div>
                            <div class="control-group">
                                <div class="input-row">
                                    <div>
                                        <label>Width</label>
                                        <input type="number" id="txtWidth" class="form-control">
                                    </div>
                                    <div>
                                        <label>Height</label>
                                        <input type="number" id="txtHeight" class="form-control">
                                    </div>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 10px;">
                                <input type="checkbox" id="chkLockRatio" checked>
                                <label for="chkLockRatio" style="font-size: 0.75rem; user-select: none;">Lock Aspect Ratio</label>
                            </div>
                            <button class="btn-accent" id="btnApplyResize">Apply Resize</button>
                        </div>

                        <div class="section-card" style="margin-top: auto;">
                            <div class="section-title">💾 Save & Export</div>
                            <div class="control-group">
                                <label>Export Format</label>
                                <select id="selFormat" class="form-control">
                                    <option value="image/png">PNG</option>
                                    <option value="image/jpeg">JPEG</option>
                                    <option value="image/webp">WebP</option>
                                </select>
                            </div>
                            <div class="control-group" id="qualitySection" style="display: none;">
                                <label>Quality (<span id="qualityVal">80</span>%)</label>
                                <div class="slider-row">
                                    <input type="range" id="rngQuality" min="1" max="100" value="80">
                                </div>
                            </div>
                            <button class="btn-accent" id="btnSave" style="background-color: #28a745; margin-bottom: 8px;">Save</button>
                            <button class="btn-accent" id="btnExport" style="background-color: #4e4e4e;">Export As...</button>
                        </div>
                    </div>
                </div>

                <!-- Custom Context Menu -->
                <div class="context-menu" id="contextMenu">
                    <div class="context-menu-item" id="ctxCopy">
                        <span>📋 Copy Image</span>
                        <span class="context-menu-shortcut">Ctrl+C</span>
                    </div>
                    <div class="context-menu-item" id="ctxErase">
                        <span>✂️ Delete Selection</span>
                        <span class="context-menu-shortcut">Del</span>
                    </div>
                    <div class="context-menu-divider"></div>
                    <div class="context-menu-item" id="ctxFlipH">
                        <span>↔️ Flip Horizontal</span>
                    </div>
                    <div class="context-menu-item" id="ctxFlipV">
                        <span>↕️ Flip Vertical</span>
                    </div>
                    <div class="context-menu-divider"></div>
                    <div class="context-menu-item" id="ctxSave">
                        <span>💾 Save</span>
                        <span class="context-menu-shortcut">Ctrl+S</span>
                    </div>
                    <div class="context-menu-item" id="ctxUndo">
                        <span>↩️ Undo</span>
                        <span class="context-menu-shortcut">Ctrl+Z</span>
                    </div>
                    <div class="context-menu-item" id="ctxReset">
                        <span>🧹 Reset</span>
                        <span class="context-menu-shortcut">Ctrl+0</span>
                    </div>
                </div>

                <!-- Floating Eyedropper Tooltip -->
                <div id="eyedropperTooltip" class="eyedropper-tooltip" style="display: none;">채울 색을 선택해주세요</div>

                <!-- Color Picker Tooltip (Option key) -->
                <div id="colorPickerTooltip" class="color-picker-tooltip" style="display: none;">
                    <span class="color-picker-swatch" id="colorPickerSwatch"></span>
                    <span id="colorPickerPreview">#000000</span>
                </div>

                <!-- Color Info Modal -->
                <div id="colorModal" class="color-modal" style="display: none;">
                    <div class="color-modal-backdrop" id="colorModalBackdrop"></div>
                    <div class="color-modal-panel">
                        <div class="color-modal-header">
                            <span class="color-modal-title">색상 정보</span>
                            <button type="button" class="color-modal-close" id="colorModalClose" title="닫기">✕</button>
                        </div>
                        <div class="color-modal-preview">
                            <div class="color-modal-swatch" id="colorModalSwatch"></div>
                            <div class="color-modal-hint">형식을 클릭하면 클립보드에 복사됩니다</div>
                        </div>
                        <div class="color-format-list" id="colorFormatList"></div>
                    </div>
                </div>

                <!-- Keyboard Shortcut Cheatsheet Overlay -->
                <div id="shortcutOverlay" class="shortcut-overlay" style="display: none;">
                    <div class="shortcut-overlay-title">⌨️ Keyboard Shortcuts</div>
                    <div class="shortcut-grid">
                        <div class="shortcut-row"><span class="shortcut-key">⌘/Ctrl + S</span><span class="shortcut-desc">Save</span></div>
                        <div class="shortcut-row"><span class="shortcut-key">⌘/Ctrl + Z</span><span class="shortcut-desc">Undo</span></div>
                        <div class="shortcut-row"><span class="shortcut-key">⌘/Ctrl + C</span><span class="shortcut-desc">Copy Image</span></div>
                        <div class="shortcut-row"><span class="shortcut-key">⌘/Ctrl + A</span><span class="shortcut-desc">Select All</span></div>
                        <div class="shortcut-row"><span class="shortcut-key">Space + Drag</span><span class="shortcut-desc">Pan Image</span></div>
                        <div class="shortcut-row"><span class="shortcut-key">⌘/Ctrl + 0</span><span class="shortcut-desc">100% ↔ Fit</span></div>
                        <div class="shortcut-row"><span class="shortcut-key">⌘/Ctrl + +</span><span class="shortcut-desc">Zoom In</span></div>
                        <div class="shortcut-row"><span class="shortcut-key">⌘/Ctrl + −</span><span class="shortcut-desc">Zoom Out</span></div>
                        <div class="shortcut-row"><span class="shortcut-key">[ / ]</span><span class="shortcut-desc">Rotate Left / Right</span></div>
                        <div class="shortcut-row"><span class="shortcut-key">Enter</span><span class="shortcut-desc">Apply Crop</span></div>
                        <div class="shortcut-row"><span class="shortcut-key">Del / Bksp</span><span class="shortcut-desc">Erase Selection</span></div>
                        <div class="shortcut-row"><span class="shortcut-key">Esc</span><span class="shortcut-desc">Cancel / Clear</span></div>
                        <div class="shortcut-row"><span class="shortcut-key">⌥/Alt + Click</span><span class="shortcut-desc">Pick Color</span></div>
                    </div>
                </div>

                <script src="${cropperJsUri}"></script>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }
}
