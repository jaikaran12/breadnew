// Generates the Android launcher icons and splash images from the bread logo.
// Usage: node scripts/make-android-icons.cjs   (needs Playwright + Chromium)
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BRAND = '#9A3412';
const RES = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const BREAD = `
  <path d="M22 50c0-12 11-20 26-20s26 8 26 20c0 4-3 6-6 6v14a4 4 0 0 1-4 4H32a4 4 0 0 1-4-4V56c-3 0-6-2-6-6z"
        fill="#F8D9A0" stroke="#7C2D12" stroke-width="3"/>
  <path d="M38 44l4 8M48 42l2 9M58 44l-3 8" stroke="#C2410C" stroke-width="3" stroke-linecap="round"/>`;

// The bread drawing spans roughly 20..76 x 28..76 of a 96 box; center it.
const bread = (scale) => `<g transform="translate(48 50) scale(${scale}) translate(-48 -52)">${BREAD}</g>`;

const svgs = {
  square: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect x="4" y="4" width="88" height="88" rx="20" fill="${BRAND}"/>${bread(1.05)}</svg>`,
  round: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="44" fill="${BRAND}"/>${bread(0.95)}</svg>`,
  // Adaptive icon foreground: only the middle 66/108 is always visible.
  foreground: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">${bread(0.92)}</svg>`,
};

async function render(page, svg, w, h, file, background) {
  await page.setViewportSize({ width: w, height: h });
  const bg = background ? `background:${background};` : 'background:transparent;';
  const size = Math.min(w, h);
  const iconSize = background ? Math.round(size * 0.32) : size;
  await page.setContent(
    `<html><body style="margin:0;${bg}width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center">
       <div style="width:${iconSize}px;height:${iconSize}px">${svg.replace('<svg ', `<svg width="${iconSize}" height="${iconSize}" `)}</div>
     </body></html>`,
  );
  await page.screenshot({ path: file, omitBackground: !background, clip: { x: 0, y: 0, width: w, height: h } });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(densities)) {
    const dir = path.join(RES, `mipmap-${d}`);
    await render(page, svgs.square, 48 * k, 48 * k, path.join(dir, 'ic_launcher.png'));
    await render(page, svgs.round, 48 * k, 48 * k, path.join(dir, 'ic_launcher_round.png'));
    await render(page, svgs.foreground, 108 * k, 108 * k, path.join(dir, 'ic_launcher_foreground.png'));
  }
  // Replace every splash.png with the same size, brand background + logo.
  const splashLogo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">${bread(1.1)}</svg>`;
  for (const dir of fs.readdirSync(RES).filter((d) => d.startsWith('drawable'))) {
    const file = path.join(RES, dir, 'splash.png');
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    await render(page, splashLogo, w, h, file, BRAND);
  }
  await browser.close();
  console.log('Android icons and splash images written to', RES);
})();
