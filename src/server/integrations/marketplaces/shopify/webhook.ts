import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verifies Shopify's X-Shopify-Hmac-Sha256 header against the app's client secret. */
export function validShopifyHmac(body: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac('sha256', secret).update(body, 'utf8').digest();
  const received = Buffer.from(header, 'base64');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
