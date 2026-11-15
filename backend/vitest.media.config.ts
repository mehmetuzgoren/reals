import { defineConfig, mergeConfig } from "vitest/config";
import shared from "./vitest.shared.ts";
import base from "./vitest.config.ts";

export default mergeConfig(shared, defineConfig({
  test: {
    ...base.test,
    include: ["tests/**/*.integration.ts"],
    hookTimeout: 30000,
    testTimeout: 30000,
  },
}));
