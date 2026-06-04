'use strict';

function normalizeBlockSize(blockSize) {
    const size = Math.round(Number(blockSize));
    return Number.isFinite(size) ? Math.max(1, size) : 8;
}

function clampMosaicRect(rect, width, height) {
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
}

function applyMosaicToImageData(imageData, rect, blockSize) {
    if (!imageData || !imageData.data) {
        return imageData;
    }

    const width = imageData.width;
    const height = imageData.height;
    const clampedRect = clampMosaicRect(rect, width, height);
    if (!clampedRect) {
        return imageData;
    }

    const size = normalizeBlockSize(blockSize);
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
}

function applyMosaicToCanvas(canvas, rect, blockSize) {
    if (!canvas || !canvas.width || !canvas.height) {
        return canvas;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return canvas;
    }

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyMosaicToImageData(imageData, rect, blockSize);
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

const api = {
    normalizeBlockSize,
    clampMosaicRect,
    applyMosaicToImageData,
    applyMosaicToCanvas
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
}
if (typeof globalThis !== 'undefined') {
    globalThis.VsimageMosaicLogic = api;
}
