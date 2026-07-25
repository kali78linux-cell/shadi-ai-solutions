
import { WebChannel } from '../../lib/services/gateway/channels/web';
import { WebSocketServer } from '../../lib/services/gateway/channels/web/server';
import { UnifiedMessage, OutgoingMessage } from '../../lib/services/gateway/types';
import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';

describe('WebChannel and WebSocketServer Integration', () => {
    it('should handle incoming and outgoing messages', () => new Promise((done) => {
        const port = 8092;
        const webChannel = new WebChannel();
        const server = new WebSocketServer(port, webChannel);
        webChannel.setServer(server);

        const client = new WebSocket(`ws://localhost:${port}`);

        const incomingMessage: UnifiedMessage = {
            channel: 'web',
            channelId: '123',
            conversationId: '456',
            senderId: '789',
            recipientId: '101',
            timestamp: Date.now(),
            message: {
                id: 'abc',
                type: 'text',
                text: 'Hello, world!',
            },
        };
        
        const outgoingMessage: OutgoingMessage = {
            channel: 'web',
            recipientId: 'all',
            message: {
                type: 'text',
                text: 'This is a broadcast message.',
            },
        };

        webChannel.onMessage((message) => {
            expect(message).toEqual(incomingMessage);
            webChannel.sendMessage(outgoingMessage);
        });

        client.on('open', () => {
            client.send(JSON.stringify(incomingMessage));
        });

        client.on('message', (data) => {
            const message = JSON.parse(data.toString());
            expect(message).toEqual(outgoingMessage);
            client.close();
            server.wss.close();
            done(null);
        });
    }));
});

