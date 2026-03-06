-- ── JSON Studio Pro — Supabase Schema ────────────────────────────────────────
-- Run this in your Supabase project: Dashboard → SQL Editor → New Query

-- SCANS TABLE
-- Stores every screenshot analysis result
create table if not exists scans (
  id            bigint generated always as identity primary key,
  filename      text,
  analysis_type text,
  ai_response   text,
  image_thumb   text,   -- base64 data URL of the screenshot thumbnail
  created_at    timestamptz default now()
);

-- SESSIONS TABLE
-- Stores editor snapshots when user hits Save
create table if not exists sessions (
  id         bigint generated always as identity primary key,
  mode       text,      -- json | html | css | js
  code       text,
  created_at timestamptz default now()
);

-- Enable Row Level Security (good practice even for open tools)
alter table scans    enable row level security;
alter table sessions enable row level security;

-- Allow anonymous read/write (adjust if you add auth later)
create policy "Allow all on scans"    on scans    for all using (true) with check (true);
create policy "Allow all on sessions" on sessions for all using (true) with check (true);
