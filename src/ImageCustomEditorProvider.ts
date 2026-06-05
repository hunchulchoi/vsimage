import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { loadMessageBundle, loadPackageNls, resolveLanguageId, t as translate } from './l10n';

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
        return vscode.window.registerCustomEditorProvider(ImageCustomEditorProvider.viewType, provider, {
            webviewOptions: { retainContextWhenHidden: true }
        });
    }

    private static readonly viewType = 'vsimage.editor';

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<vscode.CustomDocument>>();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    private readonly webviews = new Map<string, vscode.WebviewPanel>();
    private readonly pendingImageRequests = new Map<number, PendingImageRequest>();
    private nextRequestId = 0;
    private untitledCounter = 0;

    constructor(private readonly context: vscode.ExtensionContext) {}

    private isUntitledDocument(document: vscode.CustomDocument): boolean {
        return document.uri.scheme === 'untitled';
    }

    private packageNls() {
        return loadPackageNls(this.context.extensionPath, vscode.env.language);
    }

    private getExtensionVersionLabel(): string {
        try {
            const packageJsonPath = path.join(this.context.extensionPath, 'package.json');
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string };
            const version = String(packageJson.version ?? '').trim();
            return version ? `v${version}` : '';
        } catch {
            return '';
        }
    }

    private webviewL10n() {
        return loadMessageBundle(this.context.extensionPath, vscode.env.language);
    }

    private getMimeTypeForUri(uri: vscode.Uri): string {
        switch (path.extname(uri.fsPath).toLowerCase()) {
            case '.png':
                return 'image/png';
            case '.jpg':
            case '.jpeg':
                return 'image/jpeg';
            case '.webp':
                return 'image/webp';
            case '.gif':
                return 'image/gif';
            default:
                return 'application/octet-stream';
        }
    }

    private async readImageAsDataUri(uri: vscode.Uri): Promise<{ src: string; fileSizeBytes: number } | undefined> {
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            if (!bytes.byteLength) {
                return undefined;
            }
            const mime = this.getMimeTypeForUri(uri);
            return {
                src: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
                fileSizeBytes: bytes.byteLength
            };
        } catch {
            return undefined;
        }
    }

    private getWebviewLocalResourceRoots(documentUri?: vscode.Uri): vscode.Uri[] {
        const roots: vscode.Uri[] = [
            vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
        ];

        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            roots.push(folder.uri);
        }

        if (documentUri?.scheme === 'file' && documentUri.fsPath) {
            roots.push(vscode.Uri.file(path.dirname(documentUri.fsPath)));
        }

        return roots;
    }

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

        const isUntitled = this.isUntitledDocument(document);

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: this.getWebviewLocalResourceRoots(isUntitled ? undefined : document.uri)
        };

        if (isUntitled) {
            webviewPanel.title = translate(this.packageNls(), 'untitledPanel.title');
        }

        const initialImage = isUntitled ? undefined : await this.readImageAsDataUri(document.uri);
        const initialImageSrc = initialImage?.src ?? '';

        if (!isUntitled && !initialImageSrc) {
            vscode.window.showErrorMessage(translate(this.packageNls(), 'toast.openImageFailed'));
        }

        webviewPanel.webview.html = this.getHtmlForWebview(
            webviewPanel.webview,
            initialImageSrc,
            initialImage?.fileSizeBytes,
            true,
            isUntitled ? path.basename(document.uri.fsPath) : undefined
        );

        webviewPanel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'save-image':
                case 'save-document':
                    await this.saveDocumentFromWebview(document, webviewPanel.webview);
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

        if (this.isUntitledDocument(document)) {
            const destination = await this.promptImageSaveLocation();
            if (!destination) {
                throw new Error('Save cancelled');
            }
            await this.saveCustomDocumentAs(document, destination, cancellation);
            return;
        }

        const { buffer } = await this.requestImageData(panel.webview, cancellation);
        await vscode.workspace.fs.writeFile(document.uri, buffer);
        this.markDocumentSaved(document, panel, buffer.byteLength);
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
        this.markDocumentSaved(document, panel, buffer.byteLength);
    }

    async revertCustomDocument(document: vscode.CustomDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        const panel = this.webviews.get(document.uri.toString());
        if (!panel) {
            return;
        }

        if (this.isUntitledDocument(document)) {
            this.markDocumentSaved(document, panel);
            panel.webview.postMessage({ command: 'revert-untitled' });
            return;
        }

        const src = await this.readImageAsDataUri(document.uri);
        if (!src) {
            vscode.window.showErrorMessage(translate(this.packageNls(), 'toast.openImageFailed'));
            return;
        }

        this.markDocumentSaved(document, panel, src.fileSizeBytes);
        panel.webview.postMessage({
            command: 'revert-document',
            src: src.src,
            fileSizeBytes: src.fileSizeBytes
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
            try {
                const { buffer } = await this.requestImageData(panel.webview, cancellation);
                await vscode.workspace.fs.writeFile(backupUri, buffer);
            } catch {
                await vscode.workspace.fs.writeFile(backupUri, new Uint8Array());
            }
        } else if (!this.isUntitledDocument(document)) {
            const data = await vscode.workspace.fs.readFile(document.uri);
            await vscode.workspace.fs.writeFile(backupUri, data);
        } else {
            await vscode.workspace.fs.writeFile(backupUri, new Uint8Array());
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

    private markDocumentSaved(document: vscode.CustomDocument, panel?: vscode.WebviewPanel, fileSizeBytes?: number): void {
        const targetPanel = panel ?? this.webviews.get(document.uri.toString());
        targetPanel?.webview.postMessage({ command: 'document-saved', fileSizeBytes });
    }

    private async saveDocumentFromWebview(
        document: vscode.CustomDocument,
        webview: vscode.Webview
    ): Promise<void> {
        try {
            const saved = await vscode.workspace.save(document.uri);
            if (saved) {
                vscode.window.showInformationMessage(translate(this.packageNls(), 'toast.saved'));
            }
        } catch {
            vscode.window.showErrorMessage(translate(this.packageNls(), 'toast.saveFailed'));
        }
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

    private async promptImageSaveLocation(): Promise<vscode.Uri | undefined> {
        return vscode.window.showSaveDialog({
            filters: {
                Images: ['png', 'jpg', 'jpeg', 'webp', 'gif']
            },
            saveLabel: 'Save Image'
        });
    }

    private async exportImage(buffer: ArrayBuffer, mimeType: string) {
        const fileUri = await this.promptImageSaveLocation();
        if (fileUri) {
            await vscode.workspace.fs.writeFile(fileUri, new Uint8Array(buffer));
            vscode.window.showInformationMessage(
                translate(this.packageNls(), 'toast.exported', { filename: path.basename(fileUri.fsPath) })
            );
        }
    }

    public async createUntitledEditor(): Promise<void> {
        this.untitledCounter += 1;
        const uri = vscode.Uri.parse(`untitled:Untitled-${this.untitledCounter}.png`);
        await this.openImageWithEditor(uri);
    }

    public async openImageWithEditor(uri?: vscode.Uri): Promise<void> {
        const target = uri ?? vscode.window.activeTextEditor?.document.uri ?? this.getActiveTabUri();
        if (!target) {
            const picked = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: translate(this.packageNls(), 'command.openWithEditor.title'),
                filters: { Images: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }
            });
            if (!picked?.[0]) {
                return;
            }
            await vscode.commands.executeCommand('vscode.openWith', picked[0], ImageCustomEditorProvider.viewType);
            return;
        }

        await vscode.commands.executeCommand('vscode.openWith', target, ImageCustomEditorProvider.viewType);
    }

    private getActiveTabUri(): vscode.Uri | undefined {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined;
        return input?.uri;
    }

    public async runShortcut(action: string): Promise<void> {
        const panel = Array.from(this.webviews.values()).find(candidate => candidate.active)
            ?? Array.from(this.webviews.values()).find(candidate => candidate.visible);
        await panel?.webview.postMessage({ command: 'run-shortcut', action });
    }

    private getHtmlForWebview(
        webview: vscode.Webview,
        initialImageSrc: string,
        initialFileSizeBytes: number | undefined,
        isDocumentEditor = false,
        untitledFilename?: string
    ): string {
        const l10n = this.webviewL10n();
        const lang = resolveLanguageId(vscode.env.language);
        const extensionVersionLabel = this.getExtensionVersionLabel();
        const l10nEnUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'l10n', 'en.json')));
        const l10nKoUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'l10n', 'ko.json')));
        const canvasLayoutLogicUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'canvasLayoutLogic.js')));
        const shortcutLogicUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'shortcutLogic.js')));
        const zoomLogicUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'zoomLogic.js')));
        const cropMarqueeLogicUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'cropMarqueeLogic.js')));
        const resizePanelLogicUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'resizePanelLogic.js')));
        const sharpenLogicUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'sharpenLogic.js')));
        const mosaicLogicUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'mosaicLogic.js')));
        const colorLogicUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'colorLogic.js')));
        const magicWandLogicUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'magicWandLogic.js')));
        const clipboardLogicUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'clipboardLogic.js')));
        const saveExportLogicUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'saveExportLogic.js')));
        const historyLogicUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'historyLogic.js')));
        const transformLogicUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'transformLogic.js')));
        const loupeLogicUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'loupeLogic.js')));
        const sidebarAutoCollapseLogicUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'sidebarAutoCollapseLogic.js')));
        const toolRailLogicUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'toolRailLogic.js')));
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'editor.js')));
        const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'editor.css')));
        const cropperJsUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'cropper.min.js')));
        const cropperCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'cropper.min.css')));
        const safeImageSrc = initialImageSrc.replace(/"/g, '&quot;');
        const safeInitialFileSizeBytes = initialFileSizeBytes != null ? String(initialFileSizeBytes) : '';
        const untitledFilenameAttr = untitledFilename
            ? ` data-untitled-filename="${untitledFilename}"`
            : '';

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; connect-src ${webview.cspSource};">
                <link href="${cropperCssUri}" rel="stylesheet">
                <link href="${styleUri}" rel="stylesheet">
            </head>
            <body data-document-editor="${isDocumentEditor ? 'true' : 'false'}" data-lang="${lang}" data-l10n-en="${l10nEnUri}" data-l10n-ko="${l10nKoUri}" data-initial-file-size-bytes="${safeInitialFileSizeBytes}"${untitledFilenameAttr}>
                <div class="editor-wrapper">
                    <!-- Landing Dashboard Empty State -->
                    <div class="dashboard-empty" id="dashboard" style="display: none;">
                        <div style="font-size: 3rem; margin-bottom: 12px;">🖼️</div>
                        <h2 style="margin: 0 0 10px 0;" data-i18n="dashboard.title"></h2>
                        <p style="color: #aaa; margin-bottom: 20px; max-width: 400px; font-size: 0.9rem;" data-i18n="dashboard.description"></p>
                        <div class="empty-card-container">
                            <div class="empty-card" id="cardImport">
                                <h3 style="margin: 0 0 6px 0; font-size: 1rem;" data-i18n="dashboard.importTitle"></h3>
                                <p style="font-size: 0.75rem; color: #858585;" data-i18n="dashboard.importDesc"></p>
                                <input type="file" id="filePicker" accept="image/*" style="display: none;">
                            </div>
                            <div class="empty-card" id="cardPaste">
                                <h3 style="margin: 0 0 6px 0; font-size: 1rem;" data-i18n="dashboard.pasteTitle"></h3>
                                <p style="font-size: 0.75rem; color: #858585;" data-i18n-html="dashboard.pasteDesc"></p>
                            </div>
                        </div>
                    </div>

                    <!-- Workspace Area (grid: ruler-corner | rulerH / rulerV | scrollable canvas) -->
                    <div class="canvas-workspace" id="workspace" tabindex="-1" style="display: none; outline: none;">
                        <div class="tool-rail" id="toolRail" style="display: none;">
                            <button type="button" class="tool-rail-btn active" id="btnToolCursor" data-tool="cursor" data-i18n-title="toolbar.cursor">
                                <svg class="tool-rail-icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M5 3 17 15 12.5 15.5 16 21 13.5 22 10 16.5 6.5 19Z"></path>
                                </svg>
                                <span class="tool-rail-label" data-i18n="toolbar.cursor"></span>
                            </button>
                            <button type="button" class="tool-rail-btn" id="btnToolMarquee" data-tool="marquee" data-i18n-title="toolbar.marqueeSelect">
                                <svg class="tool-rail-icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <rect x="4" y="4" width="12" height="12" rx="2"></rect>
                                    <path d="M14.5 14.5 20 20"></path>
                                    <path d="M17 20h3v-3"></path>
                                </svg>
                                <span class="tool-rail-label" data-i18n="toolbar.marqueeSelect"></span>
                            </button>
                            <button type="button" class="tool-rail-btn" id="btnToolCrop" data-tool="crop" data-i18n-title="shortcuts.toggleCrop">
                                <svg class="tool-rail-icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M7 3v6H3"></path>
                                    <path d="M17 3h4v4"></path>
                                    <path d="M21 17h-4v4"></path>
                                    <path d="M3 17h4v4"></path>
                                    <path d="M8 16 16 8"></path>
                                </svg>
                                <span class="tool-rail-label" data-i18n="shortcuts.toggleCrop"></span>
                            </button>
                            <button type="button" class="tool-rail-btn" id="btnToolResize" data-tool="resize" data-i18n-title="sidebar.resize">
                                <svg class="tool-rail-icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M8 16h-4v-4"></path>
                                    <path d="M16 8h4v4"></path>
                                    <path d="M8 8 16 16"></path>
                                    <path d="M8 20h12"></path>
                                    <path d="M20 8v12"></path>
                                </svg>
                                <span class="tool-rail-label" data-i18n="sidebar.resize"></span>
                            </button>
                            <button type="button" class="tool-rail-btn" id="btnToolMosaic" data-tool="mosaic" data-i18n-title="sidebar.applyMosaic">
                                <svg class="tool-rail-icon tool-rail-icon-grid" viewBox="0 0 24 24" aria-hidden="true">
                                    <rect x="4" y="4" width="4" height="4" rx="1"></rect>
                                    <rect x="10" y="4" width="4" height="4" rx="1"></rect>
                                    <rect x="16" y="4" width="4" height="4" rx="1"></rect>
                                    <rect x="4" y="10" width="4" height="4" rx="1"></rect>
                                    <rect x="10" y="10" width="4" height="4" rx="1"></rect>
                                    <rect x="16" y="10" width="4" height="4" rx="1"></rect>
                                    <rect x="4" y="16" width="4" height="4" rx="1"></rect>
                                    <rect x="10" y="16" width="4" height="4" rx="1"></rect>
                                    <rect x="16" y="16" width="4" height="4" rx="1"></rect>
                                </svg>
                                <span class="tool-rail-label" data-i18n="sidebar.applyMosaic"></span>
                            </button>
                            <button type="button" class="tool-rail-btn" id="btnToolMove" data-tool="move" data-i18n-title="shortcuts.pan">
                                <svg class="tool-rail-icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M12 3v18"></path>
                                    <path d="M3 12h18"></path>
                                    <path d="M12 3l-3 3"></path>
                                    <path d="M12 3l3 3"></path>
                                    <path d="M12 21l-3-3"></path>
                                    <path d="M12 21l3-3"></path>
                                    <path d="M3 12l3-3"></path>
                                    <path d="M3 12l3 3"></path>
                                    <path d="M21 12l-3-3"></path>
                                    <path d="M21 12l-3 3"></path>
                                </svg>
                                <span class="tool-rail-label" data-i18n="shortcuts.pan"></span>
                            </button>
                            <button type="button" class="tool-rail-btn tool-rail-secondary" id="btnRotateLeft" data-shortcut="shift+r" data-i18n-title="toolbar.rotateLeft">
                                <svg class="tool-rail-icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M7 7V3L2 8l5 5V9c3.3 0 6 2.7 6 6 0 2.1-1.1 4-2.8 5.1l1.2 1.6C14.7 19.2 16 16.8 16 15c0-4.4-3.6-8-8-8z"></path>
                                </svg>
                            </button>
                            <button type="button" class="tool-rail-btn tool-rail-secondary" id="btnRotateRight" data-shortcut="R" data-i18n-title="toolbar.rotateRight">
                                <svg class="tool-rail-icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M17 7V3l5 5-5 5V9c-3.3 0-6 2.7-6 6 0 2.1 1.1 4 2.8 5.1l-1.2 1.6C9.3 19.2 8 16.8 8 15c0-4.4 3.6-8 8-8z"></path>
                                </svg>
                            </button>
                            <button type="button" class="tool-rail-btn tool-rail-secondary" id="btnFlipH" data-i18n-title="toolbar.flipH">
                                <svg class="tool-rail-icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M11 4H9v16h2V4zm4 0h-2v16h2V4zM6 6H4v12h2V6zm14 0h-2v12h2V6z"></path>
                                </svg>
                            </button>
                            <button type="button" class="tool-rail-btn tool-rail-secondary" id="btnFlipV" data-i18n-title="toolbar.flipV">
                                <svg class="tool-rail-icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M4 11v2h16v-2H4zm0-4v2h16V7H4zm0 8v2h16v-2H4z"></path>
                                </svg>
                            </button>
                        </div>
                        <div class="ruler-corner" id="rulerCorner"></div>
                        <canvas class="ruler ruler-h" id="rulerH"></canvas>
                        <canvas class="ruler ruler-v" id="rulerV"></canvas>
                        <!-- Scrollable canvas viewport -->
                        <div class="canvas-scroll-area" id="canvasScrollArea">
                            <div class="canvas-scroll-content" id="canvasScrollContent">
                                <div class="image-container" id="imageContainer">
                                    <img id="image" ${safeImageSrc ? `src="${safeImageSrc}"` : ''}>
                                    <canvas id="mosaicPreviewCanvas" class="mosaic-preview-canvas" style="display: none;"></canvas>
                                </div>
                            </div>
                        </div>
                        <div id="zoomLoupePanel" class="zoom-loupe-panel" style="display: none;">
                            <button type="button" id="zoomLoupeDragHandle" class="zoom-loupe-drag-handle" aria-label="Move zoom panel">
                                <svg class="zoom-loupe-drag-icon" viewBox="0 0 16 16" aria-hidden="true">
                                    <path d="M8 1v4M8 11v4M1 8h4M11 8h4M6.5 2.5 8 1l1.5 1.5M9.5 14.5 8 13l-1.5 1.5M2.5 6.5 1 8l1.5 1.5M14.5 9.5 13 8l1.5-1.5" />
                                </svg>
                            </button>
                            <span class="zoom-loupe-label" data-i18n="zoomLoupe.label"></span>
                            <canvas id="zoomLoupeCanvas" width="200" height="200"></canvas>
                        </div>
                    </div>

                    <!-- Control Panel -->
                    <div class="sidebar-controls" id="sidebar" style="display: none;">
                        <button type="button" id="btnSidebarAutoCollapse" class="sidebar-auto-collapse-toggle" data-i18n-title="sidebar.autoCollapse" aria-pressed="false">
                            <span class="sidebar-auto-collapse-toggle-icon" aria-hidden="true">‹</span>
                        </button>
                        <div class="sidebar-scroll">
                        <div class="section-card section-card-properties">
                            <div class="section-title section-title-with-version">
                                <span data-i18n="sidebar.properties"></span>
                                <span class="section-title-version">${extensionVersionLabel ? `(${extensionVersionLabel})` : ''}</span>
                            </div>
                            <div style="font-size: 0.8rem; line-height: 1.5; color: #aaa;">
                                <div><span data-i18n="sidebar.dimensions"></span> <span id="lblDimensions">0 × 0</span> px</div>
                                <div><span data-i18n="sidebar.fileSize"></span> <span id="lblFileSize">—</span></div>
                            </div>
                            <div class="properties-zoom-row">
                                <button class="tb-btn" id="btnZoomOut" data-shortcut="-" data-i18n-title="toolbar.zoomOut">-<span class="ui-shortcut-badge"></span></button>
                                <span class="zoom-indicator" id="lblZoomPercent">--%</span>
                                <button class="tb-btn" id="btnZoomIn" data-shortcut="+" data-i18n-title="toolbar.zoomIn">+<span class="ui-shortcut-badge"></span></button>
                                <button class="tb-btn" id="btnReset" data-shortcut="mod+0" data-i18n-title="toolbar.reset"><span id="lblResetText" data-i18n="toolbar.reset"></span><span class="ui-shortcut-badge"></span></button>
                            </div>
                        </div>

                        <div class="section-card section-card-selection">
                            <div class="section-title" data-i18n="sidebar.selection"></div>
                            <div class="selection-info-grid">
                                <div class="selection-info-item">
                                    <div class="selection-info-line">
                                        <span class="selection-info-label" data-i18n="selection.width"></span>
                                        <span class="selection-info-value" id="lblMarqueeWidth">— px</span>
                                    </div>
                                </div>
                                <div class="selection-info-item">
                                    <div class="selection-info-line">
                                        <span class="selection-info-label" data-i18n="selection.height"></span>
                                        <span class="selection-info-value" id="lblMarqueeHeight">— px</span>
                                    </div>
                                </div>
                                <div class="selection-info-item">
                                    <div class="selection-info-line">
                                        <span class="selection-info-label" data-i18n="selection.x"></span>
                                        <span class="selection-info-value" id="lblMarqueeX">— px</span>
                                    </div>
                                </div>
                                <div class="selection-info-item">
                                    <div class="selection-info-line">
                                        <span class="selection-info-label" data-i18n="selection.y"></span>
                                        <span class="selection-info-value" id="lblMarqueeY">— px</span>
                                    </div>
                                </div>
                            </div>
                            <p class="tool-hint" data-i18n="sidebar.selectionHint"></p>
                        </div>

                        <div class="section-card section-card-tool-options" id="toolOptionsSection">
                            <div class="section-title" data-i18n="sidebar.toolOptions">Tool Options</div>
                            <div class="tool-options-panel active" id="toolOptionsCursor">
                                <p class="tool-options-note" data-i18n="shortcuts.cursor"></p>
                            </div>
                            <div class="tool-options-panel" id="toolOptionsMarquee">
                                <p class="tool-options-note" data-i18n="shortcuts.marqueeSelect"></p>
                            </div>
                            <div class="tool-options-panel" id="toolOptionsCrop">
                                <div class="section-title" style="display: flex; align-items: center; justify-content: space-between;">
                                    <span data-i18n="sidebar.cropPresets"></span>
                                    <div style="display: flex; align-items: center; gap: 4px; text-transform: none;">
                                        <input type="checkbox" id="chkEnableCrop" style="margin: 0; cursor: pointer;">
                                        <label for="chkEnableCrop" style="font-size: 0.75rem; user-select: none; cursor: pointer; color: #ccc;" data-i18n="sidebar.enableCrop" data-shortcut="C / M"></label>
                                    </div>
                                </div>
                                <div class="btn-grid" id="cropPresets" style="margin-bottom: 8px;">
                                    <button class="btn-secondary" data-auto="true" data-i18n="sidebar.cropAuto"></button>
                                    <button class="btn-secondary" data-ratio="NaN" data-i18n="sidebar.cropFree"></button>
                                    <button class="btn-secondary" data-ratio="1">1:1</button>
                                    <button class="btn-secondary" data-ratio="1.77777777778">16:9</button>
                                    <button class="btn-secondary" data-ratio="1.33333333333">4:3</button>
                                </div>
                                <button class="btn-accent" id="btnApplyCrop" data-shortcut="Enter"><span data-i18n="sidebar.applyCrop"></span><span class="ui-shortcut-badge"></span></button>
                                <div class="control-group magic-wand-controls" style="margin-top: 12px; margin-bottom: 0;">
                                    <label data-i18n="sidebar.magicWand"></label>
                                    <div class="slider-row">
                                        <input type="range" id="rngMagicWandTolerance" min="0" max="128" value="32">
                                        <span id="magicWandToleranceVal" style="min-width: 28px; text-align: right; font-size: 0.8rem;">32</span>
                                    </div>
                                    <p class="tool-hint" data-i18n="sidebar.magicWandHint"></p>
                                </div>
                            </div>
                            <div class="tool-options-panel" id="toolOptionsResize">
                                <div class="control-group">
                                    <div class="input-row resize-dimension-row">
                                        <div class="resize-dimension-field">
                                            <label data-i18n="sidebar.width"></label>
                                            <input type="number" id="txtWidth" class="form-control" min="1" step="1" inputmode="numeric">
                                        </div>
                                        <div class="resize-dimension-field">
                                            <label data-i18n="sidebar.height"></label>
                                            <input type="number" id="txtHeight" class="form-control" min="1" step="1" inputmode="numeric">
                                        </div>
                                    </div>
                                </div>
                                <div class="control-group resize-scale-row">
                                    <label data-i18n-label="sidebar.resizeScale" data-percent-id="resizeScaleVal" data-percent-input="rngResizeScale" data-percent-default="100">Scale (<span id="resizeScaleVal">100</span>%)</label>
                                    <div class="slider-row">
                                        <input type="range" id="rngResizeScale" min="10" max="200" step="1" value="100">
                                        <div class="resize-lock-row">
                                            <input type="checkbox" id="chkLockRatio" checked>
                                            <label for="chkLockRatio" data-i18n="sidebar.lockRatio"></label>
                                        </div>
                                    </div>
                                </div>
                                <button class="btn-accent" id="btnApplyResize" data-i18n="sidebar.applyResize"></button>
                                <div class="control-group sharpen-section" id="sharpenSection" style="display: none;">
                                    <label data-i18n-label="sidebar.sharpen" data-percent-id="sharpenVal" data-percent-input="rngSharpen" data-percent-default="0">Sharpen (<span id="sharpenVal">0</span>%)</label>
                                    <div class="slider-row">
                                        <input type="range" id="rngSharpen" min="0" max="100" value="0" disabled>
                                    </div>
                                    <p class="tool-hint" data-i18n="sidebar.sharpenHint"></p>
                                </div>
                            </div>
                            <div class="tool-options-panel" id="toolOptionsMosaic">
                                <div class="control-group mosaic-size-section">
                                    <label data-i18n-label="sidebar.mosaicSize" data-percent-id="mosaicSizeVal" data-percent-input="rngMosaicSize" data-percent-default="16">Pixel Size (<span id="mosaicSizeVal">16</span> px)</label>
                                    <div class="slider-row">
                                        <input type="range" id="rngMosaicSize" min="4" max="64" step="1" value="16">
                                    </div>
                                    <p class="tool-hint" data-i18n="sidebar.mosaicHint"></p>
                                </div>
                                <button class="btn-secondary" id="btnApplyMosaic" data-i18n="sidebar.applyMosaic"></button>
                                <div class="mosaic-modal-actions" style="margin-top: 8px;">
                                    <button type="button" class="btn-secondary" id="btnMosaicCancel" data-i18n="sidebar.mosaicCancel"></button>
                                    <button type="button" class="btn-accent mosaic-modal-confirm" id="btnMosaicConfirm" data-i18n="sidebar.mosaicConfirm"></button>
                                </div>
                            </div>
                            <div class="tool-options-panel" id="toolOptionsMove">
                                <p class="tool-options-note" data-i18n="shortcuts.pan"></p>
                            </div>
                        </div>

                        <div class="section-card section-card-history">
                            <div class="section-title" data-i18n="sidebar.history"></div>
                            <div id="historyList" class="history-list"></div>
                            <p class="tool-hint" data-i18n="sidebar.historyHint"></p>
                        </div>

                        <div class="section-card section-card-save">
                            <div class="section-title" data-i18n="sidebar.saveExport"></div>
                            <div class="control-group">
                                <label data-i18n="sidebar.exportFormat"></label>
                                <select id="selFormat" class="form-control">
                                    <option value="image/png">PNG</option>
                                    <option value="image/jpeg">JPEG</option>
                                    <option value="image/webp">WebP</option>
                                </select>
                            </div>
                            <div class="control-group" id="qualitySection" style="display: none;">
                                <label data-i18n-label="sidebar.quality" data-percent-id="qualityVal" data-percent-input="rngQuality" data-percent-default="80">Quality (<span id="qualityVal">80</span>%)</label>
                                <div class="slider-row">
                                    <input type="range" id="rngQuality" min="1" max="100" value="80">
                                </div>
                            </div>
                            <button class="btn-accent" id="btnSave" style="background-color: #28a745; margin-bottom: 8px;" data-shortcut="mod+s"><span data-i18n="sidebar.save"></span><span class="ui-shortcut-badge"></span></button>
                            <button class="btn-accent" id="btnExport" style="background-color: #4e4e4e;" data-i18n="sidebar.exportAs"></button>
                        </div>
                    </div>
                </div>

                <!-- Custom Context Menu -->
                <div class="context-menu" id="contextMenu">
                    <div class="context-menu-item" id="ctxCopy" data-shortcut="mod+c">
                        <span data-i18n="context.copy"></span>
                        <span class="context-menu-shortcut"></span>
                    </div>
                    <div class="context-menu-item" id="ctxErase" data-shortcut="Del">
                        <span data-i18n="context.deleteSelection"></span>
                        <span class="context-menu-shortcut"></span>
                    </div>
                    <div class="context-menu-divider"></div>
                    <div class="context-menu-item" id="ctxFlipH">
                        <span data-i18n="context.flipH"></span>
                    </div>
                    <div class="context-menu-item" id="ctxFlipV">
                        <span data-i18n="context.flipV"></span>
                    </div>
                    <div class="context-menu-item" id="ctxMosaic" data-shortcut="X">
                        <span data-i18n="context.mosaic"></span>
                        <span class="context-menu-shortcut"></span>
                    </div>
                    <div class="context-menu-divider"></div>
                    <div class="context-menu-item" id="ctxSave" data-shortcut="mod+s">
                        <span data-i18n="context.save"></span>
                        <span class="context-menu-shortcut"></span>
                    </div>
                    <div class="context-menu-item" id="ctxUndo" data-shortcut="mod+z">
                        <span data-i18n="context.undo"></span>
                        <span class="context-menu-shortcut"></span>
                    </div>
                    <div class="context-menu-item" id="ctxReset" data-shortcut="mod+0">
                        <span data-i18n="context.reset"></span>
                        <span class="context-menu-shortcut"></span>
                    </div>
                </div>

                <div id="shortcutHintTooltip" class="shortcut-hint-tooltip" style="display: none;"></div>

                <div id="marqueeShortcutTooltip" class="marquee-shortcut-tooltip" style="display: none;">
                    <div class="marquee-shortcut-tooltip-row">
                        <span class="marquee-shortcut-key">Del / Bksp</span>
                        <span class="marquee-shortcut-desc" data-i18n="shortcuts.eraseSelection"></span>
                    </div>
                    <div class="marquee-shortcut-tooltip-row">
                        <span class="marquee-shortcut-key">X</span>
                        <span class="marquee-shortcut-desc" data-i18n="shortcuts.mosaicSelection"></span>
                    </div>
                    <div class="marquee-shortcut-tooltip-row">
                        <span class="marquee-shortcut-key">Esc</span>
                        <span class="marquee-shortcut-desc" data-i18n="shortcuts.cancel"></span>
                    </div>
                </div>

                <!-- Floating Eyedropper Tooltip -->
                <div id="eyedropperTooltip" class="eyedropper-tooltip" style="display: none;" data-i18n="eyedropper.tooltip"></div>

                <!-- Color Picker Tooltip (I key) -->
                <div id="colorPickerTooltip" class="color-picker-tooltip" style="display: none;">
                    <span class="color-picker-swatch" id="colorPickerSwatch"></span>
                    <span id="colorPickerPreview">#000000</span>
                </div>

                <!-- Z + drag: selection highlight on image -->
                <div id="zoomLoupeSelection" class="zoom-loupe-selection" style="display: none;"></div>

                <!-- Color Info Modal -->
                <div id="colorModal" class="color-modal" style="display: none;">
                    <div class="color-modal-backdrop" id="colorModalBackdrop"></div>
                    <div class="color-modal-panel">
                        <div class="color-modal-header">
                            <span class="color-modal-title" data-i18n="colorModal.title"></span>
                            <button type="button" class="color-modal-close" id="colorModalClose" data-i18n-title="colorModal.close">✕</button>
                        </div>
                        <div class="color-modal-preview">
                            <div class="color-modal-swatch" id="colorModalSwatch"></div>
                            <div class="color-modal-hint" data-i18n="colorModal.hint"></div>
                        </div>
                        <div class="color-format-list" id="colorFormatList"></div>
                    </div>
                </div>

                <!-- Copy Format Modal -->
                <div id="copyModal" class="color-modal copy-modal" style="display: none;">
                    <div class="color-modal-backdrop" id="copyModalBackdrop"></div>
                    <div class="color-modal-panel">
                        <div class="color-modal-header">
                            <span class="color-modal-title" data-i18n="copyModal.title"></span>
                            <button type="button" class="color-modal-close" id="copyModalClose" data-i18n-title="copyModal.close">✕</button>
                        </div>
                        <div class="color-modal-hint copy-modal-hint" data-i18n="copyModal.hint"></div>
                        <div class="copy-scope-section" id="copyScopeSection" style="display: none;">
                            <label class="copy-scope-label">
                                <input type="checkbox" id="chkCopySelectionOnly" checked>
                                <span data-i18n="copyModal.selectionOnly"></span>
                            </label>
                            <div class="copy-scope-info" id="copyScopeInfo"></div>
                        </div>
                        <div class="copy-format-options" id="copyFormatOptions">
                            <button type="button" class="copy-format-btn active" data-format="image/png">PNG</button>
                            <button type="button" class="copy-format-btn" data-format="image/jpeg">JPEG</button>
                            <button type="button" class="copy-format-btn" data-format="image/webp">WebP</button>
                        </div>
                        <div class="control-group copy-quality-section" id="copyQualitySection" style="display: none;">
                            <label data-i18n-label="copyModal.quality" data-percent-id="copyQualityVal" data-percent-input="rngCopyQuality" data-percent-default="80">Quality (<span id="copyQualityVal">80</span>%)</label>
                            <div class="slider-row">
                                <input type="range" id="rngCopyQuality" min="1" max="100" value="80">
                            </div>
                        </div>
                        <button type="button" class="btn-accent copy-modal-confirm" id="btnCopyConfirm" data-i18n="copyModal.confirm"></button>
                    </div>
                </div>

                <!-- Keyboard Shortcut Cheatsheet Overlay -->
                <div id="shortcutOverlay" class="shortcut-overlay" style="display: none;">
                    <div class="shortcut-overlay-title" data-i18n="shortcuts.title"></div>
                    <div class="shortcut-grid">
                        <div class="shortcut-row"><span class="shortcut-key">⌘/Ctrl + S</span><span class="shortcut-desc" data-i18n="shortcuts.save"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">⌘/Ctrl + Z</span><span class="shortcut-desc" data-i18n="shortcuts.undo"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">⌘/Ctrl + C</span><span class="shortcut-desc" data-i18n="shortcuts.copyImage"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">⌘/Ctrl + A</span><span class="shortcut-desc" data-i18n="shortcuts.selectAll"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">H / Space + Drag</span><span class="shortcut-desc" data-i18n="shortcuts.pan"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">Z + Drag</span><span class="shortcut-desc" data-i18n="shortcuts.zoomLoupe"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key" data-i18n="shortcuts.dblClickImageKey"></span><span class="shortcut-desc" data-i18n="shortcuts.dblClickImage"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">⌘/Ctrl + 0</span><span class="shortcut-desc" data-i18n="shortcuts.zoomFit"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">⌘/Ctrl + 1</span><span class="shortcut-desc" data-i18n="shortcuts.zoomActualPixels"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">+</span><span class="shortcut-desc" data-i18n="shortcuts.zoomIn"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">−</span><span class="shortcut-desc" data-i18n="shortcuts.zoomOut"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">[ / ]</span><span class="shortcut-desc" data-i18n="shortcuts.marqueeResize"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">R / Shift + R</span><span class="shortcut-desc" data-i18n="shortcuts.rotate"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">Enter</span><span class="shortcut-desc" data-i18n="shortcuts.applyCrop"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">X</span><span class="shortcut-desc" data-i18n="shortcuts.mosaicSelection"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">Del / Bksp</span><span class="shortcut-desc" data-i18n="shortcuts.eraseSelection"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">Esc</span><span class="shortcut-desc" data-i18n="shortcuts.cancel"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">I + Click</span><span class="shortcut-desc" data-i18n="shortcuts.pickColor"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">↑ ↓ ← →</span><span class="shortcut-desc" data-i18n="shortcuts.moveMarquee"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">M</span><span class="shortcut-desc" data-i18n="shortcuts.marqueeSelect"></span></div>
                        <div class="shortcut-row"><span class="shortcut-key">C</span><span class="shortcut-desc" data-i18n="shortcuts.toggleCrop"></span></div>
                        <div class="shortcut-row magic-wand-shortcut-row"><span class="shortcut-key">W + Click</span><span class="shortcut-desc" data-i18n="shortcuts.magicWand"></span></div>
                    </div>
                </div>

                <script src="${cropperJsUri}"></script>
                <script src="${canvasLayoutLogicUri}"></script>
                <script src="${shortcutLogicUri}"></script>
                <script src="${zoomLogicUri}"></script>
                <script src="${cropMarqueeLogicUri}"></script>
                <script src="${resizePanelLogicUri}"></script>
                <script src="${sharpenLogicUri}"></script>
                <script src="${mosaicLogicUri}"></script>
                <script src="${colorLogicUri}"></script>
                <script src="${magicWandLogicUri}"></script>
                <script src="${clipboardLogicUri}"></script>
                <script src="${saveExportLogicUri}"></script>
                <script src="${historyLogicUri}"></script>
                <script src="${transformLogicUri}"></script>
                <script src="${loupeLogicUri}"></script>
                <script src="${sidebarAutoCollapseLogicUri}"></script>
                <script src="${toolRailLogicUri}"></script>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }
}
