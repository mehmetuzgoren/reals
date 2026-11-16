import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seed, collectPages, validatePlan } from './seed-sample.mjs';

const load = async name => JSON.parse(await readFile(new URL(`./seed-plans/${name}.json`, import.meta.url), 'utf8'));
const never = () => assert.fail('network called');

test('checked-in seed plans are valid', async () => {
  assert.equal(validatePlan(await load('sample')).size, 6);
  assert.equal(validatePlan(await load('jensen')).size, 13);
});

test('plans reject dotted usernames, duplicate people and votes on friends-only takes', async () => {
  const plan = await load('sample');
  assert.throws(() => validatePlan({ ...plan, people: [{ ...plan.people[0], username: 'jordan.lee' }, ...plan.people.slice(1)] }), /usernames/);
  assert.throws(() => validatePlan({ ...plan, people: [plan.people[0], ...plan.people] }), /usernames/);
  assert.throws(() => validatePlan({ ...plan, votes: [['sam', 'priya']] }), /public author/);
});

test('seed refuses credential state inside repository before network access', async () => {
  await assert.rejects(seed({ plan: await load('sample'), statePath: new URL('./secret.json', import.meta.url).pathname, clipDirectory: '/missing', fetcher: never }), /outside the repository/);
});

test('seed refuses credential state on Drive before network access', async () => {
  await assert.rejects(seed({ plan: await load('sample'), statePath: '/home/user/.capy/drive/project-reals/secret.json', clipDirectory: '/missing', fetcher: never }), /outside the repository/);
});

test('seed resolves symlinked parents before accepting a credential location', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'takes-seed-test-'));
  try {
    await symlink(new URL('.', import.meta.url).pathname, join(directory, 'outside'));
    await assert.rejects(seed({ plan: await load('sample'), statePath: join(directory, 'outside', 'secret.json'), clipDirectory: '/missing', fetcher: never }), /outside the repository/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a viewer account requires a supplied password before network access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'takes-seed-test-'));
  try {
    const plan = { ...(await load('sample')), viewer: { username: 'viewer_x', displayName: 'Viewer' } };
    await assert.rejects(seed({ plan, statePath: join(directory, 'state.json'), clipDirectory: '/missing', fetcher: never }), /TAKES_VIEWER_PASSWORD/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('seed follows every feed or comment page before checking existing content', async () => {
  const cursors = [];
  assert.deepEqual(await collectPages(async cursor => {
    cursors.push(cursor);
    return cursor === null ? { items: ['first'], nextCursor: 'next' } : { items: ['existing-seed'], nextCursor: null };
  }), ['first', 'existing-seed']);
  assert.deepEqual(cursors, [null, 'next']);
});

test('seed stops on cyclic pagination rather than adding duplicate content', async () => {
  await assert.rejects(collectPages(async () => ({ items: [], nextCursor: 'repeated' })), /cursor repeated/);
});
