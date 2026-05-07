-- Tabel voor het opslaan van editor-veldwaarden per klant (pre-fill)
create table if not exists client_content (
  slug       text primary key,
  data       jsonb not null,
  updated_at timestamptz default now()
);

alter table client_content enable row level security;

create policy "public read"   on client_content for select using (true);
create policy "anon insert"   on client_content for insert with check (true);
create policy "anon update"   on client_content for update using (true);
