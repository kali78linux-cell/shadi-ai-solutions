-- ============================================================================
-- PHASE L — PUBLIC PAGE CONTENT (achievements / testimonials / articles / news)
-- SAFE: additive-only. New tables only; no column/table changes to existing
-- schema. Theme (colors/fonts/buttons) intentionally lives in the existing
-- clinics.settings.public_profile JSONB (single source of truth — no duplicate
-- clinic_page_settings table, documented architectural decision).
-- Reversible: see DROP section at the bottom.
-- ============================================================================

create table if not exists clinic_achievements (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  title text not null,
  value text not null default '',
  icon text,
  background_color text not null default '#0e7490' check (background_color ~ '^#[0-9a-fA-F]{6}$'),
  font_size text not null default 'medium' check (font_size in ('small', 'medium', 'large')),
  display_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table clinic_achievements is
  'Owner-managed public-page achievement cards (icon/number/title). Background color is a bounded hex value; font_size is a bounded enum.' ;

create index if not exists idx_clinic_achievements_clinic
  on clinic_achievements (clinic_id, display_order);

create table if not exists clinic_testimonials (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  patient_name text not null,
  content text not null,
  rating integer not null default 5 check (rating between 1 and 5),
  image_path text,
  image_url text,
  display_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table clinic_testimonials is
  'Owner-managed patient reviews. Binaries (optional) in storage bucket clinic-public-media under clinic/{clinic_id}/public-content/.' ;

create index if not exists idx_clinic_testimonials_clinic
  on clinic_testimonials (clinic_id, display_order);

create table if not exists clinic_articles (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  title text not null,
  content text,
  category text,
  image_path text,
  image_url text,
  title_color text not null default '#0f172a' check (title_color ~ '^#[0-9a-fA-F]{6}$'),
  font_size text not null default 'medium' check (font_size in ('small', 'medium', 'large')),
  published_at timestamptz,
  display_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table clinic_articles is
  'Owner-managed public articles. title_color is a bounded hex value; font_size is a bounded enum.' ;

create index if not exists idx_clinic_articles_clinic
  on clinic_articles (clinic_id, display_order);

create index if not exists idx_clinic_articles_published
  on clinic_articles (clinic_id, published_at desc);

create table if not exists clinic_news_ticker (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  text text not null,
  link text,
  priority integer not null default 0,
  speed text not null default 'medium' check (speed in ('slow', 'medium', 'fast')),
  background_color text not null default '#0e7490' check (background_color ~ '^#[0-9a-fA-F]{6}$'),
  text_color text not null default '#ffffff' check (text_color ~ '^#[0-9a-fA-F]{6}$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table clinic_news_ticker is
  'Owner-managed scrolling news strip. Bounded color hex + speed enum only.' ;

create index if not exists idx_clinic_news_ticker_clinic
  on clinic_news_ticker (clinic_id, priority);

-- ---------------------------------------------------------------------------
-- RLS: strict tenant isolation (mirrors clinic_public_media policy pattern).
-- ---------------------------------------------------------------------------
alter table clinic_achievements enable row level security;
alter table clinic_testimonials enable row level security;
alter table clinic_articles enable row level security;
alter table clinic_news_ticker enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clinic_achievements'
      and policyname = 'clinic_achievements_tenant_all'
  ) then
    create policy clinic_achievements_tenant_all
      on clinic_achievements for all
      using (
        clinic_id in (
          select cu.clinic_id from clinic_users cu where cu.user_id = auth.uid()
        )
      )
      with check (
        clinic_id in (
          select cu.clinic_id from clinic_users cu where cu.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clinic_testimonials'
      and policyname = 'clinic_testimonials_tenant_all'
  ) then
    create policy clinic_testimonials_tenant_all
      on clinic_testimonials for all
      using (
        clinic_id in (
          select cu.clinic_id from clinic_users cu where cu.user_id = auth.uid()
        )
      )
      with check (
        clinic_id in (
          select cu.clinic_id from clinic_users cu where cu.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clinic_articles'
      and policyname = 'clinic_articles_tenant_all'
  ) then
    create policy clinic_articles_tenant_all
      on clinic_articles for all
      using (
        clinic_id in (
          select cu.clinic_id from clinic_users cu where cu.user_id = auth.uid()
        )
      )
      with check (
        clinic_id in (
          select cu.clinic_id from clinic_users cu where cu.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clinic_news_ticker'
      and policyname = 'clinic_news_ticker_tenant_all'
  ) then
    create policy clinic_news_ticker_tenant_all
      on clinic_news_ticker for all
      using (
        clinic_id in (
          select cu.clinic_id from clinic_users cu where cu.user_id = auth.uid()
        )
      )
      with check (
        clinic_id in (
          select cu.clinic_id from clinic_users cu where cu.user_id = auth.uid()
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- REVERSIBILITY (documented; NOT executed here):
--   drop policy if exists clinic_news_ticker_tenant_all on clinic_news_ticker;
--   drop policy if exists clinic_articles_tenant_all on clinic_articles;
--   drop policy if exists clinic_testimonials_tenant_all on clinic_testimonials;
--   drop policy if exists clinic_achievements_tenant_all on clinic_achievements;
--   drop table if exists clinic_news_ticker;
--   drop table if exists clinic_articles;
--   drop table if exists clinic_testimonials;
--   drop table if exists clinic_achievements;
-- ---------------------------------------------------------------------------
