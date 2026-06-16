-- ============================================================
--  Aether · Phase 2 — Supabase schema
--  Run this once in your Supabase project's SQL Editor:
--  https://supabase.com/dashboard/project/pbjmskzkgfavldjyncfo/sql/new
--  (Paste everything below and click Run. It is safe to re-run.)
-- ============================================================

-- 1. The memories table ---------------------------------------
create table if not exists public.memories (
  id          uuid primary key default gen_random_uuid(),
  title       text        not null,
  body        text        not null,
  category    text        not null default 'idea',
  tags        text[]      not null default '{}',
  created_at  timestamptz not null default now()
);

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
insert into public.memories (title, body, category, tags, created_at)
select v.title, v.body, v.category, v.tags, v.created_at
from (values
  ('Ambient sound as a service',
   'An app that composes adaptive soundscapes from the room''s live acoustics — silence becomes an instrument.',
   'idea', array['product','audio']::text[], now() - interval '2 hours'),
  ('On the economy of attention',
   'Reread "The Slight Edge". Compounding is not about intensity, but the quiet weight of small unfelt choices.',
   'reading', array['reading','philosophy']::text[], now() - interval '5 hours'),
  ('Q3 direction: fewer, deeper',
   'Three pillars only. Ship one thing so well it feels inevitable. Decline everything that dilutes the core.',
   'strategy', array['strategy','focus']::text[], now() - interval '1 day'),
  ('A line worth keeping',
   '"Luxury is the absence of friction, felt as ease." — overheard, unattributed. Save for the manifesto.',
   'quote', array['writing']::text[], now() - interval '1 day'),
  ('Memory as architecture',
   'What if recall was spatial — a building you wander, not a list you scroll? Museums, not spreadsheets.',
   'design', array['product','design']::text[], now() - interval '2 days'),
  ('Tea ceremony, translated',
   'The four principles — harmony, respect, purity, tranquility — map cleanly onto a calmer product workflow.',
   'ritual', array['ritual','design']::text[], now() - interval '3 days')
) as v(title, body, category, tags, created_at)
where not exists (select 1 from public.memories);
