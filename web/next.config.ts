import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // App Hosting builds a standalone server; this keeps the image small.
  output: "standalone",
};

export default withNextIntl(nextConfig);
