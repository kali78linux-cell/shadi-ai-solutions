
import { WebhookVerifier } from '../../lib/services/gateway/security/verification';
import { describe, it, expect, vi } from 'vitest';

describe('WebhookVerifier', () => {
    const verifier = new WebhookVerifier();
    const secret = 'my-super-secret-key';
    const payload = JSON.stringify({
        event: 'message',
        data: 'Hello, world!',
    });

    it('should generate a valid signature', () => {
        const signature = verifier.generateSignature(payload, secret);
        expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    });

    it('should verify a valid signature', () => {
        const signature = verifier.generateSignature(payload, secret);
        const isValid = verifier.verify(payload, signature, secret);
        expect(isValid).toBe(true);
    });

    it('should reject an invalid signature', () => {
        const signature = 't=123,v1=invalid-signature';
        const isValid = verifier.verify(payload, signature, secret);
        expect(isValid).toBe(false);
    });

    it('should reject a signature generated with a different secret', () => {
        const differentSecret = 'another-secret';
        const signature = verifier.generateSignature(payload, differentSecret);
        const isValid = verifier.verify(payload, signature, secret);
        expect(isValid).toBe(false);
    });

    it('should reject an old timestamp', () => {
        const oldTimestamp = Date.now() - 6 * 60 * 1000;
        const signature = verifier.generateSignature(payload, secret, oldTimestamp);
        const isValid = verifier.verify(payload, signature, secret);
        expect(isValid).toBe(false);
    });

    it('should accept a recent timestamp', () => {
        const recentTimestamp = Date.now() - 4 * 60 * 1000;
        const signature = verifier.generateSignature(payload, secret, recentTimestamp);
        const isValid = verifier.verify(payload, signature, secret);
        expect(isValid).toBe(true);
    });
});
