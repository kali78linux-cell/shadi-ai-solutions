
import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';

describe('WebSocket', () => {
    it('should create a WebSocket server', () => {
        // The 'ws' module is aliased to tests/mocks/ws.ts at runtime (vitest config).
        // tsc resolves the real 'ws' types, so we cast to access the mock's Server.
        const Ws = WebSocket as unknown as { Server: new (o: { port: number }) => { close(): void } };
        const server = new Ws.Server({ port: 8093 });
        expect(server).toBeDefined();
        server.close();
    });
});
