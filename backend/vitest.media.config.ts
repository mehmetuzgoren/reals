import { defineConfig } from "vitest/config";
import base from "./vitest.config";

export default defineConfig({
  test: {
    ...base.test,
    include: ["tests/**/*.integration.ts"],
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
