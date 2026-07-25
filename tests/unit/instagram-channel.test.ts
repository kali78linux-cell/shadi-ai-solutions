
import { InstagramChannel } from '../../lib/services/gateway/channels/instagram';
import { InstagramEvent } from '../../lib/services/gateway/channels/instagram/types';
import { UnifiedMessage, OutgoingMessage } from '../../lib/services/gateway/types';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('InstagramChannel', () => {
    const pageAccessToken = 'test-token';
    const fetchMock = vi.fn();
    const channel = new InstagramChannel(pageAccessToken, fetchMock);

    beforeEach(() => {
        fetchMock.mockClear();
    });

    describe('Message Handling', () => {
        it('should normalize an incoming Instagram message', () => {
            const instagramPayload: InstagramEvent = {
                object: 'instagram',
                entry: [
                    {
                        id: 'page-id',
                        time: 1678886400,
                        messaging: [
                            {
                                sender: {
                                    id: 'user-id',
                                },
                                recipient: {
                                    id: 'page-id',
                                },
                                timestamp: 1678886400,
                                message: {
                                    mid: 'message-id',
                                    text: 'Hello, world!',
                                },
                            },
                        ],
                    },
                ],
            };

            const expectedUnifiedMessage: Partial<UnifiedMessage> = {
                channel: 'instagram',
                channelId: 'page-id',
                conversationId: 'user-id',
                senderId: 'user-id',
                recipientId: 'page-id',
                timestamp: 1678886400,
                message: {
                    id: 'message-id',
                    type: 'text',
                    text: 'Hello, world!',
                },
            };

            const messageHandler = vi.fn();
            channel.onMessage(messageHandler);
            channel.handleWebhook(instagramPayload);

            expect(messageHandler).toHaveBeenCalledWith(expect.objectContaining(expectedUnifiedMessage));
        });

        it('should send an outgoing message', async () => {
            fetchMock.mockResolvedValue({ ok: true });
            const outgoingMessage: OutgoingMessage = {
                channel: 'instagram',
                recipientId: 'user-id',
                message: {
                    type: 'text',
                    text: 'Hello back!',
                },
            };

            await channel.sendMessage(outgoingMessage);

            expect(fetchMock).toHaveBeenCalledWith(
                `https://graph.facebook.com/v19.0/me/messages?access_token=${pageAccessToken}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        recipient: {
                            id: outgoingMessage.recipientId,
                        },
                        message: {
                            text: outgoingMessage.message.text,
                        },
                    }),
                }
            );
        });
    });
});
