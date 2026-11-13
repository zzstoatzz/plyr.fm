import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.toml" }, miniflare: { compatibilityFlags: ["nodejs_compat"], bindings: { UPLOAD_INSPECT_URL: "https://authority.invalid/inspect", UPLOAD_CAPABILITY_SECRET: "test-upload-capability-secret-000000000000", PROCESSING_TRANSCODER_URL: "https://plyr-next-processing.fly.dev/v1/processing", PROCESSING_TRANSCODER_KEY: "fixture-processing-executor-key-00000000" },
    outboundService: async request => {
      const url = new URL(request.url);
      if (url.href === "https://plyr-next-processing.fly.dev/v1/processing" && request.headers.get("X-Processing-Key") === "fixture-processing-executor-key-00000000") return new Response(null, { status: 202 });
      if (url.hostname === "redirect.invalid") return Response.json({ state: "published" });
      if (url.href !== "https://authority.invalid/inspect" || request.headers.get("authorization") !== "Bearer test-upload-capability-secret-000000000000") return new Response(null, { status: 403 });
      const body = await request.json();
      if (!body || typeof body !== "object" || !("recordUri" in body) || typeof body.recordUri !== "string") return new Response(null, { status: 400 });
      if (body.recordUri.endsWith("/network-redirect")) return new Response(null, { status: 307, headers: { location: "https://redirect.invalid/credential-sink" } });
      if (body.recordUri.endsWith("/network-verified")) return Response.json({ state: "published" });
      return new Response(null, { status: 503 });
    },
  } })],
  test: { maxWorkers: 1 },
});
