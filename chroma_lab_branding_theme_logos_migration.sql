-- Add separate light/dark web logo fields. The existing web_logo_path /
-- web_logo_url remain as a theme-agnostic fallback.
alter table public.branding_settings
  add column if not exists web_logo_light_path text,
  add column if not exists web_logo_light_url  text,
  add column if not exists web_logo_dark_path  text,
  add column if not exists web_logo_dark_url   text;
