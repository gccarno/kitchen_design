// Regenerates the app icons in public/icons from one drawing: a floor plan
// (walls, a door with its swing, two items). Run: node scripts/make-icons.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const BG = '#111827';

/** The drawing sits inside the central 60% so maskable crops never cut it. */
const svg = (corner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${corner}" fill="${BG}"/>
  <g fill="none" stroke="#ffffff" stroke-width="26" stroke-linejoin="miter" stroke-linecap="square">
    <path d="M150 360 V152 H362 V360 H290 M150 360 H222"/>
  </g>
  <g fill="none" stroke="#ffffff" stroke-width="10">
    <path d="M222 360 V292"/>
    <path d="M222 292 A68 68 0 0 1 290 360" stroke-dasharray="14 10"/>
  </g>
  <g fill="#fde68a">
    <rect x="172" y="174" width="96" height="48" rx="4"/>
    <rect x="290" y="174" width="50" height="76" rx="4"/>
  </g>
</svg>`;

const icons = [
  ['icon-192.png', 192, 96],
  ['icon-512.png', 512, 96],
  ['icon-maskable-512.png', 512, 0],
  ['apple-touch-icon.png', 180, 0],
];
mkdirSync('public/icons', { recursive: true });
for (const [file, size, corner] of icons) {
  await sharp(Buffer.from(svg(corner)), { density: (72 * size) / 512 })
    .resize(size, size)
    .png()
    .toFile(`public/icons/${file}`);
  console.log('wrote public/icons/' + file);
}
