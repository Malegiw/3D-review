// GitHub REST client for the in-app converter (private repo + Actions + Autodesk APS).
// The app never sees the Autodesk secret: it only uploads the native file and downloads the finished GLB.
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

  async api(path, { method = 'GET', body, accept = 'application/vnd.github+json', raw = false } = {}) {
    let res;
    try {
      res = await this._fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError(0, 'Cannot reach GitHub from this page (offline, or a preview sandbox that blocks network). Use the app from GitHub Pages or nexus3d.html.');
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
    let secrets = null; // null = cannot verify with this token
    try {
      const s = await this.api(`/repos/${this.owner}/${this.name}/actions/secrets`);
      const names = (s.secrets || []).map((x) => x.name);
      secrets = names.includes('APS_CLIENT_ID') && names.includes('APS_CLIENT_SECRET');
    } catch { /* token without Secrets:read */ }
    return { private: !!r.private, branch: this.branch, workflow, secrets, url: r.html_url };
  }

  async fileSha(path) {
    try { return (await this.api(`/repos/${this.owner}/${this.name}/contents/${encPath(path)}?ref=${encodeURIComponent(this.branch)}`)).sha; } catch (e) { if (e.status === 404) return null; throw e; }
  }

  async putFile(path, base64, message) {
    if (!this.branch) await this.info();
    const sha = await this.fileSha(path);
    const r = await this.api(`/repos/${this.owner}/${this.name}/contents/${encPath(path)}`, {
      method: 'PUT', body: { message, content: base64, branch: this.branch, ...(sha ? { sha } : {}) },
    });
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
  async uploadModel(blob, fileName) {
    if (blob.size > MAX_UPLOAD) throw new Error(`File is ${(blob.size / 1048576).toFixed(0)} MB — the in-app upload limit is ${MAX_UPLOAD / 1048576} MB. Use “Run workflow” with a download link on GitHub instead.`);
    const b64 = toBase64(new Uint8Array(await blob.arrayBuffer()));
    return this.putFile(`models/incoming/${fileName}`, b64, `Convert ${fileName}`);
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
  async download(path) { return (await this.rawFile(path)).blob(); }
}
