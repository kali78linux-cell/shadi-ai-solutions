
-- db/migrations/20260723_communication_gateway.sql

CREATE TABLE gateway_channels (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id),
  channel_type VARCHAR(20) NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  settings JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE gateway_messages (
  id SERIAL PRIMARY KEY,
  channel_id INTEGER REFERENCES gateway_channels(id),
  message_id VARCHAR(255) UNIQUE,
  conversation_id VARCHAR(255),
  sender_id VARCHAR(255),
  recipient_id VARCHAR(255),
  message_type VARCHAR(50),
  content JSONB,
  status VARCHAR(20) DEFAULT 'pending',
  direction VARCHAR(10) NOT NULL, -- 'incoming' or 'outgoing'
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE gateway_dlq (
  id SERIAL PRIMARY KEY,
  message_id INTEGER REFERENCES gateway_messages(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gateway_messages_conversation_id ON gateway_messages(conversation_id);
CREATE INDEX idx_gateway_messages_sender_id ON gateway_messages(sender_id);
CREATE INDEX idx_gateway_messages_recipient_id ON gateway_messages(recipient_id);
