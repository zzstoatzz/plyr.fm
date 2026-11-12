import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.toml" }, miniflare: { compatibilityFlags: ["nodejs_compat"], bindings: { UPLOAD_INSPECT_URL: "https://authority.invalid/inspect", UPLOAD_CAPABILITY_SECRET: "test-upload-capability-secret-000000000000" } } })],
  test: { maxWorkers: 1 },
});
