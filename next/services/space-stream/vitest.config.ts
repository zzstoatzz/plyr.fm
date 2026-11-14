import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { testHost } from "./test/host";

// Every outbound request the worker makes in tests lands on the in-memory space host.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" }, miniflare: { outboundService: testHost, bindings: { SPACE_TYPES: "tech.waow.ops.space" } } })],
  test: { include: ["test/*.test.ts"] },
});
