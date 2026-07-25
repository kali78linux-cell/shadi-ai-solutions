
export class RateLimiter {
  private requests: Map<string, number[]> = new Map();

  constructor(private limit: number, private windowMs: number) {}

  isAllowed(id: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    const requestTimestamps = (this.requests.get(id) || []).filter(
      (timestamp) => timestamp > windowStart
    );

    if (requestTimestamps.length >= this.limit) {
      return false;
    }

    requestTimestamps.push(now);
    this.requests.set(id, requestTimestamps);
    return true;
  }
}
