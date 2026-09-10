import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateMessageFile,
  buildMessageStoragePath,
  isOwnMessageFilePath,
  sendMessage,
  assertCanMessage,
  uploadMessageFile,
  markConversationRead,
  countUnreadMessages,
  getThread,
  getConversations,
} from '@/lib/services/clinicMessaging';

/**
 * PHASE H — CLINIC MESSAGING service tests.
 * Covers: messaging file validation (images/PDF/DICOM), tenant-scoped storage
 * paths, cross-tenant attachment rejection, relationship gating (self / none /
 * pending / accepted), thread direction mapping + fresh signed URLs, and
 * mark-read / unread-count scoping.
 */

const CID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PARTNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const mockState = vi.hoisted(() => ({
  rows: [] as any[],
  singleRow: null as any,
  relRow: null as any,
  queryError: null as any,
  rpcResult: { data: [] as any[], error: null as any },
  insertPayload: null as any,
  updatePayload: null as any,
  eqCalls: [] as [string, any][],
  uploads: [] as { path: string; type: string }[],
  signedUrls: new Map<string, string>(),
  signedFailures: new Set<string>(),
  countResult: 0,
}));

function makeChain(table: string) {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((col: string, val: any) => {
    mockState.eqCalls.push([`${table}.${col}`, val]);
    return chain;
  });
  chain.is = vi.fn(() => chain);
  chain.or = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.insert = vi.fn((payload: any) => {
    mockState.insertPayload = { table, payload };
    return chain;
  });
  chain.update = vi.fn((payload: any) => {
    mockState.updatePayload = { table, payload };
    return chain;
  });
  chain.single = vi.fn(() =>
    Promise.resolve({ data: mockState.singleRow, error: mockState.queryError })
  );
  chain.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: mockState.relRow, error: mockState.queryError })
  );
  chain.then = (
    onFulfilled: (v: { data: any[]; error: any; count: number }) => any,
    onRejected: (e: unknown) => any
  ) =>
    Promise.resolve({
      data: mockState.rows,
      error: mockState.queryError,
      count: mockState.countResult,
    }).then(onFulfilled, onRejected);
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => makeChain(table)),
    rpc: vi.fn(async () => mockState.rpcResult),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(async (path: string, file: { type?: string }) => {
          mockState.uploads.push({ path, type: file?.type ?? '' });
          return { error: null };
        }),
        createSignedUrl: vi.fn(async (path: string) => {
          if (mockState.signedFailures.has(path)) {
            return { data: null, error: new Error('sign failed') };
          }
          return {
            data: { signedUrl: mockState.signedUrls.get(path) ?? `https://signed.example/${path}` },
            error: null,
          };
        }),
      })),
    },
  },
}));

beforeEach(() => {
  mockState.rows = [];
  mockState.singleRow = null;
  mockState.relRow = null;
  mockState.queryError = null;
  mockState.rpcResult = { data: [], error: null };
  mockState.insertPayload = null;
  mockState.updatePayload = null;
  mockState.eqCalls = [];
  mockState.uploads = [];
  mockState.signedUrls = new Map();
  mockState.signedFailures = new Set();
  mockState.countResult = 0;
});

describe('validateMessageFile', () => {
  it('accepts JPEG / PNG / PDF', () => {
    expect(validateMessageFile({ name: 'pano.jpg', type: 'image/jpeg', size: 1000 }).ok).toBe(true);
    expect(validateMessageFile({ name: 'scan.png', type: 'image/png', size: 1000 }).ok).toBe(true);
    expect(validateMessageFile({ name: 'report.pdf', type: 'application/pdf', size: 1000 }).ok).toBe(true);
  });

  it('accepts DICOM via application/dicom AND via empty MIME with .dcm name', () => {
    expect(validateMessageFile({ name: 'x.dcm', type: 'application/dicom', size: 1000 }).ok).toBe(true);
    const emptyMime = validateMessageFile({ name: 'x.dcm', type: '', size: 1000 });
    expect(emptyMime.ok).toBe(true);
    if (emptyMime.ok) expect(emptyMime.ext).toBe('.dcm');
  });

  it('rejects unsupported MIME, empty files, oversized files, and bad extensions', () => {
    expect(validateMessageFile({ name: 'page.html', type: 'text/html', size: 100 }).ok).toBe(false);
    expect(validateMessageFile({ name: 'a.jpg', type: 'image/jpeg', size: 0 }).ok).toBe(false);
    expect(
      validateMessageFile({ name: 'big.jpg', type: 'image/jpeg', size: 26 * 1024 * 1024 }).ok
    ).toBe(false);
    expect(validateMessageFile({ name: 'evil.jpg.exe', type: 'image/jpeg', size: 100 }).ok).toBe(false);
  });
});

describe('storage paths', () => {
  it('buildMessageStoragePath is tenant-scoped and never uses the raw filename', () => {
    const p = buildMessageStoragePath(CID, '.pdf');
    expect(p.startsWith(`clinic/${CID}/messaging/`)).toBe(true);
    expect(p.endsWith('.pdf')).toBe(true);
    expect(p).not.toContain('report'); // raw filename never leaks into the path
  });

  it('isOwnMessageFilePath accepts only the tenant messaging folder', () => {
    expect(isOwnMessageFilePath(CID, `clinic/${CID}/messaging/x.pdf`)).toBe(true);
    expect(isOwnMessageFilePath(CID, `clinic/${OTHER}/messaging/x.pdf`)).toBe(false);
    expect(isOwnMessageFilePath(CID, 'https://evil.example/x.pdf')).toBe(false);
    expect(isOwnMessageFilePath(CID, `clinic/${CID}/public-media/x.png`)).toBe(false);
  });
});

