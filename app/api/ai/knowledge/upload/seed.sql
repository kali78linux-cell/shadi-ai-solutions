-- This script will be run by `supabase db reset`.
-- It is idempotent, meaning it can be run multiple times without causing errors.

-- 1. Create a demo clinic if it doesn't exist
-- Note: We use a fixed UUID for the clinic to make linking easier.
INSERT INTO public.clinics (id, name, slug)
SELECT 'a1b2c3d4-e5f6-7890-1234-567890abcdef', 'عيادة الأمل للأسنان', 'al-amal-dental'
WHERE NOT EXISTS (SELECT 1 FROM public.clinics WHERE id = 'a1b2c3d4-e5f6-7890-1234-567890abcdef');

-- 2. Create the demo user if they don't exist
-- Note: This uses the credentials you provided.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
SELECT
    'b1c2d3e4-f5a6-7890-1234-567890abcdef', -- Fixed UUID for the user
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'shadisuad78@gmail.com',
    crypt('111978', gen_salt('bf')), -- Encrypt the password
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'shadisuad78@gmail.com');

-- 3. Link the user to the clinic as an owner
INSERT INTO public.clinic_users (clinic_id, user_id, role)
SELECT 'a1b2c3d4-e5f6-7890-1234-567890abcdef', 'b1c2d3e4-f5a6-7890-1234-567890abcdef', 'owner'
WHERE NOT EXISTS (SELECT 1 FROM public.clinic_users WHERE user_id = 'b1c2d3e4-f5a6-7890-1234-567890abcdef');

-- 4. Insert some sample patients for the demo clinic
INSERT INTO public.patients (clinic_id, name, email, phone)
VALUES
    ('a1b2c3d4-e5f6-7890-1234-567890abcdef', 'أحمد محمد', 'ahmad.m@example.com', '0501234567'),
    ('a1b2c3d4-e5f6-7890-1234-567890abcdef', 'فاطمة علي', 'fatima.a@example.com', '0557654321'),
    ('a1b2c3d4-e5f6-7890-1234-567890abcdef', 'خالد عبدالله', 'khalid.a@example.com', '0539876543');

-- 5. Insert some sample appointments for these patients
DO $$
DECLARE
    ahmad_id UUID;
    fatima_id UUID;
BEGIN
    SELECT id INTO ahmad_id FROM public.patients WHERE email = 'ahmad.m@example.com' AND clinic_id = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
    SELECT id INTO fatima_id FROM public.patients WHERE email = 'fatima.a@example.com' AND clinic_id = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';

    INSERT INTO public.appointments (clinic_id, patient_id, service, appointment_date, status)
    VALUES
        ('a1b2c3d4-e5f6-7890-1234-567890abcdef', ahmad_id, 'تنظيف أسنان', now() + interval '1 day', 'confirmed'),
        ('a1b2c3d4-e5f6-7890-1234-567890abcdef', fatima_id, 'فحص عام', now() + interval '2 days', 'scheduled');
END $$;

-- 6. Insert a sample lead
INSERT INTO public.leads (clinic_id, name, email, phone, source, status)
VALUES
    ('a1b2c3d4-e5f6-7890-1234-567890abcdef', 'سارة يوسف', 'sara.y@example.com', '0561122334', 'Website', 'New');

-- 7. Insert a sample knowledge document to make the Knowledge Base page interactive
INSERT INTO public.clinic_knowledge_documents (id, clinic_id, uploaded_by, original_filename, file_type, mime_type, file_size, storage_path, upload_status, processing_status, chunk_count, indexed_at)
SELECT
    'c1d2e3f4-a5b6-c7d8-e9f0-123456789abc', -- Fixed UUID for the document
    'a1b2c3d4-e5f6-7890-1234-567890abcdef', -- Demo clinic ID
    'b1c2d3e4-f5a6-7890-1234-567890abcdef', -- Demo user ID
    'أسعار الخدمات.pdf',
    'application/pdf',
    'application/pdf',
    15728, -- 15 KB
    'a1b2c3d4-e5f6-7890-1234-567890abcdef/dummy-pricing.pdf',
    'success',
    'indexed',
    12,
    now()
WHERE NOT EXISTS (SELECT 1 FROM public.clinic_knowledge_documents WHERE id = 'c1d2e3f4-a5b6-c7d8-e9f0-123456789abc');