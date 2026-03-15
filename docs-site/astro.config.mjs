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
        {
          label: "developers",
          items: [
            { slug: "developers", label: "overview" },
            { slug: "developers/quickstart" },
            {
              label: "API reference",
              collapsed: true,
              autogenerate: { directory: "developers/api-reference" },
            },
            { slug: "developers/auth" },
          ],
        },
        { slug: "lexicons/overview" },
        { slug: "troubleshooting" },
        { slug: "glossary" },
        { slug: "contributing" },
        {
          label: "legal",
          collapsed: true,
          items: [{ slug: "legal/privacy" }, { slug: "legal/terms" }],
        },
      ],
      head: [
        {
          tag: "meta",
          attrs: { property: "og:image", content: "https://docs.plyr.fm/og.png" },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:width", content: "1200" },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:height", content: "630" },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:alt", content: "plyr.fm docs" },
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
