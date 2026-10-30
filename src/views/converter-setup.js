// One-time setup for the in-app converter (GitHub repo + token; Autodesk keys optional).
// Optional client-side encryption for public repositories (key = repository secret NEXUS_KEY).
import { h, modal, toast } from '../core/ui.js';
import { getConverter, setConverter, repoClient } from '../core/jobs.js';
import { CONVERTER_FILES } from '../core/converter-files.js';
import { newKey, validKey } from '../core/crypto.js';

const A = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
const chip = (ok, label) => h('span', { class: 'chip dot', style: { '--c': ok === true ? 'var(--green)' : ok === false ? 'var(--red)' : 'var(--yellow)' } }, label);

export async function openConverterSetup() {
  const cfg = (await getConverter()) || {};
  const repoIn = h('input', { class: 'inp mono', id: 'cv-repo', placeholder: 'username/repo', value: cfg.repo || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
  const tokIn = h('input', { class: 'inp mono', id: 'cv-token', type: 'password', placeholder: 'github_pat_…', value: cfg.token || '', autocomplete: 'off' });
  const keyIn = h('input', { class: 'inp mono', id: 'cv-key', placeholder: 'created automatically for public repositories', value: cfg.key || '', autocomplete: 'off', spellcheck: false });
  const encIn = h('input', { type: 'checkbox', id: 'cv-enc', checked: !!cfg.encrypted });
  const keyField = h('div', { class: 'field', hidden: !cfg.encrypted });
  encIn.addEventListener('change', () => { keyField.hidden = !encIn.checked; });
  const status = h('div', { class: 'btn-row', 'aria-live': 'polite' });
  const secretsLink = h('span', { class: 'mono dim2' }, 'Settings → Secrets and variables → Actions');
  keyField.append(h('label', { for: 'cv-key' }, 'Encryption key — copy it to use another device'),
    h('div', { style: { display: 'flex', gap: '8px' } }, keyIn, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => copyKey() }, 'Copy')));
  const read = () => ({ repo: repoIn.value.trim(), token: tokIn.value.trim(), key: keyIn.value.trim() });
  const refreshLink = () => {
    const r = read().repo.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '');
    secretsLink.replaceChildren(/^[\w.-]+\/[\w.-]+$/.test(r) ? A(`https://github.com/${r}/settings/secrets/actions`, `github.com/${r} → Secrets → Actions`) : 'Settings → Secrets and variables → Actions');
  };
  repoIn.addEventListener('input', refreshLink);
  refreshLink();
  const copyKey = async () => {
    try { await navigator.clipboard.writeText(keyIn.value); toast('Key copied.', 'ok'); } catch { keyIn.select(); toast('Select the key and copy it.', 'warn'); }
  };

  const check = async () => {
    status.replaceChildren(h('span', { class: 'mono dim2' }, 'Checking…'));
    try {
      const gh = await repoClient(read());
      const c = await gh.check();
      status.replaceChildren(
        c.private ? chip(true, 'Private repo') : encIn.checked ? chip(c.encryptionKey ? true : null, c.encryptionKey ? 'Public repo · encrypted' : 'Public repo · key not saved yet') : chip(null, 'Public repo · not encrypted'),
        chip(c.workflow, c.workflow ? 'Converter installed' : 'Converter not installed'),
        chip(c.secrets === true ? true : null, c.secrets === true ? 'Autodesk keys set' : 'Autodesk keys: optional (DWFx/SKP)'),
      );
      return c;
    } catch (e) {
      status.replaceChildren(chip(false, e.message));
      return null;
    }
  };

  /** Public repo: make sure a key exists here and as the NEXUS_KEY secret. Returns the config to save. */
  async function prepare(gh, info) {
    const v = read();
    if (info.private || !encIn.checked) return { repo: v.repo, token: v.token, branch: gh.branch, encrypted: false, key: v.key || undefined };
    let key = v.key;
    if (key && !validKey(key)) throw new Error('The encryption key is not valid (expected 44 characters of base64).');
    const fresh = !key;
    if (fresh) { key = newKey(); keyIn.value = key; }
    try {
      await gh.setSecret('NEXUS_KEY', key);
    } catch (e) {
      if (fresh) { keyIn.value = ''; }
      throw new Error(`Could not save the encryption key to GitHub (${e.message}). Give the token “Secrets: Read and write”, or add a secret named NEXUS_KEY with this key yourself.`);
    }
    return { repo: v.repo, token: v.token, branch: gh.branch, encrypted: true, key };
  }

  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
    h('p', { class: 'dim2', style: { margin: 0 } }, 'Conversions run on GitHub’s servers in your repository. NWD and NWC are read by an independent open-source reader — no Autodesk account needed. Optional encryption keeps models unreadable in a public repository.'),
    h('ol', { style: { margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--fg-2)' } },
      h('li', {}, 'Token: ', A('https://github.com/settings/personal-access-tokens/new', 'fine-grained token'), ' → Repository access: only your repository → permissions ', h('b', {}, 'Contents: Read & write, Actions: Read, Workflows: Read & write'), ' (Secrets: Read & write only if you turn on encryption).'),
      h('li', {}, 'Paste repository and token below → ', h('b', {}, 'Install converter'), ' → ', h('b', {}, 'Save'), '.'),
      h('li', {}, h('i', {}, 'Optional, for DWFx/SKP/RVT/IFC: '), A('https://aps.autodesk.com/hubs', 'aps.autodesk.com/hubs'), ' → Create application → ', h('b', {}, 'Traditional Web App'), ', callback ', h('span', { class: 'mono' }, location.origin + location.pathname), ', API access Data Management + Model Derivative → secrets ', h('span', { class: 'mono' }, 'APS_CLIENT_ID'), ' and ', h('span', { class: 'mono' }, 'APS_CLIENT_SECRET'), ' at ', secretsLink, '.')),
    h('div', { class: 'form-grid', style: { gridTemplateColumns: '1fr' } },
      h('div', { class: 'field' }, h('label', { for: 'cv-repo' }, 'Repository (owner/name)'), repoIn),
      h('div', { class: 'field' }, h('label', { for: 'cv-token' }, 'GitHub fine-grained token'), tokIn),
      h('label', { class: 'check', for: 'cv-enc' }, encIn, 'Encrypt uploads (needs Secrets permission; files in a public repo are otherwise downloadable by anyone)'),
      keyField),
    status,
    h('p', { class: 'mono dim', style: { margin: 0, fontSize: '11px' } }, 'NWD/NWC engine: nwd-reader by 1817716374 (PolyForm Noncommercial 1.0.0 — free for personal/non-commercial use; commercial use needs a licence from its author). Autodesk formats are sent to Autodesk’s transient storage (auto-deleted after ~24 h). With encryption on, keep the key safe: without it, encrypted results cannot be opened.'));

  modal({
    title: 'Model converter', eyebrow: 'NWD reader on GitHub Actions', wide: true, body,
    actions: [
      { label: 'Check', icon: 'search', onClick: async () => { await check(); return false; } },
      { label: 'Install converter', icon: 'download', kind: 'mag', onClick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const gh = await repoClient(read());
          const info = await gh.info();
          const next = await prepare(gh, info);
          await gh.install(CONVERTER_FILES, (p) => status.replaceChildren(h('span', { class: 'mono dim2' }, `Installing ${p}…`)));
          await setConverter(next);
          toast(next.encrypted ? 'Converter installed with encryption. Press Save, then convert.' : 'Converter installed. Press Save, then convert NWD/NWC files.', 'ok', 'Installed');
          await check();
        } catch (err) { toast(err.message, 'err'); status.replaceChildren(chip(false, err.message)); } finally { btn.disabled = false; }
        return false;
      } },
      { label: 'Save', kind: 'primary', icon: 'check', onClick: async () => {
        const v = read();
        if (!v.repo || !v.token) { toast('Fill in repository and token.', 'warn'); return false; }
        try {
          const gh = await repoClient(v);
          const info = await gh.info();
          let next;
          if (!info.private && encIn.checked && v.key && validKey(v.key)) next = { repo: v.repo, token: v.token, branch: gh.branch, encrypted: true, key: v.key }; // key already in GitHub (other device)
          else next = await prepare(gh, info);
          await setConverter(next);
        } catch (e) { toast(e.message, 'err'); return false; }
        toast('Converter settings saved on this device.', 'ok');
        return true;
      } },
    ],
  });
  if (cfg.repo && cfg.token) check();
}
