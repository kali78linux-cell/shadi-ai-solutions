
import { WhatsAppChannel } from '../../lib/services/gateway/channels/whatsapp';
import { WhatsAppMessage } from '../../lib/services/gateway/channels/whatsapp/types';
import { UnifiedMessage, OutgoingMessage } from '../../lib/services/gateway/types';
import { vi, describe, it, expect } from 'vitest';

describe('WhatsAppChannel', () => {
    const token = 'test-token';
    const webhookVerifyToken = 'test-verify-token';
    const channel = new WhatsAppChannel(token, webhookVerifyToken);

    describe('Webhook Verification', () => {
        it('should verify a valid webhook', () => {
            const hubMode = 'subscribe';
            const hubChallenge = 'challenge-code';
            const hubVerifyToken = webhookVerifyToken;

            const result = channel.verifyWebhook(hubMode, hubChallenge, hubVerifyToken);
            expect(result).toBe(hubChallenge);
        });

        it('should reject an invalid webhook', () => {
            const hubMode = 'subscribe';
            const hubChallenge = 'challenge-code';
            const hubVerifyToken = 'invalid-token';

            expect(() => {
                channel.verifyWebhook(hubMode, hubChallenge, hubVerifyToken);
            }).toThrow('Failed to verify webhook');
        });
    });

    describe('Message Handling', () => {
        it('should normalize an incoming WhatsApp message', () => {
            const whatsappPayload: WhatsAppMessage = {
                object: 'whatsapp_business_account',
                entry: [
                    {
                        id: '12345',
                        changes: [
                            {
                                field: 'messages',
                                value: {
                                    messaging_product: 'whatsapp',
                                    metadata: {
                                        display_phone_number: '15550992222',
                                        phone_number_id: '1234567890',
                                    },
                                    contacts: [
                                        {
                                            profile: {
                                                name: 'John Doe',
                                            },
                                            wa_id: '15551234567',
                                        },
                                    ],
                                    messages: [
                                        {
                                            from: '15551234567',
                                            id: 'wamid.HBgLMTU1NTEyMzQ1NjcVAgARGBJDNkQ5NkY4RjdCMzgzQzYwRQA=',
                                            timestamp: '1678886400',
                                            text: {
                                                body: 'Hello, world!',
                                            },
                                            type: 'text',
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            };

            const expectedUnifiedMessage: Partial<UnifiedMessage> = {
                channel: 'whatsapp',
                channelId: '12345',
                conversationId: '15551234567',
                senderId: '15551234567',
                recipientId: '1234567890',
                timestamp: 1678886400,
                message: {
                    id: 'wamid.HBgLMTU1NTEyMzQ1NjcVAgARGBJDNkQ5NkY4RjdCMzgzQzYwRQA=',
                    type: 'text',
                    text: 'Hello, world!',
                },
            };

            const messageHandler = vi.fn();
            channel.onMessage(messageHandler);
            channel.handleWebhook(whatsappPayload);

            expect(messageHandler).toHaveBeenCalledWith(expect.objectContaining(expectedUnifiedMessage));
        });

        it('should send an outgoing message', async () => {
            const outgoingMessage: OutgoingMessage = {
                channel: 'whatsapp',
                recipientId: '15551234567',
                message: {
                    type: 'text',
                    text: 'Hello back!',
                },
            };

            const fetchMock = vi.fn().mockResolvedValue({ ok: true });
            global.fetch = fetchMock;

            await channel.sendMessage(outgoingMessage);

            expect(fetchMock).toHaveBeenCalledWith(
                `https://graph.facebook.com/v19.0/${token}/messages`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        to: outgoingMessage.recipientId,
                        type: outgoingMessage.message.type,
                        [outgoingMessage.message.type]: {
                            body: outgoingMessage.message.text,
                        },
                    }),
                }
            );
        });
    });
});
