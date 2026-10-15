-- Larp To Prospect: run state + append-only event log
create extension if not exists pgcrypto;

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued',        -- queued|running|done|failed
  doc_text text not null,
  profile jsonb,                                 -- CompanyProfile from deconstruct
  candidates jsonb default '[]'::jsonb,          -- [{id,name,url,why}]
  verdicts jsonb default '{}'::jsonb,            -- skeptic output keyed by candidate id
  deck jsonb,                                    -- typed slides
  inject_failure boolean not null default false, -- demo toggle (UI labels it as injected)
  cost_usd numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references runs(id) on delete cascade,
  seq int not null,
  node_id text not null,
  parent_id text,
  type text not null,   -- node_started|tool_call|node_failed|recovery_started|node_done|claim_added|claim_rejected|skeptic_verdict|deck_ready|cost_tick
  payload jsonb not null default '{}'::jsonb,
  ts timestamptz not null default now(),
  unique (run_id, seq)
);
create index if not exists run_events_run_seq on run_events(run_id, seq);

-- seq allocator so parallel function invocations never collide
create table if not exists run_seq (run_id uuid primary key references runs(id) on delete cascade, n int not null default 0);
create or replace function next_seq(p_run uuid) returns int language plpgsql set search_path = public as $$
declare v int;
begin
  insert into run_seq(run_id,n) values (p_run,1)
    on conflict (run_id) do update set n = run_seq.n + 1 returning n into v;
  return v;
end $$;

create table if not exists claims (
  id bigint generated always as identity primary key,
  run_id uuid not null references runs(id) on delete cascade,
  candidate_id text not null,
  field text not null,          -- pricing|residency|soc2_scope|integration:github|sentiment|...
  value text not null,
  source_url text not null,
  quote text not null,          -- verified literal substring of fetched page
  confidence text not null default 'high',  -- high|low (low = snippet-only)
  created_at timestamptz not null default now()
);
create index if not exists claims_run on claims(run_id, candidate_id);

-- Realtime + RLS: browser (anon) may READ runs/events/claims; only service role writes.
alter table runs enable row level security;
alter table run_events enable row level security;
alter table claims enable row level security;
create policy "anon read runs" on runs for select using (true);
create policy "anon read events" on run_events for select using (true);
create policy "anon read claims" on claims for select using (true);
alter table run_seq enable row level security;
revoke execute on function next_seq(uuid) from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.runs, public.run_events, public.claims to anon, authenticated;
alter publication supabase_realtime add table run_events;
alter publication supabase_realtime add table runs;

-- v2 additions (applied via migration outreach_and_gaps)
create table if not exists outreach (
  id bigint generated always as identity primary key,
  run_id uuid not null references runs(id) on delete cascade,
  candidate_id text not null, gap_field text,
  channel text not null check (channel in ('form','email','call')),
  target text, status text not null default 'planned',
  message text, screenshot_url text, reply_text text, reply_at timestamptz,
  sandbox boolean not null default false, error text, created_at timestamptz not null default now()
);
create index if not exists outreach_run on outreach(run_id);
alter table outreach enable row level security;
create policy "anon read outreach" on outreach for select using (true);
grant select on public.outreach to anon, authenticated;
grant all on public.outreach to service_role;
alter table claims add column if not exists source_type text not null default 'web';
alter table claims add column if not exists channel text not null default 'web';
alter table runs add column if not exists gaps jsonb default '[]'::jsonb;
alter publication supabase_realtime add table outreach;
-- also applied: emit_event(), service_role grants (see migrations)
