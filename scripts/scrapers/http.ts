// Polite HTTP client for the collectors: per-host minimum spacing between
// requests, retries with exponential backoff on 429/5xx/network errors,
// Retry-After support, and retries for GitHub's "202 still computing".
// Only response bodies are returned; headers (which can carry our contact
// details or tokens) are never stored.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

export interface RequestOptions {
  headers?: Record<string, string>;
  /** Treat 202 Accepted as "try again shortly" (GitHub stats endpoints). */
  retryOn202?: boolean;
}

export interface HttpClient {
  getJson<T = unknown>(url: string, options?: RequestOptions): Promise<T>;
  getText(url: string, options?: RequestOptions): Promise<string>;
}

export interface PoliteHttpOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Minimum ms between requests to the same host. */
  hostIntervals?: Record<string, number>;
  defaultIntervalMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  timeoutMs?: number;
  /** Default User-Agent for hosts that don't need a specific one. */
  userAgent?: string;
}

/** Published or conservative limits per host (see docs/model-data-sources.md). */
export const DEFAULT_HOST_INTERVALS: Record<string, number> = {
  'api.npmjs.org': 300,
  'pypistats.org': 2000,
  'api.github.com': 250,
  'data.sec.gov': 150,
  'www.sec.gov': 150,
  'efts.sec.gov': 150,
  'boards-api.greenhouse.io': 500,
  'api.ashbyhq.com': 500,
  'apply.workable.com': 1000,
  'tranco-list.eu': 1100,
  'hn.algolia.com': 400,
};

export class PoliteHttp implements HttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly intervals: Record<string, number>;
  private readonly nextSlot = new Map<string, number>();
  private readonly o: Required<Pick<PoliteHttpOptions, 'defaultIntervalMs' | 'maxRetries' | 'baseBackoffMs' | 'timeoutMs' | 'userAgent'>>;
  /** Count of requests made, for reporting. */
  requests = 0;

  constructor(options: PoliteHttpOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? (() => Date.now());
    this.intervals = { ...DEFAULT_HOST_INTERVALS, ...options.hostIntervals };
    this.o = {
      defaultIntervalMs: options.defaultIntervalMs ?? 500,
      maxRetries: options.maxRetries ?? 4,
      baseBackoffMs: options.baseBackoffMs ?? 1000,
      timeoutMs: options.timeoutMs ?? 30_000,
      userAgent: options.userAgent ?? 'senzi-model-collector (hackathon research prototype)',
    };
  }

  async getJson<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    const text = await this.getText(url, { ...options, headers: { Accept: 'application/json', ...options.headers } });
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError(200, url, `Invalid JSON from ${url}`);
    }
  }

  async getText(url: string, options: RequestOptions = {}): Promise<string> {
    const host = new URL(url).host;
    for (let attempt = 0; ; attempt++) {
      await this.throttle(host);
      this.requests++;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          headers: { 'User-Agent': this.o.userAgent, ...options.headers },
          signal: AbortSignal.timeout(this.o.timeoutMs),
        });
      } catch (err) {
        if (attempt >= this.o.maxRetries) throw err;
        await this.sleep(this.backoff(attempt));
        continue;
      }

      if (res.status === 202 && options.retryOn202) {
        if (attempt >= this.o.maxRetries) throw new HttpError(202, url, `Still computing after ${attempt + 1} tries: ${url}`);
        await this.sleep(Math.max(2000, this.backoff(attempt)));
        continue;
      }
      if (res.ok) return res.text();

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= this.o.maxRetries) throw new HttpError(res.status, url);
      const retryAfter = Number(res.headers.get('retry-after'));
      await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.backoff(attempt));
    }
  }

  private backoff(attempt: number): number {
    return this.o.baseBackoffMs * 2 ** attempt;
  }

  private async throttle(host: string): Promise<void> {
    const interval = this.intervals[host] ?? this.o.defaultIntervalMs;
    const now = this.now();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + interval);
    if (slot > now) await this.sleep(slot - now);
  }
}
