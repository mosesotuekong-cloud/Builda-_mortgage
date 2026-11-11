// A small fixed-window limiter, kept in memory (one server). Enough to slow down password guessing
// and form spam on a demo deployment; it resets when the server restarts.
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private max: number, private windowMs: number) {}

  // True if this key has used up its allowance for the current window.
  blocked(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    return !!h && h.resetAt > now && h.count >= this.max;
  }

  hit(key: string, now = Date.now()): void {
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    else h.count++;
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }

  clear(key: string): void { this.hits.delete(key); }
}
