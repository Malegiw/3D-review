// Cache of neon ground textures rendered from plot plan PDFs.
import { openPdf, renderPage, closePdf } from './pdf.js';
import { neonGround } from './plotbuild.js';

const cache = new Map();
const keyOf = (plan) => `${plan.id}:${plan.page || 1}:${plan.pdf?.size || 0}`;

export function putGround(plan, srcCanvas) {
  if (plan?.pdf && srcCanvas) cache.set(keyOf(plan), neonGround(srcCanvas));
}

export async function getGround(plan) {
  if (!plan?.pdf) return null;
  const k = keyOf(plan);
  if (cache.has(k)) return cache.get(k);
  const doc = await openPdf(plan.pdf);
  try {
    const page = await doc.getPage(plan.page || 1);
    const { canvas } = await renderPage(page, 2048);
    const g = neonGround(canvas);
    cache.set(k, g);
    return g;
  } finally { closePdf(doc); }
}
