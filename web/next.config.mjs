/** @type {import('next').NextConfig} */
const nextConfig = {
  // Playwright's webServer reaches the dev server via 127.0.0.1; allow it so dev logs stay clean.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
