import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("plan shared daily rounds", { hours: 1 }, internal.planner.plan, {});
crons.interval("clean expired upload intents and grants", { minutes: 10 }, internal.cleanup.expired, {});
crons.interval("clean unbound storage objects", { hours: 12 }, internal.cleanup.orphans, { cursor: null });
crons.interval("retire notification delivery receipts", { hours: 24 }, internal.notifications.cleanup, {});
crons.interval("recover interrupted notification sends", { minutes: 5 }, internal.notifications.recover, {});
export default crons;
