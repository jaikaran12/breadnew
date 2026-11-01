// Generates the app icons from the bread logo:
//   - Android launcher icons + splash image for the wrapper app (android-wrapper/app/src/main/res)
//   - PNG icons for the driver web app (driver-app/public/icons)
// Usage (needs Playwright + Chromium): node android-wrapper/scripts/make-icons.cjs
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BRAND = '#9A3412';
const ROOT = path.join(__dirname, '..', '..');
const RES = path.join(ROOT, 'android-wrapper', 'app', 'src', 'main', 'res');
const WEB = path.join(ROOT, 'driver-app', 'public', 'icons');
const BREAD = `
  <path d="M22 50c0-12 11-20 26-20s26 8 26 20c0 4-3 6-6 6v14a4 4 0 0 1-4 4H32a4 4 0 0 1-4-4V56c-3 0-6-2-6-6z"
        fill="#F8D9A0" stroke="#7C2D12" stroke-width="3"/>
  <path d="M38 44l4 8M48 42l2 9M58 44l-3 8" stroke="#C2410C" stroke-width="3" stroke-linecap="round"/>`;
const bread = (scale) => `<g transform="translate(48 50) scale(${scale}) translate(-48 -52)">${BREAD}</g>`;

const svgs = {
  square: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect x="4" y="4" width="88" height="88" rx="20" fill="${BRAND}"/>${bread(1.05)}</svg>`,
  round: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="44" fill="${BRAND}"/>${bread(0.95)}</svg>`,
  // Adaptive icon foreground / splash: transparent, bread inside the always-visible middle area.
  foreground: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">${bread(0.92)}</svg>`,
  // Web "maskable" icon: full-bleed background, bread well inside the safe zone.
  maskable: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${BRAND}"/>${bread(0.8)}</svg>`,
};

async function render(page, svg, size, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(densities)) {
    const dir = path.join(RES, `mipmap-${d}`);
    await render(page, svgs.square, 48 * k, path.join(dir, 'ic_launcher.png'));
    await render(page, svgs.round, 48 * k, path.join(dir, 'ic_launcher_round.png'));
    await render(page, svgs.foreground, 108 * k, path.join(dir, 'ic_launcher_foreground.png'));
  }
  // Splash image shown (on the brand colour) while the web app loads: 108dp.
  await render(page, svgs.foreground, 432, path.join(RES, 'drawable-xxxhdpi', 'splash.png'));
  await render(page, svgs.square, 192, path.join(WEB, 'icon-192.png'));
  await render(page, svgs.square, 512, path.join(WEB, 'icon-512.png'));
  await render(page, svgs.maskable, 512, path.join(WEB, 'maskable-512.png'));
  await browser.close();
  console.log('Icons written to', RES, 'and', WEB);
})();
