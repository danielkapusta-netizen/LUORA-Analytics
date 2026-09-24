import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Every page is rendered per request (they all read the session), so no incremental cache is needed.
export default defineCloudflareConfig({});
