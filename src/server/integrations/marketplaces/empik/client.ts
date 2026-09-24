import { request, type RequestOptions } from '../../../http';

export interface EmpikCredentials {
  /** Mirakl front URL given by Empik, e.g. "https://marketplace.empik.com". */
  baseUrl: string;
  apiKey: string;
  /** Only needed when the API key has access to several shops. */
  shopId?: string;
}

/** Empik Marketplace runs on Mirakl; this is a thin client for the Mirakl Seller API. */
export class MiraklClient {
  constructor(private readonly creds: EmpikCredentials) {}

  async call<T>(method: string, path: string, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    const base = this.creds.baseUrl.replace(/\/+$/, '').replace(/\/api$/, '');
    const { data } = await request<T>(`${base}/api${path}`, {
      ...options,
      method,
      query: { ...options.query, shop_id: this.creds.shopId },
      headers: { Authorization: this.creds.apiKey, Accept: 'application/json', ...options.headers },
    });
    return data;
  }
}
