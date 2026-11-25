// Browser smoke test of the built app (CI and local): opens the sample project, loads the Seruni 4D demo,
// scrubs the timeline, builds the weekly and monthly reports, and fails on any page error.
// Usage: npx vite build && npx vite preview --port 4173 & node scripts/smoke.mjs   (CHROME_PATH=… to use a local Chrome)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const fail = (msg) => { console.error(`SMOKE FAIL: ${msg}`); process.exitCode = 1; };
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND/.test(m.text())) errors.push(`console: ${m.text()}`); });
try {
  await page.goto(BASE);
  await page.waitForSelector('a[href^="#p-"]', { timeout: 30000 });
  const href = await page.locator('a[href^="#p-"]').first().getAttribute('href');
  await page.goto(BASE + href.replace('overview', 'review'));
  await page.waitForSelector('button.tool', { timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.locator('button.tool[data-tip="Progres 4D"], button.tool[data-tip="4D progress"]').first().click();
  await page.locator('button', { hasText: /Seruni WF/ }).first().click();
  await page.waitForSelector('.p4-stats', { timeout: 60000 });
  await page.waitForTimeout(3000);
  const stat = await page.locator('.p4-stats .stat-v').first().textContent();
  if (!/%/.test(stat || '')) fail(`stats band shows "${stat}"`);
  await page.evaluate(() => { const s = document.querySelector('.p4-slider'); s.value = 80; s.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(1500);
  const day = await page.locator('.p4-when').textContent();
  if (!/81/.test(day || '')) fail(`timeline did not move: "${day}"`);
  for (const [i, kind] of [[0, 'weekly'], [1, 'monthly']]) {
    await page.locator('.p4-repbox .seg button').nth(i).click();
    const [rep] = await Promise.all([ctx.waitForEvent('page'), page.locator('.p4-rep').click()]);
    await rep.waitForLoadState();
    const title = await rep.title();
    const kpis = await rep.locator('.kpi').count();
    if (kpis !== 4) fail(`${kind} report has ${kpis} KPI tiles`);
    if (!(await rep.locator('svg.chart').count())) fail(`${kind} report has no S-curve`);
    console.log(`ok ${kind} report: ${title}`);
    await rep.close();
  }
} catch (e) { fail(e.stack || String(e)); }
if (errors.length) { fail(`${errors.length} page errors`); console.error(errors.slice(0, 10).join('\n')); }
await browser.close();
if (!process.exitCode) console.log('SMOKE OK');
