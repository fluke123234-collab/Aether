-- ============================================================
--  Aether · Phase 3 — Supabase schema (fully re-runnable)
--  Run this in your Supabase project's SQL Editor:
--  https://supabase.com/dashboard/project/pbjmskzkgfavldjyncfo/sql/new
--  (Paste everything below and click Run. Safe to re-run on ANY
--   existing state of the memories table — it reconciles every column.)
-- ============================================================

-- 1. Create the table if it doesn't exist at all ----------------
create table if not exists public.memories (
  id          uuid primary key default gen_random_uuid(),
  title       text        not null default 'Capturing thought…',
  body        text        not null,
  summary     text,
  category    text        not null default 'idea',
  tags        text[]      not null default '{}',
  processing  boolean     not null default false,
  user_id     text,
  created_at  timestamptz not null default now()
);

-- 1b. Reconcile EVERY column for pre-existing/partial tables (idempotent).
--     This guarantees the insert in /api/capture works no matter how the
--     table was initially created.
alter table public.memories add column if not exists id          uuid         primary key default gen_random_uuid();
alter table public.memories add column if not exists title       text         not null default 'Capturing thought…';
alter table public.memories add column if not exists body        text;
alter table public.memories add column if not exists summary     text;
alter table public.memories add column if not exists category    text         not null default 'idea';
alter table public.memories add column if not exists tags        text[]       not null default '{}';
alter table public.memories add column if not exists processing  boolean      not null default false;
alter table public.memories add column if not exists user_id     text;
alter table public.memories add column if not exists created_at  timestamptz  not null default now();

-- 2. Row Level Security ---------------------------------------
alter table public.memories enable row level security;

-- 3. Policies — allow anon read & write (tighten with auth later)
drop policy if exists "memories_select_all" on public.memories;
create policy "memories_select_all" on public.memories
  for select using (true);

drop policy if exists "memories_insert_all" on public.memories;
create policy "memories_insert_all" on public.memories
  for insert with check (true);

drop policy if exists "memories_update_all" on public.memories;
create policy "memories_update_all" on public.memories
  for update using (true);

drop policy if exists "memories_delete_all" on public.memories;
create policy "memories_delete_all" on public.memories
  for delete using (true);

-- 4. Seed — the original sanctuary memories (only if empty) ----
insert into public.memories (title, body, summary, category, tags, processing, created_at)
select v.title, v.body, v.summary, v.category, v.tags, false, v.created_at
from (values
  ('Ambient sound as a service',
   'An app that composes adaptive soundscapes from the room''s live acoustics — silence becomes an instrument.',
   'A product concept turning ambient room acoustics into adaptive, generative soundscapes.',
   'idea', array['product','audio']::text[], now() - interval '2 hours'),
  ('On the economy of attention',
   'Reread "The Slight Edge". Compounding is not about intensity, but the quiet weight of small unfelt choices.',
   'Reflection on compounding as the accumulation of small, unfelt choices rather than intensity.',
   'reading', array['reading','philosophy']::text[], now() - interval '5 hours'),
  ('Q3 direction: fewer, deeper',
   'Three pillars only. Ship one thing so well it feels inevitable. Decline everything that dilutes the core.',
   'A quarterly strategy to ship fewer things with greater depth and conviction.',
   'strategy', array['strategy','focus']::text[], now() - interval '1 day'),
  ('A line worth keeping',
   '"Luxury is the absence of friction, felt as ease." — overheard, unattributed. Save for the manifesto.',
   'A captured aphorism defining luxury as frictionless ease.',
   'quote', array['writing']::text[], now() - interval '1 day'),
  ('Memory as architecture',
   'What if recall was spatial — a building you wander, not a list you scroll? Museums, not spreadsheets.',
   'A design premise: treat memory recall as spatial navigation rather than a flat list.',
   'design', array['product','design']::text[], now() - interval '2 days'),
  ('Tea ceremony, translated',
   'The four principles — harmony, respect, purity, tranquility — map cleanly onto a calmer product workflow.',
   'Mapping the four tea-ceremony principles onto a calmer product design workflow.',
   'ritual', array['ritual','design']::text[], now() - interval '3 days')
) as v(title, body, summary, category, tags, created_at)
where not exists (select 1 from public.memories);
