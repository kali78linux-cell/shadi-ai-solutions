-- Payment gateway (Stripe) tracking columns for subscriptions. Additive, non-destructive.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;