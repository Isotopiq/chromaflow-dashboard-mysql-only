-- Add optional direct-URL fields to branding_settings so admins can
-- point favicon/web logo/PDF logo at an external URL instead of (or in
-- addition to) uploading a file to the branding bucket. When both a URL
-- and an upload path are set, the URL wins.
alter table public.branding_settings
  add column if not exists favicon_url   text,
  add column if not exists web_logo_url  text,
  add column if not exists pdf_logo_url  text;
