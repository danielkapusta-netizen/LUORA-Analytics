import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
};

export default nextConfig;

// Gives `next dev` the D1, Queue and R2 bindings from wrangler.jsonc (local simulations).
initOpenNextCloudflareForDev();
