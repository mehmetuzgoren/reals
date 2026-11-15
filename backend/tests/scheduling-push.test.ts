import { afterEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { api, internal } from "../convex/_generated/api";
import { chooseOpening, dailyPlans } from "../convex/lib/schedule";
import { pushMessage } from "../convex/push";
import { setup, user, round, matrix } from "./helpers";

const sender = vi.hoisted(() => vi.fn());
vi.mock("../convex/lib/pushProvider", () => ({ sendPush: sender }));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); sender.mockReset(); });

async function dailyFanout(t: ReturnType<typeof setup>) {
  for (let owner = 0; owner < 6; owner++) {
    const person = await user(t, `owner${owner}`);
    for (let index = owner * 10; index < Math.min(51, (owner + 1) * 10); index++) {
      await person.client.mutation(api.devices.register, { installationId: `fanout-installation-${index}`, token: `test-private-fanout-token-${index}`, platform: "ios", notificationsEnabled: true });
    }
  }
  await round(t);
  const job = (await t.run(ctx => ctx.db.query("notificationJobs").first()))!;
  const devices = await t.run(ctx => ctx.db.query("deviceTokens").collect());
  expect(devices).toHaveLength(51); expect(new Set(devices.map(device => device.userId)).size).toBe(6);
  expect((await t.query(internal.notifications.batch, { jobId: job._id }))?.items).toEqual(devices.slice(0, 50).map(device => ({ id: device._id })));
  return { job, devices };
}

