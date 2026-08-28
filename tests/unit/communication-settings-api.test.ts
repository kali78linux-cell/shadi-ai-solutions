import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PUT } from '@/app/api/clinic/communication-settings/route';

// Mock clinicAuthorization
const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn(() => null),
  ADMIN_ROLES: ['owner','manager'],
  DATA_ROLES: ['owner','manager','doctor','receptionist','staff'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

// Mock settings service
const mockSettings = vi.hoisted(() => ({
  getClinicCommunicationSettings: vi.fn(),
  saveClinicCommunicationSettings: vi.fn(),
  validateAndNormalizeSettings: vi.fn(),
}));
vi.mock('@/lib/communications/settings', () => mockSettings);

// Mock logging
const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const CLINIC_B = '22222222-2222-2222-2222-222222222222';

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

const defaultSettings = {
  clinicId: CLINIC_A,
  emailEnabled: true,
  smsEnabled: false,
  whatsappEnabled: false,
  telegramEnabled: false,
  reminderChannels: ['email'],
  confirmationChannels: ['email'],
  cancellationChannels: ['email'],
  defaultChannel: 'email',
};

describe('GET /api/clinic/communication-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'user-1' }, role: 'owner' });
  });

  it('returns settings for an authorized clinic member', async () => {
    mockSettings.getClinicCommunicationSettings.mockResolvedValue(defaultSettings);

    const res = await GET(makeRequest(`http://localhost/api/clinic/communication-settings?clinic_id=${CLINIC_A}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual(defaultSettings);
    expect(mockSettings.getClinicCommunicationSettings).toHaveBeenCalledWith(CLINIC_A);
  });

  it('returns 400 when clinic_id is missing', async () => {
    const res = await GET(makeRequest('http://localhost/api/clinic/communication-settings'));
    expect(res.status).toBe(400);
    expect(mockSettings.getClinicCommunicationSettings).not.toHaveBeenCalled();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    const res = await GET(makeRequest(`http://localhost/api/clinic/communication-settings?clinic_id=${CLINIC_A}`));
    expect(res.status).toBe(401);
  });

  it('returns 403 when caller is not a member of the clinic (tenant isolation)', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await GET(makeRequest(`http://localhost/api/clinic/communication-settings?clinic_id=${CLINIC_B}`));
    expect(res.status).toBe(403);
    expect(mockSettings.getClinicCommunicationSettings).not.toHaveBeenCalled();
  });

  it('returns 500 on internal error', async () => {
    mockSettings.getClinicCommunicationSettings.mockRejectedValue(new Error('DB down'));
    const res = await GET(makeRequest(`http://localhost/api/clinic/communication-settings?clinic_id=${CLINIC_A}`));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });
});

describe('PUT /api/clinic/communication-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'user-1' }, role: 'owner' });
    mockSettings.validateAndNormalizeSettings.mockImplementation((clinicId, input) => ({
      clinicId,
      emailEnabled: input.emailEnabled ?? true,
      smsEnabled: input.smsEnabled ?? false,
      whatsappEnabled: input.whatsappEnabled ?? false,
      telegramEnabled: input.telegramEnabled ?? false,
      reminderChannels: input.reminderChannels ?? ['email'],
      confirmationChannels: input.confirmationChannels ?? ['email'],
      cancellationChannels: input.cancellationChannels ?? ['email'],
      defaultChannel: input.defaultChannel ?? 'email',
    }));
    mockSettings.saveClinicCommunicationSettings.mockResolvedValue(defaultSettings);
  });

  it('saves settings for an authorized clinic member', async () => {
    const res = await PUT(makeRequest(`http://localhost/api/clinic/communication-settings?clinic_id=${CLINIC_A}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailEnabled: true, smsEnabled: true }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual(defaultSettings);
    expect(mockSettings.saveClinicCommunicationSettings).toHaveBeenCalledWith(expect.objectContaining({ clinicId: CLINIC_A }));
  });

  it('returns 400 for invalid channel in payload', async () => {
    const res = await PUT(makeRequest(`http://localhost/api/clinic/communication-settings?clinic_id=${CLINIC_A}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reminderChannels: ['email', 'fax'] }),
    }));
    expect(res.status).toBe(400);
    expect(mockSettings.saveClinicCommunicationSettings).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid default channel', async () => {
    const res = await PUT(makeRequest(`http://localhost/api/clinic/communication-settings?clinic_id=${CLINIC_A}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultChannel: 'fax' }),
    }));
    expect(res.status).toBe(400);
  });

  it('returns 403 when caller is not a member of the clinic (tenant isolation)', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await PUT(makeRequest(`http://localhost/api/clinic/communication-settings?clinic_id=${CLINIC_B}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailEnabled: true }),
    }));
    expect(res.status).toBe(403);
    expect(mockSettings.saveClinicCommunicationSettings).not.toHaveBeenCalled();
  });

  it('forces clinic_id from the caller, never from the body', async () => {
    const res = await PUT(makeRequest(`http://localhost/api/clinic/communication-settings?clinic_id=${CLINIC_A}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailEnabled: true }),
    }));
    expect(res.status).toBe(200);
    // validateAndNormalizeSettings must be called with the URL clinic_id, not a body clinic_id
    expect(mockSettings.validateAndNormalizeSettings).toHaveBeenCalledWith(CLINIC_A, expect.any(Object));
  });

  it('returns 500 on save failure', async () => {
    mockSettings.saveClinicCommunicationSettings.mockRejectedValue(new Error('DB down'));
    const res = await PUT(makeRequest(`http://localhost/api/clinic/communication-settings?clinic_id=${CLINIC_A}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailEnabled: true }),
    }));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });
});