-- Waiter profile editor fields (slice 3). Additive, nullable, non-destructive.
-- `city` lives on profiles (personal); the rest are waiter-specific. The older
-- columns (years_experience, hourly_rate_min, availability_days, certifications,
-- cv_url, documents) are kept for the future "verified credentials" flow.
alter table public.profiles        add column if not exists city text;
alter table public.waiter_profiles add column if not exists primary_role text;
alter table public.waiter_profiles add column if not exists languages text;
alter table public.waiter_profiles add column if not exists specializations text;
alter table public.waiter_profiles add column if not exists experience text;
