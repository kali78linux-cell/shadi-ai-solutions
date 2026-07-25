import { beforeEach, describe, expect, it, vi } from 'vitest';

const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

import { logEvent, sanitizeLogPayload } from '@/lib/server/logging';

describe('server logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes request context without writing sensitive patient payloads', () => {
    logEvent('ai_request_started', {
      clinic_id: 'clinic-1',
      user_id: 'user-1',
      session_id: 'session-1',
      patient: { name: 'Patient Name', phone: '+966500000000' },
      provider: 'openai',
    });

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    const [entry] = consoleInfoSpy.mock.calls[0];
    const payload = JSON.parse(String(entry));

    expect(payload.event).toBe('ai_request_started');
    expect(payload.clinic_id).toBe('clinic-1');
    expect(payload.user_id).toBe('user-1');
    expect(payload.session_id).toBe('session-1');
    expect(payload.provider).toBe('openai');
    expect(payload.patient).toBeUndefined();
  });

  it('prevents sensitive patient data from leaking through nested payloads', () => {
    const sanitized = sanitizeLogPayload({
      patient_name: 'Patient Name',
      phone: '+966500000000',
      email: 'patient@example.com',
      nested: { address: 'somewhere', safe: 'ok' },
    });

    expect(sanitized).toEqual({
      nested: { safe: 'ok' },
    });
  });

  it('logs provider failures with a structured error event', () => {
    logEvent('llm_provider_error', {
      clinic_id: 'clinic-1',
      error: { name: 'ProviderError', message: 'timeout' },
    }, 'error');

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [entry] = consoleErrorSpy.mock.calls[0];
    const payload = JSON.parse(String(entry));

    expect(payload.level).toBe('error');
    expect(payload.event).toBe('llm_provider_error');
    expect(payload.error.message).toBe('timeout');
  });
});
