import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET as cronGET } from '@/app/api/cron/notifications/route';
import { ResendEmailProvider } from '@/lib/communications/email/resendProvider';

// Mock dispatcher
const mockDispatcher = vi.hoisted(() => ({
  processNotificationQueueWithDispatcher: vi.fn(),
}));
vi.mock('@/lib/communications/dispatcher', () => mockDispatcher);

// Mock logging
const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

describe('GET /api/cron/notifications', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('invokes the notification queue processor', async () => {
    mockDispatcher.processNotificationQueueWithDispatcher.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }]);

    const res = await cronGET(makeRequest('http://localhost/api/cron/notifications'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.processed).toBe(2);
    expect(mockDispatcher.processNotificationQueueWithDispatcher).toHaveBeenCalledWith({ limit: 50 });
  });

  it('allows unauthenticated calls when CRON_SECRET is not set', async () => {
    mockDispatcher.processNotificationQueueWithDispatcher.mockResolvedValue([]);

    const res = await cronGET(makeRequest('http://localhost/api/cron/notifications'));
    expect(res.status).toBe(200);
  });

  it('rejects calls without the cron secret when CRON_SECRET is set', async () => {
    process.env.CRON_SECRET = 'my-secret';

    const res = await cronGET(makeRequest('http://localhost/api/cron/notifications'));
    expect(res.status).toBe(401);
    expect(mockDispatcher.processNotificationQueueWithDispatcher).not.toHaveBeenCalled();
  });

  it('accepts calls with the correct cron secret', async () => {
    process.env.CRON_SECRET = 'my-secret';
    mockDispatcher.processNotificationQueueWithDispatcher.mockResolvedValue([]);

    const res = await cronGET(makeRequest('http://localhost/api/cron/notifications', {
      headers: { Authorization: 'Bearer my-secret' },
    }));
    expect(res.status).toBe(200);
  });

  it('returns 500 when queue processing fails', async () => {
    mockDispatcher.processNotificationQueueWithDispatcher.mockRejectedValue(new Error('DB down'));

    const res = await cronGET(makeRequest('http://localhost/api/cron/notifications'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });
});

describe('ResendEmailProvider', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('throws when RESEND_API_KEY is missing', async () => {
    const provider = new ResendEmailProvider({});
    await expect(provider.send({ to: 'a@b.com', subject: 'S', text: 'T' })).rejects.toThrow('RESEND_API_KEY is not configured');
  });

  it('throws when EMAIL_FROM is missing', async () => {
    const provider = new ResendEmailProvider({ RESEND_API_KEY: 'key' });
    await expect(provider.send({ to: 'a@b.com', subject: 'S', text: 'T' })).rejects.toThrow('EMAIL_FROM is not configured');
  });

  it('sends the correct payload to the Resend API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    global.fetch = fetchMock;

    const provider = new ResendEmailProvider({ RESEND_API_KEY: 'test-key', EMAIL_FROM: 'Clinic <no-reply@example.com>' });
    await provider.send({ to: 'patient@example.com', subject: 'Booking Received', text: 'Your booking has been received.' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.from).toBe('Clinic <no-reply@example.com>');
    expect(body.to).toEqual(['patient@example.com']);
    expect(body.subject).toBe('Booking Received');
    expect(body.text).toContain('Your booking has been received.');
  });

  it('propagates provider failure to the caller', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Server Error'),
    } as unknown as Response);
    global.fetch = fetchMock;

    const provider = new ResendEmailProvider({ RESEND_API_KEY: 'test-key', EMAIL_FROM: 'Clinic <no-reply@example.com>' });
    await expect(provider.send({ to: 'a@b.com', subject: 'S', text: 'T' })).rejects.toThrow(/Resend API error/);
  });
});