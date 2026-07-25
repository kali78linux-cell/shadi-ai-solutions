
import { MessageRouter } from '../../lib/services/gateway/routing/router';
import { WebChannel } from '../../lib/services/gateway/channels/web';
import { UnifiedMessage, OutgoingMessage } from '../../lib/services/gateway/types';
import { vi, describe, it, expect } from 'vitest';

describe('Gateway', () => {
    it('should route an incoming message from the web channel', async () => {
        const router = new MessageRouter();
        const webChannel = new WebChannel();
        router.registerChannel(webChannel);

        const messageHandler = vi.fn();
        router.onMessage(messageHandler);

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

        // This is now handled by the router's onMessage
        const webChannelMessageHandler = (router as any).channels.get('web').messageHandler;
        webChannelMessageHandler(incomingMessage);

        expect(messageHandler).toHaveBeenCalledWith(incomingMessage);
    });

    it('should send an outgoing message to the web channel', async () => {
        const router = new MessageRouter();
        const webChannel = new WebChannel();
        const mockServer = { broadcast: vi.fn() };
        // @ts-ignore
        webChannel.setServer(mockServer);
        router.registerChannel(webChannel);

        const outgoingMessage: OutgoingMessage = {
            channel: 'web',
            recipientId: '789',
            message: {
                type: 'text',
                text: 'Hello back!',
            },
        };

        await router.sendMessage(outgoingMessage);

        expect(mockServer.broadcast).toHaveBeenCalledWith(outgoingMessage);
    });
});
