// 用 Playwright 把 ppt/index.html 的每一页截图，输出到 ppt/images/slide-NN.png
// 用法：node scripts/shoot_ppt.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const deckUrl = "file://" + path.join(root, "ppt", "index.html");
const outDir = path.join(root, "ppt", "images");
fs.mkdirSync(outDir, { recursive: true });

const W = 1920, H = 1080;

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--force-color-profile=srgb"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await page.goto(deckUrl, { waitUntil: "networkidle" });
await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
// 强制动态模式（保留 canvas 背景效果），并隐藏导航/提示 UI
await page.evaluate(() => {
  try { window.__setLowPowerMode && window.__setLowPowerMode(false); } catch (e) {}
  const css = document.createElement("style");
  css.textContent = "#nav,#hint{display:none!important}";
  document.head.appendChild(css);
});
await page.waitForTimeout(1200);

const total = await page.evaluate(() => document.querySelectorAll(".slide").length);
console.log("slides:", total);

for (let i = 0; i < total; i++) {
  if (i > 0) { await page.keyboard.press("ArrowRight"); }
  // 等待翻页过渡(.9s) + 入场动画 + canvas 起一帧
  await page.waitForTimeout(2600);
  const file = path.join(outDir, `slide-${String(i + 1).padStart(2, "0")}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
  console.log("shot", file);
}

await browser.close();
console.log("done");
