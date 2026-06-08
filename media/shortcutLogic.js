'use strict';

function hasModifier(event) {
    return Boolean(event.metaKey || event.ctrlKey);
}

function hasToolModifier(event) {
    return Boolean(event.metaKey || event.ctrlKey || event.altKey);
}

function isCode(event, code) {
    return event.code === code;
}

function isLetter(event, letter) {
    return String(event.key || '').toLowerCase() === letter || isCode(event, `Key${letter.toUpperCase()}`);
}

function getShortcutAction(event) {
    const key = String(event.key || '');
    const mod = hasModifier(event);
    if (mod && isLetter(event, 's')) {
        return 'save';
    }
    if (mod && isLetter(event, 'z')) {
        return 'undo';
    }
    if (mod && isLetter(event, 'c')) {
        return 'copy';
    }
    if (mod && isLetter(event, 'a')) {
        return 'selectAll';
    }
    if (mod && key === '0') {
        return 'fitViewport';
    }
    if (mod && key === '1') {
        return 'actualPixels';
    }
    if (!mod && !event.altKey && key === '+') {
        return 'zoomIn';
    }
    if (!mod && !event.altKey && key === '-') {
        return 'zoomOut';
    }
    if (!hasToolModifier(event) && isLetter(event, 'm')) {
        return 'marquee';
    }
    if (!hasToolModifier(event) && isLetter(event, 'x')) {
        return 'mosaic';
    }
    if (!hasToolModifier(event) && isLetter(event, 'c')) {
        return 'crop';
    }
    if (!hasToolModifier(event) && isLetter(event, 'r')) {
        return event.shiftKey ? 'rotateLeft' : 'rotateRight';
    }
    return null;
}

function canRunWhenInputFocused(action) {
    return action === 'save' || action === 'undo' || action === 'copy';
}

function isPanHoldCode(code) {
    return code === 'Space' || code === 'KeyH';
}

function isEyedropperHoldCode(code) {
    return code === 'KeyI';
}

const api = {
    getShortcutAction,
    canRunWhenInputFocused,
    isPanHoldCode,
    isEyedropperHoldCode
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
}
if (typeof globalThis !== 'undefined') {
    globalThis.VsimageShortcutLogic = api;
}
