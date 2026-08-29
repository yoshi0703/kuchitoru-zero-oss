begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, api, private;
select no_plan();

select has_schema('api', 'Data API schema exists');
select has_schema('private', 'server-only schema exists');

select has_table('api', 'stores', 'stores are part of Community core');
select has_table('api', 'interview_sessions', 'interview sessions are part of Community core');
select has_table('api', 'interview_messages', 'interview messages are part of Community core');
select has_table('private', 'store_ai_provider_connections', 'owner provider credentials are stored server-side');
select has_table('private', 'meo_provider_connections', 'MEO provider credentials are stored server-side');
select has_table('private', 'zero_feature_rollouts', 'feature availability is stored server-side');
select has_table('private', 'store_runtime_limits', 'operational limits are stored without plan state');
select hasnt_table('private', 'ai_' || 'usage_events', 'Community does not persist installer-wide AI usage');
select hasnt_table('private', 'interview_monthly_' || 'usage', 'Community has no monthly interview quota ledger');
select hasnt_table('private', 'meo_instagram_' || 'settings', 'Community has no automatic posting settings');
select hasnt_column('private', 'service_usage', 'cost', 'provider cost is not persisted');
select hasnt_column('private', 'integration_jobs', 'provider_' || 'cost', 'rank job cost is not persisted');
select hasnt_column('api', 'interview_sessions', 'ai_' || 'quota_state', 'interview sessions have no installer quota state');
select hasnt_column('private', 'store_runtime_limits', 'plan_' || 'code', 'runtime limits are not a billing plan');

select is(
  (select count(*)::integer from private.zero_feature_rollouts),
  5,
  'all five Community capabilities are seeded'
);
select is(
  (
    select count(*)::integer
    from private.zero_feature_rollouts
    where configured_state = 'available' and not kill_switch
  ),
  5,
  'all Community capabilities are available by default'
);
select is(
  (
    select count(*)::integer
    from private.zero_feature_rollouts
    where execution_mode = 'owner_provider'
  ),
  2,
  'AI review replies and rank measurement use owner providers'
);
select is(
  (
    select count(*)::integer
    from private.zero_feature_rollouts
    where execution_mode = 'native'
  ),
  3,
  'non-AI Community capabilities run natively'
);

select ok(
  to_regprocedure('private.owner_exists(uuid)') is not null,
  'owner existence is the account gate'
);
select ok(
  to_regprocedure('api.internal_get_public_store(text)') is not null,
  'public store lookup is available'
);
select ok(
  to_regprocedure('api.internal_start_interview_session(uuid,uuid,text,text,text,text,text,timestamptz)') is not null,
  'public interview session creation is available'
);
select ok(
  to_regprocedure('api.internal_meo_reserve_ai_draft(uuid,uuid,text,text,integer,integer,text)') is not null,
  'owner-provider review draft reservation is available'
);
select ok(
  to_regprocedure('api.internal_meo_settle_ai_draft(uuid,text,text,text,text,text,jsonb)') is not null,
  'owner-provider draft settlement has no platform token metering parameters'
);
select ok(
  to_regprocedure('api.internal_meo_get_external_write_settings(uuid,uuid)') is not null
    and to_regprocedure('api.internal_meo_set_external_writes(uuid,uuid,boolean)') is not null,
  'external writes have an explicit owner-managed store gate'
);
select ok(
  to_regprocedure('api.internal_meo_claim_external_action(uuid,uuid,text,text,text)') is not null,
  'each confirmed external action is claimed and audited server-side'
);