describe("one shared authoritative round", () => {
  it("chooses zoned local windows across both DST changes rather than using a fixed offset", () => {
    for (const day of ["2026-03-07", "2026-03-08", "2026-11-01", "2026-11-02"]) {
      for (const random of [0, 0.5, 0.999999]) {
        const at = chooseOpening(day, "America/Los_Angeles", 10, 20, random);
        const local = Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO("America/Los_Angeles");
        expect(local.toPlainDate().toString()).toBe(day); expect(local.hour).toBeGreaterThanOrEqual(10); expect(local.hour).toBeLessThan(20);
      }
    }
    expect(new Date(chooseOpening("2026-03-07", "America/Los_Angeles", 10, 20, 0)).getUTCHours()).toBe(18);
    expect(new Date(chooseOpening("2026-03-08", "America/Los_Angeles", 10, 20, 0)).getUTCHours()).toBe(17);
    const plans = dailyPlans(Date.parse("2026-03-08T01:00:00Z"), "America/Los_Angeles", 10, 20, () => 0.5);
    expect(plans.map(plan => plan.planKey)).toEqual(["America/Los_Angeles:2026-03-07", "America/Los_Angeles:2026-03-08", "America/Los_Angeles:2026-03-09"]);
    for (const plan of plans) {
      expect(plan.plannedAt).toBeGreaterThanOrEqual(plan.windowStartsAt); expect(plan.plannedAt).toBeLessThan(plan.windowEndsAt);
      expect(Temporal.Instant.fromEpochMilliseconds(plan.windowStartsAt).toZonedDateTimeISO("America/Los_Angeles").hour).toBe(10);
      expect(Temporal.Instant.fromEpochMilliseconds(plan.windowEndsAt).toZonedDateTimeISO("America/Los_Angeles").hour).toBe(20);
    }
    expect(() => chooseOpening("2026-03-08", "America/Los_Angeles", 20, 10, 0.5)).toThrow();
    expect(() => chooseOpening("2026-03-08", "not-a-zone", 10, 20, 0.5)).toThrow();
  });

  it("plans idempotently and closes the previous round only when its successor actually commits open", async () => {
    const t = setup(); const alex = await user(t, "alex");
    const first = await round(t);
    const { windowStartsAt, windowEndsAt } = dailyPlans(Date.now(), "America/Los_Angeles", 10, 20, () => 0)[0];
    const future = await t.mutation(internal.rounds.plan, { planKey: "future", plannedAt: Date.now() + 10000, windowStartsAt, windowEndsAt, question: "Next?", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] });
    expect(await t.mutation(internal.rounds.open, { id: future })).toBe(false);
    expect((await alex.client.query(api.rounds.today, {})).round).toMatchObject({ id: first, closesAt: null });
    vi.setSystemTime(Date.now() + 15000);
    const actual = Date.now();
    expect(await t.mutation(internal.rounds.open, { id: future })).toBe(true);
    expect(await t.mutation(internal.rounds.open, { id: future })).toBe(false);
    const data = await t.run(async ctx => ({ first: await ctx.db.get(first), future: await ctx.db.get(future), pointers: await ctx.db.query("currentRound").collect(), jobs: await ctx.db.query("notificationJobs").collect() }));
    expect(data.first!.closesAt).toBe(actual); expect(data.future!.opensAt).toBe(actual); expect(data.pointers).toHaveLength(1); expect(data.jobs).toHaveLength(2);
    const old = await t.mutation(internal.rounds.plan, { planKey: "late-old", plannedAt: actual - 12000, windowStartsAt, windowEndsAt, question: "Stale?", options: [{ id: "yes", label: "Yes" }] });
    expect(await t.mutation(internal.rounds.open, { id: old })).toBe(false);
    await t.action(internal.planner.plan, {}); await t.action(internal.planner.plan, {});
    const all = await t.run(ctx => ctx.db.query("rounds").collect());
    expect(all.filter(plan => plan.planKey.startsWith("America/Los_Angeles:"))).toHaveLength(3);
  });

  it.each(["2026-11-16T04:00:00Z", "2026-11-16T07:00:00Z"])("skips today's elapsed local window when initial planning runs at %s", async now => {
    const t = setup(); vi.setSystemTime(new Date(now));
    await t.action(internal.planner.plan, {});
    const data = await t.run(async ctx => ({ rounds: await ctx.db.query("rounds").collect(), scheduled: await ctx.db.system.query("_scheduled_functions").collect(), pointers: await ctx.db.query("currentRound").collect(), jobs: await ctx.db.query("notificationJobs").collect() }));
    expect(data.rounds.map(plan => plan.planKey)).toEqual(["America/Los_Angeles:2026-11-16", "America/Los_Angeles:2026-11-17", "America/Los_Angeles:2026-11-18"]);
    expect(data.scheduled.map(job => job.scheduledTime).sort()).toEqual(data.rounds.map(plan => plan.plannedAt).sort());
    for (const plan of data.rounds) {
      const date = plan.planKey.slice("America/Los_Angeles:".length);
      expect(plan.windowStartsAt).toBe(Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: "America/Los_Angeles", plainTime: { hour: 10 } }).epochMilliseconds);
      expect(plan.windowEndsAt).toBe(Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: "America/Los_Angeles", plainTime: { hour: 20 } }).epochMilliseconds);
      expect(plan.plannedAt).toBeGreaterThan(Date.now()); expect(plan.plannedAt).toBeGreaterThanOrEqual(plan.windowStartsAt); expect(plan.plannedAt).toBeLessThan(plan.windowEndsAt);
    }
    expect(data.pointers).toEqual([]); expect(data.jobs).toEqual([]);
  });

  it("rejects planned instants outside their numeric window before scheduling anything", async () => {
    const t = setup(); const plan = dailyPlans(Date.now(), "America/Los_Angeles", 10, 20, () => 0)[0];
    for (const plannedAt of [plan.windowStartsAt - 1, plan.windowEndsAt, NaN]) {
      await expect(t.mutation(internal.rounds.plan, { ...plan, plannedAt })).rejects.toThrow("INVALID_ARGUMENT");
    }
    expect(await t.run(ctx => ctx.db.query("rounds").collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);
  });

  it.each(["2026-11-16T04:00:00Z", "2026-11-16T07:00:00Z", "2026-11-16T20:00:00Z"])("leaves the current round and pushes untouched by an expired scheduled plan at %s", async now => {
    const t = setup(); const alex = await user(t, "alex");
    await alex.client.mutation(api.devices.register, { installationId: "alex-installation", token: "test-private-device-token-alex", platform: "ios", notificationsEnabled: true });
    sender.mockResolvedValue("sent");
    const prior = await round(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sender).toHaveBeenCalledTimes(1); sender.mockClear();
    const priorJob = (await t.run(ctx => ctx.db.query("notificationJobs").first()))!;
    const plan = dailyPlans(Date.now(), "America/Los_Angeles", 10, 20, () => 0.3)[0];
    const old = await t.mutation(internal.rounds.plan, plan);
    vi.setSystemTime(new Date(now));
    expect(await t.mutation(internal.rounds.open, { id: old })).toBe(false);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run(ctx => ctx.db.get(prior))).toMatchObject({ closesAt: null });
    expect(await t.run(ctx => ctx.db.get(old))).toMatchObject({ opensAt: null, closesAt: null });
    expect(await t.run(ctx => ctx.db.query("currentRound").collect())).toMatchObject([{ roundId: prior }]);
    expect(await t.run(ctx => ctx.db.query("notificationJobs").collect())).toEqual([priorJob]);
    expect(sender).not.toHaveBeenCalled();
    const nextPlan = dailyPlans(Date.now(), "America/Los_Angeles", 10, 20, () => 0.75)[0];
    const next = await t.mutation(internal.rounds.plan, nextPlan);
    vi.setSystemTime(nextPlan.plannedAt + 1000);
    const openedAt = Date.now();
    expect(await t.mutation(internal.rounds.open, { id: next })).toBe(true);
    expect(await t.run(ctx => ctx.db.get(prior))).toMatchObject({ closesAt: openedAt });
    expect(await t.run(ctx => ctx.db.get(next))).toMatchObject({ opensAt: openedAt });
    const today = await alex.client.query(api.rounds.today, {});
    expect(today.round).toMatchObject({ id: next }); expect(today.round).not.toHaveProperty("windowStartsAt"); expect(today.round).not.toHaveProperty("windowEndsAt");
    expect(await t.run(ctx => ctx.db.query("currentRound").collect())).toMatchObject([{ roundId: next }]);
    expect(await t.run(ctx => ctx.db.query("notificationJobs").collect())).toHaveLength(2);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sender).toHaveBeenCalledTimes(1); expect(sender.mock.calls[0][0].data.roundId).toBe(next);
  });

  it("does not expose public round release or production auth-bypassing seed functions", async () => {
    const t = setup();
    vi.stubEnv("TAKE_DEPLOYMENT_ENV", "production"); vi.stubEnv("TAKE_ALLOW_DEV_SEED", "true");
    await expect(t.action(internal.dev.seed, {})).rejects.toThrow("NOT_FOUND");
    expect((await t.run(ctx => ctx.db.query("users").collect()))).toEqual([]);
  });
});

