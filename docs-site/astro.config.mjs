import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://docs.plyr.fm",
  integrations: [
    starlight({
      title: "plyr.fm docs",
      favicon: "/favicon.svg",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/zzstoatzz/plyr.fm",
        },
      ],
      sidebar: [
        {
          label: "getting started",
          items: [
            { slug: "local-development/setup" },
            { slug: "contributing" },
            { slug: "offboarding" },
          ],
        },
        {
          label: "development",
          items: [
            {
              label: "backend",
              items: [
                { slug: "backend/configuration" },
                { slug: "backend/atproto-identity" },
                { slug: "backend/background-tasks" },
                { slug: "backend/database/neon" },
                { slug: "backend/database/connection-pooling" },
                { slug: "backend/feature-flags" },
                { slug: "backend/genre-classification" },
                { slug: "backend/liked-tracks" },
                { slug: "backend/mood-search" },
                { slug: "backend/playlist-recommendations" },
                { slug: "backend/streaming-uploads" },
                { slug: "backend/transcoder" },
              ],
            },
            {
              label: "frontend",
              items: [
                { slug: "frontend/state-management" },
                { slug: "frontend/data-loading" },
                { slug: "frontend/design-tokens" },
                { slug: "frontend/keyboard-shortcuts" },
                { slug: "frontend/navigation" },
                { slug: "frontend/portals" },
                { slug: "frontend/queue" },
                { slug: "frontend/redirect-after-login" },
                { slug: "frontend/search" },
                { slug: "frontend/toast-notifications" },
              ],
            },
            {
              label: "architecture",
              items: [
                { slug: "architecture/jams" },
                { slug: "architecture/jams-queue-integration" },
                { slug: "architecture/jams-transport-decision" },
              ],
            },
            {
              label: "moderation",
              items: [
                { slug: "moderation/overview" },
                { slug: "moderation/copyright-detection" },
                { slug: "moderation/sensitive-content" },
                { slug: "moderation/atproto-labeler" },
              ],
            },
            {
              label: "lexicons",
              items: [{ slug: "lexicons/overview" }],
            },
          ],
        },
        {
          label: "operations",
          items: [
            {
              label: "deployment",
              items: [
                { slug: "deployment/environments" },
                { slug: "deployment/database-migrations" },
              ],
            },
            {
              label: "runbooks",
              items: [
                { slug: "runbooks/readme" },
                { slug: "runbooks/connection-pool-exhaustion" },
              ],
            },
            {
              label: "tools",
              items: [
                { slug: "tools/logfire" },
                { slug: "tools/neon" },
                { slug: "tools/pdsx" },
                { slug: "tools/plyrfm" },
                { slug: "tools/status-maintenance" },
                { slug: "tools/tap" },
              ],
            },
            {
              label: "testing",
              items: [
                { slug: "testing/readme" },
                { slug: "testing/integration-tests" },
              ],
            },
          ],
        },
        {
          label: "platform",
          items: [
            { slug: "authentication" },
            { slug: "security" },
            { slug: "rate-limiting" },
          ],
        },
        {
          label: "legal",
          items: [{ slug: "legal/privacy" }, { slug: "legal/terms" }],
        },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
  vite: {
    resolve: {
      preserveSymlinks: true,
    },
  },
});