describe('assertCanMessage', () => {
  it('blocks self-messaging with 400', async () => {
    const r = await assertCanMessage(CID, CID);
    expect(r.ok).toBe(false);
    if ('status' in r) expect(r.status).toBe(400);
  });

  it('blocks when no relationship exists (403)', async () => {
    mockState.relRow = null;
    const r = await assertCanMessage(CID, PARTNER);
    expect(r.ok).toBe(false);
    if ('status' in r) {
      expect(r.status).toBe(403);
      expect(r.message).toContain('لا توجد علاقة');
    }
  });

  it('blocks a pending relationship (403) with a clear Arabic message', async () => {
    mockState.relRow = { id: 'rel1', status: 'pending' };
    const r = await assertCanMessage(CID, PARTNER);
    expect(r.ok).toBe(false);
    if ('status' in r) {
      expect(r.status).toBe(403);
      expect(r.message).toContain('غير مقبولة');
    }
  });

  it('allows an accepted relationship', async () => {
    mockState.relRow = { id: 'rel2', status: 'accepted' };
    const r = await assertCanMessage(CID, PARTNER);
    expect(r.ok).toBe(true);
  });
});

describe('sendMessage', () => {
  it('inserts the message with sender/recipient and is_read=false', async () => {
    mockState.singleRow = { id: 'm1' };
    await sendMessage(CID, PARTNER, { content: 'مرحبا' });
    expect(mockState.insertPayload?.table).toBe('clinic_messages');
    expect(mockState.insertPayload?.payload).toMatchObject({
      from_clinic_id: CID,
      to_clinic_id: PARTNER,
      content: 'مرحبا',
      is_read: false,
    });
  });

  it('rejects attachments outside the tenant messaging folder', async () => {
    await expect(
      sendMessage(CID, PARTNER, { file_url: `clinic/${OTHER}/messaging/x.pdf` })
    ).rejects.toThrow('مسار الملف المرفق غير صالح');
    expect(mockState.insertPayload).toBeNull();
  });

  it('accepts attachments inside the tenant messaging folder', async () => {
    mockState.singleRow = { id: 'm2' };
    await sendMessage(CID, PARTNER, { file_url: `clinic/${CID}/messaging/x.pdf` });
    expect(mockState.insertPayload?.payload.file_url).toBe(`clinic/${CID}/messaging/x.pdf`);
  });
});

describe('uploadMessageFile', () => {
  it('rejects an invalid file WITHOUT touching storage', async () => {
    const bad = new File(['x'], 'evil.html', { type: 'text/html' });
    const r = await uploadMessageFile(CID, bad as unknown as File);
    expect(r.ok).toBe(false);
    expect(mockState.uploads).toHaveLength(0);
  });

  it('uploads a valid file and returns the STORAGE PATH (not a signed URL)', async () => {
    const file = new File(['pdf-bytes'], 'report.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 1024 });
    const r = await uploadMessageFile(CID, file);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.url.startsWith(`clinic/${CID}/messaging/`)).toBe(true);
      expect(r.url.endsWith('.pdf')).toBe(true);
      expect(r.name).toBe('report.pdf');
      expect(r.size).toBe(1024);
    }
    expect(mockState.uploads).toHaveLength(1);
  });
});

describe('getThread', () => {
  const ownPath = `clinic/${CID}/messaging/own.pdf`;

  it('maps direction, resolves fresh signed URLs, degrades failures to null, and passes legacy URLs', async () => {
    mockState.relRow = { id: 'rel3', status: 'accepted' };
    mockState.rows = [
      { id: 'm1', from_clinic_id: CID, to_clinic_id: PARTNER, file_url: ownPath, content: 'a' },
      {
        id: 'm2',
        from_clinic_id: PARTNER,
        to_clinic_id: CID,
        file_url: 'https://legacy.example/scan.jpg',
        content: null,
      },
      { id: 'm3', from_clinic_id: CID, to_clinic_id: PARTNER, file_url: `clinic/${OTHER}/messaging/f.pdf` },
    ];
    mockState.signedFailures.add(ownPath); // force signing failure → file_url must degrade to null

    const thread = await getThread(CID, PARTNER);
    expect(thread).toHaveLength(3);
    expect(thread[0].direction).toBe('outgoing');
    expect(thread[0].file_url).toBeNull(); // signing failed → name-only, never a broken/expired link
    expect(thread[1].direction).toBe('incoming');
    expect(thread[1].file_url).toBe('https://legacy.example/scan.jpg');
    expect(thread[2].file_url).toBeNull(); // foreign-tenant path is never resolvable
  });
});

describe('markConversationRead / countUnreadMessages', () => {
  it('marks only incoming unread messages from the partner as read', async () => {
    await markConversationRead(CID, PARTNER);
    expect(mockState.updatePayload?.payload).toMatchObject({ is_read: true });
    const cols = mockState.eqCalls.map(([c]) => c);
    expect(cols).toContain('clinic_messages.to_clinic_id');
    expect(cols).toContain('clinic_messages.from_clinic_id');
    expect(cols).toContain('clinic_messages.is_read');
  });

  it('counts unread messages for the tenant', async () => {
    mockState.countResult = 7;
    const n = await countUnreadMessages(CID);
    expect(n).toBe(7);
  });
});

describe('getConversations', () => {
  it('delegates to the get_clinic_conversations RPC with the tenant id', async () => {
    mockState.rpcResult = {
      data: [{ partner_id: PARTNER, partner_name: 'X', unread_count: 2 }],
      error: null,
    };
    const rows = await getConversations(CID);
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).partner_id).toBe(PARTNER);
  });
});