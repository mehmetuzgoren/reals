import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, chmod, open, unlink, realpath, lstat } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const origin = 'https://first-mandrill-982.convex.cloud';
const site = 'https://first-mandrill-982.convex.site';
const usernamePattern = /^[a-z0-9_]{3,24}$/;
export function requireSeed(condition, message) { if (!condition) throw new Error(message); }
export async function collectPages(load) {
  const items = [];
  const seen = new Set();
  let cursor = null;
  do {
    const page = await load(cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
    requireSeed(cursor === null || !seen.has(cursor), 'Pagination cursor repeated');
    seen.add(cursor);
  } while (cursor !== null);
  return items;
}
export function validatePlan(plan) {
  const people = new Map();
  for (const person of plan.people ?? []) {
    requireSeed(usernamePattern.test(person.username) && !people.has(person.username), 'Plan usernames must be unique 3–24 lowercase letters, numbers or underscores');
    requireSeed(typeof person.displayName === 'string' && person.displayName.trim() && typeof person.clip === 'string' && ['friends', 'public'].includes(person.audience), 'Each plan person needs displayName, clip and audience');
    requireSeed(Number.isInteger(person.option) || typeof person.option === 'string', 'Each plan person needs an option label or index');
    people.set(person.username, person);
  }
  requireSeed(people.size >= 2, 'Plan needs at least two people');
  if (plan.viewer) requireSeed(usernamePattern.test(plan.viewer.username) && !people.has(plan.viewer.username) && plan.viewer.displayName, 'Plan viewer needs a distinct username and displayName');
  const accounts = new Set([...people.keys(), ...(plan.viewer ? [plan.viewer.username] : [])]);
  requireSeed((plan.friends ?? []).every(name => accounts.has(name)), 'Friends must be plan accounts');
  const posters = name => people.has(name);
  for (const reply of plan.replies ?? []) requireSeed(posters(reply.author) && posters(reply.parent) && reply.author !== reply.parent && typeof reply.clip === 'string', 'Replies need two posting people and a clip');
  for (const comment of plan.comments ?? []) requireSeed(posters(comment.author) && posters(comment.parent) && comment.text?.trim().length > 0 && comment.text.trim().length <= 300, 'Comments need posting people and 1–300 characters');
  for (const [who, author] of plan.likes ?? []) requireSeed(posters(who) && posters(author), 'Likes need posting people');
  for (const [who, author] of plan.votes ?? []) requireSeed(posters(who) && posters(author) && people.get(author).audience === 'public', 'Votes need a posting voter and a public author');
  return people;
}

export async function seed({ statePath, plan, clipDirectory, friendUsername, viewerPassword, fetcher = fetch }) {
  const people = validatePlan(plan);
  statePath = resolve(statePath);
  const repository = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  const guardPath = path => requireSeed(!path.startsWith(`${repository}/`) && !path.includes('/.capy/drive/'), 'Keep seed credentials outside the repository and Drive');
  guardPath(statePath);
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
  statePath = resolve(await realpath(dirname(statePath)), basename(statePath));
  guardPath(statePath);
  try { requireSeed(!(await lstat(statePath)).isSymbolicLink(), 'Seed state must not be a symlink'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const clips = new Map();
  for (const name of new Set([...people.values()].map(person => person.clip).concat((plan.replies ?? []).map(reply => reply.clip)))) {
    const bytes = await readFile(resolve(clipDirectory, name));
    requireSeed(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024, `${name} must be 1 byte to 8 MiB`);
    clips.set(name, bytes);
  }
  if (plan.viewer) requireSeed(viewerPassword?.length >= 10, 'Set TAKES_VIEWER_PASSWORD (at least 10 characters) for the viewer account');
  const lock = await open(`${statePath}.lock`, 'wx', 0o600);
  let state;
  const save = async () => {
    const temporary = `${statePath}.${randomBytes(8).toString('hex')}.next`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
    await chmod(temporary, 0o600);
    await rename(temporary, statePath);
  };
  try {
    try { state = JSON.parse(await readFile(statePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    state ??= { origin, accounts: {}, rounds: {} };
    requireSeed(state.origin === origin, 'Seed state belongs to a different deployment');
    await save();
    const raw = async (kind, path, args, token) => {
      const response = await fetcher(`${origin}/api/${kind}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ path, args, format: 'json' }),
      });
      const body = await response.json();
      requireSeed(response.ok && body.status === 'success', `${path} failed; response withheld`);
      return body.value;
    };
    const signIn = async account => {
      const signed = await raw('mutation', 'auth:signInWithUsernamePassword', { username: account.username, password: account.password });
      requireSeed(signed.status === 'complete' && signed.tokens, 'Sign-in incomplete');
      return signed.tokens;
    };
    const api = async (name, kind, path, args = {}) => {
      const account = state.accounts[name];
      const expiry = JSON.parse(Buffer.from(account.tokens.accessToken.split('.')[1], 'base64url')).exp;
      if (expiry * 1000 < Date.now() + 15000) {
        const refreshed = await raw('mutation', 'auth:refreshSession', { refreshToken: account.tokens.refreshToken });
        account.tokens = refreshed.kind === 'rotated' ? refreshed.tokens : await signIn(account);
        await save();
      }
      return raw(kind, path, args, account.tokens.accessToken);
    };
    const all = (name, path, args) => collectPages(cursor => api(name, 'query', path, { ...args, cursor, limit: 50 }));
    const accounts = [...people.values(), ...(plan.viewer ? [{ ...plan.viewer, viewer: true }] : [])];
    for (const { username: name, displayName, viewer } of accounts) {
      const account = state.accounts[name] ??= { username: name, password: viewer ? viewerPassword : randomBytes(32).toString('base64url') };
      if (viewer) account.password = viewerPassword;
      await save();
      if (!account.tokens) {
        try { account.tokens = await signIn(account); }
        catch {
          const signed = await raw('mutation', 'auth:signUpWithUsernamePassword', { username: name, password: account.password });
          requireSeed(signed.status === 'complete' && signed.tokens, `${name} sign-up did not complete (username may belong to someone else)`);
          account.tokens = signed.tokens;
        }
        await save();
      }
      account.profile = await api(name, 'mutation', 'profiles:completeOnboarding', { username: name, displayName });
      requireSeed(account.profile.username === name && account.profile.id === account.tokens.userId, 'Seed profile identity mismatch');
      await save();
    }
    const group = plan.friends ?? [];
    for (let i = 0; i < group.length; i++) for (const recipient of group.slice(i + 1)) {
      const sender = group[i];
      const request = await api(sender, 'mutation', 'friends:request', { userId: state.accounts[recipient].profile.id });
      if (request.relationship !== 'approved') {
        const acceptor = request.relationship === 'incoming' ? sender : recipient;
        await api(acceptor, 'mutation', 'friends:respond', { requestId: request.requestId, accept: true });
      }
    }
    const first = [...people.keys()][0];
    const today = await api(first, 'query', 'rounds:today');
    requireSeed(today.round?.isCurrent && today.round.options.length >= 2, 'No open round; no round was changed');
    const round = today.round;
    if (plan.question) requireSeed(round.question === plan.question, `Current round asks "${round.question}", not the plan's question; nothing was posted`);
    const optionId = option => {
      const found = Number.isInteger(option) ? round.options[option] : round.options.find(item => item.label.toLowerCase() === option.toLowerCase() || item.id === option);
      requireSeed(found, `Round has no option ${option}`);
      return found.id;
    };
    const record = state.rounds[round.id] ??= { originals: {}, replies: {}, intents: {} };
    await save();
    const publish = async (name, key, clip, optionId, audience, originalId = null) => {
      const kind = originalId ? 'reply' : 'original';
      const collection = kind === 'reply' ? record.replies : record.originals;
      if (collection[key]) return collection[key];
      const args = { requestId: `takes-seed-v2-${round.id}-${key}`.slice(0, 128), kind, roundId: round.id, optionId, originalId, ...(kind === 'original' ? { audience } : {}) };
      const intent = await api(name, 'mutation', 'uploads:begin', args);
      record.intents[key] = intent.uploadId;
      await save();
      const status = await api(name, 'query', 'uploads:status', { uploadId: intent.uploadId });
      let result = status.result;
      if (status.state !== 'published' && status.state !== 'processing') {
        try { result = await api(name, 'action', 'uploads:finalize', { uploadId: intent.uploadId }); }
        catch (error) { requireSeed(error.message === 'uploads:finalize failed; response withheld', 'Publication recovery failed'); }
      }
      if (!result && status.state !== 'processing') {
        requireSeed(new URL(intent.uploadUrl).origin === site && new URL(intent.uploadUrl).pathname === `/v1/uploads/${intent.uploadId}/video`, 'Unexpected upload destination');
        await api(name, 'query', 'viewer:session');
        const response = await fetcher(intent.uploadUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000), headers: { 'Content-Type': 'video/mp4', Authorization: `Bearer ${state.accounts[name].tokens.accessToken}` }, body: clips.get(clip) });
        requireSeed(response.ok, `${clip} upload failed; response withheld`);
      }
      result ??= await api(name, 'action', 'uploads:finalize', { uploadId: intent.uploadId });
      requireSeed(result.state === 'published', `${clip} was not published (${result.failure?.code ?? 'incomplete'}); rerun with the same state after fixing it`);
      collection[key] = kind === 'original' ? result.originalId : result.replyId;
      await save();
      return collection[key];
    };
    for (const person of people.values()) {
      const own = await api(person.username, 'query', 'rounds:today');
      requireSeed(own.round?.id === round.id, 'Round changed during seed; rerun');
      if (own.ownOriginal) record.originals[person.username] = own.ownOriginal.id;
      else requireSeed(!own.viewerReceipt, `${person.username}'s original was deleted; cannot republish this round`);
      await save();
      await publish(person.username, person.username, person.clip, optionId(person.option), person.audience);
    }
    for (const reply of plan.replies ?? []) {
      const key = `${reply.author}>${reply.parent}`;
      const existing = (await all(reply.author, 'replies:list', { originalId: record.originals[reply.parent] })).find(item => item.author.id === state.accounts[reply.author].profile.id);
      if (existing) record.replies[key] = existing.id;
      await publish(reply.author, key, reply.clip, null, null, record.originals[reply.parent]);
    }
    for (const comment of plan.comments ?? []) {
      const contentId = record.originals[comment.parent];
      const text = comment.text.trim();
      const existing = await all(comment.author, 'comments:list', { contentId, kind: 'original' });
      if (!existing.some(item => item.author.id === state.accounts[comment.author].profile.id && item.text === text)) await api(comment.author, 'mutation', 'comments:create', { contentId, kind: 'original', text });
    }
    for (const [name, author] of plan.likes ?? []) {
      const detail = await api(name, 'query', 'takes:detail', { originalId: record.originals[author] });
      if (!detail.viewerLiked) await api(name, 'mutation', 'likes:toggle', { contentId: detail.id, kind: 'original' });
    }
    const battles = new Set();
    for (const [name, author] of plan.votes ?? []) {
      const detail = await api(name, 'query', 'takes:detail', { originalId: record.originals[author] });
      requireSeed(detail.battle, `${author}'s public take has no battle opponent`);
      const battle = await api(name, 'query', 'battles:get', { battleId: detail.battle.battleId });
      await api(name, 'mutation', 'battles:vote', { battleId: battle.battleId, side: battle.left.id === detail.id ? 'left' : 'right' });
      battles.add(battle.battleId);
    }
    if (friendUsername) {
      requireSeed(usernamePattern.test(friendUsername), 'Use the exact lowercase backend username');
      for (const name of group.filter(name => people.has(name))) {
        const target = (await api(name, 'query', 'friends:search', { usernamePrefix: friendUsername, limit: 50 })).find(item => item.profile.username === friendUsername);
        requireSeed(target, 'Friend username not found');
        await api(name, 'mutation', 'friends:request', { userId: target.profile.id });
      }
    }
    const posters = group.filter(name => people.has(name));
    for (const name of group) {
      const friends = await api(name, 'query', 'friends:list');
      requireSeed(group.filter(other => other !== name).every(other => friends.approved.some(item => item.id === state.accounts[other].profile.id)), 'Friend group incomplete');
    }
    for (const name of posters) {
      const feed = await all(name, 'takes:feed', { roundId: round.id });
      requireSeed(posters.filter(other => other !== name).every(other => feed.some(item => item.id === record.originals[other])), 'Friends feed incomplete');
    }
    const publicAuthors = [...people.values()].filter(person => person.audience === 'public').map(person => person.username);
    for (const name of [...people.keys()]) {
      const publicFeed = await all(name, 'takes:forYou', { roundId: round.id });
      requireSeed(publicAuthors.filter(author => author !== name).every(author => publicFeed.some(item => item.id === record.originals[author])), 'For You feed incomplete');
    }
    for (const reply of plan.replies ?? []) {
      const visible = await all(reply.parent, 'replies:list', { originalId: record.originals[reply.parent] });
      requireSeed(visible.some(item => item.id === record.replies[`${reply.author}>${reply.parent}`]), 'Reply visibility incomplete');
    }
    await save();
    return { roundId: round.id, question: round.question, accounts: accounts.map(account => account.username), originals: Object.keys(record.originals).length, replies: Object.keys(record.replies).length, battlesVoted: battles.size, friendRequestsRequested: !!friendUsername };
  } finally {
    await lock.close();
    await unlink(`${statePath}.lock`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [planPath, clipDirectory, friendUsername] = process.argv.slice(2);
  if (!planPath || !clipDirectory) {
    console.error('Usage: node verification/seed-sample.mjs verification/seed-plans/PLAN.json /absolute/clip/directory [friend_username]');
    process.exitCode = 1;
  } else {
    try {
      const plan = JSON.parse(await readFile(planPath, 'utf8'));
      const statePath = process.env.TAKES_SEED_STATE ?? `${homedir()}/.capy/work/takes-sample-seed/accounts.json`;
      console.log(JSON.stringify(await seed({ plan, clipDirectory, friendUsername, statePath, viewerPassword: process.env.TAKES_VIEWER_PASSWORD }), null, 2));
    } catch (error) { console.error(`Seed stopped: ${error.message.startsWith('fetch') ? 'transport failed; details withheld' : error.message}`); process.exitCode = 1; }
  }
}
