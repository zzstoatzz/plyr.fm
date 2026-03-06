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
          ],
        },
        {
          label: "guides",
          items: [
            { slug: "authentication" },
            { slug: "security" },
            { slug: "rate-limiting" },
            { slug: "offboarding" },
            { slug: "content-gating-roadmap" },
          ],
        },
        {
          label: "architecture",
          autogenerate: { directory: "architecture" },
        },
        { label: "backend", autogenerate: { directory: "backend" } },
        { label: "frontend", autogenerate: { directory: "frontend" } },
        {
          label: "deployment",
          autogenerate: { directory: "deployment" },
        },
        {
          label: "moderation",
          autogenerate: { directory: "moderation" },
        },
        { label: "tools", autogenerate: { directory: "tools" } },
        { label: "testing", autogenerate: { directory: "testing" } },
        { label: "lexicons", autogenerate: { directory: "lexicons" } },
        { label: "runbooks", autogenerate: { directory: "runbooks" } },
        {
          label: "legal",
          items: [{ slug: "legal/privacy" }, { slug: "legal/terms" }],
        },
      ],
      customCss: [],
    }),
  ],
  vite: {
    resolve: {
      preserveSymlinks: true,
    },
  },
});
