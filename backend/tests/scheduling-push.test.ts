import { afterEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { api, internal } from "../convex/_generated/api";
import { chooseOpening, dailyPlans } from "../convex/lib/schedule";
import { pushMessage } from "../convex/push";
import { setup, user, round, matrix } from "./helpers";

const sender = vi.hoisted(() => vi.fn());
vi.mock("firebase-admin/messaging", () => ({ getMessaging: () => ({ send: sender }) }));
vi.mock("../convex/lib/firebase", () => ({ firebaseApp: () => ({}) }));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); sender.mockReset(); });

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
    expect(() => chooseOpening("2026-03-08", "America/Los_Angeles", 20, 10, 0.5)).toThrow();
    expect(() => chooseOpening("2026-03-08", "not-a-zone", 10, 20, 0.5)).toThrow();
  });

  it("plans idempotently and closes the previous round only when its successor actually commits open", async () => {
    const t = setup(); const alex = await user(t, "alex");
    const first = await round(t);
    const future = await t.mutation(internal.rounds.plan, { planKey: "future", plannedAt: Date.now() + 10000, question: "Next?", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] });
    expect(await t.mutation(internal.rounds.open, { id: future })).toBe(false);
    expect((await alex.client.query(api.rounds.today, {})).round).toMatchObject({ id: first, closesAt: null });
    vi.setSystemTime(Date.now() + 15000);
    const actual = Date.now();
    expect(await t.mutation(internal.rounds.open, { id: future })).toBe(true);
    expect(await t.mutation(internal.rounds.open, { id: future })).toBe(false);
    const data = await t.run(async ctx => ({ first: await ctx.db.get(first), future: await ctx.db.get(future), pointers: await ctx.db.query("currentRound").collect(), jobs: await ctx.db.query("notificationJobs").collect() }));
    expect(data.first!.closesAt).toBe(actual); expect(data.future!.opensAt).toBe(actual); expect(data.pointers).toHaveLength(1); expect(data.jobs).toHaveLength(2);
    const old = await t.mutation(internal.rounds.plan, { planKey: "late-old", plannedAt: actual - 12000, question: "Stale?", options: [{ id: "yes", label: "Yes" }] });
    expect(await t.mutation(internal.rounds.open, { id: old })).toBe(false);
    await t.action(internal.planner.plan, {}); await t.action(internal.planner.plan, {});
    const all = await t.run(ctx => ctx.db.query("rounds").collect());
    expect(all.filter(plan => plan.planKey.startsWith("America/Los_Angeles:"))).toHaveLength(3);
  });

  it("does not expose public round release or production auth-bypassing seed functions", async () => {
    const t = setup();
    vi.stubEnv("TAKE_DEPLOYMENT_ENV", "production"); vi.stubEnv("TAKE_ALLOW_DEV_SEED", "true");
    await expect(t.action(internal.dev.seed, {})).rejects.toThrow("NOT_FOUND");
    expect((await t.run(ctx => ctx.db.query("users").collect()))).toEqual([]);
  });
});

