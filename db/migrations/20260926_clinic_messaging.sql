-- ============================================================
-- PHASE H — Clinic-to-Clinic Messaging System
-- SAFE: additive-only, idempotent, fully reversible
-- ============================================================

-- 1) Core message table
CREATE TABLE IF NOT EXISTS clinic_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    to_clinic_id    UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    content         TEXT,
    file_url        TEXT,
    file_name       TEXT,
    file_size       INTEGER,
    patient_name    TEXT,
    patient_phone   TEXT,
    patient_notes   TEXT,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Self-messaging guard (idempotent constraint add)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'clinic_messages_clinic_ids_differ'
          AND conrelid = 'clinic_messages'::regclass
    ) THEN
        ALTER TABLE clinic_messages
        ADD CONSTRAINT clinic_messages_clinic_ids_differ
        CHECK (from_clinic_id <> to_clinic_id);
    END IF;
END;
$$;

-- 3) Performance indexes for conversation views + unread tracking
CREATE INDEX IF NOT EXISTS idx_clinic_messages_from_clinic_created
ON clinic_messages(from_clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinic_messages_to_clinic_created
ON clinic_messages(to_clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinic_messages_thread
ON clinic_messages(
    LEAST(from_clinic_id, to_clinic_id),
    GREATEST(from_clinic_id, to_clinic_id),
    created_at ASC
);

CREATE INDEX IF NOT EXISTS idx_clinic_messages_unread
ON clinic_messages(to_clinic_id, is_read, created_at DESC);

-- 4) RLS: service-role-only access (client goes through the API layer, which
--    authorizes membership via authorizeClinicRequest before using the
--    service-role client). No policies = denied for anon/authenticated.
ALTER TABLE clinic_messages ENABLE ROW LEVEL SECURITY;

-- 5) Trigger: messaging requires an accepted relationship between the two orgs
CREATE OR REPLACE FUNCTION enforce_messaging_relationship()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.from_clinic_id = NEW.to_clinic_id THEN
        RAISE EXCEPTION 'Cannot send message to yourself';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM organization_relationships
        WHERE ((source_org_id = NEW.from_clinic_id AND target_org_id = NEW.to_clinic_id)
            OR (source_org_id = NEW.to_clinic_id AND target_org_id = NEW.from_clinic_id))
          AND status = 'accepted'
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Messaging requires an accepted partnership between clinics';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_clinic_messages_enforce_relationship ON clinic_messages;
CREATE TRIGGER tr_clinic_messages_enforce_relationship
BEFORE INSERT OR UPDATE ON clinic_messages
FOR EACH ROW EXECUTE FUNCTION enforce_messaging_relationship();

-- 6) RPC: conversation list (accepted partners + last message + REAL unread
--    count computed over ALL unread messages per thread, not just the last one)
CREATE OR REPLACE FUNCTION get_clinic_conversations(p_clinic_id UUID)
RETURNS TABLE (
    partner_id        UUID,
    partner_name      TEXT,
    partner_slug      TEXT,
    partner_activity  TEXT,
    last_message_id   UUID,
    last_content      TEXT,
    last_file_name    TEXT,
    last_created_at   TIMESTAMPTZ,
    unread_count      BIGINT
) LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN QUERY
    WITH unread_per_partner AS (
        SELECT m.from_clinic_id AS partner, COUNT(*)::BIGINT AS unread
        FROM clinic_messages m
        WHERE m.to_clinic_id = p_clinic_id AND m.is_read = FALSE
        GROUP BY m.from_clinic_id
    ),
    last_msgs AS (
        SELECT DISTINCT ON (
            LEAST(m.from_clinic_id, m.to_clinic_id),
            GREATEST(m.from_clinic_id, m.to_clinic_id)
        )
            m.id,
            m.from_clinic_id,
            m.to_clinic_id,
            m.content,
            m.file_name,
            m.created_at
        FROM clinic_messages m
        WHERE (m.from_clinic_id = p_clinic_id OR m.to_clinic_id = p_clinic_id)
        ORDER BY
            LEAST(m.from_clinic_id, m.to_clinic_id),
            GREATEST(m.from_clinic_id, m.to_clinic_id),
            m.created_at DESC
    )
    SELECT
        partner.id AS partner_id,
        partner.name AS partner_name,
        partner.slug AS partner_slug,
        partner.activity_type AS partner_activity,
        lm.id::UUID AS last_message_id,
        lm.content AS last_content,
        lm.file_name AS last_file_name,
        lm.created_at AS last_created_at,
        COALESCE(u.unread, 0::BIGINT) AS unread_count
    FROM last_msgs lm
    JOIN clinics partner ON (
        partner.id = CASE
            WHEN lm.from_clinic_id = p_clinic_id THEN lm.to_clinic_id
            ELSE lm.from_clinic_id
        END
    )
    LEFT JOIN unread_per_partner u ON u.partner = partner.id
    WHERE EXISTS (
        SELECT 1 FROM organization_relationships r
        WHERE r.status = 'accepted'
          AND r.deleted_at IS NULL
          AND (
              (r.source_org_id = p_clinic_id AND r.target_org_id = partner.id)
              OR
              (r.source_org_id = partner.id AND r.target_org_id = p_clinic_id)
          )
    )
    ORDER BY lm.created_at DESC;
END;
$$;

-- ============================================================
-- ROLLBACK:
-- DROP FUNCTION get_clinic_conversations(UUID);
-- DROP TRIGGER tr_clinic_messages_enforce_relationship ON clinic_messages;
-- DROP FUNCTION enforce_messaging_relationship();
-- DROP INDEX idx_clinic_messages_unread;
-- DROP INDEX idx_clinic_messages_thread;
-- DROP INDEX idx_clinic_messages_to_clinic_created;
-- DROP INDEX idx_clinic_messages_from_clinic_created;
-- ALTER TABLE clinic_messages DROP CONSTRAINT clinic_messages_clinic_ids_differ;
-- DROP TABLE clinic_messages;
-- ============================================================