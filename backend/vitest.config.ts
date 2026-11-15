import { defineConfig, mergeConfig } from "vitest/config";
import shared from "./vitest.shared.ts";

export default mergeConfig(shared, defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    restoreMocks: true,
  },
}));
