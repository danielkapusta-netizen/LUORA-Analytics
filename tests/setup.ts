import { httpConfig } from '@/server/http';

// Retries and Retry-After waits happen instantly in tests.
httpConfig.sleep = async () => {};
