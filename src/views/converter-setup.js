// One-time setup for the in-app converter: private GitHub repo + token + Autodesk keys (as repo secrets).
import { h, modal, toast } from '../core/ui.js';
import { getConverter, setConverter, repoClient } from '../core/jobs.js';
import { CONVERTER_FILES } from '../core/converter-files.js';

const A = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
const chip = (ok, label) => h('span', { class: 'chip dot', style: { '--c': ok === true ? 'var(--green)' : ok === false ? 'var(--red)' : 'var(--yellow)' } }, label);

export async function openConverterSetup() {
  const cfg = (await getConverter()) || {};
  const repoIn = h('input', { class: 'inp mono', id: 'cv-repo', placeholder: 'username/nexus3d-converter', value: cfg.repo || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
  const tokIn = h('input', { class: 'inp mono', id: 'cv-token', type: 'password', placeholder: 'github_pat_…', value: cfg.token || '', autocomplete: 'off' });
  const status = h('div', { class: 'btn-row', 'aria-live': 'polite' });
  const secretsLink = h('span', { class: 'mono dim2' }, 'Settings → Secrets and variables → Actions');
  const read = () => ({ repo: repoIn.value.trim(), token: tokIn.value.trim() });
  const refreshLink = () => {
    const r = read().repo.replace(/^https?:\/\/github\.com\//i, '');
    secretsLink.replaceChildren(/^[\w.-]+\/[\w.-]+$/.test(r) ? A(`https://github.com/${r}/settings/secrets/actions`, `github.com/${r} → Secrets → Actions`) : 'Settings → Secrets and variables → Actions');
  };
  repoIn.addEventListener('input', refreshLink);
  refreshLink();

  const check = async () => {
    status.replaceChildren(h('span', { class: 'mono dim2' }, 'Checking…'));
    try {
      const gh = await repoClient(read());
      const c = await gh.check();
      status.replaceChildren(
        chip(c.private, c.private ? 'Private repo' : 'PUBLIC repo — use a private one'),
        chip(c.workflow, c.workflow ? 'Converter installed' : 'Converter not installed'),
        chip(c.secrets === true ? true : null, c.secrets === true ? 'Autodesk keys set' : 'Autodesk keys: optional (DWFx/SKP)'),
      );
      return c;
    } catch (e) {
      status.replaceChildren(chip(false, e.message));
      return null;
    }
  };

  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
    h('p', { class: 'dim2', style: { margin: 0 } }, 'Conversions run in your own private GitHub repository. NWD and NWC files are read by an independent open-source reader on GitHub’s servers — no Autodesk account needed. DWFx, SKP, RVT and IFC additionally need free Autodesk keys. This device only stores the repository name and a GitHub token.'),
    h('ol', { style: { margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--fg-2)' } },
      h('li', {}, 'GitHub: ', A('https://github.com/new', 'github.com/new'), ' → name e.g. ', h('span', { class: 'mono' }, 'nexus3d-converter'), ', ', h('b', {}, 'Private'), ', tick “Add a README”.'),
      h('li', {}, 'Token: ', A('https://github.com/settings/personal-access-tokens/new', 'fine-grained token'), ' → only that repository → permissions ', h('b', {}, 'Contents: Read & write, Actions: Read, Workflows: Read & write'), '.'),
      h('li', {}, 'Paste repo and token below → ', h('b', {}, 'Install converter'), ' → ', h('b', {}, 'Save'), '. NWD/NWC conversion works from here on.'),
      h('li', {}, h('i', {}, 'Optional, for DWFx/SKP/RVT/IFC: '), A('https://aps.autodesk.com/hubs', 'aps.autodesk.com/hubs'), ' → Create application → ', h('b', {}, 'Traditional Web App'), ', callback ', h('span', { class: 'mono' }, location.origin + location.pathname), ', API access Data Management + Model Derivative → add secrets ', h('span', { class: 'mono' }, 'APS_CLIENT_ID'), ' and ', h('span', { class: 'mono' }, 'APS_CLIENT_SECRET'), ' at ', secretsLink, '.')),
    h('div', { class: 'form-grid', style: { gridTemplateColumns: '1fr' } },
      h('div', { class: 'field' }, h('label', { for: 'cv-repo' }, 'Private repository (owner/name)'), repoIn),
      h('div', { class: 'field' }, h('label', { for: 'cv-token' }, 'GitHub fine-grained token'), tokIn)),
    status,
    h('p', { class: 'mono dim', style: { margin: 0, fontSize: '11px' } }, 'NWD/NWC engine: nwd-reader by 1817716374 (PolyForm Noncommercial 1.0.0 — free for personal/non-commercial use; commercial use needs a licence from its author). Autodesk formats are sent to Autodesk’s transient storage (auto-deleted after ~24 h). Check both against your company’s policy.'));

  modal({
    title: 'Model converter', eyebrow: 'NWD READER · AUTODESK APS · GITHUB', wide: true, body,
    actions: [
      { label: 'Check', icon: 'search', onClick: async () => { await check(); return false; } },
      { label: 'Install converter', icon: 'download', kind: 'mag', onClick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const gh = await repoClient(read());
          const info = await gh.info();
          if (!info.private) { toast('This repository is public. Use a private repository for company models.', 'err', 'NOT INSTALLED'); return false; }
          await gh.install(CONVERTER_FILES, (p) => status.replaceChildren(h('span', { class: 'mono dim2' }, `Installing ${p}…`)));
          await setConverter({ ...read(), branch: gh.branch });
          toast('Converter installed. Add the two Autodesk secrets, then convert a file.', 'ok', 'INSTALLED');
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
          if (!info.private) { toast('This repository is public. Model files would be visible to everyone — use a separate private repository for the converter.', 'err', 'NOT SAVED'); return false; }
          await setConverter({ ...v, branch: gh.branch });
        } catch (e) { toast(e.message, 'err'); return false; }
        toast('Converter settings saved on this device.', 'ok');
        return true;
      } },
    ],
  });
  if (cfg.repo && cfg.token) check();
}

