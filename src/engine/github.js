// GitHub REST client for the in-app converter (repo contents + Actions + Autodesk APS).
// The app never sees the Autodesk secret: it only uploads the native file and downloads the finished GLB.
import { sealedBox, toB64, fromB64 } from '../core/crypto.js';

const API = 'https://api.github.com';

export const CONVERTER_WORKFLOW = '.github/workflows/convert-models.yml';
export const GLB_DIRS = ['converted/glb', 'public/models'];
export const MAX_UPLOAD = 75 * 1024 * 1024; // contents API practical ceiling (GitHub hard limit is 100 MB per file)

const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

function toBase64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
/** Large files: base64 in 3 MB slices (multiple of 3 → no padding mid-stream) so the whole file is never held as one giant string. */
async function blobToB64Parts(blob) {
  const parts = [];
  const SLICE = 3 * 1024 * 1024;
  for (let i = 0; i < blob.size; i += SLICE) parts.push(toBase64(new Uint8Array(await blob.slice(i, i + SLICE).arrayBuffer())));
  return parts;
}
const utf8b64 = (str) => toBase64(new TextEncoder().encode(str));

export class GitHubError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

export class GitHubRepo {
  /** @param {{repo:string, token:string, branch?:string, fetch?:Function}} o  repo = "owner/name" */
  constructor({ repo, token, branch, fetch: f }) {
    const m = String(repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').match(/^([\w.-]+)\/([\w.-]+)$/);
    if (!m) throw new Error('Repository must look like owner/name.');
    this.owner = m[1]; this.name = m[2];
    this.token = String(token || '').trim();
    if (!this.token) throw new Error('A GitHub token is required.');
    this.branch = branch || null;
    this._fetch = f || ((...a) => fetch(...a));
  }
  get slug() { return `${this.owner}/${this.name}`; }
  get webUrl() { return `https://github.com/${this.slug}`; }

  async api(path, { method = 'GET', body, rawBody, accept = 'application/vnd.github+json', raw = false } = {}) {
    let res;
    try {
      res = await this._fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...(body || rawBody ? { 'Content-Type': 'application/json' } : {}) },
      body: rawBody || (body ? JSON.stringify(body) : undefined),
      });
    } catch {
      throw new GitHubError(0, 'Cannot reach GitHub from this page (offline, or a preview sandbox that blocks network). Use the app from GitHub Pages or review3d.html.');
    }
    if (raw && res.ok) return res;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const hint = res.status === 401 ? 'Token rejected — check it has not expired.'
        : res.status === 403 ? 'Token lacks permission for this repository (needs Contents, Actions and Workflows access).'
          : res.status === 404 ? 'Not found — check the repository name and that the token can access it.' : '';
      throw new GitHubError(res.status, `${data?.message || `GitHub ${res.status}`}${hint ? ` · ${hint}` : ''}`, data);
    }
    return data;
  }

  async info() {
    const r = await this.api(`/repos/${this.owner}/${this.name}`);
    this.branch ||= r.default_branch;
    return r;
  }

  /** Repository readiness for conversion. */
  async check() {
    const r = await this.info();
    let workflow = false;
    try { await this.api(`/repos/${this.owner}/${this.name}/contents/${encPath(CONVERTER_WORKFLOW)}?ref=${encodeURIComponent(this.branch)}`); workflow = true; } catch (e) { if (e.status !== 404) throw e; }
    let secrets = null, encryptionKey = null; // null = cannot verify with this token
    try {
      const s = await this.api(`/repos/${this.owner}/${this.name}/actions/secrets`);
      const names = (s.secrets || []).map((x) => x.name);
      secrets = names.includes('APS_CLIENT_ID') && names.includes('APS_CLIENT_SECRET');
      encryptionKey = names.includes('NEXUS_KEY');
    } catch { /* token without Secrets:read */ }
    return { private: !!r.private, branch: this.branch, workflow, secrets, encryptionKey, url: r.html_url };
  }

  /** Create/replace an Actions secret (value sealed with the repository public key, as GitHub requires). */
  async setSecret(name, value) {
    const pk = await this.api(`/repos/${this.owner}/${this.name}/actions/secrets/public-key`);
    const sealed = sealedBox(new TextEncoder().encode(value), fromB64(pk.key));
    await this.api(`/repos/${this.owner}/${this.name}/actions/secrets/${encodeURIComponent(name)}`, { method: 'PUT', body: { encrypted_value: toB64(sealed), key_id: pk.key_id } });
  }

  async fileSha(path) {
    try { return (await this.api(`/repos/${this.owner}/${this.name}/contents/${encPath(path)}?ref=${encodeURIComponent(this.branch)}`)).sha; } catch (e) { if (e.status === 404) return null; throw e; }
  }

  /** content: base64 string, or an array of base64 parts (large files — sent as a Blob body instead of one huge string). */
  async putFile(path, content, message) {
    if (!this.branch) await this.info();
    const sha = await this.fileSha(path);
    const url = `/repos/${this.owner}/${this.name}/contents/${encPath(path)}`;
    const meta = { message, branch: this.branch, ...(sha ? { sha } : {}) };
    const r = typeof content === 'string'
      ? await this.api(url, { method: 'PUT', body: { ...meta, content } })
      : await this.api(url, { method: 'PUT', rawBody: new Blob([`${JSON.stringify(meta).slice(0, -1)},"content":"`, ...content, '"}'], { type: 'application/json' }) });
    return r.commit.sha;
  }

  /** files: [{path, text}] — workflow last so nothing runs half-installed. */
  async install(files, onStep) {
    if (!this.branch) await this.info();
    const ordered = [...files].sort((a, b) => (a.path.startsWith('.github/') ? 1 : 0) - (b.path.startsWith('.github/') ? 1 : 0));
    for (const f of ordered) {
      onStep?.(f.path);
      await this.putFile(f.path, utf8b64(f.text.replace(/branches: \[main\]/g, `branches: [${this.branch}]`)), `NEXUS converter: ${f.path}`);
    }
  }

  /** Commit a native model into models/incoming/ → triggers the convert workflow. Returns the commit SHA. */
  async uploadModel(blob, fileName, onProgress) {
    if (blob.size > MAX_UPLOAD + 64) throw new Error(`File is ${(blob.size / 1048576).toFixed(0)} MB — the in-app upload limit is ${MAX_UPLOAD / 1048576} MB. Use “Run workflow” with a download link on GitHub instead.`);
    if (blob.size <= 8 * 1048576) return this.putFile(`models/incoming/${fileName}`, toBase64(new Uint8Array(await blob.arrayBuffer())), `Convert ${fileName}`);
    // Large file: many small requests (3 MB each) into models/parts/<name>/NNNN — that path does not trigger the workflow.
    // The final tiny marker models/incoming/<name>.parts does; the workflow then joins the parts back into <name>.
    // Parts already on GitHub with the right size are kept, so a dropped connection costs only the missing parts.
    const PART = 3 * 1024 * 1024;
    const total = Math.ceil(blob.size / PART);
    const have = new Map((await this.listDir(`models/parts/${fileName}`)).map((f) => [f.name, f.size]));
    try {
      for (let i = 0; i < total; i++) {
        const name = String(i + 1).padStart(4, '0');
        const slice = blob.slice(i * PART, (i + 1) * PART);
        if (have.get(name) === slice.size) { onProgress?.(i + 1, total, { skipped: true }); continue; }
        onProgress?.(i + 1, total, { skipped: false });
        const b64 = toBase64(new Uint8Array(await slice.arrayBuffer()));
        for (let attempt = 0; ; attempt++) {
          try { await this.putFile(`models/parts/${fileName}/${name}`, b64, `Upload ${fileName} part ${i + 1}/${total}`); break; } catch (e) {
            if (e.status !== 0 || attempt >= 2) throw e;
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          }
        }
      }
      return await this.putFile(`models/incoming/${fileName}.parts`, utf8b64(String(total)), `Convert ${fileName}`);
    } catch (e) {
      if (e.status === 0) throw new GitHubError(0, 'Upload to GitHub was interrupted (connection dropped or the device ran out of memory on this large file). Try again on a stable connection, or use “Run workflow” with a download link on GitHub.');
      throw e;
    }
  }

  /** Files directly inside a repository folder ([] when it does not exist). */
  async listDir(path) {
    if (!this.branch) await this.info();
    try {
      const r = await this.api(`/repos/${this.owner}/${this.name}/contents/${encPath(path)}?ref=${encodeURIComponent(this.branch)}`);
      return Array.isArray(r) ? r.filter((f) => f.type === 'file').map((f) => ({ name: f.name, size: f.size })) : [];
    } catch (e) { if (e.status === 404) return []; throw e; }
  }

  async runForCommit(sha) {
    const r = await this.api(`/repos/${this.owner}/${this.name}/actions/runs?head_sha=${sha}&per_page=10`);
    return (r.workflow_runs || []).find((x) => (x.path || '').endsWith('convert-models.yml')) || r.workflow_runs?.[0] || null;
  }
  async run(runId) { return this.api(`/repos/${this.owner}/${this.name}/actions/runs/${runId}`); }
  async steps(runId) {
    const r = await this.api(`/repos/${this.owner}/${this.name}/actions/runs/${runId}/jobs`);
    return (r.jobs?.[0]?.steps || []).map((s) => ({ name: s.name, status: s.status, conclusion: s.conclusion }));
  }

  async rawFile(path) {
    if (!this.branch) await this.info();
    const res = await this.api(`/repos/${this.owner}/${this.name}/contents/${encPath(path)}?ref=${encodeURIComponent(this.branch)}`, { accept: 'application/vnd.github.raw+json', raw: true });
    return res;
  }
  /** Entries produced for a given uploaded file name, with the folder they live in. */
  async findOutputs(fileName) {
    for (const dir of GLB_DIRS) {
      try {
        const idx = await (await this.rawFile(`${dir}/index.json`)).json();
        const hits = (idx.models || []).filter((m) => m.source === fileName);
        if (hits.length) return hits.map((m) => ({ ...m, path: `${dir}/${m.file}` }));
      } catch (e) { if (e.status !== 404) throw e; }
    }
    return [];
  }
  /** Every converted model in the repository (newest first), with its path. */
  async listOutputs() {
    const all = [];
    for (const dir of GLB_DIRS) {
      try {
        const idx = await (await this.rawFile(`${dir}/index.json`)).json();
        for (const m of idx.models || []) all.push({ ...m, path: `${dir}/${m.file}` });
      } catch (e) { if (e.status !== 404) throw e; }
    }
    return all.sort((a, b) => String(b.converted || '').localeCompare(String(a.converted || '')));
  }
  async download(path) { return (await this.rawFile(path)).blob(); }
}