describe("authorization-aware generic remote push integration", () => {
  it("recovers an interrupted retry and counts crashed attempts within the retry bound", async () => {
    const t = setup(); const alex = await user(t, "alex");
    await alex.client.mutation(api.devices.register, { installationId: "installation-one", fcmToken: "test-private-fcm-token-one", platform: "ios", notificationsEnabled: true });
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
    for (const suffix of ["one", "two"]) await alex.client.mutation(api.devices.register, { installationId: `installation-${suffix}`, fcmToken: `test-private-fcm-token-${suffix}`, platform: "ios", notificationsEnabled: true });
    await round(t);
    const job = (await t.run(ctx => ctx.db.query("notificationJobs").first()))!;
    let release!: () => void; let started!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const began = new Promise<void>(resolve => { started = resolve; });
    sender.mockImplementationOnce(async () => { started(); await paused; return "already-in-flight"; }).mockResolvedValue("takeover-delivery");
    const stale = t.action(internal.push.deliver, { jobId: job._id });
    await began;
    const inFlight = (await t.run(ctx => ctx.db.get(job._id)))!;
    vi.setSystemTime(inFlight.leaseUntil! + 1);
    await t.action(internal.push.deliver, { jobId: job._id });
    release(); await stale;
    expect(sender).toHaveBeenCalledTimes(3);
    expect(sender.mock.calls.map(call => call[0].token)).toEqual(["test-private-fcm-token-one", "test-private-fcm-token-one", "test-private-fcm-token-two"]);
    expect((await t.run(ctx => ctx.db.query("notificationDeliveries").collect()))).toHaveLength(2);
  });
  it("retries a failed device without resending successfully persisted targets", async () => {
    const t = setup(); const alex = await user(t, "alex");
    for (const token of ["one", "two"]) await alex.client.mutation(api.devices.register, { installationId: `installation-${token}`, fcmToken: `test-private-fcm-token-${token}`, platform: "ios", notificationsEnabled: true });
    await round(t);
    const job = (await t.run(ctx => ctx.db.query("notificationJobs").first()))!;
    sender.mockResolvedValueOnce("delivered").mockRejectedValueOnce(new Error("temporary test outage"));
    await t.action(internal.push.deliver, { jobId: job._id });
    expect(sender).toHaveBeenCalledTimes(2);
    sender.mockResolvedValue("delivered on retry");
    await t.action(internal.push.deliver, { jobId: job._id });
    expect(sender).toHaveBeenCalledTimes(3);
    expect(sender.mock.calls.map(call => call[0].token)).toEqual(["test-private-fcm-token-one", "test-private-fcm-token-two", "test-private-fcm-token-two"]);
    expect((await t.run(ctx => ctx.db.query("notificationDeliveries").collect()))).toHaveLength(2);
  });
  it("opens before notification, honors preferences/permission, and sends only generic identifiers", async () => {
    const t = setup(); const alex = await user(t, "alex"); const blair = await user(t, "blair");
    await alex.client.mutation(api.devices.register, { installationId: "alex-installation", fcmToken: "alex-private-fcm-token-12345", platform: "ios", notificationsEnabled: true });
    await blair.client.mutation(api.devices.register, { installationId: "blair-installation", fcmToken: "blair-private-fcm-token-12345", platform: "ios", notificationsEnabled: true });
    await blair.client.mutation(api.profiles.setNotifications, { dailyQuestion: false, directReply: true });
    const id = await round(t);
    const job = (await t.run(ctx => ctx.db.query("notificationJobs").first()))!;
    sender.mockImplementation(async () => {
      expect((await alex.client.query(api.rounds.today, {})).round?.id).toBe(id);
      return "mock-fcm-message-id";
    });
    await t.action(internal.push.deliver, { jobId: job._id });
    expect(sender).toHaveBeenCalledTimes(1);
    const payload = sender.mock.calls[0][0];
    expect(payload).toMatchObject({ token: "alex-private-fcm-token-12345", notification: { body: "A new question is ready. Give your take." }, data: { type: "daily", roundId: id } });
    expect(JSON.stringify(payload)).not.toMatch(/optionId|caption|thumbnail|author|username/);
    expect(await alex.client.query(api.friends.list, {})).not.toHaveProperty("tokens");
  });

  it("rechecks direct-reply eligibility at send time and retires invalid tokens without leaking them", async () => {
    const t = setup(); const m = await matrix(t);
    await m.alex.client.mutation(api.devices.register, { installationId: "alex-installation", fcmToken: "test-private-token-for-alex-123", platform: "ios", notificationsEnabled: true });
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
    sender.mockRejectedValue(Object.assign(new Error("mock invalid token"), { code: "messaging/registration-token-not-registered" }));
    await t.action(internal.push.deliver, { jobId: daily._id });
    expect(await t.run(ctx => ctx.db.query("deviceTokens").collect())).toEqual([]);
    expect(pushMessage({ kind: "reply", roundId: "round", contentId: "reply" })).toMatchObject({ notification: { body: "You have a new video reply." }, data: { type: "reply", roundId: "round", contentId: "reply" } });
  });

  it("never unregisters someone else's installation and preserves refreshed tokens when a stale send fails", async () => {
    const t = setup(); const alex = await user(t, "alex"); const blair = await user(t, "blair");
    await alex.client.mutation(api.devices.register, { installationId: "same-installation", fcmToken: "old-private-fcm-token-123456", platform: "ios", notificationsEnabled: true });
    await blair.client.mutation(api.devices.unregister, { installationId: "same-installation" });
    const row = (await t.run(ctx => ctx.db.query("deviceTokens").first()))!;
    await round(t);
    const job = (await t.run(ctx => ctx.db.query("notificationJobs").first()))!;
    await t.mutation(internal.notifications.claim, { jobId: job._id, lease: "refresh-test-lease" });
    await alex.client.mutation(api.devices.register, { installationId: "same-installation", fcmToken: "new-private-fcm-token-123456", platform: "ios", notificationsEnabled: true });
    expect(await t.mutation(internal.notifications.finishAttempt, { jobId: job._id, deviceId: row._id, lease: "refresh-test-lease", token: row.fcmToken, outcome: "invalid" })).toEqual({ validLease: true, retry: true });
    expect((await t.run(ctx => ctx.db.query("deviceTokens").first()))?.fcmToken).toBe("new-private-fcm-token-123456");
    await alex.client.mutation(api.devices.unregister, { installationId: "same-installation" });
    expect(await t.run(ctx => ctx.db.query("deviceTokens").collect())).toEqual([]);
  });
});
