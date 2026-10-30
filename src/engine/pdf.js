// pdf.js wrapper — legacy build for wider iOS/Android support.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { extractPaths, stitch, classify, textItems } from './pdfvector.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const asset = (p) => new URL(p, document.baseURI).href;

/** pdf.js v6 has no doc.destroy(); tear down through the loading task. */
export function closePdf(doc) { try { doc?.loadingTask?.destroy?.(); } catch { /* ignore */ } }

export async function openPdf(blob) {
  const data = new Uint8Array(await blob.arrayBuffer());
  return pdfjs.getDocument({
    data,
    isEvalSupported: false,
    standardFontDataUrl: asset('./pdfjs/standard_fonts/'),
    wasmUrl: asset('./pdfjs/wasm/'),
    verbosity: 0,
  }).promise;
}

const isSmallDevice = () => Math.min(screen.width, screen.height) < 820;

/** Render a page into a canvas whose long side is ≤ maxDim px (iOS caps canvas area at ~16.7 MP). */
export async function renderPage(page, maxDim = isSmallDevice() ? 3000 : 4096) {
  const vp1 = page.getViewport({ scale: 1 });
  const k = Math.min(maxDim / Math.max(vp1.width, vp1.height), 6);
  const vp = page.getViewport({ scale: k });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport: vp, background: '#ffffff' }).promise;
  return { canvas, vp1, k };
}

export async function analyzePage(page, { minSize = 6 } = {}) {
  const vp1 = page.getViewport({ scale: 1 });
  const ol = await page.getOperatorList();
  const raw = extractPaths(ol, pdfjs.OPS, vp1.transform);
  const paths = stitch(raw);
  const shapes = classify(paths, { minSize, pageW: vp1.width, pageH: vp1.height });
  let texts = [];
  try { texts = textItems(await page.getTextContent(), vp1.transform); } catch { /* scanned PDFs have none */ }
  return { shapes, texts, vp1, rawCount: raw.length };
}
