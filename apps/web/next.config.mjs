import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@natacao/domain"],
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  devIndicators: false,
};

export default nextConfig;
