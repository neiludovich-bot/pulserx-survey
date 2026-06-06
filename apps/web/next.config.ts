import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  basePath: basePath && basePath !== "/" ? basePath : undefined,
  transpilePackages: [
    "@interview/engine",
    "@interview/prompts",
    "@interview/schemas",
  ],
};

export default nextConfig;
