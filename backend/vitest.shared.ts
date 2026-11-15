import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [{
    name: "convex-auth-password-wasm",
    enforce: "pre",
    load(id) {
      if (!id.endsWith("/argon2id_bg.wasm")) return;
      const bytes = readFileSync(id).toString("base64");
      return `export default new WebAssembly.Module(Uint8Array.from(atob(${JSON.stringify(bytes)}), c => c.charCodeAt(0)));`;
    },
  }],
  test: { server: { deps: { inline: ["password-hash-wasm"] } } },
});
