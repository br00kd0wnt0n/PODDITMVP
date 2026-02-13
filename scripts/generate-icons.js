// Generate placeholder PWA icons as simple colored PNGs
// Run: node scripts/generate-icons.js

const fs = require('fs');
const path = require('path');

// Minimal PNG generator for solid color squares with a letter
function createMinimalPNG(size) {
  // Create a simple PNG with a purple background
  // This is a valid minimal PNG file
  const { createCanvas } = (() => {
    try {
      return require('canvas');
    } catch {
      return { createCanvas: null };
    }
  })();

  if (createCanvas) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#4c6ef5';
    ctx.fillRect(0, 0, size, size);

    // Letter P
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(size * 0.6)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', size / 2, size / 2);

    return canvas.toBuffer('image/png');
  }

  // Fallback: create a 1x1 purple PNG and let browsers scale it
  // This is a valid 1x1 PNG with purple color (#4c6ef5)
  const png = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x08, 0xD7, 0x63, 0x98, 0xC9, 0xF2, 0xCA,
    0x00, 0x00, 0x00, 0x04, 0x00, 0x01, 0xE4, 0xA0,
    0x54, 0xBE, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, // IEND chunk
    0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
  ]);
  return png;
}

const iconsDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

[192, 512].forEach(size => {
  const buffer = createMinimalPNG(size);
  const filepath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(filepath, buffer);
  console.log(`Created ${filepath} (${buffer.length} bytes)`);
});

// Also create extension icons
const extIconsDir = path.join(__dirname, '..', 'extension', 'icons');
fs.mkdirSync(extIconsDir, { recursive: true });

[16, 48, 128].forEach(size => {
  const buffer = createMinimalPNG(size);
  const filepath = path.join(extIconsDir, `icon-${size}.png`);
  fs.writeFileSync(filepath, buffer);
  console.log(`Created ${filepath} (${buffer.length} bytes)`);
});

console.log('Done! Replace these with real icons before production.');
