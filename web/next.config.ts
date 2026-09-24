import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // App Hosting builds a standalone server; this keeps the image small.
  output: "standalone",
  // The step pages moved under /r/[rid]; old bookmarks land on the dashboard.
  async redirects() {
    return ["documents", "reconcile", "inventory", "questionnaire"].map((p) => ({ source: `/${p}`, destination: "/home", permanent: false }));
  },
};

export default withNextIntl(nextConfig);
