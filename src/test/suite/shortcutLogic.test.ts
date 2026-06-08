import * as assert from 'assert';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const shortcuts = require(path.join(__dirname, '../../../../media/shortcutLogic.js')) as {
    getShortcutAction: (event: {
        key?: string;
        code?: string;
        metaKey?: boolean;
        ctrlKey?: boolean;
        shiftKey?: boolean;
        altKey?: boolean;
    }) => string | null;
    canRunWhenInputFocused: (action: string | null) => boolean;
    isPanHoldCode: (code: string) => boolean;
    isEyedropperHoldCode: (code: string) => boolean;
};

suite('Photoshop-style shortcuts', () => {
    test('maps fit and actual pixels to modifier 0 and 1', () => {
        assert.strictEqual(shortcuts.getShortcutAction({ key: '0', metaKey: true }), 'fitViewport');
        assert.strictEqual(shortcuts.getShortcutAction({ key: '1', ctrlKey: true }), 'actualPixels');
    });

    test('maps modifier select all to crop selection action', () => {
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'a', metaKey: true }), 'selectAll');
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'A', ctrlKey: true }), 'selectAll');
    });

    test('maps rotation to R and Shift+R without legacy modifier brackets', () => {
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'r' }), 'rotateRight');
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'R', shiftKey: true }), 'rotateLeft');
        assert.strictEqual(shortcuts.getShortcutAction({ key: '[', metaKey: true }), null);
        assert.strictEqual(shortcuts.getShortcutAction({ key: ']', ctrlKey: true }), null);
    });

    test('uses plain plus and minus for zoom without intercepting editor zoom shortcuts', () => {
        assert.strictEqual(shortcuts.getShortcutAction({ key: '+' }), 'zoomIn');
        assert.strictEqual(shortcuts.getShortcutAction({ key: '-' }), 'zoomOut');
        assert.strictEqual(shortcuts.getShortcutAction({ key: '+', metaKey: true }), null);
        assert.strictEqual(shortcuts.getShortcutAction({ key: '-', ctrlKey: true }), null);
    });

    test('keeps crop key but disables the magic wand shortcut', () => {
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'c' }), 'crop');
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'm' }), 'marquee');
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'W' }), null);
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'x' }), 'mosaic');
    });

    test('uses physical key codes when keyboard layout changes letter output', () => {
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'ㄴ', code: 'KeyS', metaKey: true }), 'save');
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'ㅋ', code: 'KeyZ', ctrlKey: true }), 'undo');
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'ㅁ', code: 'KeyA', metaKey: true }), 'selectAll');
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'ㅊ', code: 'KeyC' }), 'crop');
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'ㅁ', code: 'KeyM' }), 'marquee');
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'ㅈ', code: 'KeyW' }), null);
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'ㅌ', code: 'KeyX' }), 'mosaic');
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'ㄱ', code: 'KeyR' }), 'rotateRight');
        assert.strictEqual(shortcuts.getShortcutAction({ key: 'ㄱ', code: 'KeyR', shiftKey: true }), 'rotateLeft');
    });

    test('allows image copy even when an editor input keeps focus', () => {
        assert.strictEqual(shortcuts.canRunWhenInputFocused('save'), true);
        assert.strictEqual(shortcuts.canRunWhenInputFocused('undo'), true);
        assert.strictEqual(shortcuts.canRunWhenInputFocused('copy'), true);
        assert.strictEqual(shortcuts.canRunWhenInputFocused('selectAll'), false);
        assert.strictEqual(shortcuts.canRunWhenInputFocused(null), false);
    });

    test('preserves physical bracket codes when shift changes key output', () => {
        assert.strictEqual(shortcuts.getShortcutAction({ key: '{', code: 'BracketLeft', shiftKey: true }), null);
        assert.strictEqual(shortcuts.getShortcutAction({ key: '}', code: 'BracketRight', shiftKey: true }), null);
    });

    test('uses H or Space for hand pan and I for eyedropper', () => {
        assert.strictEqual(shortcuts.isPanHoldCode('KeyH'), true);
        assert.strictEqual(shortcuts.isPanHoldCode('Space'), true);
        assert.strictEqual(shortcuts.isPanHoldCode('KeyZ'), false);
        assert.strictEqual(shortcuts.isEyedropperHoldCode('KeyI'), true);
        assert.strictEqual(shortcuts.isEyedropperHoldCode('AltLeft'), false);
    });
});
