-- Optional evaluation data. Run this file explicitly; production bootstrap does
-- not load it. Every identity and store below is fictional.

begin;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'community-owner@example.test',
  extensions.crypt('community-demo-password', extensions.gen_salt('bf')),
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Community Demo Owner"}'::jsonb,
  statement_timestamp(),
  statement_timestamp(),
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

insert into api.stores (
  id,
  owner_id,
  owner_store_slot,
  public_slug,
  name,
  industry,
  address,
  description,
  google_review_url,
  status
) values (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  1,
  'community-demo-store-0001',
  'Community Demo Cafe',
  'カフェ',
  '東京都サンプル区1-2-3',
  'Community版の評価用に用意した架空店舗です。',
  'https://g.page/r/community-demo-store/review',
  'draft'
)
on conflict (id) do nothing;

commit;
