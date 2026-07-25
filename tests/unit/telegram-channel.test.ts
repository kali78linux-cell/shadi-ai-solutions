
import { TelegramChannel } from '../../lib/services/gateway/channels/telegram';
import { TelegramUpdate } from '../../lib/services/gateway/channels/telegram/types';
import { UnifiedMessage, OutgoingMessage } from '../../lib/services/gateway/types';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('TelegramChannel', () => {
    const token = 'test-token';
    const fetchMock = vi.fn();
    const channel = new TelegramChannel(token, fetchMock);

    beforeEach(() => {
        fetchMock.mockClear();
    });

    describe('Message Handling', () => {
        it('should normalize an incoming Telegram message', () => {
            const telegramPayload: TelegramUpdate = {
                update_id: 12345,
                message: {
                    message_id: 67890,
                    from: {
                        id: 123456789,
                        is_bot: false,
                        first_name: 'John',
                        last_name: 'Doe',
                        username: 'johndoe',
                    },
                    chat: {
                        id: 987654321,
                        first_name: 'John',
                        last_name: 'Doe',
                        username: 'johndoe',
                        type: 'private',
                    },
                    date: 1678886400,
                    text: 'Hello, world!',
                },
            };

            const expectedUnifiedMessage: Partial<UnifiedMessage> = {
                channel: 'telegram',
                channelId: '12345',
                conversationId: '987654321',
                senderId: '123456789',
                recipientId: '',
                timestamp: 1678886400,
                message: {
                    id: '67890',
                    type: 'text',
                    text: 'Hello, world!',
                },
            };

            const messageHandler = vi.fn();
            channel.onMessage(messageHandler);
            channel.handleWebhook(telegramPayload);

            expect(messageHandler).toHaveBeenCalledWith(expect.objectContaining(expectedUnifiedMessage));
        });

        it('should send an outgoing message', async () => {
            fetchMock.mockResolvedValue({ ok: true });
            const outgoingMessage: OutgoingMessage = {
                channel: 'telegram',
                recipientId: '987654321',
                message: {
                    type: 'text',
                    text: 'Hello back!',
                },
            };

            await channel.sendMessage(outgoingMessage);

            expect(fetchMock).toHaveBeenCalledWith(
                `https://api.telegram.org/bot${token}/sendMessage`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        chat_id: outgoingMessage.recipientId,
                        text: outgoingMessage.message.text,
                    }),
                }
            );
        });
    });
});
