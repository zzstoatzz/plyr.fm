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
        { slug: "listeners" },
        { slug: "artists" },
        { slug: "developers" },
        { slug: "lexicons/overview" },
        {
          label: "contributing",
          collapsed: true,
          items: [{ slug: "contributing" }],
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