describe("authorization-aware generic remote push integration", () => {
  it("reports the shipped provider as unavailable without performing a network send", async () => {
    const { sendPush } = await vi.importActual<typeof import("../convex/lib/pushProvider")>("../convex/lib/pushProvider");
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No transport is installed"));
    await expect(sendPush({ token: "opaque-device-token", ...pushMessage({ kind: "daily", roundId: "round", contentId: null }) })).resolves.toBe("unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds retries from the shipped unavailable provider without creating delivery receipts", async () => {
    const { sendPush } = await vi.importActual<typeof import("../convex/lib/pushProvider")>("../convex/lib/pushProvider");
    const t = setup(); const alex = await user(t, "alex");
    await alex.client.mutation(api.devices.register, { installationId: "alex-installation", token: "opaque-device-token", platform: "ios", notificationsEnabled: true });
    await round(t);
    const job = (await t.run(ctx => ctx.db.query("notificationJobs").first()))!;
    sender.mockImplementation(sendPush);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sender).toHaveBeenCalledTimes(5);
    expect(await t.run(ctx => ctx.db.get(job._id))).toMatchObject({ state: "unavailable", attempts: 5, cursor: null, leaseUntil: 0 });
    expect(await t.run(ctx => ctx.db.query("notificationDeliveries").collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("deviceTokens").first())).toMatchObject({ token: "opaque-device-token" });
    expect(fetch).not.toHaveBeenCalled();
    expect(await t.action(internal.push.claimForWorker, { jobId: job._id })).toBeNull();
    await t.action(internal.push.deliver, { jobId: job._id });
    expect(sender).toHaveBeenCalledTimes(5);
  });

  it("stores bounded opaque tokens without assuming an APNs token length or format", async () => {
    const t = setup(); const alex = await user(t, "alex");
    for (const token of ["x", "CaseSensitive/+opaque=_-:9", "T".repeat(4096)]) {
      await alex.client.mutation(api.devices.register, { installationId: "alex-installation", token, platform: "ios", notificationsEnabled: true });
      expect(await t.run(ctx => ctx.db.query("deviceTokens").first())).toMatchObject({ token });
    }
    for (const token of ["", "T".repeat(4097)]) {
      await expect(alex.client.mutation(api.devices.register, { installationId: "alex-installation", token, platform: "ios", notificationsEnabled: true })).rejects.toThrow("INVALID_ARGUMENT");
    }
    expect(await t.run(ctx => ctx.db.query("deviceTokens").collect())).toHaveLength(1);
  });

  it("leases an empty worker batch and completes an empty scheduled delivery without a provider call", async () => {
    const t = setup(); await round(t);
    const job = (await t.run(ctx => ctx.db.query("notificationJobs").first()))!;
    const claimed = (await t.action(internal.push.claimForWorker, { jobId: job._id }))!;
    expect(claimed).toEqual({ lease: expect.any(String), items: [], nextCursor: null, done: true });
    expect(await t.action(internal.push.claimForWorker, { jobId: job._id })).toBeNull();
    const inFlight = (await t.run(ctx => ctx.db.get(job._id)))!;
    vi.setSystemTime(inFlight.leaseUntil! + 1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run(ctx => ctx.db.get(job._id))).toMatchObject({ state: "sent", attempts: 0 });
    expect(await t.action(internal.push.claimForWorker, { jobId: job._id })).toBeNull();
    expect(sender).not.toHaveBeenCalled();
  });

  it("claims a token-free worker batch and fences stale leases, preferences, permission and receipts", async () => {
    const t = setup(); const alex = await user(t, "alex"); const blair = await user(t, "blair");
    await alex.client.mutation(api.devices.register, { installationId: "alex-installation", token: "alex-private-device-token", platform: "ios", notificationsEnabled: true });
    await alex.client.mutation(api.devices.register, { installationId: "disabled-installation", token: "disabled-private-device-token", platform: "ios", notificationsEnabled: false });
    await blair.client.mutation(api.devices.register, { installationId: "blair-installation", token: "blair-private-device-token", platform: "ios", notificationsEnabled: true });
    await blair.client.mutation(api.profiles.setNotifications, { dailyQuestion: false, directReply: true });
    await round(t);
    const job = (await t.run(ctx => ctx.db.query("notificationJobs").first()))!;
    const device = (await t.run(ctx => ctx.db.query("deviceTokens").withIndex("by_owner_installation", q => q.eq("userId", alex.profile.id).eq("installationId", "alex-installation")).unique()))!;
    const first = (await t.action(internal.push.claimForWorker, { jobId: job._id }))!;
    expect(first).toEqual({ lease: expect.any(String), items: [{ id: device._id }], nextCursor: null, done: true });
    expect(first.lease.length).toBeGreaterThan(0);
    expect(JSON.stringify(first)).not.toContain("private-device-token");
    expect(await t.action(internal.push.claimForWorker, { jobId: job._id })).toBeNull();
    const inFlight = (await t.run(ctx => ctx.db.get(job._id)))!;
    vi.setSystemTime(inFlight.leaseUntil! + 1);
    const second = (await t.action(internal.push.claimForWorker, { jobId: job._id }))!;
    expect(second.lease).not.toBe(first.lease);
    expect(await t.mutation(internal.notifications.target, { jobId: job._id, deviceId: device._id, lease: first.lease })).toEqual({ lostLease: true, target: null });
    expect(await t.mutation(internal.notifications.finishAttempt, { jobId: job._id, deviceId: device._id, lease: first.lease, token: device.token, outcome: "sent" })).toEqual({ validLease: false, retry: false });
    await t.mutation(internal.notifications.progress, { jobId: job._id, lease: first.lease, nextCursor: null, done: true, unavailable: false });
    expect(await t.run(ctx => ctx.db.get(job._id))).toMatchObject({ state: "pending", attempts: 2, lease: second.lease });
    await alex.client.mutation(api.profiles.setNotifications, { dailyQuestion: false, directReply: true });
    expect(await t.mutation(internal.notifications.target, { jobId: job._id, deviceId: device._id, lease: second.lease })).toEqual({ lostLease: false, target: null });
    await alex.client.mutation(api.profiles.setNotifications, { dailyQuestion: true, directReply: true });
    await alex.client.mutation(api.devices.register, { installationId: "alex-installation", token: device.token, platform: "ios", notificationsEnabled: false });
    expect(await t.mutation(internal.notifications.target, { jobId: job._id, deviceId: device._id, lease: second.lease })).toEqual({ lostLease: false, target: null });
    await alex.client.mutation(api.devices.register, { installationId: "alex-installation", token: device.token, platform: "ios", notificationsEnabled: true });
    await t.run(ctx => ctx.db.patch(alex.profile.id, { status: "disabled" }));
    expect(await t.mutation(internal.notifications.target, { jobId: job._id, deviceId: device._id, lease: second.lease })).toEqual({ lostLease: false, target: null });
    await t.run(ctx => ctx.db.patch(alex.profile.id, { status: "active" }));
    expect(await t.mutation(internal.notifications.target, { jobId: job._id, deviceId: device._id, lease: second.lease })).toEqual({ lostLease: false, target: { token: device.token, kind: "daily", roundId: job.roundId, contentId: null } });
    expect(await t.mutation(internal.notifications.finishAttempt, { jobId: job._id, deviceId: device._id, lease: second.lease, token: device.token, outcome: "sent" })).toEqual({ validLease: true, retry: false });
    expect(await t.mutation(internal.notifications.target, { jobId: job._id, deviceId: device._id, lease: second.lease })).toEqual({ lostLease: false, target: null });
    expect(await t.run(ctx => ctx.db.query("notificationDeliveries").collect())).toHaveLength(1);
    await t.mutation(internal.notifications.progress, { jobId: job._id, lease: second.lease, nextCursor: second.nextCursor, done: second.done, unavailable: false });
    expect(await t.action(internal.push.claimForWorker, { jobId: job._id })).toBeNull();
    expect(sender).not.toHaveBeenCalled();
  });

  it("restricts worker reply batches to the recipient and rechecks the reply friendship intersection", async () => {
    const t = setup(); const m = await matrix(t);
    for (const [name, person] of [["alex", m.alex], ["blair", m.blair]] as const) {
      await person.client.mutation(api.devices.register, { installationId: `${name}-installation`, token: `${name}-private-device-token`, platform: "ios", notificationsEnabled: true });
    }
    const job = (await t.run(ctx => ctx.db.query("notificationJobs").collect())).find(job => job.kind === "reply")!;
    const claimed = (await t.action(internal.push.claimForWorker, { jobId: job._id }))!;
    const device = (await t.run(ctx => ctx.db.query("deviceTokens").withIndex("by_user", q => q.eq("userId", m.alex.profile.id)).unique()))!;
    expect(claimed.items).toEqual([{ id: device._id }]);
    expect((await t.mutation(internal.notifications.target, { jobId: job._id, deviceId: device._id, lease: claimed.lease })).target).toMatchObject({ token: device.token, kind: "reply", contentId: job.replyId });
    await m.alex.client.mutation(api.blocks.set, { userId: m.blair.profile.id, blocked: true });
    expect(await t.mutation(internal.notifications.target, { jobId: job._id, deviceId: device._id, lease: claimed.lease })).toEqual({ lostLease: false, target: null });
    expect(await t.run(ctx => ctx.db.query("notificationDeliveries").collect())).toEqual([]);
    expect(sender).not.toHaveBeenCalled();
  });

  it("rechecks the current round after a worker claim and returns no old-round targets on takeover", async () => {
    const t = setup(); const alex = await user(t, "alex");
    await alex.client.mutation(api.devices.register, { installationId: "alex-installation", token: "alex-private-device-token", platform: "ios", notificationsEnabled: true });
    await round(t);
    const job = (await t.run(ctx => ctx.db.query("notificationJobs").first()))!;
    const claimed = (await t.action(internal.push.claimForWorker, { jobId: job._id }))!;
    expect(claimed.items).toHaveLength(1);
    vi.setSystemTime(Date.now() + 1000);
    await round(t, "worker-successor");
    expect(await t.mutation(internal.notifications.target, { jobId: job._id, deviceId: claimed.items[0].id, lease: claimed.lease })).toEqual({ lostLease: false, target: null });
    const inFlight = (await t.run(ctx => ctx.db.get(job._id)))!;
    vi.setSystemTime(inFlight.leaseUntil! + 1);
    expect(await t.action(internal.push.claimForWorker, { jobId: job._id })).toEqual({ lease: expect.any(String), items: [], nextCursor: null, done: true });
    expect(await t.run(ctx => ctx.db.query("notificationDeliveries").collect())).toEqual([]);
    expect(sender).not.toHaveBeenCalled();
  });

  it("retires a malformed page-one token and sends all 50 other eligible devices across six owners", async () => {
    const t = setup(); const { job, devices } = await dailyFanout(t);
    sender.mockImplementation(async ({ token }) => {
      if (token === devices[0].token) return "invalid-token";
      return "sent";
    });
    await t.action(internal.push.deliver, { jobId: job._id });
    expect(sender).toHaveBeenCalledTimes(50);
    expect(await t.run(ctx => ctx.db.query("notificationDeliveries").collect())).toHaveLength(49);
    expect(await t.run(ctx => ctx.db.get(devices[0]._id))).toBeNull();
    expect(await t.run(ctx => ctx.db.get(job._id))).toMatchObject({ state: "pending", attempts: 0 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sender).toHaveBeenCalledTimes(51);
    expect(sender.mock.calls.filter(call => call[0].token === devices[0].token)).toHaveLength(1);
    expect(sender.mock.calls.filter(call => call[0].token === devices[50].token)).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("notificationDeliveries").collect())).toHaveLength(50);
    expect(await t.run(ctx => ctx.db.get(job._id))).toMatchObject({ state: "sent", attempts: 0 });
  });

  it("advances an exhausted raw page after five transient failures without resending its successes", async () => {
    const t = setup(); const { job, devices } = await dailyFanout(t);
    const first = (await t.query(internal.notifications.batch, { jobId: job._id }))!;
    sender.mockImplementation(async ({ token }) => {
      if (token === devices[0].token) return "unavailable";
      return "sent";
    });
    for (let attempt = 0; attempt < 4; attempt++) await t.action(internal.push.deliver, { jobId: job._id });
    const scheduledBeforeFifth = await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
    await t.action(internal.push.deliver, { jobId: job._id });
    expect(sender).toHaveBeenCalledTimes(54);
    expect(await t.run(ctx => ctx.db.get(job._id))).toMatchObject({ state: "unavailable", attempts: 5, cursor: null });
    const transitions = (await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).filter(task => !scheduledBeforeFifth.some(prior => prior._id === task._id));
    expect(transitions).toHaveLength(1); expect(transitions[0].name).toBe("push:deliver");
    expect(transitions[0].scheduledTime).toBeGreaterThanOrEqual(Date.now()); expect(transitions[0].scheduledTime).toBeLessThan(Date.now() + 1000);
    await t.action(internal.push.deliver, { jobId: job._id });
    expect(await t.run(ctx => ctx.db.get(job._id))).toMatchObject({ state: "pending", attempts: 0, cursor: first.nextCursor });
    expect(sender).toHaveBeenCalledTimes(54);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sender.mock.calls.filter(call => call[0].token === devices[0].token)).toHaveLength(5);
    for (const device of devices.slice(1)) expect(sender.mock.calls.filter(call => call[0].token === device.token)).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.get(devices[0]._id))).not.toBeNull();
    expect(await t.run(ctx => ctx.db.query("notificationDeliveries").collect())).toHaveLength(50);
    expect(await t.run(ctx => ctx.db.get(job._id))).toMatchObject({ state: "sent", attempts: 0 });
  });

  it("recovers a worker that died after its fifth claim by advancing to the next raw page", async () => {
    const t = setup(); const { job, devices } = await dailyFanout(t);
    const first = (await t.query(internal.notifications.batch, { jobId: job._id }))!;
    sender.mockImplementation(async ({ token }) => {
      if (token === devices[0].token) throw new Error("temporary test outage");
      return "sent";
    });
    for (let attempt = 0; attempt < 4; attempt++) await t.action(internal.push.deliver, { jobId: job._id });
    expect(await t.mutation(internal.notifications.claim, { jobId: job._id, lease: "crashed-fifth-claim" })).toBe(true);
    const crashed = (await t.run(ctx => ctx.db.get(job._id)))!;
    expect(crashed).toMatchObject({ state: "pending", attempts: 5, cursor: null });
    vi.setSystemTime(crashed.leaseUntil! + 1);
    const before = (await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).length;
    await t.mutation(internal.notifications.recover, {});
    expect((await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).length).toBe(before + 1);
    await t.action(internal.push.deliver, { jobId: job._id });
    expect(await t.run(ctx => ctx.db.get(job._id))).toMatchObject({ state: "pending", attempts: 0, cursor: first.nextCursor });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sender.mock.calls.filter(call => call[0].token === devices[0].token)).toHaveLength(4);
    expect(sender.mock.calls.filter(call => call[0].token === devices[50].token)).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("notificationDeliveries").collect())).toHaveLength(50);
    expect(await t.run(ctx => ctx.db.get(job._id))).toMatchObject({ state: "sent", attempts: 0 });
  });

  it("leaves an exhausted final page terminal and unavailable rather than claiming success", async () => {
    const t = setup(); const alex = await user(t, "alex");
    await alex.client.mutation(api.devices.register, { installationId: "alex-installation", token: "test-private-device-token-alex", platform: "ios", notificationsEnabled: true });
    await round(t);
    const job = (await t.run(ctx => ctx.db.query("notificationJobs").first()))!;
    sender.mockRejectedValue(new Error("temporary test outage"));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sender).toHaveBeenCalledTimes(5);
    expect(await t.run(ctx => ctx.db.get(job._id))).toMatchObject({ state: "unavailable", attempts: 5, cursor: null, leaseUntil: 0 });
    expect(await t.run(ctx => ctx.db.query("notificationDeliveries").collect())).toEqual([]);
    await t.action(internal.push.deliver, { jobId: job._id });
    expect(sender).toHaveBeenCalledTimes(5);
    expect(await t.run(ctx => ctx.db.get(job._id))).toMatchObject({ state: "unavailable", attempts: 5 });
  });

  it("recovers an interrupted retry and counts crashed attempts within the retry bound", async () => {
    const t = setup(); const alex = await user(t, "alex");
    await alex.client.mutation(api.devices.register, { installationId: "installation-one", token: "test-private-device-token-one", platform: "ios", notificationsEnabled: true });
    await round(t);
    const job = (await t.run(ctx => ctx.db.query("notificationJobs").first()))!;
    sender.mockRejectedValue(new Error("temporary test outage"));
    await t.action(internal.push.deliver, { jobId: job._id });
    expect(await t.mutation(internal.notifications.claim, { jobId: job._id, lease: "crashed-retry" })).toBe(true);
    expect(await t.run(ctx => ctx.db.get(job._id))).toMatchObject({ state: "pending", attempts: 2 });
    const crashed = (await t.run(ctx => ctx.db.get(job._id)))!;
    vi.setSystemTime(crashed.leaseUntil! + 1);
    const before = (await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).length;
    await t.mutation(internal.notifications.recover, {});
    expect((await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).length).toBe(before + 1);
  });

  it("fences a stale worker before it can start another send after lease takeover", async () => {
    const t = setup(); const alex = await user(t, "alex");
    for (const suffix of ["one", "two"]) await alex.client.mutation(api.devices.register, { installationId: `installation-${suffix}`, token: `test-private-device-token-${suffix}`, platform: "ios", notificationsEnabled: true });
    await round(t);
    const job = (await t.run(ctx => ctx.db.query("notificationJobs").first()))!;
    let release!: () => void; let started!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const began = new Promise<void>(resolve => { started = resolve; });
    sender.mockImplementationOnce(async () => { started(); await paused; return "sent"; }).mockResolvedValue("sent");
    const stale = t.action(internal.push.deliver, { jobId: job._id });
    await began;
    const inFlight = (await t.run(ctx => ctx.db.get(job._id)))!;
    vi.setSystemTime(inFlight.leaseUntil! + 1);
    await t.action(internal.push.deliver, { jobId: job._id });
    release(); await stale;
    expect(sender).toHaveBeenCalledTimes(3);
    expect(sender.mock.calls.map(call => call[0].token)).toEqual(["test-private-device-token-one", "test-private-device-token-one", "test-private-device-token-two"]);
    expect((await t.run(ctx => ctx.db.query("notificationDeliveries").collect()))).toHaveLength(2);
  });
  it("retries a failed device without resending successfully persisted targets", async () => {
    const t = setup(); const alex = await user(t, "alex");
    for (const token of ["one", "two"]) await alex.client.mutation(api.devices.register, { installationId: `installation-${token}`, token: `test-private-device-token-${token}`, platform: "ios", notificationsEnabled: true });
    await round(t);
    const job = (await t.run(ctx => ctx.db.query("notificationJobs").first()))!;
    sender.mockResolvedValueOnce("sent").mockRejectedValueOnce(new Error("temporary test outage"));
    await t.action(internal.push.deliver, { jobId: job._id });
    expect(sender).toHaveBeenCalledTimes(2);
    sender.mockResolvedValue("sent");
    await t.action(internal.push.deliver, { jobId: job._id });
    expect(sender).toHaveBeenCalledTimes(3);
    expect(sender.mock.calls.map(call => call[0].token)).toEqual(["test-private-device-token-one", "test-private-device-token-two", "test-private-device-token-two"]);
    expect((await t.run(ctx => ctx.db.query("notificationDeliveries").collect()))).toHaveLength(2);
  });
  it("opens before notification, honors preferences/permission, and sends only generic identifiers", async () => {
    const t = setup(); const alex = await user(t, "alex"); const blair = await user(t, "blair");
    await alex.client.mutation(api.devices.register, { installationId: "alex-installation", token: "alex-private-device-token-12345", platform: "ios", notificationsEnabled: true });
    await blair.client.mutation(api.devices.register, { installationId: "blair-installation", token: "blair-private-device-token-12345", platform: "ios", notificationsEnabled: true });
    await blair.client.mutation(api.profiles.setNotifications, { dailyQuestion: false, directReply: true });
    const id = await round(t);
    const job = (await t.run(ctx => ctx.db.query("notificationJobs").first()))!;
    sender.mockImplementation(async () => {
      expect((await alex.client.query(api.rounds.today, {})).round?.id).toBe(id);
      return "sent";
    });
    await t.action(internal.push.deliver, { jobId: job._id });
    expect(sender).toHaveBeenCalledTimes(1);
    const payload = sender.mock.calls[0][0];
    expect(payload).toMatchObject({ token: "alex-private-device-token-12345", notification: { body: "A new question is ready. Give your take." }, data: { type: "daily", roundId: id } });
    expect(JSON.stringify(payload)).not.toMatch(/optionId|caption|thumbnail|author|username/);
    expect(await alex.client.query(api.friends.list, {})).not.toHaveProperty("tokens");
  });

  it("rechecks direct-reply eligibility at send time and retires invalid tokens without leaking them", async () => {
    const t = setup(); const m = await matrix(t);
    await m.alex.client.mutation(api.devices.register, { installationId: "alex-installation", token: "test-private-token-for-alex-123", platform: "ios", notificationsEnabled: true });
    const job = (await t.run(ctx => ctx.db.query("notificationJobs").collect())).find(job => job.kind === "reply")!;
    const batch = await t.query(internal.notifications.batch, { jobId: job._id });
    expect(batch?.items).toHaveLength(1);
    const deviceId = batch!.items[0].id;
    await t.mutation(internal.notifications.claim, { jobId: job._id, lease: "eligibility-test-lease" });
    await m.alex.client.mutation(api.blocks.set, { userId: m.blair.profile.id, blocked: true });
    expect(await t.mutation(internal.notifications.target, { jobId: job._id, deviceId, lease: "eligibility-test-lease" })).toEqual({ lostLease: false, target: null });
    await t.action(internal.push.deliver, { jobId: job._id });
    expect(sender).not.toHaveBeenCalled();
    const daily = (await t.run(ctx => ctx.db.query("notificationJobs").collect())).find(job => job.kind === "daily")!;
    sender.mockResolvedValue("invalid-token");
    await t.action(internal.push.deliver, { jobId: daily._id });
    expect(await t.run(ctx => ctx.db.query("deviceTokens").collect())).toEqual([]);
    expect(pushMessage({ kind: "reply", roundId: "round", contentId: "reply" })).toMatchObject({ notification: { body: "You have a new video reply." }, data: { type: "reply", roundId: "round", contentId: "reply" } });
  });

  it("never unregisters someone else's installation and preserves refreshed tokens when a stale send fails", async () => {
    const t = setup(); const alex = await user(t, "alex"); const blair = await user(t, "blair");
    await alex.client.mutation(api.devices.register, { installationId: "same-installation", token: "old-private-device-token-123456", platform: "ios", notificationsEnabled: true });
    await blair.client.mutation(api.devices.unregister, { installationId: "same-installation" });
    const row = (await t.run(ctx => ctx.db.query("deviceTokens").first()))!;
    await round(t);
    const job = (await t.run(ctx => ctx.db.query("notificationJobs").first()))!;
    await t.mutation(internal.notifications.claim, { jobId: job._id, lease: "refresh-test-lease" });
    await alex.client.mutation(api.devices.register, { installationId: "same-installation", token: "new-private-device-token-123456", platform: "ios", notificationsEnabled: true });
    expect(await t.mutation(internal.notifications.finishAttempt, { jobId: job._id, deviceId: row._id, lease: "refresh-test-lease", token: row.token, outcome: "invalid-token" })).toEqual({ validLease: true, retry: true });
    expect((await t.run(ctx => ctx.db.query("deviceTokens").first()))?.token).toBe("new-private-device-token-123456");
    await alex.client.mutation(api.devices.unregister, { installationId: "same-installation" });
    expect(await t.run(ctx => ctx.db.query("deviceTokens").collect())).toEqual([]);
  });
});
