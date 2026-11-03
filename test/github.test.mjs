import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubRepo, CONVERTER_WORKFLOW } from '../src/engine/github.js';

function mockGitHub() {
  const files = new Map([['converted/glb/index.json', JSON.stringify({ models: [{ name: 'PIPING', file: 'piping.glb', source: '123-PIPING.nwd', units: 'mm', zUp: true, size: 4 }] })], ['converted/glb/piping.glb', 'GLB!']]);
  const calls = [];
  const fetch = async (url, opt = {}) => {
    const u = new URL(url);
    calls.push(`${opt.method || 'GET'} ${u.pathname}${u.search}`);
    assert.equal(opt.headers.Authorization, 'Bearer tok');
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    const p = u.pathname;
    if (p === '/repos/yan/conv') return json({ private: true, default_branch: 'main', html_url: 'https://github.com/yan/conv' });
    if (p === '/repos/yan/conv/actions/secrets') return json({ secrets: [{ name: 'APS_CLIENT_ID' }, { name: 'APS_CLIENT_SECRET' }] });
    if (p.startsWith('/repos/yan/conv/contents/')) {
      const path = decodeURIComponent(p.slice('/repos/yan/conv/contents/'.length));
      if ((opt.method || 'GET') === 'PUT') {
        const body = JSON.parse(typeof opt.body === 'string' ? opt.body : await opt.body.text());
        assert.equal(body.branch, 'main');
        files.set(path, Buffer.from(body.content, 'base64').toString('utf8'));
        return json({ commit: { sha: 'sha-' + path.split('/').pop() } }, 201);
      }
      const kids = [...files.keys()].filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'));
      if (!files.has(path) && kids.length) return json(kids.map((k) => ({ name: k.split('/').pop(), type: 'file', size: Buffer.byteLength(files.get(k)) })));
      if (!files.has(path)) return json({ message: 'Not Found' }, 404);
      if ((opt.headers.Accept || '').includes('raw')) return new Response(files.get(path));
      return json({ sha: 'blob-' + path });
    }
    if (p === '/repos/yan/conv/actions/runs') return json({ workflow_runs: [{ id: 7, path: CONVERTER_WORKFLOW, html_url: 'https://github.com/yan/conv/actions/runs/7' }] });
    if (p === '/repos/yan/conv/actions/runs/7') return json({ id: 7, status: 'completed', conclusion: 'success', html_url: 'x' });
    if (p === '/repos/yan/conv/actions/runs/7/jobs') return json({ jobs: [{ steps: [{ name: 'Convert with Autodesk APS', status: 'completed', conclusion: 'success' }] }] });
    return json({ message: 'unexpected ' + p }, 500);
  };
  return { fetch, files, calls };
}

test('GitHubRepo: check, install, upload, find run, download output', async () => {
  const m = mockGitHub();
  const gh = new GitHubRepo({ repo: 'https://github.com/yan/conv.git', token: 'tok', fetch: m.fetch });
  assert.equal(gh.slug, 'yan/conv');
  let c = await gh.check();
  assert.deepEqual([c.private, c.workflow, c.secrets, c.branch], [true, false, true, 'main']);
  await gh.install([{ path: CONVERTER_WORKFLOW, text: 'on:\n  push:\n    branches: [main]\n' }, { path: 'tools/aps-convert.mjs', text: '// x' }]);
  const puts = m.calls.filter((x) => x.startsWith('PUT'));
  assert.ok(puts[puts.length - 1].includes('convert-models.yml'), 'workflow installed last');
  c = await gh.check();
  assert.equal(c.workflow, true);
  const sha = await gh.uploadModel(new Blob([new Uint8Array([1, 2, 3, 250])]), '123-PIPING.nwd');
  assert.equal(sha, 'sha-123-PIPING.nwd');
  assert.equal(m.files.get('models/incoming/123-PIPING.nwd').length > 0, true);
  const seen = [];
  await gh.uploadModel(new Blob([new Uint8Array(9 * 1048576)]), 'big.nwd', (i, n) => seen.push(`${i}/${n}`));
  assert.deepEqual(seen, ['1/3', '2/3', '3/3']);
  assert.ok(m.files.has('models/parts/big.nwd/0001') && m.files.has('models/parts/big.nwd/0003'));
  assert.equal(m.files.get('models/incoming/big.nwd.parts'), '3');
  assert.ok(!m.files.has('models/incoming/big.nwd'), 'only the marker triggers the workflow');
  const run = await gh.runForCommit(sha);
  assert.equal(run.id, 7);
  assert.equal((await gh.run(7)).conclusion, 'success');
  assert.equal((await gh.steps(7))[0].name, 'Convert with Autodesk APS');
  const outs = await gh.findOutputs('123-PIPING.nwd');
  assert.equal(outs.length, 1);
  assert.equal(outs[0].path, 'converted/glb/piping.glb');
  assert.equal(await (await gh.download(outs[0].path)).text(), 'GLB!');
  await assert.rejects(() => new GitHubRepo({ repo: 'yan/conv', token: 'tok', fetch: m.fetch }).api('/repos/yan/conv/contents/missing'), /Not Found/);
  assert.throws(() => new GitHubRepo({ repo: 'not a repo', token: 't' }), /owner\/name/);
});

test('GitHubRepo.uploadModel resumes: parts already on GitHub are not sent again', async () => {
  const m = mockGitHub();
  const gh = new GitHubRepo({ repo: 'https://github.com/yan/conv.git', token: 'tok', fetch: m.fetch });
  const blob = new Blob([new Uint8Array(9 * 1048576)]); // 3 parts of 3 MB
  await gh.uploadModel(blob, '1-big.nwd');
  const parts = [...m.files.keys()].filter((k) => k.startsWith('models/parts/1-big.nwd/'));
  assert.equal(parts.length, 3);

  // connection dropped after part 1: parts 2 and 3 are missing, and a stale half-written part 3 would have the wrong size
  m.files.delete('models/parts/1-big.nwd/0002');
  m.files.set('models/parts/1-big.nwd/0003', 'cut short');
  m.files.delete('models/incoming/1-big.nwd.parts');
  m.calls.length = 0;
  const seen = [];
  await gh.uploadModel(blob, '1-big.nwd', (i, n, o) => seen.push(`${i}/${n}${o?.skipped ? ' skipped' : ''}`));
  const puts = m.calls.filter((c) => c.startsWith('PUT')).map((c) => decodeURIComponent(c.split('?')[0]).split('/contents/')[1]);
  assert.deepEqual(puts, ['models/parts/1-big.nwd/0002', 'models/parts/1-big.nwd/0003', 'models/incoming/1-big.nwd.parts']);
  assert.deepEqual(seen, ['1/3 skipped', '2/3', '3/3']);
  assert.equal(m.files.get('models/incoming/1-big.nwd.parts'), '3');
});
