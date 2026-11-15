import { spawnSync } from "node:child_process";

if (!process.env.CONVEX_DEPLOYMENT?.startsWith("dev:") || process.argv.length > 2) {
  throw new Error("Set CONVEX_DEPLOYMENT=dev:<your-development-deployment>; production seeding is forbidden");
}
const result = spawnSync("npx", ["convex", "run", "dev:seed", "{}"], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
