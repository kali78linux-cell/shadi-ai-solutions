
import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';

describe('WebSocket', () => {
    it('should create a WebSocket server', () => {
        const server = new WebSocket.Server({ port: 8093 });
        expect(server).toBeDefined();
        server.close();
    });
});
