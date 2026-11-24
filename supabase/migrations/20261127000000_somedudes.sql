-- Somedudes: the one trusted local per city who can paste event pages straight onto the pole
-- (/somedude). Rows are added by hand (never from the site); no policies, so only the server
-- (service role) reads them. Emails stay out of the public repo on purpose.
create table if not exists afoot.somedudes (
  email text primary key,
  area text not null default 'Los Angeles',
  note text,
  added_at timestamptz not null default now()
);
alter table afoot.somedudes enable row level security;

-- One row per paste: what was found, what was already on the pole, what got added. Kept so we can
-- see which sites and pages pay off (and tune the importer) after a few runs.
create table if not exists afoot.paste_imports (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  kind text not null,              -- facebook | page
  found int not null default 0,
  added int not null default 0,
  already int not null default 0,
  skipped int not null default 0,
  items jsonb not null default '[]',
  created_at timestamptz not null default now()
);
alter table afoot.paste_imports enable row level security;
