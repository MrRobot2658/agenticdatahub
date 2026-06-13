#!/usr/bin/env node
/**
 * Render docs/CDP-OneID全链路优化方案.html → PDF via headless Chrome
 * Waits for Mermaid SVG rendering before printing.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'docs/CDP-OneID全链路优化方案.html');
const PDF = path.join(ROOT, 'docs/CDP优化方案V3.0-06.pdf');

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome',
  'chromium',
];

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    try {
      if (c.startsWith('/')) {
        if (fs.existsSync(c)) return c;
      } else {
        execFileSync('which', [c], { stdio: 'pipe' });
        return c;
      }
    } catch (_) {}
  }
  throw new Error('Chrome/Chromium not found');
}

async function main() {
  if (!fs.existsSync(HTML)) {
    console.error('HTML not found:', HTML);
    process.exit(1);
  }

  const chrome = findChrome();
  const fileUrl = 'file://' + HTML;

  // Use playwright if available via npx, else fall back to chrome headless + delay script
  try {
    const playwright = require('playwright');
    const browser = await playwright.chromium.launch({
      executablePath: chrome.startsWith('/') ? chrome : undefined,
      headless: true,
    });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1200, height: 1600 });
    await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForFunction(
      () => {
        const blocks = document.querySelectorAll('pre.mermaid');
        if (blocks.length === 0) return true;
        return [...blocks].every((el) => el.querySelector('svg'));
      },
      { timeout: 90000 }
    );
    await page.waitForTimeout(2000);
    await page.pdf({
      path: PDF,
      format: 'A4',
      printBackground: true,
      scale: 1.0,
      margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
      preferCSSPageSize: false,
    });
    await browser.close();
    console.log('PDF written:', PDF);
    return;
  } catch (e) {
    console.warn('Playwright unavailable, using Chrome headless fallback:', e.message);
  }

  // Fallback: inject wait via temp HTML then chrome --print-to-pdf
  const tmpHtml = path.join(ROOT, 'docs/_pdf_render_tmp.html');
  let html = fs.readFileSync(HTML, 'utf8');
  html = html.replace(
    '</body>',
    `<script>
      setTimeout(() => { document.title = 'READY'; }, 8000);
    </script></body>`
  );
  fs.writeFileSync(tmpHtml, html);
  const tmpUrl = 'file://' + tmpHtml;

  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=15000',
    `--print-to-pdf=${PDF}`,
    tmpUrl,
  ], { stdio: 'inherit', timeout: 120000 });

  fs.unlinkSync(tmpHtml);
  if (!fs.existsSync(PDF)) {
    console.error('PDF generation failed');
    process.exit(1);
  }
  console.log('PDF written (fallback):', PDF);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
