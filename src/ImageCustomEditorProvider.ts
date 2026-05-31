import * as vscode from 'vscode';
import * as path from 'path';

export class ImageCustomEditorProvider implements vscode.CustomEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new ImageCustomEditorProvider(context);
        return vscode.window.registerCustomEditorProvider(ImageCustomEditorProvider.viewType, provider);
    }

    private static readonly viewType = 'vsimage.editor';

    readonly onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<vscode.CustomDocument>>().event;

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
        token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
            ]
        };

        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document.uri);

        webviewPanel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'save-image':
                    this.saveImage(document.uri, message.arrayBuffer);
                    return;
                case 'export-image':
                    this.exportImage(message.arrayBuffer, message.mimeType);
                    return;
                case 'show-toast':
                    vscode.window.showInformationMessage(message.text);
                    return;
            }
        });
    }

    async saveCustomDocument(document: vscode.CustomDocument, cancellation: vscode.CancellationToken): Promise<void> {
        // Will implement in Task 7
    }

    async saveCustomDocumentAs(document: vscode.CustomDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
        // Will implement in Task 7
    }

    async revertCustomDocument(document: vscode.CustomDocument, cancellation: vscode.CancellationToken): Promise<void> {
        // Will implement in Task 7
    }

    async backupCustomDocument(document: vscode.CustomDocument, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
        return {
            id: '',
            delete: () => {}
        };
    }

    private saveImage(uri: vscode.Uri, buffer: ArrayBuffer) {
        vscode.workspace.fs.writeFile(uri, new Uint8Array(buffer));
        vscode.window.showInformationMessage('Image saved successfully.');
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

        panel.webview.html = this.getHtmlForWebview(panel.webview);

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

    private getHtmlForWebview(webview: vscode.Webview, imageUri?: vscode.Uri): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'editor.js')));
        const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'editor.css')));
        const cropperJsUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'cropper.min.js')));
        const cropperCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'cropper.min.css')));
        const imgWebviewUri = imageUri ? webview.asWebviewUri(imageUri) : '';

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

                    <!-- Workspace Area -->
                    <div class="canvas-workspace" id="workspace" style="display: none;">
                        <div class="image-container">
                            <img id="image" ${imgWebviewUri ? `src="${imgWebviewUri}"` : ''}>
                        </div>
                        <div class="floating-toolbar" id="toolbar" style="display: none;">
                            <button class="tb-btn" id="btnZoomOut" title="Zoom Out (-)">-</button>
                            <span class="zoom-indicator" id="lblZoomPercent">100%</span>
                            <button class="tb-btn" id="btnZoomIn" title="Zoom In (+)">+</button>
                            <div class="tb-divider"></div>
                            <button class="tb-btn" id="btnRotateLeft" title="Rotate Left ([)">⟲</button>
                            <button class="tb-btn" id="btnRotateRight" title="Rotate Right (])">⟳</button>
                            <div class="tb-divider"></div>
                            <button class="tb-btn" id="btnReset" title="Reset (Ctrl+0)">Reset</button>
                        </div>
                    </div>

                    <!-- Control Panel -->
                    <div class="sidebar-controls" id="sidebar" style="display: none;">
                        <div class="section-card">
                            <div class="section-title">📄 Properties</div>
                            <div style="font-size: 0.8rem; line-height: 1.5; color: #aaa;">
                                <div>Name: <span id="lblFilename">Untitled</span></div>
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
                            <div class="btn-grid" id="cropPresets">
                                <button class="btn-secondary" data-ratio="NaN">Free</button>
                                <button class="btn-secondary" data-ratio="1">1:1</button>
                                <button class="btn-secondary" data-ratio="1.77777777778">16:9</button>
                                <button class="btn-secondary" data-ratio="1.33333333333">4:3</button>
                                <button class="btn-secondary" data-circle="true">Circle</button>
                            </div>
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

                <script src="${cropperJsUri}"></script>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }
}
