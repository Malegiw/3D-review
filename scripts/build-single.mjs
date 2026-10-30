// Packs the Vite build into ONE self-contained HTML file (CSS, fonts, app JS, pdf.js worker and samples inlined).
// Output:
//   dist/nexus3d.html          full document — double-click to run offline on a laptop
//   dist/nexus3d.preview.html  same content without <html>/<head>/<body> — for sandboxed hosts that wrap the page
// Usage: npm run build:single
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const pick = (re, what) => { const m = html.match(re); if (!m) throw new Error(`${what} not found in dist/index.html`); return m[1]; };
const jsPath = pick(/<script type="module"[^>]*src="\.\/([^"]+)"/, 'entry script');
const cssPath = pick(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/, 'stylesheet');
const worker = fs.readdirSync(path.join(dist, 'assets')).find((f) => /^pdf\.worker.*\.m?js$/.test(f));

// Inline text must not close its <script> early or open an HTML comment state.
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

let css = fs.readFileSync(path.join(dist, cssPath), 'utf8');
css = css.replace(/@font-face\{[^}]*devanagari[^}]*\}/g, ''); // Latin + Latin-ext only
css = css.replace(/,url\(\.\/[^)]+\.woff\)\s*format\("woff"\)/g, '');
css = css.replace(/url\(\.\/([^)]+\.woff2)\)/g, (_, f) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(dist, 'assets', f)).toString('base64')})`);

const js = safe(fs.readFileSync(path.join(dist, jsPath), 'utf8'));
const workerJs = worker ? safe(fs.readFileSync(path.join(dist, 'assets', worker), 'utf8')) : '';
const b64 = (p) => (fs.existsSync(p) ? fs.readFileSync(p).toString('base64') : '');
const samples = JSON.stringify({ pdf: b64(path.join(dist, 'samples', 'sample-plotplan.pdf')), glb: b64(path.join(dist, 'samples', 'sample-contractor-model.glb')) });

const meta = `<title>NEXUS 3D Review</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="NEXUS 3D Review by YMD — plot plan PDF to 3D, contractor model review, clash detection, MTO and deliverable tracking.">
<meta name="theme-color" content="#07060c">`;
const body = `<style>${css}</style>
<div id="app" aria-live="polite"></div>
<div id="toasts" class="toasts" role="status"></div>
<script id="nx-samples" type="application/json">${safe(samples)}</script>
<script id="nx-pdf-worker" type="text/plain">${workerJs}</script>
<script type="module">${js}</script>`;

const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${meta}
</head>
<body>
${body}
</body>
</html>
`;
// Sandboxed hosts already pad :root by the safe-area insets, so the app must not add them a second time.
const preview = `${meta}\n${body}\n<style>:root{--sa-top:0px;--sa-bottom:0px}</style>\n`;

fs.writeFileSync(path.join(dist, 'nexus3d.html'), full);
fs.writeFileSync(path.join(dist, 'nexus3d.preview.html'), preview);
const mb = (s) => (Buffer.byteLength(s) / 1048576).toFixed(2);
console.log(`single-file: dist/nexus3d.html ${mb(full)} MB · dist/nexus3d.preview.html ${mb(preview)} MB`);
