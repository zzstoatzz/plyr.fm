import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightClientMermaid from "@pasqal-io/starlight-client-mermaid";

export default defineConfig({
  site: "https://docs.plyr.fm",
  integrations: [
    starlight({
      title: "plyr.fm docs",
      favicon: "/favicon.png",
      components: {
        SocialIcons: "./src/components/SocialIcons.astro",
      },
      plugins: [starlightClientMermaid()],
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
          label: "platform",
          collapsed: true,
          items: [
            { slug: "authentication" },
            { slug: "security" },
            { slug: "deployment/environments" },
            { slug: "frontend/keyboard-shortcuts" },
            { slug: "moderation/overview" },
            { slug: "lexicons/overview" },
          ],
        },
        {
          label: "legal",
          collapsed: true,
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