select is(
  (
    select count(*)::integer
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('api', 'private')
      and relation.relkind = 'r'
      and relation.relrowsecurity
  ),
  (
    select count(*)::integer
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('api', 'private')
      and relation.relkind = 'r'
  ),
  'every Community table has row-level security enabled'
);
select ok(
  not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated clients cannot use the private schema'
);
select ok(
  not has_schema_privilege('anon', 'api', 'USAGE'),
  'anonymous clients cannot call the Data API directly'
);
select ok(
  has_schema_privilege('service_role', 'private', 'USAGE'),
  'Edge Functions can use the private schema'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  role_user.id,
  'authenticated',
  'authenticated',
  role_user.email,
  '',
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(),
  statement_timestamp(),
  '', '', '', ''
from (values
  ('10000000-0000-4000-8000-000000000001'::uuid, 'owner-role-test@example.test'),
  ('10000000-0000-4000-8000-000000000002'::uuid, 'admin-role-test@example.test'),
  ('10000000-0000-4000-8000-000000000003'::uuid, 'editor-role-test@example.test'),
  ('10000000-0000-4000-8000-000000000004'::uuid, 'analyst-role-test@example.test')
) role_user(id, email);

insert into api.stores (
  id, owner_id, owner_store_slot, public_slug, name, status
) values (
  '10000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000001',
  1,
  'external-write-role-test',
  'External Write Role Test',
  'draft'
);

insert into private.zero_meo_store_members (
  organization_id, store_id, user_id, role, created_by, updated_by
)
select
  workspace.organization_id,
  workspace.store_id,
  role_member.user_id,
  role_member.role,
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid
from private.zero_meo_store_workspaces workspace
cross join (values
  ('10000000-0000-4000-8000-000000000002'::uuid, 'admin'::text),
  ('10000000-0000-4000-8000-000000000003'::uuid, 'editor'::text),
  ('10000000-0000-4000-8000-000000000004'::uuid, 'analyst'::text)
) role_member(user_id, role)
where workspace.store_id = '10000000-0000-4000-8000-000000000010';

select lives_ok(
  $$select api.internal_meo_set_external_writes(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000010', true
  )$$,
  'owner can enable external writes'
);
select lives_ok(
  $$select api.internal_meo_set_external_writes(
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000010', true
  )$$,
  'admin can manage external writes'
);
select throws_ok(
  $$select api.internal_meo_set_external_writes(
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000010', true
  )$$,
  'P0001', 'EXTERNAL_WRITE_ADMIN_REQUIRED',
  'editor cannot change the administrator setting'
);
select throws_ok(
  $$select api.internal_meo_set_external_writes(
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000010', true
  )$$,
  'P0001', 'EXTERNAL_WRITE_ADMIN_REQUIRED',
  'analyst cannot change the administrator setting'
);

select is(
  (api.internal_meo_get_external_write_settings(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000010'
  ) ->> 'can_execute')::boolean,
  true,
  'owner can execute a confirmed external write'
);
select is(
  (api.internal_meo_get_external_write_settings(
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000010'
  ) ->> 'can_execute')::boolean,
  true,
  'admin can execute a confirmed external write'
);
select is(
  (api.internal_meo_get_external_write_settings(
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000010'
  ) ->> 'can_execute')::boolean,
  true,
  'editor is the store operator role for confirmed external writes'
);
select is(
  (api.internal_meo_get_external_write_settings(
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000010'
  ) ->> 'can_execute')::boolean,
  false,
  'analyst remains read-only'
);

select lives_ok(
  $$select api.internal_meo_claim_external_action(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000010',
    'review_reply', repeat('1', 64), repeat('2', 64)
  )$$,
  'owner can claim a confirmed external action'
);
select lives_ok(
  $$select api.internal_meo_claim_external_action(
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000010',
    'review_reply', repeat('3', 64), repeat('4', 64)
  )$$,
  'admin can claim a confirmed external action'
);
select lives_ok(
  $$select api.internal_meo_claim_external_action(
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000010',
    'review_reply', repeat('5', 64), repeat('6', 64)
  )$$,
  'editor can claim a confirmed external action'
);
select throws_ok(
  $$select api.internal_meo_claim_external_action(
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000010',
    'review_reply', repeat('7', 64), repeat('8', 64)
  )$$,
  'P0001', 'EXTERNAL_WRITE_ROLE_REQUIRED',
  'analyst cannot claim an external action'
);

insert into private.meo_provider_connections (
  store_id, provider, credential_ciphertext, credential_iv, key_version,
  status, expires_at, location_name
) values (
  '10000000-0000-4000-8000-000000000010',
  'google_business', repeat('c', 24), repeat('i', 16), 1,
  'active', statement_timestamp() + interval '1 day',
  'accounts/test-account/locations/test-location'
);

select isnt(
  api.internal_meo_get_connection(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000010', 'google_business'
  ),
  null::jsonb,
  'owner can use the saved provider connection'
);
select isnt(
  api.internal_meo_get_connection(
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000010', 'google_business'
  ),
  null::jsonb,
  'admin can use the saved provider connection'
);
select isnt(
  api.internal_meo_get_connection(
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000010', 'google_business'
  ),
  null::jsonb,
  'editor can use the saved provider connection'
);
select throws_ok(
  $$select api.internal_meo_get_connection(
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000010', 'google_business'
  )$$,
  'P0001', 'STORE_OPERATOR_REQUIRED',
  'analyst cannot use the saved provider connection'
);

select lives_ok(
  $$select api.internal_meo_reserve_provider_call(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000010',
    repeat('a', 64), repeat('b', 64),
    'google_business_api', 'google_review_reply_write', 'native',
    60, 100, 100, 100, 100
  )$$,
  'owner can reserve the provider write'
);
select lives_ok(
  $$select api.internal_meo_reserve_provider_call(
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000010',
    repeat('b', 64), repeat('c', 64),
    'google_business_api', 'google_review_reply_write', 'native',
    60, 100, 100, 100, 100
  )$$,
  'admin can reserve the provider write'
);
select lives_ok(
  $$select api.internal_meo_reserve_provider_call(
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000010',
    repeat('c', 64), repeat('d', 64),
    'google_business_api', 'google_review_reply_write', 'native',
    60, 100, 100, 100, 100
  )$$,
  'editor can reserve the provider write'
);
select throws_ok(
  $$select api.internal_meo_reserve_provider_call(
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000010',
    repeat('d', 64), repeat('e', 64),
    'google_business_api', 'google_review_reply_write', 'native',
    60, 100, 100, 100, 100
  )$$,
  'P0001', 'STORE_OPERATOR_REQUIRED',
  'analyst cannot reserve the provider write'
);

select * from finish();
rollback;
