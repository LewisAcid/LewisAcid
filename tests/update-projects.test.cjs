const test = require('node:test');
const assert = require('node:assert/strict');
const update = require('../scripts/update-projects.cjs');
const { render, replaceSection } = update;
const owner = 'example';
const repo = (name, extra = {}) => ({ name, owner: { login: owner },
  created_at: '2026-01-01T00:00:00Z', private: false, archived: false,
  fork: false, description: null, language: null, ...extra });
const readme = 'INTRO\n<!-- PROJECTS:START -->\nold\n<!-- PROJECTS:END -->\nCONTACT';

test('new projects appear first; private, archived, foreign and profile repos are excluded', () => {
  const result = render([repo('old'), repo('new', { created_at: '2026-09-17T00:00:00Z' }),
    repo('secret', { private: true }), repo('archived', { archived: true }),
    repo('foreign', { owner: { login: 'someone' } }), repo('EXAMPLE')], owner);
  assert.ok(result.indexOf('>new<') < result.indexOf('>old<'));
  for (const name of ['secret', 'archived', 'foreign', 'EXAMPLE']) assert.ok(!result.includes(`>${name}<`));
});
test('separate limits for projects and forks', () => {
  const result = render(Array.from({ length: 12 }, (_, i) => repo(`project${i}`))
    .concat(Array.from({ length: 7 }, (_, i) => repo(`fork${i}`, { fork: true }))), owner);
  assert.equal((result.match(/<b>project/g) || []).length, 6);
  assert.equal((result.match(/<b>fork/g) || []).length, 3);
});
test('metadata cannot inject HTML or break out of the surrounding table cell', () => {
  const result = render([repo('demo', { description: '</td><img src=x onerror="alert(1)">\nnext & more' })], owner);
  assert.ok(!result.includes('</td>'));
  assert.ok(!result.includes('<img'));
  assert.ok(!result.includes('onerror="'));
  assert.ok(result.includes('&#60;/td&#62;'));
  assert.ok(result.includes('next &#38; more'));
});
test('long descriptions are truncated so the narrow column stays readable', () => {
  const result = render([repo('demo', { description: 'x'.repeat(200) })], owner);
  assert.ok(result.includes('…'));
  assert.ok(!result.includes('x'.repeat(100)));
});
test('names and languages are url- and html-safe', () => {
  const result = render([repo('a b&c', { language: 'C++' })], owner);
  assert.ok(result.includes('https://github.com/example/a%20b%26c'));
  assert.ok(result.includes('<b>a b&#38;c</b>'));
  assert.ok(result.includes('· C++'));
});
test('only marker section changes and reruns are idempotent', () => {
  const next = replaceSection(readme, render([], owner));
  assert.ok(next.startsWith('INTRO\n<!-- PROJECTS:START -->'));
  assert.ok(next.endsWith('<!-- PROJECTS:END -->\nCONTACT'));
  assert.equal(replaceSection(next, render([], owner)), next);
  assert.throws(() => replaceSection('no markers', 'x'));
  assert.throws(() => replaceSection(readme + '<!-- PROJECTS:END -->', 'x'));
  assert.throws(() => replaceSection('<!-- PROJECTS:END --><!-- PROJECTS:START -->', 'x'));
});
function mock(previous, fail = false) {
  const writes = [];
  return { writes, context: { repo: { owner, repo: owner }, payload: { repository: { default_branch: 'main' } } },
    core: { info() {} }, github: { paginate: async () => { if (fail) throw new Error('API unavailable'); return []; },
      rest: { repos: { listForUser() {}, getContent: async ({ path }) => ({ data: { type: 'file', encoding: 'base64',
        sha: 'current-sha', content: Buffer.from(typeof previous === 'string' ? previous : previous[path]).toString('base64') } }),
      createOrUpdateFileContents: async data => writes.push(data) } } } };
}
test('API writes the README on the default branch with concurrency protection', async () => {
  const env = mock(readme); await update(env);
  assert.equal(env.writes.length, 1);
  assert.equal(env.writes[0].path, 'README.md');
  assert.equal(env.writes[0].sha, 'current-sha');
  assert.equal(env.writes[0].branch, 'main');
  assert.ok(Buffer.from(env.writes[0].content, 'base64').toString('utf8').includes('View all repositories'));
});
test('unchanged content or failed API never writes', async () => {
  const env = mock(replaceSection(readme, render([], owner))); await update(env);
  assert.equal(env.writes.length, 0);
  const failed = mock(readme, true);
  await assert.rejects(update(failed), /API unavailable/);
  assert.equal(failed.writes.length, 0);
});
test('invalid markers prevent any write', async () => {
  const env = mock('missing markers');
  await assert.rejects(update(env), /marker pair/);
  assert.equal(env.writes.length, 0);
});
