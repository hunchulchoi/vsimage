import * as assert from 'assert';
import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

function execFileAsync(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(command, args, (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
}

async function pasteboardTypes(): Promise<string> {
    return execFileAsync('swift', [
        '-e',
        'import AppKit; print(NSPasteboard.general.types?.map { $0.rawValue }.joined(separator: "\\n") ?? "")'
    ]);
}

async function waitForDebugState<T extends object>(
    predicate: (state: T) => boolean,
    timeoutMs = 5000
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let lastState: T | undefined;

    while (Date.now() < deadline) {
        lastState = await vscode.commands.executeCommand<T>('vsimage.debugState');
        if (lastState && predicate(lastState)) {
            return lastState;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    assert.fail(`Timed out waiting for debug state. Last state: ${JSON.stringify(lastState)}`);
}

suite('VS Code Image Editor Integration Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension is successfully registered', () => {
        const ext = vscode.extensions.getExtension('choihunchul.vsimage');
        assert.ok(ext);
    });

    test('vsimage.newEditor command is registered', async () => {
        const ext = vscode.extensions.getExtension('choihunchul.vsimage');
        assert.ok(ext);
        if (!ext.isActive) {
            await ext.activate();
        }
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('vsimage.newEditor'));
        assert.ok(commands.includes('vsimage.debugState'));
    });

    test('opens PNG with the vsimage custom editor', async () => {
        const fileUri = vscode.Uri.file(path.join(os.tmpdir(), `vsimage-openwith-${Date.now()}.png`));
        const png1x1 = Uint8Array.from(Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw9L5wAAAABJRU5ErkJggg==',
            'base64'
        ));

        await vscode.workspace.fs.writeFile(fileUri, png1x1);
        await vscode.commands.executeCommand('vscode.openWith', fileUri, 'vsimage.editor');
        await new Promise(resolve => setTimeout(resolve, 500));

        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        assert.ok(activeTab?.input instanceof vscode.TabInputCustom);
        assert.strictEqual(activeTab.input.viewType, 'vsimage.editor');
    });

    test('copies the active image selection to the macOS pasteboard', async function () {
        this.timeout(10000);

        if (process.platform !== 'darwin') {
            this.skip();
        }

        const fileUri = vscode.Uri.file(path.join(os.tmpdir(), `vsimage-copy-selection-${Date.now()}.png`));
        const png1x1 = Uint8Array.from(Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw9L5wAAAABJRU5ErkJggg==',
            'base64'
        ));

        await vscode.workspace.fs.writeFile(fileUri, png1x1);
        await vscode.commands.executeCommand('vscode.openWith', fileUri, 'vsimage.editor');
        await new Promise(resolve => setTimeout(resolve, 800));
        await vscode.commands.executeCommand('vsimage.runShortcut', { action: 'selectAll' });
        await new Promise(resolve => setTimeout(resolve, 200));
        await vscode.commands.executeCommand('vsimage.runShortcut', { action: 'copy' });
        await new Promise(resolve => setTimeout(resolve, 1200));

        const debugState = await vscode.commands.executeCommand<{
            editorReadyCount: number;
            copyImageMessageCount: number;
            copyFunctionEnterCount: number;
            hostClipboardRequestCount: number;
            shortcutDispatchCount: number;
            shortcutAckCount: number;
            showToastCount: number;
            lastToastText: string;
            lastShortcutAction: string;
            lastShortcutDocumentKey: string;
            webviewCount: number;
            readyWebviewCount: number;
        }>('vsimage.debugState');
        assert.ok(debugState);
        assert.ok((debugState?.editorReadyCount ?? 0) > 0);
        assert.ok((debugState?.readyWebviewCount ?? 0) > 0);
        assert.ok((debugState?.shortcutDispatchCount ?? 0) > 0, JSON.stringify(debugState));
        assert.ok((debugState?.shortcutAckCount ?? 0) > 0, JSON.stringify(debugState));
        assert.ok((debugState?.copyFunctionEnterCount ?? 0) > 0, JSON.stringify(debugState));
        assert.ok((debugState?.hostClipboardRequestCount ?? 0) > 0, JSON.stringify(debugState));
        assert.ok((debugState?.copyImageMessageCount ?? 0) > 0, JSON.stringify(debugState));
        assert.ok((debugState?.showToastCount ?? 0) > 0, JSON.stringify(debugState));
        assert.ok((debugState?.lastToastText ?? '').length > 0, JSON.stringify(debugState));

        assert.match(await pasteboardTypes(), /public\.tiff|NeXT TIFF/);
    });

    test('activates selection move tool after marquee without resetting crop', async function () {
        this.timeout(15000);

        await waitForDebugState<{
            webviewCount: number;
            readyWebviewCount: number;
        }>(state => state.webviewCount > 0 && state.readyWebviewCount > 0);

        await vscode.commands.executeCommand('vsimage.runShortcut', { action: 'marquee' });
        await new Promise(resolve => setTimeout(resolve, 300));
        await vscode.commands.executeCommand('vsimage.runShortcut', { action: 'move' });

        const debugState = await waitForDebugState<{
            editorReadyCount: number;
            readyWebviewCount: number;
            lastShortcutAction: string;
            lastActiveTool: string;
            selectionMoveActive: boolean;
            cropEnabled: boolean;
            cropped: boolean;
            cropWidth: number;
            cropHeight: number;
        }>(state => state.lastShortcutAction === 'move' && state.lastActiveTool === 'move');

        assert.ok(debugState);
        assert.ok((debugState?.editorReadyCount ?? 0) > 0);
        assert.ok((debugState?.readyWebviewCount ?? 0) > 0);
        assert.strictEqual(debugState?.lastShortcutAction, 'move');
        assert.strictEqual(debugState?.lastActiveTool, 'move');
        assert.strictEqual(debugState?.selectionMoveActive, true);
        assert.strictEqual(debugState?.cropEnabled, true);
        assert.strictEqual(debugState?.cropped, true);
        assert.ok((debugState?.cropWidth ?? 0) > 0);
        assert.ok((debugState?.cropHeight ?? 0) > 0);
    });
});
