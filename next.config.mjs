/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for 'use cache' / cacheTag / updateTag (architecture spine AD-16).
  cacheComponents: true,
}

export default nextConfig
