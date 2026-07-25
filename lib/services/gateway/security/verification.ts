import * as crypto from 'crypto';

const TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

export class WebhookVerifier {
  verify(payload: string, signature: string, secret: string): boolean {
    const { timestamp, signature: payloadSignature } = this.extractSignatureAndTimestamp(signature);
    if (!this.verifyTimestamp(timestamp)) {
      return false;
    }
    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(`${timestamp}.${payload}`).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(payloadSignature), Buffer.from(digest));
  }

  generateSignature(payload: string, secret: string, timestamp: number = Date.now()): string {
    const hmac = crypto.createHmac('sha256', secret);
    const signature = hmac.update(`${timestamp}.${payload}`).digest('hex');
    return `t=${timestamp},v1=${signature}`;
  }

  private verifyTimestamp(timestamp: number): boolean {
    if (!timestamp) {
        return false;
    }
    return Math.abs(Date.now() - timestamp) < TOLERANCE_MS;
  }

  private extractSignatureAndTimestamp(signature: string): { timestamp: number, signature: string } {
    const parts = signature.split(',').reduce((acc, part) => {
        const [key, value] = part.split('=');
        acc[key] = value;
        return acc;
    }, {} as Record<string, string>);

    return {
        timestamp: parseInt(parts.t, 10),
        signature: parts.v1,
    }
  }
}
