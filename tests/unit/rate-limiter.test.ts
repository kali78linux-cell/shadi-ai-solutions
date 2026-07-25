
import { RateLimiter } from '../../lib/services/gateway/security/rate-limiter';
import { describe, it, expect } from 'vitest';

describe('RateLimiter', () => {
    it('should allow requests below the limit', () => {
        const limiter = new RateLimiter(5, 1000);
        for (let i = 0; i < 5; i++) {
            expect(limiter.isAllowed('user1')).toBe(true);
        }
    });

    it('should block requests above the limit', () => {
        const limiter = new RateLimiter(5, 1000);
        for (let i = 0; i < 5; i++) {
            limiter.isAllowed('user1');
        }
        expect(limiter.isAllowed('user1')).toBe(false);
    });

    it('should allow requests after the window has passed', async () => {
        const limiter = new RateLimiter(5, 100);
        for (let i = 0; i < 5; i++) {
            limiter.isAllowed('user1');
        }
        expect(limiter.isAllowed('user1')).toBe(false);

        await new Promise((resolve) => setTimeout(resolve, 101));

        expect(limiter.isAllowed('user1')).toBe(true);
    });

    it('should handle multiple users independently', () => {
        const limiter = new RateLimiter(2, 1000);
        expect(limiter.isAllowed('user1')).toBe(true);
        expect(limiter.isAllowed('user1')).toBe(true);
        expect(limiter.isAllowed('user1')).toBe(false);

        expect(limiter.isAllowed('user2')).toBe(true);
        expect(limiter.isAllowed('user2')).toBe(true);
        expect(limiter.isAllowed('user2')).toBe(false);
    });
});
