-- Kuchitoru ZERO Community v1 database baseline.
-- This schema contains the Community data model, BYOK credential storage,
-- operational safeguards, and explicitly confirmed external actions.

-- Dumped from database version 17.10 (Homebrew)
-- Dumped by pg_dump version 17.10 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: api; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA api;


--
-- Name: SCHEMA api; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA api IS 'Only schema exposed through the Kuchitoru Data API. Mutations are server-controlled.';


--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA private;


--
-- Name: SCHEMA private; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA private IS 'Non-exposed storage for credentials, session secrets, usage, rate limits, and idempotency.';


--
-- Name: internal_bind_interview_survey_revision(uuid, text, integer); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_bind_interview_survey_revision(p_session_id uuid, p_token_hash text, p_survey_revision integer) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_session api.interview_sessions%rowtype;
  v_config jsonb;
begin
  if p_survey_revision is null or p_survey_revision < 1 then
    raise exception using errcode = '22023', message = 'SURVEY_REVISION_NOT_FOUND';
  end if;

  v_session := private.require_interview_session(p_session_id, p_token_hash);
  select revision.config_json into v_config
  from private.store_survey_revisions revision
  where revision.store_id = v_session.store_id
    and revision.revision = p_survey_revision;
  if not found then
    raise exception using errcode = '22023', message = 'SURVEY_REVISION_NOT_FOUND';
  end if;

  update api.interview_sessions
  set survey_revision = p_survey_revision
  where id = p_session_id
    and (survey_revision is null or survey_revision = p_survey_revision);
  if not found then
    raise exception using errcode = '22023', message = 'SURVEY_REVISION_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'survey_revision', p_survey_revision,
    'survey_config_json', v_config
  );
end;
$$;


--
-- Name: internal_bind_interview_survey_snapshot(uuid, text, integer, jsonb, jsonb); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_bind_interview_survey_snapshot(p_session_id uuid, p_token_hash text, p_source_revision integer, p_selection_json jsonb, p_resolved_config_json jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_session api.interview_sessions%rowtype;
  v_source_config jsonb;
  v_expected_config jsonb;
  v_snapshot private.interview_survey_snapshots%rowtype;
begin
  v_session := private.require_interview_session(p_session_id, p_token_hash);
  perform 1
  from api.interview_sessions session
  where session.id = p_session_id
  for update;

  select snapshot.* into v_snapshot
  from private.interview_survey_snapshots snapshot
  where snapshot.session_id = p_session_id;
  if found then
    if v_session.store_id <> v_snapshot.store_id
      or (
        v_session.survey_revision is not null
        and v_session.survey_revision <> v_snapshot.source_revision
      )
    then
      raise exception using errcode = '22023', message = 'SURVEY_REVISION_NOT_FOUND';
    end if;
    update api.interview_sessions
    set survey_revision = v_snapshot.source_revision
    where id = p_session_id and survey_revision is null;
    return jsonb_build_object(
      'store_id', v_snapshot.store_id,
      'survey_revision', v_snapshot.source_revision,
      'selection_json', v_snapshot.selection_json,
      'survey_config_json', v_snapshot.resolved_config_json
    );
  end if;

  if p_source_revision is null or p_source_revision < 1 then
    raise exception using errcode = '22023', message = 'SURVEY_REVISION_NOT_FOUND';
  end if;

  select revision.config_json into v_source_config
  from private.store_survey_revisions revision
  where revision.store_id = v_session.store_id
    and revision.revision = p_source_revision;
  if not found then
    raise exception using errcode = '22023', message = 'SURVEY_REVISION_NOT_FOUND';
  end if;

  v_expected_config := private.expected_resolved_survey_config(
    v_source_config,
    p_selection_json
  );
  if v_expected_config is null
    or v_expected_config is distinct from p_resolved_config_json
  then
    raise exception using errcode = '22023', message = 'INVALID_SURVEY_SNAPSHOT';
  end if;

  if v_session.survey_revision is not null
    and v_session.survey_revision <> p_source_revision
  then
    raise exception using errcode = '22023', message = 'SURVEY_REVISION_NOT_FOUND';
  end if;

  insert into private.interview_survey_snapshots (
    session_id,
    store_id,
    source_revision,
    selection_json,
    resolved_config_json
  ) values (
    p_session_id,
    v_session.store_id,
    p_source_revision,
    p_selection_json,
    p_resolved_config_json
  )
  on conflict (session_id) do nothing;

  update api.interview_sessions
  set survey_revision = p_source_revision
  where id = p_session_id
    and (survey_revision is null or survey_revision = p_source_revision);
  if not found then
    raise exception using errcode = '22023', message = 'SURVEY_REVISION_NOT_FOUND';
  end if;

  select snapshot.* into strict v_snapshot
  from private.interview_survey_snapshots snapshot
  where snapshot.session_id = p_session_id;
  return jsonb_build_object(
    'store_id', v_snapshot.store_id,
    'survey_revision', v_snapshot.source_revision,
    'selection_json', v_snapshot.selection_json,
    'survey_config_json', v_snapshot.resolved_config_json
  );
end;
$$;


--
-- Name: internal_claim_interview_turn(uuid, text, text, text, text, text, text, jsonb, jsonb, integer, text, jsonb, integer); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_claim_interview_turn(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_kind text, p_answer text DEFAULT NULL::text, p_profile_json jsonb DEFAULT '{}'::jsonb, p_structured_answers_json jsonb DEFAULT '{}'::jsonb, p_rating integer DEFAULT NULL::integer, p_visit_frequency text DEFAULT NULL::text, p_answer_chunks jsonb DEFAULT NULL::jsonb, p_survey_revision integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_session api.interview_sessions%rowtype;
  v_limits private.store_runtime_limits%rowtype;
  v_claim jsonb;
  v_operation_id uuid;
  v_sequence integer;
  v_message_id uuid;
  v_inserted_message_id uuid;
  v_chunk text;
  v_chunk_index integer;
  v_chunk_key_hash text;
  v_is_v3 boolean;
begin
  v_is_v3 := p_structured_answers_json ? 'schemaVersion';
  if p_kind <> 'survey'
    or p_session_subject_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_profile_json) <> 'object'
    or jsonb_typeof(p_structured_answers_json) <> 'object'
    or octet_length(p_profile_json::text) > 8192
    or octet_length(p_structured_answers_json::text) > 16384
    or (p_rating is not null and p_rating not between 1 and 5)
    or (
      p_visit_frequency is not null
      and p_visit_frequency not in ('first', 'occasional', 'regular', 'unknown')
    )
    or (p_survey_revision is not null and p_survey_revision < 1)
    or (
      p_answer_chunks is null
      and (
        p_answer is null
        or char_length(btrim(p_answer)) not between 1 and 1000
      )
    )
    or (
      p_answer_chunks is not null
      and (
        jsonb_typeof(p_answer_chunks) <> 'array'
        or jsonb_array_length(p_answer_chunks) not between 1 and 12
        or exists (
          select 1
          from jsonb_array_elements(p_answer_chunks) chunk
          where jsonb_typeof(chunk) <> 'string'
            or char_length(btrim(chunk #>> '{}')) not between 1 and 1000
        )
      )
    )
    or (
      v_is_v3
      and private.is_valid_structured_survey_answers_v3(
        p_structured_answers_json
      ) is not true
    )
    or (
      not v_is_v3
      and (
        not (p_structured_answers_json ?& array['serviceUsed', 'memorablePoints'])
        or p_structured_answers_json - array[
          'serviceUsed', 'memorablePoints', 'improvementPoints'
        ] <> '{}'::jsonb
        or jsonb_typeof(p_structured_answers_json -> 'serviceUsed') <> 'string'
        or char_length(btrim(p_structured_answers_json ->> 'serviceUsed')) not between 1 and 120
        or jsonb_typeof(p_structured_answers_json -> 'memorablePoints') <> 'string'
        or char_length(btrim(p_structured_answers_json ->> 'memorablePoints')) not between 1 and 300
        or (
          p_structured_answers_json ? 'improvementPoints'
          and (
            jsonb_typeof(p_structured_answers_json -> 'improvementPoints') <> 'string'
            or char_length(btrim(p_structured_answers_json ->> 'improvementPoints')) not between 1 and 300
          )
        )
      )
    )
  then
    raise exception using errcode = '22023', message = 'INVALID_TURN_INPUT';
  end if;

  v_session := private.require_interview_session(p_session_id, p_token_hash);
  select * into strict v_session
  from api.interview_sessions where id = p_session_id for update;
  v_claim := private.claim_idempotency(
    'turn', p_session_id, p_idempotency_key_hash, p_request_hash, 90
  );
  v_operation_id := (v_claim ->> 'operation_id')::uuid;

  if (v_claim ->> 'replayed')::boolean then
    return v_claim || jsonb_build_object(
      'kind', 'survey',
      'session_id', p_session_id,
      'store_id', v_session.store_id,
      'requires_ai', false,
      'ai_turn_count', v_session.ai_turn_count,
      'interview_complete', v_session.interview_complete
    );
  end if;

  if (v_claim ->> 'resumed')::boolean and v_claim ->> 'request_ref' is not null then
    update private.request_idempotency
    set status = 'completed', result_ref = request_ref, lease_expires_at = null
    where id = v_operation_id;
    return v_claim || jsonb_build_object(
      'kind', 'survey',
      'session_id', p_session_id,
      'store_id', v_session.store_id,
      'requires_ai', false,
      'ai_turn_count', v_session.ai_turn_count,
      'interview_complete', true
    );
  end if;

  if v_session.status <> 'active' or v_session.interview_complete then
    raise exception using errcode = 'P0001', message = 'INVALID_SESSION_STATE';
  end if;

  select * into strict v_limits
  from private.store_runtime_limits where store_id = v_session.store_id;
  perform private.consume_rate_limit(
    'session', v_session.store_id, p_session_subject_hash,
    v_limits.session_mutation_window_seconds,
    v_limits.session_mutation_window_limit
  );

  select coalesce(max(sequence), 0) + 1 into v_sequence
  from api.interview_messages where session_id = p_session_id;

  if p_answer_chunks is null then
    insert into api.interview_messages (
      session_id, store_id, sequence, role, content,
      message_type, idempotency_key_hash
    ) values (
      p_session_id, v_session.store_id, v_sequence, 'user', btrim(p_answer),
      'answer', p_idempotency_key_hash
    ) returning id into v_message_id;
  else
    for v_chunk, v_chunk_index in
      select chunk #>> '{}', ordinality::integer - 1
      from jsonb_array_elements(p_answer_chunks) with ordinality as chunks(chunk, ordinality)
      order by ordinality
    loop
      v_chunk_key_hash := case when v_chunk_index = 0
        then p_idempotency_key_hash
        else encode(
          sha256((p_idempotency_key_hash || ':' || v_chunk_index)::bytea),
          'hex'
        )
      end;
      insert into api.interview_messages (
        session_id, store_id, sequence, role, content,
        message_type, idempotency_key_hash
      ) values (
        p_session_id, v_session.store_id, v_sequence + v_chunk_index,
        'user', btrim(v_chunk), 'answer', v_chunk_key_hash
      ) returning id into v_inserted_message_id;
      if v_chunk_index = 0 then
        v_message_id := v_inserted_message_id;
      end if;
    end loop;
  end if;

  update api.interview_sessions
  set profile_json = profile_json || p_profile_json,
      structured_answers_json = structured_answers_json || p_structured_answers_json,
      rating = p_rating,
      visit_frequency = nullif(btrim(p_visit_frequency), ''),
      survey_revision = case when p_survey_revision is null
        then survey_revision else p_survey_revision end,
      interview_complete = true,
      last_activity_at = statement_timestamp()
  where id = p_session_id;
  update private.request_idempotency
  set status = 'completed', request_ref = v_message_id,
      result_ref = v_message_id, lease_expires_at = null
  where id = v_operation_id;

  return jsonb_build_object(
    'operation_id', v_operation_id,
    'replayed', false,
    'resumed', false,
    'kind', 'survey',
    'session_id', p_session_id,
    'store_id', v_session.store_id,
    'requires_ai', false,
    'user_message_id', v_message_id,
    'ai_turn_count', v_session.ai_turn_count,
    'interview_complete', true
  );
end;
$_$;


--
-- Name: internal_claim_owner_operation(uuid, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_claim_owner_operation(p_owner_id uuid, p_scope text, p_idempotency_key_hash text, p_request_hash text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if p_owner_id is null or p_scope not in (
    'owner_store', 'owner_store_create', 'owner_publish', 'owner_pause',

    'owner_connection_save', 'owner_connection_revalidate',
    'owner_connection_select', 'owner_connection_model_select',
    'owner_connection_delete', 'owner_account_delete'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_OWNER_OPERATION';
  end if;
  return private.claim_idempotency(
    case
      -- private.claim_idempotency keeps the original rolling-deployment
      -- scope allowlist. Reuse the account-owned owner_store bucket while the
      when p_scope = 'owner_store_create'
        then 'owner_store'
      when p_scope = 'owner_connection_model_select' then 'owner_connection_select'
      else p_scope
    end,
    p_owner_id,
    p_idempotency_key_hash,
    p_request_hash,
    120
  );
end;
$$;


--
-- Name: internal_claim_review_generation(uuid, text, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_claim_review_generation(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_session api.interview_sessions%rowtype;
  v_limits private.store_runtime_limits%rowtype;
  v_claim jsonb;
begin
  v_session := private.require_interview_session(p_session_id, p_token_hash);
  select * into strict v_session
  from api.interview_sessions where id = p_session_id for update;
  select * into strict v_limits
  from private.store_runtime_limits where store_id = v_session.store_id;

  perform private.recover_expired_generation_operation(
    'review', p_session_id, p_idempotency_key_hash, p_request_hash
  );
  select * into strict v_session
  from api.interview_sessions where id = p_session_id;

  v_claim := private.claim_idempotency(
    'review', p_session_id, p_idempotency_key_hash, p_request_hash, 120
  );
  if (v_claim ->> 'replayed')::boolean then
    return v_claim || jsonb_build_object(
      'session_id', p_session_id,
      'store_id', v_session.store_id,
      'review_text', v_session.edited_review,
      'rewrite_count', v_session.rewrite_count,
      'rewrite_limit', v_limits.rewrite_limit,
      'remaining_rewrites', greatest(
        v_limits.rewrite_limit - v_session.rewrite_count, 0
      ),
      'generation_source', v_session.generation_source
    );
  end if;

  if not (v_claim ->> 'resumed')::boolean and (
    v_session.status <> 'active'
    or not v_session.interview_complete
    or v_session.generation_status = 'generating'
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_REVIEW_STATE';
  end if;

  perform private.consume_rate_limit(
    'session', v_session.store_id, p_session_subject_hash,
    v_limits.session_mutation_window_seconds,
    v_limits.session_mutation_window_limit
  );

  update api.interview_sessions
  set status = 'generating', generation_status = 'generating',
      last_activity_at = statement_timestamp()
  where id = p_session_id;

  return v_claim || jsonb_build_object(
    'session_id', p_session_id,
    'store_id', v_session.store_id,
    'rewrite_limit', v_limits.rewrite_limit,
    'remaining_rewrites', greatest(
      v_limits.rewrite_limit - v_session.rewrite_count, 0
    )
  );
end;
$$;


--
-- Name: internal_claim_review_rewrite(uuid, text, text, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_claim_review_rewrite(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_current_review text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_session api.interview_sessions%rowtype;
  v_limits private.store_runtime_limits%rowtype;
  v_claim jsonb;
begin
  if p_current_review is null
    or char_length(btrim(p_current_review)) not between 1 and 800
  then
    raise exception using errcode = '22023', message = 'INVALID_REVIEW_TEXT';
  end if;

  v_session := private.require_interview_session(p_session_id, p_token_hash);
  select * into strict v_session
  from api.interview_sessions where id = p_session_id for update;
  select * into strict v_limits
  from private.store_runtime_limits where store_id = v_session.store_id;

  perform private.recover_expired_generation_operation(
    'rewrite', p_session_id, p_idempotency_key_hash, p_request_hash
  );
  select * into strict v_session
  from api.interview_sessions where id = p_session_id;
  v_claim := private.claim_idempotency(
    'rewrite', p_session_id, p_idempotency_key_hash, p_request_hash, 120
  );

  if (v_claim ->> 'replayed')::boolean then
    return v_claim || jsonb_build_object(
      'session_id', p_session_id,
      'store_id', v_session.store_id,
      'review_text', v_session.edited_review,
      'rewrite_count', v_session.rewrite_count,
      'rewrite_limit', v_limits.rewrite_limit,
      'remaining_rewrites', greatest(
        v_limits.rewrite_limit - v_session.rewrite_count, 0
      ),
      'generation_source', v_session.generation_source
    );
  end if;

  if not (v_claim ->> 'resumed')::boolean
    and v_session.rewrite_count >= v_limits.rewrite_limit
  then
    raise exception using errcode = 'P0001', message = 'REWRITE_LIMIT_REACHED';
  end if;
  if not (v_claim ->> 'resumed')::boolean and (
    v_session.status <> 'completed'
    or v_session.generation_status <> 'succeeded'
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_REWRITE_STATE';
  end if;

  perform private.consume_rate_limit(
    'session', v_session.store_id, p_session_subject_hash,
    v_limits.session_mutation_window_seconds,
    v_limits.session_mutation_window_limit
  );

  update api.interview_sessions
  set status = 'generating',
      edited_review = btrim(p_current_review),
      rewrite_count = rewrite_count + 1,
      last_activity_at = statement_timestamp()
  where id = p_session_id;

  return v_claim || jsonb_build_object(
    'session_id', p_session_id,
    'store_id', v_session.store_id,
    'current_review', btrim(p_current_review),
    'rewrite_count', v_session.rewrite_count + 1,
    'rewrite_limit', v_limits.rewrite_limit,
    'remaining_rewrites', greatest(
      v_limits.rewrite_limit - (v_session.rewrite_count + 1), 0
    )
  );
end;
$$;


--
-- Name: internal_claim_store_operation(uuid, uuid, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_claim_store_operation(p_actor_id uuid, p_store_id uuid, p_scope text, p_idempotency_key_hash text, p_request_hash text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_idempotency_scope text;
begin
  if p_scope not in (
    'owner_store_update', 'owner_publish', 'owner_pause',
    'owner_survey_update',
    'owner_connection_save', 'owner_connection_revalidate',
    'owner_connection_select', 'owner_connection_model',
    'owner_connection_delete'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_OWNER_OPERATION';
  end if;
  perform private.require_store_owner(p_actor_id, p_store_id);
  v_idempotency_scope := case
    when p_scope in (
      'owner_store_update', 'owner_survey_update'
    ) then 'owner_store'
    when p_scope = 'owner_connection_model' then 'owner_connection_select'
    else p_scope
  end;
  return private.claim_idempotency(
    v_idempotency_scope,
    p_store_id,
    p_idempotency_key_hash,
    p_request_hash,
    120
  );
end;
$$;


--
-- Name: internal_complete_interview_turn(uuid, text, text, text, text, boolean); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_complete_interview_turn(p_operation_id uuid, p_assistant_text text, p_provider text, p_model text, p_request_id text, p_is_complete boolean) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_operation private.request_idempotency%rowtype;
  v_session api.interview_sessions%rowtype;
  v_sequence integer;
  v_message_id uuid;
begin
  if p_assistant_text is null
    or char_length(btrim(p_assistant_text)) not between 1 and 4000
    or p_provider not in ('openai', 'gemini', 'deepseek', 'xai', 'anthropic')
    or p_model is null
    or char_length(p_model) > 200
    or p_request_id is null
    or char_length(p_request_id) > 200
  then
    raise exception using errcode = '22023', message = 'INVALID_TURN_RESULT';
  end if;

  select * into v_operation
  from private.request_idempotency
  where id = p_operation_id
    and scope = 'turn'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'OPERATION_NOT_FOUND';
  end if;

  if v_operation.status = 'completed' then
    return api.internal_get_operation_result(p_operation_id);
  end if;

  if v_operation.status <> 'processing' then
    raise exception using errcode = 'P0001', message = 'INVALID_OPERATION_STATE';
  end if;

  select * into v_session
  from api.interview_sessions
  where id = v_operation.subject_id
  for update;

  select coalesce(max(sequence), 0) + 1
  into v_sequence
  from api.interview_messages
  where session_id = v_session.id;

  insert into api.interview_messages (
    session_id,
    store_id,
    sequence,
    role,
    content,
    message_type,
    idempotency_key_hash
  ) values (
    v_session.id,
    v_session.store_id,
    v_sequence,
    'assistant',
    btrim(p_assistant_text),
    'question',
    md5(p_operation_id::text) || md5(p_operation_id::text || ':assistant')
  )
  returning id into v_message_id;

  update api.interview_sessions
  set interview_complete = p_is_complete or ai_turn_count >= 8,
      generation_provider = p_provider,
      generation_model = p_model,
      generation_request_id = p_request_id,
      last_activity_at = statement_timestamp()
  where id = v_session.id;

  update private.request_idempotency
  set status = 'completed',
      result_ref = v_message_id,
      lease_expires_at = null
  where id = p_operation_id;

  return jsonb_build_object(
    'operation_id', p_operation_id,
    'session_id', v_session.id,
    'assistant_message_id', v_message_id,
    'assistant_sequence', v_sequence,
    'assistant_text', btrim(p_assistant_text),
    'ai_turn_count', v_session.ai_turn_count,
    'interview_complete', p_is_complete or v_session.ai_turn_count >= 8,
    'replayed', false
  );
end;
$$;


--
-- Name: internal_complete_owner_operation(uuid, jsonb); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_complete_owner_operation(p_operation_id uuid, p_result_json jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_operation private.request_idempotency%rowtype;
begin
  if p_result_json is null
    or jsonb_typeof(p_result_json) not in ('object', 'array', 'null')
    or octet_length(p_result_json::text) > 32768
  then
    raise exception using errcode = '22023', message = 'INVALID_OWNER_OPERATION_RESULT';
  end if;

  select * into v_operation
  from private.request_idempotency
  where id = p_operation_id
    and scope like 'owner_%'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'OPERATION_NOT_FOUND';
  end if;

  if v_operation.status = 'completed' then
    return jsonb_build_object(
      'operation_id', v_operation.id,
      'replayed', true,
      'result_json', v_operation.result_json
    );
  end if;

  if v_operation.status <> 'processing' then
    raise exception using errcode = 'P0001', message = 'INVALID_OPERATION_STATE';
  end if;

  update private.request_idempotency
  set status = 'completed',
      result_json = p_result_json,
      lease_expires_at = null
  where id = p_operation_id;

  return jsonb_build_object(
    'operation_id', p_operation_id,
    'replayed', false,
    'result_json', p_result_json
  );
end;
$$;


--
-- Name: internal_complete_review_generation(uuid, text, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_complete_review_generation(p_operation_id uuid, p_review_text text, p_provider text, p_model text, p_request_id text) RETURNS jsonb
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select api.internal_complete_review_result(
    p_operation_id, p_review_text, 'ai', p_provider, p_model, p_request_id
  );
$$;


--
-- Name: internal_complete_review_result(uuid, text, text, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_complete_review_result(p_operation_id uuid, p_review_text text, p_generation_source text, p_provider text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_operation private.request_idempotency%rowtype;
  v_session api.interview_sessions%rowtype;
  v_limits private.store_runtime_limits%rowtype;
begin
  if p_review_text is null or char_length(btrim(p_review_text)) not between 1 and 800
    or p_generation_source <> 'ai'
    or p_provider not in ('openai', 'gemini', 'deepseek', 'xai', 'anthropic')
    or p_model is null or char_length(p_model) not between 1 and 200
    or p_request_id is null or char_length(p_request_id) not between 1 and 200
  then
    raise exception using errcode = '22023', message = 'INVALID_REVIEW_RESULT';
  end if;

  select * into v_operation
  from private.request_idempotency
  where id = p_operation_id and scope = 'review';
  if not found then
    raise exception using errcode = 'P0001', message = 'OPERATION_NOT_FOUND';
  end if;
  select * into strict v_session
  from api.interview_sessions where id = v_operation.subject_id for update;
  select * into v_operation
  from private.request_idempotency
  where id = p_operation_id and scope = 'review' and subject_id = v_session.id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OPERATION_NOT_FOUND';
  end if;
  select * into strict v_limits
  from private.store_runtime_limits where store_id = v_session.store_id;

  if v_operation.status = 'completed' then
    return jsonb_build_object(
      'operation_id', p_operation_id,
      'session_id', v_session.id,
      'review_text', v_session.edited_review,
      'rewrite_count', v_session.rewrite_count,
      'rewrite_limit', v_limits.rewrite_limit,
      'remaining_rewrites', greatest(v_limits.rewrite_limit - v_session.rewrite_count, 0),
      'generation_source', v_session.generation_source,
      'replayed', true
    );
  end if;
  if v_operation.status <> 'processing' then
    raise exception using errcode = 'P0001', message = 'INVALID_OPERATION_STATE';
  end if;
  if v_operation.lease_expires_at is null
    or v_operation.lease_expires_at <= statement_timestamp()
  then
    raise exception using errcode = 'P0001', message = 'OPERATION_LEASE_EXPIRED';
  end if;

  update api.interview_sessions
  set generated_review = btrim(p_review_text),
      edited_review = btrim(p_review_text),
      generation_status = 'succeeded',
      generation_source = 'ai',
      status = 'completed',
      generation_provider = p_provider,
      generation_model = p_model,
      generation_request_id = p_request_id,
      generated_review_at = statement_timestamp(),
      completed_at = coalesce(completed_at, statement_timestamp()),
      last_activity_at = statement_timestamp()
  where id = v_session.id
  returning * into v_session;
  update private.request_idempotency
  set status = 'completed', result_ref = v_session.id, lease_expires_at = null
  where id = p_operation_id;

  return jsonb_build_object(
    'operation_id', p_operation_id,
    'session_id', v_session.id,
    'review_text', v_session.edited_review,
    'rewrite_count', v_session.rewrite_count,
    'rewrite_limit', v_limits.rewrite_limit,
    'remaining_rewrites', greatest(v_limits.rewrite_limit - v_session.rewrite_count, 0),
    'generation_source', 'ai',
    'replayed', false
  );
end;
$$;


--
-- Name: internal_complete_review_rewrite(uuid, text, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_complete_review_rewrite(p_operation_id uuid, p_review_text text, p_provider text, p_model text, p_request_id text) RETURNS jsonb
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select api.internal_complete_review_rewrite_result(
    p_operation_id, p_review_text, 'ai', p_provider, p_model, p_request_id
  );
$$;


--
-- Name: internal_complete_review_rewrite_result(uuid, text, text, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_complete_review_rewrite_result(p_operation_id uuid, p_review_text text, p_generation_source text, p_provider text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_request_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_operation private.request_idempotency%rowtype;
  v_session api.interview_sessions%rowtype;
  v_limits private.store_runtime_limits%rowtype;
begin
  if p_review_text is null or char_length(btrim(p_review_text)) not between 1 and 800
    or p_generation_source <> 'ai'
    or p_provider not in ('openai', 'gemini', 'deepseek', 'xai', 'anthropic')
    or p_model is null or char_length(p_model) not between 1 and 200
    or p_request_id is null or char_length(p_request_id) not between 1 and 200
  then
    raise exception using errcode = '22023', message = 'INVALID_REWRITE_RESULT';
  end if;

  select * into v_operation
  from private.request_idempotency
  where id = p_operation_id and scope = 'rewrite';
  if not found then
    raise exception using errcode = 'P0001', message = 'OPERATION_NOT_FOUND';
  end if;
  select * into strict v_session
  from api.interview_sessions where id = v_operation.subject_id for update;
  select * into v_operation
  from private.request_idempotency
  where id = p_operation_id and scope = 'rewrite' and subject_id = v_session.id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OPERATION_NOT_FOUND';
  end if;
  select * into strict v_limits
  from private.store_runtime_limits where store_id = v_session.store_id;

  if v_operation.status = 'completed' then
    return jsonb_build_object(
      'operation_id', p_operation_id,
      'session_id', v_session.id,
      'review_text', v_session.edited_review,
      'rewrite_count', v_session.rewrite_count,
      'rewrite_limit', v_limits.rewrite_limit,
      'remaining_rewrites', greatest(v_limits.rewrite_limit - v_session.rewrite_count, 0),
      'generation_source', v_session.generation_source,
      'replayed', true
    );
  end if;
  if v_operation.status <> 'processing' then
    raise exception using errcode = 'P0001', message = 'INVALID_OPERATION_STATE';
  end if;
  if v_operation.lease_expires_at is null
    or v_operation.lease_expires_at <= statement_timestamp()
  then
    raise exception using errcode = 'P0001', message = 'OPERATION_LEASE_EXPIRED';
  end if;

  update api.interview_sessions
  set generated_review = btrim(p_review_text),
      edited_review = btrim(p_review_text),
      status = 'completed',
      generation_status = 'succeeded',
      generation_source = 'ai',
      generation_provider = p_provider,
      generation_model = p_model,
      generation_request_id = p_request_id,
      generated_review_at = statement_timestamp(),
      last_activity_at = statement_timestamp()
  where id = v_session.id
  returning * into v_session;
  update private.request_idempotency
  set status = 'completed', result_ref = v_session.id, lease_expires_at = null
  where id = p_operation_id;

  return jsonb_build_object(
    'operation_id', p_operation_id,
    'session_id', v_session.id,
    'review_text', v_session.edited_review,
    'rewrite_count', v_session.rewrite_count,
    'rewrite_limit', v_limits.rewrite_limit,
    'remaining_rewrites', greatest(v_limits.rewrite_limit - v_session.rewrite_count, 0),
    'generation_source', 'ai',
    'replayed', false
  );
end;
$$;


--
-- Name: internal_create_owner_store_once_v2(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_create_owner_store_once_v2(p_actor_id uuid, p_operation_id uuid, p_public_slug text, p_name text, p_industry text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_website_url text DEFAULT NULL::text, p_icon_path text DEFAULT NULL::text, p_welcome_message text DEFAULT NULL::text, p_closing_message text DEFAULT NULL::text, p_google_review_url text DEFAULT NULL::text, p_google_place_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_store jsonb;
begin
  if p_actor_id is null or p_operation_id is null then
    raise exception using errcode = '22023', message = 'INVALID_OWNER_OPERATION';
  end if;

  perform 1
  from private.request_idempotency operation
  where operation.id = p_operation_id
    and operation.scope = 'owner_store'
    and operation.subject_id = p_actor_id
    and operation.status = 'processing'
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'INVALID_OWNER_OPERATION';
  end if;

  v_store := api.internal_create_owner_store_v2(
    p_actor_id,
    p_public_slug,
    p_name,
    p_industry,
    p_address,
    p_description,
    p_website_url,
    p_icon_path,
    p_welcome_message,
    p_closing_message,
    p_google_review_url,
    p_google_place_id
  );

  perform api.internal_complete_owner_operation(p_operation_id, v_store);
  return v_store;
end;
$$;


--
-- Name: internal_create_owner_store_v2(uuid, text, text, text, text, text, text, text, text, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_create_owner_store_v2(p_actor_id uuid, p_public_slug text, p_name text, p_industry text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_website_url text DEFAULT NULL::text, p_icon_path text DEFAULT NULL::text, p_welcome_message text DEFAULT NULL::text, p_closing_message text DEFAULT NULL::text, p_google_review_url text DEFAULT NULL::text, p_google_place_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_slot smallint;
  v_store api.stores%rowtype;
begin
  if p_actor_id is null or p_name is null or btrim(p_name) = '' then
    raise exception using errcode = '22023', message = 'INVALID_STORE_INPUT';
  end if;
  if p_google_place_id is not null
    and nullif(btrim(p_google_place_id), '') is not null
    and nullif(btrim(p_google_place_id), '') !~ '^[A-Za-z0-9_-]{10,255}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_GOOGLE_PLACE_ID';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('owner-store-slots:' || p_actor_id::text, 0)
  );

  select slot::smallint into v_slot
  from generate_series(1, 100) slot
  where not exists (
    select 1
    from api.stores store
    where store.owner_id = p_actor_id
      and store.owner_store_slot = slot
  )
  order by slot
  limit 1;

  if v_slot is null then
    raise exception using errcode = 'P0001', message = 'STORE_SLOT_EXHAUSTED';
  end if;

  insert into api.stores (
    owner_id,
    owner_store_slot,
    public_slug,
    name,
    industry,
    address,
    description,
    website_url,
    icon_path,
    welcome_message,
    closing_message,
    google_review_url,
    google_place_id
  ) values (
    p_actor_id,
    v_slot,
    p_public_slug,
    btrim(p_name),
    nullif(btrim(p_industry), ''),
    nullif(btrim(p_address), ''),
    nullif(btrim(p_description), ''),
    nullif(btrim(p_website_url), ''),
    nullif(btrim(p_icon_path), ''),
    nullif(btrim(p_welcome_message), ''),
    nullif(btrim(p_closing_message), ''),
    nullif(btrim(p_google_review_url), ''),
    nullif(btrim(p_google_place_id), '')
  )
  returning * into v_store;

  insert into private.store_survey_revisions (
    store_id,
    revision,
    config_json,
    source
  ) values (
    v_store.id,
    (v_store.survey_config_json ->> 'revision')::integer,
    v_store.survey_config_json,
    'preset'
  );

  return to_jsonb(v_store);
end;
$_$;


--
-- Name: internal_delete_ai_connection_v2(uuid, uuid, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_delete_ai_connection_v2(p_actor_id uuid, p_store_id uuid, p_provider text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_was_active boolean;
begin
  if p_provider not in ('openai', 'gemini', 'deepseek', 'xai', 'anthropic') then
    raise exception using errcode = '22023', message = 'INVALID_PROVIDER';
  end if;
  perform private.require_store_owner(p_actor_id, p_store_id);

  delete from private.store_ai_provider_connections
  where store_id = p_store_id
    and provider = p_provider
  returning is_active into v_was_active;
  if not found then
    raise exception using errcode = 'P0001', message = 'AI_CONNECTION_NOT_FOUND';
  end if;

  if v_was_active then
    update api.stores
    set status = case when status = 'published' then 'paused' else status end
    where id = p_store_id;
  end if;

  return jsonb_build_object('deleted', true, 'provider', p_provider);
end;
$$;


--
-- Name: internal_fail_operation(uuid, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_fail_operation(p_operation_id uuid, p_error_code text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_operation private.request_idempotency%rowtype;
begin
  if p_error_code is null or char_length(p_error_code) > 100 then
    raise exception using errcode = '22023', message = 'INVALID_ERROR_CODE';
  end if;
  select * into v_operation
  from private.request_idempotency where id = p_operation_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OPERATION_NOT_FOUND';
  end if;
  if v_operation.status = 'completed' then
    return jsonb_build_object('operation_id', p_operation_id, 'status', 'completed');
  end if;
  if v_operation.status <> 'processing' then
    return jsonb_build_object(
      'operation_id', p_operation_id,
      'status', v_operation.status,
      'error_code', v_operation.error_code
    );
  end if;

  update private.request_idempotency
  set status = 'failed', error_code = p_error_code, lease_expires_at = null
  where id = p_operation_id;
  if v_operation.scope = 'review' then
    update api.interview_sessions
    set status = 'active', generation_status = 'failed'
    where id = v_operation.subject_id;
  elsif v_operation.scope = 'rewrite' then
    update api.interview_sessions
    set status = 'completed', generation_status = 'succeeded',
        rewrite_count = greatest(rewrite_count - 1, 0)
    where id = v_operation.subject_id;
  end if;
  return jsonb_build_object(
    'operation_id', p_operation_id,
    'status', 'failed',
    'error_code', p_error_code
  );
end;
$$;


--
-- Name: internal_get_active_ai_connection(uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_get_active_ai_connection(p_store_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'store_id', connection.store_id, 'provider', connection.provider, 'model', connection.model,
    'credential_ciphertext', connection.credential_ciphertext,
    'credential_iv', connection.credential_iv, 'key_version', connection.key_version,
    'key_last4', connection.key_last4
  ) from private.store_ai_provider_connections connection
  where connection.store_id = p_store_id and connection.is_active
    and connection.status = 'active' and connection.validated_at is not null;
$$;


--
-- Name: internal_get_ai_connection_v2(uuid, uuid, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_get_ai_connection_v2(p_actor_id uuid, p_store_id uuid, p_provider text) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'store_id', store.id,
    'provider', connection.provider,
    'model', connection.model,
    'credential_ciphertext', connection.credential_ciphertext,
    'credential_iv', connection.credential_iv,
    'key_version', connection.key_version,
    'key_last4', connection.key_last4,
    'status', connection.status,
    'is_active', connection.is_active,
    'validated_at', connection.validated_at
  )
  from api.stores store
  join private.store_ai_provider_connections connection
    on connection.store_id = store.id
  where store.id = p_store_id
    and store.owner_id = p_actor_id
    and store.archived_at is null
    and connection.provider = p_provider;
$$;


--
-- Name: internal_get_ai_connections_v2(uuid, uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_get_ai_connections_v2(p_actor_id uuid, p_store_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'provider', connection.provider,
    'model', connection.model,
    'status', connection.status,
    'is_active', connection.is_active,
    'key_last4', connection.key_last4,
    'validated_at', connection.validated_at,
    'last_error_code', connection.last_error_code
  ) order by connection.provider), '[]'::jsonb)
  from api.stores store
  join private.store_ai_provider_connections connection
    on connection.store_id = store.id
  where store.id = p_store_id
    and store.owner_id = p_actor_id
    and store.archived_at is null;
$$;


--
-- Name: internal_get_interview_context(uuid, uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_get_interview_context(p_store_id uuid, p_session_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'store_name', store.name,
    'industry', store.industry,
    'locale', session.locale,
    'rating', session.rating,
    'visit_frequency', session.visit_frequency,
    'structured_answers_json', session.structured_answers_json,
    'survey_config_json', coalesce(
      snapshot.resolved_config_json,
      case when revision.config_json ->> 'version' = '3'
        then revision.config_json else null end
    ),
    'current_review', session.edited_review,
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'role', message.role,
          'content', message.content,
          'sequence', message.sequence
        ) order by message.sequence
      )
      from api.interview_messages message
      where message.session_id = session.id and message.store_id = store.id
    ), '[]'::jsonb)
  )
  from api.interview_sessions session
  join api.stores store on store.id = session.store_id
  left join private.interview_survey_snapshots snapshot
    on snapshot.session_id = session.id
   and snapshot.store_id = session.store_id
  left join private.store_survey_revisions revision
    on revision.store_id = session.store_id
   and revision.revision = session.survey_revision
  where session.id = p_session_id and session.store_id = p_store_id;
$$;


--
-- Name: internal_get_interview_resume(uuid, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_get_interview_resume(p_session_id uuid, p_token_hash text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_session api.interview_sessions%rowtype;
  v_limits private.store_runtime_limits%rowtype;
  v_last_question text;
  v_next_kind text;
begin
  v_session := private.require_interview_session(p_session_id, p_token_hash);
  select * into strict v_limits
  from private.store_runtime_limits where store_id = v_session.store_id;

  select message.content into v_last_question
  from api.interview_messages message
  where message.session_id = p_session_id
    and message.role = 'assistant'
  order by message.sequence desc
  limit 1;

  v_next_kind := case
    when v_session.status = 'completed'
      and v_session.generation_status = 'succeeded' then 'review'
    when v_session.interview_complete then 'ready_for_review'
    when not (v_session.profile_json ? 'visitFrequency') then 'profile'
    else 'conversation'
  end;

  return jsonb_build_object(
    'status', v_session.status,
    'ai_turn_count', v_session.ai_turn_count,
    'interview_complete', v_session.interview_complete,
    'generation_status', v_session.generation_status,
    'rewrite_count', v_session.rewrite_count,
    'rewrite_limit', v_limits.rewrite_limit,
    'remaining_rewrites', greatest(
      v_limits.rewrite_limit - v_session.rewrite_count, 0
    ),
    'edited_review', v_session.edited_review,
    'last_assistant_question', v_last_question,
    'next_kind', v_next_kind
  );
end;
$$;


--
-- Name: internal_get_interview_survey_revision(uuid, text, integer); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_get_interview_survey_revision(p_session_id uuid, p_token_hash text, p_survey_revision integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_snapshot jsonb;
begin
  if p_survey_revision is null or p_survey_revision < 1 then
    raise exception using errcode = '22023', message = 'SURVEY_REVISION_NOT_FOUND';
  end if;
  v_snapshot := api.internal_get_interview_survey_snapshot(
    p_session_id,
    p_token_hash
  );
  if v_snapshot is null
    or (v_snapshot ->> 'survey_revision')::integer <> p_survey_revision
  then
    raise exception using errcode = '22023', message = 'SURVEY_REVISION_NOT_FOUND';
  end if;
  return v_snapshot;
end;
$$;


--
-- Name: internal_get_interview_survey_snapshot(uuid, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_get_interview_survey_snapshot(p_session_id uuid, p_token_hash text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_session api.interview_sessions%rowtype;
  v_snapshot private.interview_survey_snapshots%rowtype;
  v_config jsonb;
begin
  v_session := private.require_interview_session(p_session_id, p_token_hash);
  select snapshot.* into v_snapshot
  from private.interview_survey_snapshots snapshot
  where snapshot.session_id = p_session_id
    and snapshot.store_id = v_session.store_id;
  if found then
    return jsonb_build_object(
      'store_id', v_snapshot.store_id,
      'survey_revision', v_snapshot.source_revision,
      'selection_json', v_snapshot.selection_json,
      'survey_config_json', v_snapshot.resolved_config_json
    );
  end if;

  if v_session.survey_revision is null then
    return null;
  end if;
  select revision.config_json into v_config
  from private.store_survey_revisions revision
  where revision.store_id = v_session.store_id
    and revision.revision = v_session.survey_revision;
  if not found or v_config ->> 'version' <> '3' then
    raise exception using errcode = '22023', message = 'SURVEY_REVISION_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'store_id', v_session.store_id,
    'survey_revision', v_session.survey_revision,
    'selection_json', null,
    'survey_config_json', v_config
  );
end;
$$;


--
-- Name: internal_get_operation_result(uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_get_operation_result(p_operation_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_operation private.request_idempotency%rowtype;
  v_message api.interview_messages%rowtype;
  v_session api.interview_sessions%rowtype;
  v_event api.review_handoff_events%rowtype;
  v_google_review_url text;
begin
  select * into v_operation
  from private.request_idempotency
  where id = p_operation_id;

  if not found or v_operation.status <> 'completed' then
    raise exception using errcode = 'P0001', message = 'OPERATION_RESULT_NOT_READY';
  end if;

  if v_operation.scope = 'turn' then
    select * into v_message
    from api.interview_messages
    where id = v_operation.result_ref;

    select * into v_session
    from api.interview_sessions
    where id = v_operation.subject_id;

    return jsonb_build_object(
      'operation_id', v_operation.id,
      'scope', v_operation.scope,
      'session_id', v_session.id,
      'assistant_text', v_message.content,
      'assistant_sequence', v_message.sequence,
      'ai_turn_count', v_session.ai_turn_count,
      'interview_complete', v_session.interview_complete,
      'replayed', true
    );
  elsif v_operation.scope in ('review', 'rewrite', 'review_edit') then
    select * into v_session
    from api.interview_sessions
    where id = v_operation.subject_id;

    return jsonb_build_object(
      'operation_id', v_operation.id,
      'scope', v_operation.scope,
      'session_id', v_session.id,
      'review_text', v_session.edited_review,
      'rewrite_count', v_session.rewrite_count,
      'replayed', true
    );
  elsif v_operation.scope = 'handoff' then
    select * into v_event
    from api.review_handoff_events
    where id = v_operation.result_ref;

    select google_review_url into v_google_review_url
    from api.stores
    where id = v_event.store_id;

    return jsonb_build_object(
      'operation_id', v_operation.id,
      'scope', v_operation.scope,
      'session_id', v_event.session_id,
      'event_id', v_event.id,
      'event_type', v_event.event_type,
      'google_review_url', v_google_review_url,
      'replayed', true
    );
  end if;

  raise exception using errcode = 'P0001', message = 'UNSUPPORTED_OPERATION_RESULT';
end;
$$;


--
-- Name: internal_get_owner_interview_survey_snapshots(uuid, uuid, uuid[]); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_get_owner_interview_survey_snapshots(p_actor_id uuid, p_store_id uuid, p_session_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_result jsonb;
begin
  perform private.require_store_owner(p_actor_id, p_store_id);
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'session_id', snapshot.session_id,
        'resolved_config_json', snapshot.resolved_config_json
      ) order by snapshot.created_at desc, snapshot.session_id desc
    ),
    '[]'::jsonb
  ) into v_result
  from private.interview_survey_snapshots snapshot
  where snapshot.store_id = p_store_id
    and snapshot.session_id = any(p_session_ids);
  return v_result;
end;
$$;


--
-- Name: internal_get_owner_store_v2(uuid, uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_get_owner_store_v2(p_actor_id uuid, p_store_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select to_jsonb(store)
  from api.stores store
  where store.id = p_store_id
    and store.owner_id = p_actor_id
    and store.archived_at is null;
$$;


--
-- Name: internal_get_owner_survey_config_v2(uuid, uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_get_owner_survey_config_v2(p_actor_id uuid, p_store_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select store.survey_config_json
  from api.stores store
  where store.id = p_store_id
    and store.owner_id = p_actor_id
    and store.archived_at is null;
$$;


--
-- Name: internal_get_owner_survey_revisions_v2(uuid, uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_get_owner_survey_revisions_v2(p_actor_id uuid, p_store_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'revision', revision.revision,
        'config', revision.config_json
      ) order by revision.revision
    ),
    '[]'::jsonb
  )
  from private.store_survey_revisions revision
  join api.stores store on store.id = revision.store_id
  where store.id = p_store_id
    and store.owner_id = p_actor_id
    and store.archived_at is null;
$$;


--
-- Name: internal_get_public_store(text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_get_public_store(p_public_slug text) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'store_id', store.id,
    'public_slug', store.public_slug,
    'name', store.name,
    'industry', store.industry,
    'description', store.description,
    'icon_path', store.icon_path,
    'welcome_message', store.welcome_message,
    'closing_message', store.closing_message,
    'google_review_url', store.google_review_url,
    'google_maps_url', case when store.google_place_id is null then null
      else 'https://www.google.com/maps/search/?api=1&query_place_id=' || store.google_place_id end,
    'survey_config_json', store.survey_config_json,
    'survey_revision', (store.survey_config_json ->> 'revision')::integer,
    'timezone', store.timezone,
    'ai_configured', exists (
      select 1
      from private.store_ai_provider_connections connection
      where connection.store_id = store.id
        and connection.is_active
        and connection.status = 'active'
        and connection.validated_at is not null
    )
  )
  from api.stores store
  where store.public_slug = p_public_slug
    and store.status = 'published'
    and store.archived_at is null;
$$;


--
-- Name: internal_get_zero_feature_capabilities(uuid, uuid, timestamp with time zone); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_get_zero_feature_capabilities(p_actor_id uuid, p_store_id uuid, p_evaluated_at timestamp with time zone DEFAULT statement_timestamp()) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_evaluated_at timestamptz := coalesce(p_evaluated_at, statement_timestamp());
  v_result jsonb;
begin
  perform private.require_store_owner(p_actor_id, p_store_id);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'feature_key', rollout.feature_key,
      'state', evaluated.effective_state,
      'visible', evaluated.effective_state <> 'hidden',
      'available', evaluated.effective_state = 'available',
      'execution_mode', rollout.execution_mode,
      'release_at', rollout.release_at
    ) order by case rollout.feature_key
      when 'review_reply' then 1
      when 'meo_rank' then 2
      when 'gbp_insights' then 3
      when 'gbp_health' then 4
      when 'instagram_to_gbp' then 5
    end
  ), '[]'::jsonb)
  into v_result
  from private.zero_feature_rollouts rollout
  cross join lateral (
    select private.zero_feature_effective_state(
      rollout.configured_state,
      rollout.release_at,
      rollout.kill_switch,
      v_evaluated_at
    ) as effective_state
  ) evaluated;

  if jsonb_array_length(v_result) <> 5 then
    raise exception using errcode = 'P0001', message = 'FEATURE_ROLLOUT_CONFIGURATION_INCOMPLETE';
  end if;
  return v_result;
end;
$$;


--
-- Name: FUNCTION internal_get_zero_feature_capabilities(p_actor_id uuid, p_store_id uuid, p_evaluated_at timestamp with time zone); Type: COMMENT; Schema: api; Owner: -
--

COMMENT ON FUNCTION api.internal_get_zero_feature_capabilities(p_actor_id uuid, p_store_id uuid, p_evaluated_at timestamp with time zone) IS 'Returns the fixed five-feature rollout projection, including the restored read-only GBP diagnostic.';


--
-- Name: internal_list_owner_stores(uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_list_owner_stores(p_actor_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select coalesce(
    jsonb_agg(
      to_jsonb(store) || jsonb_build_object(
        'is_publicly_available', store.status = 'published'
      ) order by store.owner_store_slot
    ),
    '[]'::jsonb
  )
  from api.stores store
  where store.owner_id = p_actor_id
    and store.archived_at is null;
$$;


--
-- Name: internal_mark_ai_connection_status_v2(uuid, uuid, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_mark_ai_connection_status_v2(p_actor_id uuid, p_store_id uuid, p_provider text, p_status text, p_error_code text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_connection private.store_ai_provider_connections%rowtype;
begin
  if p_provider not in ('openai', 'gemini', 'deepseek', 'xai', 'anthropic')
    or p_status not in ('active', 'invalid', 'revoked', 'error')
  then
    raise exception using errcode = '22023', message = 'INVALID_PROVIDER_STATUS';
  end if;
  perform private.require_store_owner(p_actor_id, p_store_id);

  update private.store_ai_provider_connections connection
  set status = p_status,
      is_active = case when p_status = 'active' then connection.is_active else false end,
      validated_at = case when p_status = 'active'
        then statement_timestamp()
        else connection.validated_at
      end,
      last_error_code = p_error_code
  where connection.store_id = p_store_id
    and connection.provider = p_provider
  returning connection.* into v_connection;

  if not found then
    raise exception using errcode = 'P0001', message = 'AI_CONNECTION_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'provider', v_connection.provider,
    'model', v_connection.model,
    'status', v_connection.status,
    'is_active', v_connection.is_active,
    'key_last4', v_connection.key_last4,
    'validated_at', v_connection.validated_at,
    'last_error_code', v_connection.last_error_code
  );
end;
$$;


--
-- Name: internal_meo_attention_external_action(uuid, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_attention_external_action(p_operation_id uuid, p_error_code text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_action private.meo_external_actions%rowtype;
begin
  if p_operation_id is null or p_error_code !~ '^[A-Z0-9_:-]{2,100}$' then
    raise exception using errcode = '22023', message = 'INVALID_EXTERNAL_ACTION_ATTENTION';
  end if;
  update private.meo_external_actions action
  set status = 'attention_required', error_code = p_error_code,
      completed_at = statement_timestamp()
  where action.id = p_operation_id and action.status = 'processing'
  returning action.* into v_action;
  if not found then
    select * into v_action
    from private.meo_external_actions action
    where action.id = p_operation_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'EXTERNAL_ACTION_NOT_FOUND';
    end if;
    if v_action.status = 'attention_required' and v_action.error_code = p_error_code then
      return;
    end if;
    raise exception using errcode = 'P0001', message = 'EXTERNAL_ACTION_NOT_PROCESSING';
  end if;

  insert into private.integration_receipts (
    store_id, action_type, provider, request_hash, outcome, safe_metadata
  ) values (
    v_action.store_id, v_action.action, 'google_business', v_action.request_hash,
    'attention_required', jsonb_build_object(
      'operation_id', v_action.id,
      'error_code', p_error_code
    )
  );
end;
$_$;


--
-- Name: internal_meo_claim_due_rank_jobs(integer, text, integer); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_claim_due_rank_jobs(p_limit integer DEFAULT 10, p_worker_id text DEFAULT 'rank-worker'::text, p_lease_seconds integer DEFAULT 120) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_result jsonb;
begin
  if p_limit not between 1 and 50
    or p_worker_id !~ '^[A-Za-z0-9._:@/-]{3,120}$'
    or p_lease_seconds not between 30 and 600
  then
    raise exception using errcode = '22023', message = 'INVALID_RANK_JOB_CLAIM';
  end if;

  -- Queued jobs are submitted only by the owner request. If that request dies
  -- before marking DataForSEO submission, the outcome may be chargeable and
  -- must be reconciled rather than auto-submitted by a worker.
  perform api.internal_meo_reconcile_stale_rank_submissions(100);

  -- Polling a previously submitted task is read-only. A lost poll lease may be
  -- retried without resubmitting or creating another provider task.
  update private.integration_jobs job
  set status = 'provider_submitted',
      processing_stage = null,
      claim_token = null,
      lease_expires_at = null,
      worker_id = null,
      available_at = statement_timestamp()
  where job.job_type = 'rank_measurement'
    and job.status = 'processing'
    and job.processing_stage = 'poll'
    and job.lease_expires_at <= statement_timestamp();

  with candidates as (
    select job.id, 'poll'::text as next_stage
    from private.integration_jobs job
    join api.stores candidate_store
      on candidate_store.id = job.store_id and candidate_store.archived_at is null
    join private.meo_rank_measurements candidate_measurement
      on candidate_measurement.job_id = job.id
    join private.zero_feature_rollouts rollout on rollout.feature_key = 'meo_rank'
    where job.job_type = 'rank_measurement'
      and job.status = 'provider_submitted'
      and job.available_at <= statement_timestamp()
      and job.attempt_count < job.max_attempts
      and private.zero_feature_effective_state(
        rollout.configured_state, rollout.release_at, rollout.kill_switch,
        statement_timestamp()
      ) = 'available'
      and private.owner_exists(candidate_store.owner_id)
      and rollout.execution_mode = candidate_measurement.credential_source
    order by job.available_at, job.created_at, job.id
    limit p_limit
    for update of job skip locked
  ), claimed as (
    update private.integration_jobs job
    set status = 'processing',
        processing_stage = candidate.next_stage,
        attempt_count = job.attempt_count + 1,
        worker_id = p_worker_id,
        claim_token = gen_random_uuid(),
        lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds)
    from candidates candidate
    where job.id = candidate.id
    returning job.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'job_id', claimed.id,
    'actor_id', store.owner_id,
    'measurement_id', measurement.id,
    'store_id', claimed.store_id,
    'stage', claimed.processing_stage,
    'claim_token', claimed.claim_token,
    'lease_expires_at', claimed.lease_expires_at,
    'attempt_count', claimed.attempt_count,
    'max_attempts', claimed.max_attempts,
    'payload', claimed.payload,
    'provider_task_id', claimed.provider_task_id,
    'credential_source', measurement.credential_source
  ) order by claimed.created_at, claimed.id), '[]'::jsonb)
  into v_result
  from claimed
  join private.meo_rank_measurements measurement on measurement.job_id = claimed.id
  join api.stores store on store.id = claimed.store_id;

  return v_result;
end;
$_$;


--
-- Name: internal_meo_claim_external_action(uuid, uuid, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_claim_external_action(p_actor_id uuid, p_store_id uuid, p_action text, p_key_hash text, p_request_hash text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_action private.meo_external_actions%rowtype;
  v_feature_key text;
  v_access jsonb;
begin
  if p_action not in ('review_reply', 'gbp_post')
    or p_key_hash !~ '^[0-9a-f]{64}$'
    or p_request_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_EXTERNAL_ACTION';
  end if;
  v_feature_key := case when p_action = 'review_reply' then 'review_reply' else 'instagram_to_gbp' end;
  perform api.internal_require_zero_feature(
    p_actor_id, p_store_id, v_feature_key, statement_timestamp()
  );
  v_access := api.internal_zero_meo_workspace_authorize(p_actor_id, p_store_id);
  if v_access ->> 'role' not in ('owner', 'admin', 'editor') then
    raise exception using errcode = 'P0001', message = 'EXTERNAL_WRITE_ROLE_REQUIRED';
  end if;
  if not exists (
    select 1 from private.zero_meo_store_workspaces workspace
    where workspace.store_id = p_store_id
      and workspace.external_writes_enabled
  ) then
    raise exception using errcode = 'P0001', message = 'EXTERNAL_WRITES_DISABLED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'meo-external-action-key:' || p_store_id::text || ':' || p_action || ':' || p_key_hash,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'meo-external-action-effect:' || p_store_id::text || ':' || p_action || ':' || p_request_hash,
    0
  ));

  select * into v_action
  from private.meo_external_actions action
  where action.store_id = p_store_id
    and action.action = p_action
    and action.key_hash = p_key_hash
  for update;
  if found then
    if v_action.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_PAYLOAD_CONFLICT';
    end if;
  else
    select * into v_action
    from private.meo_external_actions action
    where action.store_id = p_store_id
      and action.action = p_action
      and action.request_hash = p_request_hash
      and action.status in ('processing', 'completed', 'attention_required')
    for update;
    if not found then
      insert into private.meo_external_actions (
        store_id, actor_id, action, key_hash, request_hash, status
      ) values (
        p_store_id, p_actor_id, p_action, p_key_hash, p_request_hash, 'processing'
      ) returning * into v_action;
      return jsonb_build_object('replayed', false, 'operation_id', v_action.id);
    end if;
  end if;

  if v_action.status = 'completed' then
    return jsonb_build_object(
      'replayed', true,
      'operation_id', v_action.id,
      'result_json', v_action.result_json
    );
  elsif v_action.status = 'attention_required' then
    return jsonb_build_object(
      'replayed', true,
      'operation_id', v_action.id,
      'outcome_unknown', true,
      'error_code', v_action.error_code
    );
  elsif v_action.status = 'failed' then
    raise exception using errcode = 'P0001', message = 'EXTERNAL_ACTION_PREVIOUSLY_FAILED';
  elsif v_action.created_at < statement_timestamp() - interval '10 minutes' then
    update private.meo_external_actions action
    set status = 'attention_required',
        error_code = 'EXTERNAL_ACTION_STALE_PROCESSING',
        completed_at = statement_timestamp()
    where action.id = v_action.id
    returning action.* into v_action;
    insert into private.integration_receipts (
      store_id, action_type, provider, request_hash, outcome, safe_metadata
    )
    select v_action.store_id, v_action.action, 'google_business',
      v_action.request_hash, 'attention_required', jsonb_build_object(
        'operation_id', v_action.id,
        'error_code', 'EXTERNAL_ACTION_STALE_PROCESSING'
      )
    where not exists (
      select 1 from private.integration_receipts receipt
      where receipt.store_id = v_action.store_id
        and receipt.action_type = v_action.action
        and receipt.request_hash = v_action.request_hash
        and receipt.outcome = 'attention_required'
    );
    return jsonb_build_object(
      'replayed', true,
      'operation_id', v_action.id,
      'outcome_unknown', true,
      'error_code', v_action.error_code
    );
  else
    raise exception using errcode = 'P0001', message = 'EXTERNAL_ACTION_IN_PROGRESS';
  end if;
end;
$_$;


--
-- Name: internal_meo_claim_health_diagnosis(uuid, uuid, text, text, integer, integer, integer, integer, integer); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_claim_health_diagnosis(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_window_seconds integer, p_store_window_limit integer, p_global_window_limit integer, p_store_daily_limit integer, p_global_daily_limit integer) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_response jsonb;
  v_completed_at timestamptz;
begin
  v_response := api.internal_meo_claim_health_diagnosis_v1(
    p_actor_id,
    p_store_id,
    p_key_hash,
    p_request_hash,
    p_window_seconds,
    p_store_window_limit,
    p_global_window_limit,
    p_store_daily_limit,
    p_global_daily_limit
  );

  if v_response ->> 'status' = 'succeeded' then
    select diagnosis.completed_at into v_completed_at
    from private.meo_health_diagnoses diagnosis
    where diagnosis.operation_id = (v_response ->> 'reservation_id')::uuid
      and diagnosis.status = 'succeeded'
      and diagnosis.result_json is not null;
    if not found or v_completed_at is null then
      raise exception using
        errcode = 'P0001', message = 'HEALTH_DIAGNOSIS_COMPLETION_MISSING';
    end if;
  end if;

  return v_response || jsonb_build_object('diagnosedAt', v_completed_at);
end;
$$;


--
-- Name: FUNCTION internal_meo_claim_health_diagnosis(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_window_seconds integer, p_store_window_limit integer, p_global_window_limit integer, p_store_daily_limit integer, p_global_daily_limit integer); Type: COMMENT; Schema: api; Owner: -
--

COMMENT ON FUNCTION api.internal_meo_claim_health_diagnosis(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_window_seconds integer, p_store_window_limit integer, p_global_window_limit integer, p_store_daily_limit integer, p_global_daily_limit integer) IS 'Service-role-only connected GBP diagnosis claim. Successful exact replay returns the bounded result and its database completion timestamp.';


--
-- Name: internal_meo_claim_health_diagnosis_v1(uuid, uuid, text, text, integer, integer, integer, integer, integer); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_claim_health_diagnosis_v1(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_window_seconds integer, p_store_window_limit integer, p_global_window_limit integer, p_store_daily_limit integer, p_global_daily_limit integer) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_now timestamptz := statement_timestamp();
  v_feature jsonb;
  v_reservation jsonb;
  v_usage private.service_usage%rowtype;
  v_diagnosis private.meo_health_diagnoses%rowtype;
  v_status text;
begin
  -- The Edge preflight is intentionally repeated in this transaction. A kill
  -- switch can change between the HTTP check and this reservation; no usage row
  -- may be created unless the DB-authoritative gate is still native/available.
  v_feature := api.internal_require_zero_feature(
    p_actor_id, p_store_id, 'gbp_health', v_now
  );
  if v_feature ->> 'state' <> 'available'
    or v_feature ->> 'execution_mode' <> 'native'
  then
    raise exception using
      errcode = 'P0001', message = 'FEATURE_EXECUTION_MODE_MISMATCH';
  end if;

  v_reservation := api.internal_meo_reserve_provider_call(
    p_actor_id,
    p_store_id,
    p_key_hash,
    p_request_hash,
    'google_business_api',
    'google_health_read',
    'native',
    p_window_seconds,
    p_store_window_limit,
    p_global_window_limit,
    p_store_daily_limit,
    p_global_daily_limit
  );

  if not coalesce((v_reservation ->> 'authorized')::boolean, false) then
    return v_reservation;
  end if;

  select * into v_usage
  from private.service_usage usage
  where usage.operation_id = (v_reservation ->> 'reservation_id')::uuid
    and usage.service = 'google_business_api'
    and usage.operation = 'google_health_read'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'HEALTH_DIAGNOSIS_RESERVATION_NOT_FOUND';
  end if;

  select * into v_diagnosis
  from private.meo_health_diagnoses diagnosis
  where diagnosis.operation_id = v_usage.operation_id
  for update;

  if not found then
    if coalesce((v_reservation ->> 'replayed')::boolean, false) then
      -- A provider reservation without its companion diagnosis can only be a
      -- legacy/incomplete transaction. Never re-run the provider for it.
      -- A missing succeeded companion is reconstructed as an expired
      -- tombstone without rewriting the immutable succeeded usage evidence.
      v_status := case v_usage.status
        when 'succeeded' then 'expired'
        when 'failed' then 'failed'
        else 'attention_required'
      end;
      if v_usage.status not in ('succeeded', 'failed') then
        update private.service_usage usage
        set status = 'attention_required',
            last_error_code = coalesce(
              v_usage.last_error_code,
              'HEALTH_DIAGNOSIS_RECORD_MISSING'
            ),
            completed_at = coalesce(v_usage.completed_at, v_now)
        where usage.id = v_usage.id;
      end if;
      insert into private.meo_health_diagnoses (
        usage_id, operation_id, store_id, key_hash, request_hash, status,
        last_error_code, lease_expires_at, completed_at
      ) values (
        v_usage.id, v_usage.operation_id, v_usage.store_id,
        v_usage.key_hash, v_usage.request_hash, v_status,
        case when v_status = 'expired'
          then 'HEALTH_DIAGNOSIS_RESULT_EXPIRED'
          else coalesce(v_usage.last_error_code, 'HEALTH_DIAGNOSIS_RECORD_MISSING')
        end,
        v_now, v_now
      )
      returning * into v_diagnosis;
    else
      insert into private.meo_health_diagnoses (
        usage_id, operation_id, store_id, key_hash, request_hash, status,
        lease_expires_at
      ) values (
        v_usage.id, v_usage.operation_id, v_usage.store_id,
        v_usage.key_hash, v_usage.request_hash, 'processing',
        v_now + interval '5 minutes'
      )
      returning * into v_diagnosis;
    end if;
  elsif v_diagnosis.status = 'processing'
    and v_diagnosis.lease_expires_at <= v_now
  then
    update private.meo_health_diagnoses diagnosis
    set status = 'attention_required',
        last_error_code = 'HEALTH_DIAGNOSIS_LEASE_EXPIRED',
        completed_at = v_now,
        updated_at = v_now
    where diagnosis.usage_id = v_diagnosis.usage_id
    returning * into v_diagnosis;
    update private.service_usage usage
    set status = 'attention_required',
        last_error_code = 'HEALTH_DIAGNOSIS_LEASE_EXPIRED',
        completed_at = v_now
    where usage.id = v_usage.id and usage.status = 'reserved';
  end if;

  return jsonb_build_object(
    'reservation_id', v_diagnosis.operation_id,
    'authorized', (
      v_diagnosis.status = 'processing'
      and not coalesce((v_reservation ->> 'replayed')::boolean, false)
    ),
    'replayed', coalesce((v_reservation ->> 'replayed')::boolean, false),
    'status', v_diagnosis.status,
    'result', case when v_diagnosis.status = 'succeeded'
      then v_diagnosis.result_json else null end,
    'error_code', v_diagnosis.last_error_code,
    'lease_expires_at', v_diagnosis.lease_expires_at
  );
end;
$$;


--
-- Name: FUNCTION internal_meo_claim_health_diagnosis_v1(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_window_seconds integer, p_store_window_limit integer, p_global_window_limit integer, p_store_daily_limit integer, p_global_daily_limit integer); Type: COMMENT; Schema: api; Owner: -
--

COMMENT ON FUNCTION api.internal_meo_claim_health_diagnosis_v1(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_window_seconds integer, p_store_window_limit integer, p_global_window_limit integer, p_store_daily_limit integer, p_global_daily_limit integer) IS 'Service-role-only connected GBP diagnosis claim. Exact replays return only a bounded derived result; stale claims become attention_required and never rerun Google.';


--
-- Name: internal_meo_complete_external_action(uuid, jsonb); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_complete_external_action(p_operation_id uuid, p_result jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_action private.meo_external_actions%rowtype;
begin
  if p_operation_id is null
    or p_result is null
    or jsonb_typeof(p_result) <> 'object'
    or octet_length(p_result::text) > 8192
    or not private.meo_integration_json_is_safe(p_result)
  then
    raise exception using errcode = '22023', message = 'INVALID_EXTERNAL_ACTION_RESULT';
  end if;
  select * into v_action
  from private.meo_external_actions action
  where action.id = p_operation_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'EXTERNAL_ACTION_NOT_FOUND';
  end if;
  if v_action.status = 'completed' then
    if v_action.result_json = p_result then return; end if;
    raise exception using errcode = 'P0001', message = 'EXTERNAL_ACTION_RESULT_CONFLICT';
  elsif v_action.status <> 'processing' then
    raise exception using errcode = 'P0001', message = 'EXTERNAL_ACTION_NOT_PROCESSING';
  end if;

  update private.meo_external_actions
  set status = 'completed', result_json = p_result, error_code = null,
      completed_at = statement_timestamp()
  where id = p_operation_id;

  insert into private.integration_receipts (
    store_id, action_type, provider, request_hash, outcome, safe_metadata
  ) values (
    v_action.store_id, v_action.action, 'google_business', v_action.request_hash,
    'succeeded', jsonb_build_object('operation_id', v_action.id)
  );
end;
$$;


--
-- Name: internal_meo_complete_rank_job(uuid, uuid, integer, timestamp with time zone, text[], jsonb); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_complete_rank_job(p_job_id uuid, p_claim_token uuid, p_position integer, p_observed_at timestamp with time zone, p_result_place_ids text[], p_competitor_positions jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_actor_id uuid;
  v_store_id uuid;
begin
  select store.owner_id, job.store_id into v_actor_id, v_store_id
  from private.integration_jobs job
  join api.stores store on store.id = job.store_id and store.archived_at is null
  where job.id = p_job_id and job.job_type = 'rank_measurement'
    and job.status = 'processing' and job.processing_stage = 'poll'
    and job.claim_token = p_claim_token
    and job.lease_expires_at > statement_timestamp();
  if not found then
    raise exception using errcode = 'P0001', message = 'WORKER_CLAIM_INVALID_OR_EXPIRED';
  end if;
  return api.internal_meo_complete_rank_measurement(
    p_job_id, v_actor_id, v_store_id, p_position, p_observed_at,
    p_result_place_ids, p_competitor_positions
  );
end;
$$;


--
-- Name: internal_meo_complete_rank_measurement(uuid, uuid, uuid, integer, timestamp with time zone, text[], jsonb); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_complete_rank_measurement(p_job_id uuid, p_actor_id uuid, p_store_id uuid, p_position integer, p_observed_at timestamp with time zone, p_result_place_ids text[], p_competitor_positions jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_job private.integration_jobs%rowtype;
  v_measurement private.meo_rank_measurements%rowtype;
  v_observation private.meo_rank_observations%rowtype;
  v_competitor text;
  v_competitor_present integer;
  v_competitor_position integer;
  v_competitor_entry jsonb;
  v_match_count integer;
  v_used_positions integer[] := '{}'::integer[];
  v_canonical_competitors jsonb := '[]'::jsonb;
begin
  perform api.internal_require_zero_feature(
    p_actor_id, p_store_id, 'meo_rank', statement_timestamp()
  );
  if p_job_id is null
    or (p_position is not null and p_position not between 1 and 100)
    or p_observed_at is null
    or p_observed_at > statement_timestamp() + interval '5 minutes'
    or p_observed_at < statement_timestamp() - interval '7 days'
    or not private.meo_place_ids_are_valid(p_result_place_ids, 100)
    or (
      p_competitor_positions is not null
      and (
        jsonb_typeof(p_competitor_positions) <> 'array'
        or jsonb_array_length(p_competitor_positions) > 3
        or octet_length(p_competitor_positions::text) > 2048
        or not private.meo_integration_json_is_safe(p_competitor_positions)
      )
    )
  then
    raise exception using errcode = '22023', message = 'INVALID_RANK_RESULT';
  end if;

  select * into v_job
  from private.integration_jobs job
  where job.id = p_job_id and job.store_id = p_store_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'RANK_JOB_NOT_FOUND';
  end if;
  select * into v_measurement
  from private.meo_rank_measurements measurement
  where measurement.job_id = p_job_id and measurement.store_id = p_store_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'RANK_MEASUREMENT_NOT_FOUND';
  end if;

  if v_measurement.status = 'completed' then
    select * into v_observation
    from private.meo_rank_observations observation
    where observation.id = v_measurement.observation_id;
    return jsonb_build_object(
      'id', v_observation.id,
      'keyword', v_observation.keyword,
      'target_place_id', v_observation.own_place_id,
      'position', v_observation.own_position,
      'competitor_positions', v_observation.competitor_positions,
      'source', v_observation.source,
      'observed_at', v_observation.observed_at,
      'result_count', v_observation.result_count
    );
  end if;
  if v_job.provider_task_id is null
    or not (
      (v_job.status = 'processing' and v_job.processing_stage = 'poll')
      or v_job.status = 'provider_submitted'
    )
    or v_measurement.status <> 'submitted'
  then
    raise exception using errcode = 'P0001', message = 'RANK_JOB_NOT_READY_TO_COMPLETE';
  end if;

  -- DataForSEO rank_absolute may contain gaps (for example 1, 3, 8), so the
  -- array index is never treated as a rank. The place-id list proves presence;
  -- the normalized rank_absolute values are supplied explicitly by the worker.
  if (array_position(p_result_place_ids, v_measurement.target_place_id) is null)
      <> (p_position is null)
  then
    raise exception using errcode = 'P0001', message = 'RANK_POSITION_RESULT_MISMATCH';
  end if;
  if p_position is not null then
    v_used_positions := array_append(v_used_positions, p_position);
  end if;

  if p_competitor_positions is null then
    p_competitor_positions := '[]'::jsonb;
  end if;
  if jsonb_array_length(p_competitor_positions)
      <> cardinality(v_measurement.competitor_place_ids)
  then
    raise exception using errcode = 'P0001', message = 'COMPETITOR_POSITION_RESULT_MISMATCH';
  end if;

  foreach v_competitor in array v_measurement.competitor_place_ids loop
    select count(*)::integer into v_match_count
    from jsonb_array_elements(p_competitor_positions) entry
    where entry ->> 'place_id' = v_competitor;
    if v_match_count <> 1 then
      raise exception using errcode = 'P0001', message = 'COMPETITOR_POSITION_RESULT_MISMATCH';
    end if;
    select entry into v_competitor_entry
    from jsonb_array_elements(p_competitor_positions) entry
    where entry ->> 'place_id' = v_competitor;
    if jsonb_typeof(v_competitor_entry) <> 'object'
      or not (v_competitor_entry ? 'place_id')
      or not (v_competitor_entry ? 'position')
      or (v_competitor_entry - 'place_id' - 'position') <> '{}'::jsonb
    then
      raise exception using errcode = 'P0001', message = 'COMPETITOR_POSITION_RESULT_MISMATCH';
    end if;
    if v_competitor_entry -> 'position' = 'null'::jsonb then
      v_competitor_position := null;
    elsif jsonb_typeof(v_competitor_entry -> 'position') = 'number'
      and (v_competitor_entry ->> 'position') ~ '^[0-9]+$'
      and (v_competitor_entry ->> 'position')::integer between 1 and 100
    then
      v_competitor_position := (v_competitor_entry ->> 'position')::integer;
    else
      raise exception using errcode = 'P0001', message = 'COMPETITOR_POSITION_RESULT_MISMATCH';
    end if;
    v_competitor_present := array_position(p_result_place_ids, v_competitor);
    if (v_competitor_present is null) <> (v_competitor_position is null) then
      raise exception using errcode = 'P0001', message = 'COMPETITOR_POSITION_RESULT_MISMATCH';
    end if;
    if v_competitor_position is not null
      and v_competitor_position = any(v_used_positions)
    then
      raise exception using errcode = 'P0001', message = 'DUPLICATE_RANK_POSITION';
    end if;
    if v_competitor_position is not null then
      v_used_positions := array_append(v_used_positions, v_competitor_position);
    end if;
    v_canonical_competitors := v_canonical_competitors || jsonb_build_array(
      jsonb_build_object('place_id', v_competitor, 'position', v_competitor_position)
    );
  end loop;

  insert into private.meo_rank_targets as target (
    store_id, keyword, normalized_keyword, own_place_id, competitor_place_ids
  ) values (
    p_store_id, v_measurement.keyword, v_measurement.normalized_keyword,
    v_measurement.target_place_id, v_measurement.competitor_place_ids
  )
  on conflict (store_id) do update set
    keyword = excluded.keyword,
    normalized_keyword = excluded.normalized_keyword,
    own_place_id = excluded.own_place_id,
    competitor_place_ids = excluded.competitor_place_ids;

  insert into private.meo_rank_observations (
    store_id, keyword, normalized_keyword, own_place_id, own_position,
    competitor_positions, source, observed_at, result_count,
    result_fingerprint
  ) values (
    p_store_id, v_measurement.keyword, v_measurement.normalized_keyword,
    v_measurement.target_place_id, p_position, v_canonical_competitors,
    v_measurement.credential_source, p_observed_at,
    cardinality(p_result_place_ids), md5(to_jsonb(p_result_place_ids)::text)
  ) returning * into v_observation;

  update private.meo_rank_measurements
  set status = 'completed', observation_id = v_observation.id,
      error_code = null, completed_at = statement_timestamp()
  where id = v_measurement.id;
  update private.integration_jobs
  set status = 'completed', processing_stage = null, claim_token = null,
      lease_expires_at = null, worker_id = null, last_error_code = null,
      completed_at = statement_timestamp()
  where id = p_job_id;
  update private.service_usage
  set status = 'succeeded', units = 1, completed_at = statement_timestamp()
  where operation_id = v_measurement.id and service = 'dataforseo_rank';

  insert into private.integration_receipts (
    store_id, job_id, action_type, provider, request_hash,
    provider_resource_hash, outcome, safe_metadata
  ) values (
    p_store_id, p_job_id, 'rank_measurement', 'dataforseo',
    v_measurement.request_hash, md5(v_job.provider_task_id), 'succeeded',
    jsonb_build_object(
      'observation_id', v_observation.id,
      'own_position', v_observation.own_position,
      'competitor_count', cardinality(v_measurement.competitor_place_ids),
      'result_count', v_observation.result_count,
      'credential_source', v_measurement.credential_source
    )
  );

  return jsonb_build_object(
    'id', v_observation.id,
    'keyword', v_observation.keyword,
    'target_place_id', v_observation.own_place_id,
    'position', v_observation.own_position,
    'competitor_positions', v_observation.competitor_positions,
    'source', v_observation.source,
    'observed_at', v_observation.observed_at,
    'result_count', v_observation.result_count
  );
end;
$_$;


--
-- Name: internal_meo_consume_oauth_state(uuid, uuid, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_consume_oauth_state(p_actor_id uuid, p_store_id uuid, p_provider text, p_state_hash text, p_browser_challenge text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_state private.meo_oauth_states%rowtype;
begin
  perform private.require_store_owner(p_actor_id, p_store_id);
  perform private.require_owner(p_actor_id);
  if p_provider not in ('google_business', 'instagram')
    or p_state_hash !~ '^[0-9a-f]{64}$'
    or p_browser_challenge is null
    or p_browser_challenge !~ '^[A-Za-z0-9_-]{43}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_OAUTH_STATE_INPUT';
  end if;
  if not private.meo_oauth_provider_feature_available(p_provider, statement_timestamp()) then
    raise exception using errcode = 'P0001', message = 'FEATURE_NOT_AVAILABLE';
  end if;
  update private.meo_oauth_states state
  set consumed_at = statement_timestamp()
  where state.actor_id = p_actor_id
    and state.store_id = p_store_id
    and state.provider = p_provider
    and state.state_hash = p_state_hash
    and state.browser_challenge = p_browser_challenge
    and state.consumed_at is null
    and state.expires_at > statement_timestamp()
  returning state.* into v_state;
  if not found then
    raise exception using errcode = 'P0001', message = 'OAUTH_STATE_INVALID_OR_EXPIRED';
  end if;

  return jsonb_build_object(
    'actor_id', v_state.actor_id,
    'store_id', v_state.store_id,
    'provider', v_state.provider,
    'return_path', v_state.return_path
  );
end;
$_$;


--
-- Name: internal_meo_create_oauth_state(uuid, uuid, text, text, text, text, timestamp with time zone); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_create_oauth_state(p_actor_id uuid, p_store_id uuid, p_provider text, p_state_hash text, p_browser_challenge text, p_return_path text, p_expires_at timestamp with time zone) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
begin
  perform private.require_store_owner(p_actor_id, p_store_id);
  perform private.require_owner(p_actor_id);
  if p_provider not in ('google_business', 'instagram')
    or p_state_hash !~ '^[0-9a-f]{64}$'
    or p_browser_challenge is null
    or p_browser_challenge !~ '^[A-Za-z0-9_-]{43}$'
    or p_return_path not in (
      '/dashboard/stores/' || p_store_id::text || '/connections',
      '/dashboard/stores/' || p_store_id::text || '/settings'
    )
    or p_expires_at is null
    or p_expires_at <= statement_timestamp() + interval '1 minute'
    or p_expires_at > statement_timestamp() + interval '15 minutes'
  then
    raise exception using errcode = '22023', message = 'INVALID_OAUTH_STATE_INPUT';
  end if;
  if not private.meo_oauth_provider_feature_available(p_provider, statement_timestamp()) then
    raise exception using errcode = 'P0001', message = 'FEATURE_NOT_AVAILABLE';
  end if;

  insert into private.meo_oauth_states (
    actor_id, store_id, provider, state_hash, browser_challenge, return_path, expires_at
  ) values (
    p_actor_id, p_store_id, p_provider, p_state_hash, p_browser_challenge,
    p_return_path, p_expires_at
  );
end;
$_$;


--
-- Name: internal_meo_delete_connection(uuid, uuid, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_delete_connection(p_actor_id uuid, p_store_id uuid, p_provider text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  perform private.require_store_owner(p_actor_id, p_store_id);
  if p_provider not in ('google_business', 'instagram', 'dataforseo') then
    raise exception using errcode = '22023', message = 'INVALID_EXTERNAL_PROVIDER';
  end if;

  delete from private.meo_provider_connections connection
  where connection.store_id = p_store_id and connection.provider = p_provider;

  if p_provider in ('google_business', 'instagram') then
    perform api.internal_meo_disable_instagram_automation(p_actor_id, p_store_id);
  end if;
end;
$$;


--
-- Name: internal_meo_expire_health_diagnosis_results(integer); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_expire_health_diagnosis_results(p_limit integer DEFAULT 100) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_now timestamptz := statement_timestamp();
  v_count integer := 0;
  v_manual_count integer := 0;
  v_usage private.service_usage%rowtype;
  v_diagnosis private.meo_health_diagnoses%rowtype;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'INVALID_EXPIRATION_LIMIT';
  end if;

  -- Keep the connected ledger lock order invariant: service_usage first, then
  -- meo_health_diagnoses. Provider usage evidence is never rewritten here.
  for v_usage in
    select usage.*
    from private.service_usage usage
    join private.meo_health_diagnoses diagnosis
      on diagnosis.usage_id = usage.id
    where usage.status = 'succeeded'
      and diagnosis.status = 'succeeded'
      and diagnosis.completed_at <= v_now - interval '30 days'
    order by diagnosis.completed_at, diagnosis.created_at
    for update of usage skip locked
    limit greatest((p_limit + 1) / 2, 1)
  loop
    select * into v_diagnosis
    from private.meo_health_diagnoses diagnosis
    where diagnosis.usage_id = v_usage.id
    for update;
    if not found
      or v_diagnosis.status <> 'succeeded'
      or v_diagnosis.completed_at > v_now - interval '30 days'
    then
      continue;
    end if;

    update private.meo_health_diagnoses diagnosis
    set status = 'expired',
        result_json = null,
        last_error_code = 'HEALTH_DIAGNOSIS_RESULT_EXPIRED',
        updated_at = v_now
    where diagnosis.usage_id = v_usage.id;
    v_count := v_count + 1;
  end loop;

  with candidates as (
    select diagnosis.id
    from private.meo_manual_health_diagnoses diagnosis
    where diagnosis.completed_at <= v_now - interval '30 days'
    order by diagnosis.completed_at, diagnosis.id
    -- The connected ledger is capped at ceil(p_limit / 2), so the remaining
    -- budget gives manual results a fair share on the five-minute production
    -- run without ever exceeding the caller's total bound. With p_limit = 1,
    -- the single slot intentionally goes to the connected tombstone path;
    -- the scheduled p_limit = 100 run still allocates up to 50 to each ledger.
    limit greatest(p_limit - v_count, 0)
  ), deleted as (
    delete from private.meo_manual_health_diagnoses diagnosis
    using candidates
    where diagnosis.id = candidates.id
    returning 1
  )
  select count(*)::integer into v_manual_count from deleted;

  return jsonb_build_object('expired', v_count + v_manual_count);
end;
$$;


--
-- Name: FUNCTION internal_meo_expire_health_diagnosis_results(p_limit integer); Type: COMMENT; Schema: api; Owner: -
--

COMMENT ON FUNCTION api.internal_meo_expire_health_diagnosis_results(p_limit integer) IS 'Redacts connected results and deletes manual results after 30 days within one shared per-run bound. Provider usage evidence is unchanged.';


--
-- Name: internal_meo_fail_external_action(uuid, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_fail_external_action(p_operation_id uuid, p_error_code text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_action private.meo_external_actions%rowtype;
begin
  if p_operation_id is null or p_error_code !~ '^[A-Z0-9_:-]{2,100}$' then
    raise exception using errcode = '22023', message = 'INVALID_EXTERNAL_ACTION_FAILURE';
  end if;
  update private.meo_external_actions action
  set status = 'failed', error_code = p_error_code,
      completed_at = statement_timestamp()
  where action.id = p_operation_id and action.status = 'processing'
  returning action.* into v_action;
  if not found then
    return;
  end if;
  insert into private.integration_receipts (
    store_id, action_type, provider, request_hash, outcome, safe_metadata
  ) values (
    v_action.store_id, v_action.action, 'google_business', v_action.request_hash,
    'failed', jsonb_build_object('error_code', p_error_code)
  );
end;
$_$;


--
-- Name: internal_meo_fail_rank_job(uuid, uuid, text, boolean, timestamp with time zone); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_fail_rank_job(p_job_id uuid, p_claim_token uuid, p_error_code text, p_outcome_ambiguous boolean DEFAULT true, p_retry_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from private.integration_jobs job
    where job.id = p_job_id and job.job_type = 'rank_measurement'
      and job.status = 'processing' and job.claim_token = p_claim_token
      and job.lease_expires_at > statement_timestamp()
  ) then
    raise exception using errcode = 'P0001', message = 'WORKER_CLAIM_INVALID_OR_EXPIRED';
  end if;
  perform api.internal_meo_fail_rank_measurement(
    p_job_id, p_error_code, p_outcome_ambiguous, p_retry_at
  );
end;
$$;


--
-- Name: internal_meo_fail_rank_measurement(uuid, text, boolean, timestamp with time zone); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_fail_rank_measurement(p_job_id uuid, p_error_code text, p_outcome_ambiguous boolean DEFAULT true, p_retry_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_job private.integration_jobs%rowtype;
  v_measurement private.meo_rank_measurements%rowtype;
  v_job_status text;
  v_measurement_status text;
  v_usage_status text;
  v_outcome text;
begin
  if p_job_id is null
    or p_error_code !~ '^[A-Z0-9_:-]{2,100}$'
    or p_outcome_ambiguous is null
    or (p_retry_at is not null and p_retry_at <= statement_timestamp())
  then
    raise exception using errcode = '22023', message = 'INVALID_RANK_FAILURE';
  end if;
  select * into v_job
  from private.integration_jobs job where job.id = p_job_id for update;
  if not found then return; end if;
  select * into v_measurement
  from private.meo_rank_measurements measurement
  where measurement.job_id = p_job_id for update;
  if not found then return; end if;
  if v_measurement.status in ('completed', 'denied') then return; end if;

  if p_outcome_ambiguous then
    v_job_status := 'attention_required';
    v_measurement_status := 'attention_required';
    v_usage_status := 'attention_required';
    v_outcome := 'attention_required';
  elsif p_retry_at is not null and v_job.attempt_count < v_job.max_attempts then
    v_job_status := case when v_job.provider_task_id is null then 'retry_scheduled' else 'provider_submitted' end;
    v_measurement_status := case when v_job.provider_task_id is null then 'reserved' else 'submitted' end;
    v_usage_status := 'reserved';
    v_outcome := 'failed';
  else
    v_job_status := 'dead_letter';
    v_measurement_status := 'dead_letter';
    v_usage_status := 'failed';
    v_outcome := 'failed';
  end if;

  update private.integration_jobs
  set status = v_job_status,
      processing_stage = null,
      claim_token = null,
      lease_expires_at = null,
      worker_id = null,
      available_at = coalesce(p_retry_at, available_at),
      last_error_code = p_error_code,
      completed_at = case when v_job_status in ('attention_required', 'dead_letter')
        then statement_timestamp() else null end
  where id = p_job_id;
  update private.meo_rank_measurements
  set status = v_measurement_status, error_code = p_error_code,
      completed_at = case when v_measurement_status in ('attention_required', 'dead_letter')
        then statement_timestamp() else null end
  where id = v_measurement.id;
  update private.service_usage
  set status = v_usage_status,
      units = case
        when v_job.provider_task_id is null and v_usage_status = 'failed' then 0
        else units
      end,
      completed_at = case when v_usage_status in ('failed', 'attention_required')
        then statement_timestamp() else null end
  where operation_id = v_measurement.id and service = 'dataforseo_rank';

  if v_job_status <> 'retry_scheduled' and v_job_status <> 'provider_submitted' then
    insert into private.integration_receipts (
      store_id, job_id, action_type, provider, request_hash,
      provider_resource_hash, outcome, safe_metadata
    ) values (
      v_measurement.store_id, p_job_id, 'rank_measurement', 'dataforseo',
      v_measurement.request_hash,
      case when v_job.provider_task_id is null then null else md5(v_job.provider_task_id) end,
      v_outcome,
      jsonb_build_object(
        'error_code', p_error_code,
        'outcome_ambiguous', p_outcome_ambiguous,
        'attempt_count', v_job.attempt_count
      )
    );
  end if;
end;
$_$;


--
-- Name: internal_meo_get_connection(uuid, uuid, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_get_connection(p_actor_id uuid, p_store_id uuid, p_provider text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_connection private.meo_provider_connections%rowtype;
  v_access jsonb;
begin
  v_access := api.internal_zero_meo_workspace_authorize(p_actor_id, p_store_id);
  if v_access ->> 'role' not in ('owner', 'admin', 'editor') then
    raise exception using errcode = 'P0001', message = 'STORE_OPERATOR_REQUIRED';
  end if;
  if p_provider not in ('google_business', 'instagram', 'dataforseo') then
    raise exception using errcode = '22023', message = 'INVALID_EXTERNAL_PROVIDER';
  end if;
  select * into v_connection
  from private.meo_provider_connections connection
  where connection.store_id = p_store_id and connection.provider = p_provider;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'provider', v_connection.provider,
    'status', v_connection.status,
    'credential_ciphertext', v_connection.credential_ciphertext,
    'credential_iv', v_connection.credential_iv,
    'key_version', v_connection.key_version,
    'expires_at', v_connection.expires_at,
    'external_account_id', v_connection.external_account_id,
    'location_name', v_connection.location_name,
    'display_name', v_connection.display_name
  );
end;
$$;


--
-- Name: internal_meo_get_connections(uuid, uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_get_connections(p_actor_id uuid, p_store_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_result jsonb;
begin
  perform private.require_store_owner(p_actor_id, p_store_id);
  select coalesce(
    jsonb_agg(private.meo_public_connection_json(connection) order by connection.provider),
    '[]'::jsonb
  ) into v_result
  from private.meo_provider_connections connection
  where connection.store_id = p_store_id;
  return v_result;
end;
$$;


--
-- Name: internal_meo_get_external_write_settings(uuid, uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_get_external_write_settings(p_actor_id uuid, p_store_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_access jsonb;
  v_enabled boolean;
begin
  v_access := api.internal_zero_meo_workspace_authorize(p_actor_id, p_store_id);
  select workspace.external_writes_enabled into strict v_enabled
  from private.zero_meo_store_workspaces workspace
  where workspace.store_id = p_store_id;
  return jsonb_build_object(
    'enabled', v_enabled,
    'can_manage', v_access ->> 'role' in ('owner', 'admin'),
    'can_execute', v_access ->> 'role' in ('owner', 'admin', 'editor')
  );
end;
$$;


--
-- Name: internal_meo_get_latest_health_result(uuid, uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_get_latest_health_result(p_actor_id uuid, p_store_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_now timestamptz := statement_timestamp();
  v_result jsonb;
begin
  -- Reads use the same DB-authoritative owner and rollout boundary as
  -- writes. Expired rows are filtered even if cron cleanup is delayed.
  perform api.internal_require_zero_feature(
    p_actor_id, p_store_id, 'gbp_health', v_now
  );

  select candidate.payload into v_result
  from (
    select diagnosis.completed_at,
      diagnosis.operation_id::text as tie_breaker,
      jsonb_build_object(
        'source', 'google_business',
        'diagnosedAt', diagnosis.completed_at,
        'result', diagnosis.result_json
      ) as payload
    from private.meo_health_diagnoses diagnosis
    where diagnosis.store_id = p_store_id
      and diagnosis.status = 'succeeded'
      and diagnosis.result_json is not null
      and diagnosis.completed_at > v_now - interval '30 days'
    union all
    select diagnosis.completed_at,
      diagnosis.id::text as tie_breaker,
      jsonb_build_object(
        'source', 'manual',
        'diagnosedAt', diagnosis.completed_at,
        'result', diagnosis.result_json
      ) as payload
    from private.meo_manual_health_diagnoses diagnosis
    where diagnosis.store_id = p_store_id
      and diagnosis.completed_at > v_now - interval '30 days'
  ) candidate
  order by candidate.completed_at desc, candidate.tie_breaker desc
  limit 1;

  return v_result;
end;
$$;


--
-- Name: FUNCTION internal_meo_get_latest_health_result(p_actor_id uuid, p_store_id uuid); Type: COMMENT; Schema: api; Owner: -
--

COMMENT ON FUNCTION api.internal_meo_get_latest_health_result(p_actor_id uuid, p_store_id uuid) IS 'Returns the newest unexpired bounded GBP diagnosis across connected and manual ledgers after DB-authoritative access checks.';


--
-- Name: internal_meo_insight_history(uuid, uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_insight_history(p_actor_id uuid, p_store_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_result jsonb;
begin
  perform api.internal_require_zero_feature(
    p_actor_id, p_store_id, 'gbp_insights', statement_timestamp()
  );
  select coalesce(jsonb_agg(item.row_json order by item.period_end desc, item.period_start desc), '[]'::jsonb)
  into v_result
  from (
    select snapshot.period_end, snapshot.period_start,
      jsonb_build_object(
        'id', snapshot.id,
        'period_start', snapshot.period_start,
        'period_end', snapshot.period_end,
        'source', snapshot.source,
        'metrics', snapshot.metrics,
        'updated_at', snapshot.updated_at
      ) as row_json
    from private.meo_insight_snapshots snapshot
    where snapshot.store_id = p_store_id
    order by snapshot.period_end desc, snapshot.period_start desc
    limit 104
  ) item;
  return v_result;
end;
$$;


--
-- Name: internal_meo_mark_rank_submitted(uuid, uuid, uuid, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_mark_rank_submitted(p_job_id uuid, p_actor_id uuid, p_store_id uuid, p_provider_task_id text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_job private.integration_jobs%rowtype;
  v_measurement private.meo_rank_measurements%rowtype;
  v_feature jsonb;
begin
  v_feature := api.internal_require_zero_feature(
    p_actor_id, p_store_id, 'meo_rank', statement_timestamp()
  );
  if p_job_id is null
    or p_provider_task_id is null
    or char_length(p_provider_task_id) not between 1 and 200
    or p_provider_task_id !~ '^[A-Za-z0-9._:@/-]+$'
  then
    raise exception using errcode = '22023', message = 'INVALID_RANK_SUBMISSION';
  end if;

  select * into v_job
  from private.integration_jobs job
  where job.id = p_job_id and job.store_id = p_store_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'RANK_JOB_NOT_FOUND';
  end if;
  select * into v_measurement
  from private.meo_rank_measurements measurement
  where measurement.job_id = p_job_id and measurement.store_id = p_store_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'RANK_MEASUREMENT_NOT_FOUND';
  end if;
  if v_feature ->> 'execution_mode' is distinct from v_measurement.credential_source then
    raise exception using errcode = 'P0001', message = 'FEATURE_EXECUTION_MODE_MISMATCH';
  end if;

  if v_job.status = 'provider_submitted' and v_job.provider_task_id = p_provider_task_id then
    return jsonb_build_object(
      'job_id', v_job.id, 'status', v_job.status,
      'attempt_count', v_job.attempt_count, 'next_check_at', v_job.available_at
    );
  end if;
  if not (
    v_job.status = 'queued'
    or (v_job.status = 'processing' and v_job.processing_stage = 'submit')
  ) then
    raise exception using errcode = 'P0001', message = 'RANK_JOB_NOT_IN_SUBMIT_STAGE';
  end if;

  update private.integration_jobs job
  set status = 'provider_submitted',
      processing_stage = null,
      claim_token = null,
      lease_expires_at = null,
      worker_id = null,
      provider_task_id = p_provider_task_id,
      available_at = statement_timestamp() + interval '15 seconds',
      last_error_code = null
  where job.id = p_job_id
  returning job.* into v_job;

  update private.meo_rank_measurements
  set status = 'submitted', error_code = null
  where id = v_measurement.id;

  return jsonb_build_object(
    'job_id', v_job.id,
    'status', v_job.status,
    'attempt_count', v_job.attempt_count,
    'next_check_at', v_job.available_at
  );
end;
$_$;


--
-- Name: internal_meo_prepare_oauth_callback(text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_prepare_oauth_callback(p_provider text, p_state_hash text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $_$
declare
  v_state private.meo_oauth_states%rowtype;
begin
  if p_provider not in ('google_business', 'instagram')
    or p_state_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_OAUTH_STATE_INPUT';
  end if;
  select * into v_state
  from private.meo_oauth_states state
  where state.provider = p_provider
    and state.state_hash = p_state_hash
    and state.consumed_at is null
    and state.expires_at > statement_timestamp();
  if not found then
    raise exception using errcode = 'P0001', message = 'OAUTH_STATE_INVALID_OR_EXPIRED';
  end if;
  perform private.require_owner(v_state.actor_id);
  if not private.meo_oauth_provider_feature_available(p_provider, statement_timestamp()) then
    raise exception using errcode = 'P0001', message = 'FEATURE_NOT_AVAILABLE';
  end if;
  return jsonb_build_object(
    'store_id', v_state.store_id,
    'return_path', v_state.return_path
  );
end;
$_$;


--
-- Name: internal_meo_rank_history(uuid, uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_rank_history(p_actor_id uuid, p_store_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_result jsonb;
begin
  perform api.internal_require_zero_feature(
    p_actor_id, p_store_id, 'meo_rank', statement_timestamp()
  );
  select coalesce(jsonb_agg(history.row_json order by history.observed_at desc, history.id desc), '[]'::jsonb)
  into v_result
  from (
    select observation.id, observation.observed_at,
      jsonb_build_object(
        'id', observation.id,
        'keyword', observation.keyword,
        'target_place_id', observation.own_place_id,
        'position', observation.own_position,
        'competitor_positions', observation.competitor_positions,
        'source', observation.source,
        'observed_at', observation.observed_at,
        'result_count', observation.result_count
      ) as row_json
    from private.meo_rank_observations observation
    join private.meo_rank_targets target on target.store_id = observation.store_id
      and target.normalized_keyword = observation.normalized_keyword
      and target.own_place_id = observation.own_place_id
    where observation.store_id = p_store_id
      and observation.observed_at >= statement_timestamp() - interval '30 days'
    order by observation.observed_at desc, observation.id desc
    limit 100
  ) history;
  return v_result;
end;
$$;


--
-- Name: internal_meo_reconcile_stale_external_actions(integer); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_reconcile_stale_external_actions(p_limit integer DEFAULT 100) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_reconciled integer;
begin
  if p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_RECONCILE_LIMIT';
  end if;
  with candidates as materialized (
    select action.id
    from private.meo_external_actions action
    where action.status = 'processing'
      and action.created_at < statement_timestamp() - interval '10 minutes'
    order by action.created_at, action.id
    for update skip locked
    limit p_limit
  ), updated as (
    update private.meo_external_actions action
    set status = 'attention_required',
        error_code = 'EXTERNAL_ACTION_STALE_PROCESSING',
        completed_at = statement_timestamp()
    from candidates
    where action.id = candidates.id
    returning action.*
  ), receipts as (
    insert into private.integration_receipts (
      store_id, action_type, provider, request_hash, outcome, safe_metadata
    )
    select action.store_id, action.action, 'google_business',
      action.request_hash, 'attention_required', jsonb_build_object(
        'operation_id', action.id,
        'error_code', 'EXTERNAL_ACTION_STALE_PROCESSING'
      )
    from updated action
    where not exists (
      select 1 from private.integration_receipts receipt
      where receipt.store_id = action.store_id
        and receipt.action_type = action.action
        and receipt.request_hash = action.request_hash
        and receipt.outcome = 'attention_required'
    )
    returning 1
  )
  select count(*)::integer into v_reconciled from updated;
  return jsonb_build_object('reconciled', v_reconciled);
end;
$$;


--
-- Name: internal_meo_reconcile_stale_health_diagnoses(integer); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_reconcile_stale_health_diagnoses(p_limit integer DEFAULT 100) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_now timestamptz := statement_timestamp();
  v_count integer;
  v_usage private.service_usage%rowtype;
  v_diagnosis private.meo_health_diagnoses%rowtype;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'INVALID_RECONCILIATION_LIMIT';
  end if;
  v_count := 0;
  for v_usage in
    select usage.*
    from private.service_usage usage
    join private.meo_health_diagnoses diagnosis
      on diagnosis.usage_id = usage.id
    where diagnosis.status = 'processing'
      and diagnosis.lease_expires_at <= v_now
    order by diagnosis.lease_expires_at, diagnosis.created_at
    for update of usage skip locked
    limit p_limit
  loop
    select * into v_diagnosis
    from private.meo_health_diagnoses diagnosis
    where diagnosis.usage_id = v_usage.id
    for update;
    if not found
      or v_diagnosis.status <> 'processing'
      or v_diagnosis.lease_expires_at > v_now
    then
      continue;
    end if;

    update private.meo_health_diagnoses diagnosis
    set status = 'attention_required',
        last_error_code = 'HEALTH_DIAGNOSIS_LEASE_EXPIRED',
        completed_at = v_now,
        updated_at = v_now
    where diagnosis.usage_id = v_usage.id;
    update private.service_usage usage
    set status = 'attention_required',
        last_error_code = 'HEALTH_DIAGNOSIS_LEASE_EXPIRED',
        completed_at = v_now
    where usage.id = v_usage.id and usage.status = 'reserved';
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('reconciled', v_count);
end;
$$;


--
-- Name: FUNCTION internal_meo_reconcile_stale_health_diagnoses(p_limit integer); Type: COMMENT; Schema: api; Owner: -
--

COMMENT ON FUNCTION api.internal_meo_reconcile_stale_health_diagnoses(p_limit integer) IS 'Quarantines expired processing diagnoses and reserved usage as attention_required without retrying Google.';


--
-- Name: internal_meo_reconcile_stale_rank_submissions(integer); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_reconcile_stale_rank_submissions(p_limit integer DEFAULT 100) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_candidate record;
  v_reconciled integer := 0;
begin
  if p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_RECONCILE_LIMIT';
  end if;
  for v_candidate in
    select job.id as job_id, job.store_id, measurement.id as measurement_id,
      measurement.request_hash
    from private.integration_jobs job
    join private.meo_rank_measurements measurement on measurement.job_id = job.id
    where job.job_type = 'rank_measurement'
      and measurement.status = 'reserved'
      and (
        (
          job.status = 'queued'
          and job.created_at < statement_timestamp() - interval '10 minutes'
        )
        or (
          job.status = 'processing'
          and job.processing_stage = 'submit'
          and job.lease_expires_at <= statement_timestamp()
        )
      )
    order by job.created_at, job.id
    limit p_limit
    for update of job, measurement skip locked
  loop
    update private.integration_jobs job
    set status = 'attention_required',
        processing_stage = null,
        claim_token = null,
        lease_expires_at = null,
        worker_id = null,
        last_error_code = 'RANK_SUBMISSION_OUTCOME_UNKNOWN',
        completed_at = statement_timestamp()
    where job.id = v_candidate.job_id;
    update private.meo_rank_measurements measurement
    set status = 'attention_required',
        error_code = 'RANK_SUBMISSION_OUTCOME_UNKNOWN',
        completed_at = statement_timestamp()
    where measurement.id = v_candidate.measurement_id;
    update private.service_usage usage
    set status = 'attention_required',
        last_error_code = 'RANK_SUBMISSION_OUTCOME_UNKNOWN',
        completed_at = statement_timestamp()
    where usage.operation_id = v_candidate.measurement_id
      and usage.service = 'dataforseo_rank'
      and usage.status = 'reserved';
    insert into private.integration_receipts (
      store_id, job_id, action_type, provider, request_hash,
      outcome, safe_metadata
    )
    select v_candidate.store_id, v_candidate.job_id, 'rank_measurement',
      'dataforseo', v_candidate.request_hash, 'attention_required',
      jsonb_build_object(
        'measurement_id', v_candidate.measurement_id,
        'error_code', 'RANK_SUBMISSION_OUTCOME_UNKNOWN'
      )
    where not exists (
      select 1 from private.integration_receipts receipt
      where receipt.job_id = v_candidate.job_id
        and receipt.action_type = 'rank_measurement'
        and receipt.request_hash = v_candidate.request_hash
        and receipt.outcome = 'attention_required'
    );
    v_reconciled := v_reconciled + 1;
  end loop;
  return jsonb_build_object('reconciled', v_reconciled);
end;
$$;


--
-- Name: internal_meo_refresh_connection(uuid, uuid, text, text, text, smallint, timestamp with time zone); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_refresh_connection(p_actor_id uuid, p_store_id uuid, p_provider text, p_credential_ciphertext text, p_credential_iv text, p_key_version smallint, p_expires_at timestamp with time zone) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_updated integer;
  v_access jsonb;
begin
  v_access := api.internal_zero_meo_workspace_authorize(p_actor_id, p_store_id);
  if v_access ->> 'role' not in ('owner', 'admin', 'editor') then
    raise exception using errcode = 'P0001', message = 'STORE_OPERATOR_REQUIRED';
  end if;
  if p_provider not in ('google_business', 'instagram')
    or p_credential_ciphertext is null
    or char_length(p_credential_ciphertext) not between 24 and 32768
    or p_credential_iv is null
    or char_length(p_credential_iv) not between 16 and 64
    or p_key_version is null or p_key_version <= 0
    or p_expires_at is null or p_expires_at <= statement_timestamp()
  then
    raise exception using errcode = '22023', message = 'INVALID_EXTERNAL_CONNECTION';
  end if;
  update private.meo_provider_connections connection
  set credential_ciphertext = p_credential_ciphertext,
      credential_iv = p_credential_iv,
      key_version = p_key_version,
      expires_at = p_expires_at,
      status = 'active',
      last_error_code = null
  where connection.store_id = p_store_id and connection.provider = p_provider;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception using errcode = 'P0001', message = 'EXTERNAL_CONNECTION_NOT_FOUND';
  end if;
end;
$$;


--
-- Name: internal_meo_reserve_ai_draft(uuid, uuid, text, text, integer, integer, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_reserve_ai_draft(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_daily_store_limit integer, p_daily_global_limit integer, p_credential_source text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_usage_date date := (statement_timestamp() at time zone 'Asia/Tokyo')::date;
  v_existing private.meo_ai_draft_reservations%rowtype;
  v_store_used integer;
  v_global_used integer;
  v_id uuid := gen_random_uuid();
  v_feature jsonb;
  v_denial_code text;
  v_denial_count integer;
begin
  v_feature := api.internal_require_zero_feature(
    p_actor_id, p_store_id, 'review_reply', statement_timestamp()
  );
  if p_key_hash !~ '^[0-9a-f]{64}$'
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_daily_store_limit not between 1 and 1000
    or p_daily_global_limit not between 1 and 1000000
    or p_credential_source <> 'owner_provider'
  then
    raise exception using errcode = '22023', message = 'INVALID_AI_DRAFT_RESERVATION';
  end if;
  if v_feature ->> 'execution_mode' is distinct from p_credential_source then
    raise exception using errcode = 'P0001', message = 'FEATURE_EXECUTION_MODE_MISMATCH';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'meo-ai-draft-idempotency:' || p_store_id::text || ':' || p_key_hash, 0
  ));
  select * into v_existing
  from private.meo_ai_draft_reservations reservation
  where reservation.store_id = p_store_id and reservation.key_hash = p_key_hash;
  if found then
    if v_existing.request_hash <> p_request_hash
      or v_existing.credential_source <> p_credential_source
    then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_PAYLOAD_CONFLICT';
    end if;
    return jsonb_build_object(
      'reservation_id', v_existing.id,
      'authorized', v_existing.status in ('reserved', 'succeeded'),
      'replayed', true,
      'status', v_existing.status,
      'usage_date', v_existing.usage_date,
      'credential_source', v_existing.credential_source,
      'result_json', v_existing.result_json
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'meo-ai-draft-owner-provider:' || v_usage_date::text, 0
  ));
  select count(*)::integer into v_store_used
  from private.meo_ai_draft_reservations reservation
  where reservation.store_id = p_store_id
    and reservation.usage_date = v_usage_date
    and reservation.credential_source = 'owner_provider'
    and reservation.status in ('reserved', 'succeeded', 'failed');
  select count(*)::integer into v_global_used
  from private.meo_ai_draft_reservations reservation
  where reservation.usage_date = v_usage_date
    and reservation.credential_source = 'owner_provider'
    and reservation.status in ('reserved', 'succeeded', 'failed');
  v_denial_code := case
    when v_store_used >= p_daily_store_limit then 'AI_DRAFT_STORE_DAILY_LIMIT'
    when v_global_used >= p_daily_global_limit then 'AI_DRAFT_GLOBAL_DAILY_LIMIT'
    else null
  end;
  if v_denial_code is not null then
    insert into private.meo_ai_draft_reservations as reservation (
      id, store_id, key_hash, request_hash, usage_date, credential_source,
      status, error_code, denial_count
    ) values (
      v_id, p_store_id, null, null, v_usage_date,
      'owner_provider', 'denied', v_denial_code, 1
    )
    on conflict (store_id, usage_date, credential_source, error_code)
      where status = 'denied'
    do update set denial_count = least(1000000000, reservation.denial_count + 1)
    returning reservation.id, reservation.denial_count into v_id, v_denial_count;
    return jsonb_build_object(
      'reservation_id', v_id, 'authorized', false, 'replayed', false,
      'status', 'denied', 'usage_date', v_usage_date,
      'credential_source', 'owner_provider',
      'denial_code', v_denial_code, 'denial_count', v_denial_count
    );
  end if;

  insert into private.meo_ai_draft_reservations (
    id, store_id, key_hash, request_hash, usage_date, credential_source, status
  ) values (
    v_id, p_store_id, p_key_hash, p_request_hash, v_usage_date,
    'owner_provider', 'reserved'
  );
  return jsonb_build_object(
    'reservation_id', v_id, 'authorized', true, 'replayed', false,
    'status', 'reserved', 'usage_date', v_usage_date,
    'credential_source', 'owner_provider'
  );
end;
$_$;


--
-- Name: internal_meo_reserve_provider_call(uuid, uuid, text, text, text, text, text, integer, integer, integer, integer, integer); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_reserve_provider_call(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_service text, p_operation text, p_credential_source text, p_window_seconds integer, p_store_window_limit integer, p_global_window_limit integer, p_store_daily_limit integer, p_global_daily_limit integer) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_now timestamptz := statement_timestamp();
  v_usage_date date := (statement_timestamp() at time zone 'Asia/Tokyo')::date;
  v_window_started_at timestamptz;
  v_existing private.service_usage%rowtype;
  v_store_window_used integer;
  v_global_window_used integer;
  v_store_daily_used integer;
  v_global_daily_used integer;
  v_denial_code text;
  v_id uuid := gen_random_uuid();
  v_denial_count integer;
  v_access jsonb;
begin
  v_access := api.internal_zero_meo_workspace_authorize(p_actor_id, p_store_id);
  if v_access ->> 'role' not in ('owner', 'admin', 'editor') then
    raise exception using errcode = 'P0001', message = 'STORE_OPERATOR_REQUIRED';
  end if;
  if p_key_hash !~ '^[0-9a-f]{64}$'
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_service not in (
      'dataforseo_api', 'google_business_api', 'instagram_graph_api'
    )
    or p_operation not in (
      'google_oauth_start', 'instagram_oauth_start',
      'google_oauth_exchange', 'instagram_oauth_exchange',
      'google_reviews_list', 'google_review_reply_write',
      'google_locations_list', 'google_insights_sync', 'google_health_read',
      'instagram_media_list', 'google_post_write',
      'dataforseo_credential_validate'
    )
    or (p_service = 'google_business_api' and p_operation not like 'google_%')
    or (p_service = 'instagram_graph_api' and p_operation not like 'instagram_%')
    or (
      p_service = 'dataforseo_api'
      and p_operation <> 'dataforseo_credential_validate'
    )
    or p_credential_source not in ('native', 'owner_provider')
    or p_window_seconds not between 60 and 3600
    or p_store_window_limit not between 1 and 1000000
    or p_global_window_limit not between 1 and 1000000
    or p_store_daily_limit not between 1 and 1000000
    or p_global_daily_limit not between 1 and 1000000
  then
    raise exception using errcode = '22023', message = 'INVALID_PROVIDER_CALL_RESERVATION';
  end if;
  v_window_started_at := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'meo-provider-call-idempotency:' || p_store_id::text || ':'
      || p_service || ':' || p_operation || ':' || p_key_hash,
    0
  ));
  select * into v_existing
  from private.service_usage usage
  where usage.store_id = p_store_id
    and usage.service = p_service
    and usage.operation = p_operation
    and usage.key_hash = p_key_hash;
  if found then
    if v_existing.request_hash <> p_request_hash
      or v_existing.credential_source <> p_credential_source
    then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_PAYLOAD_CONFLICT';
    end if;
    return jsonb_build_object(
      'reservation_id', v_existing.operation_id,
      'authorized', v_existing.status <> 'denied',
      'replayed', true,
      'status', v_existing.status,
      'denial_code', v_existing.last_error_code,
      'usage_date', v_existing.usage_date,
      'window_started_at', v_existing.window_started_at
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'meo-provider-call-quota:' || p_service || ':' || p_operation || ':'
      || p_credential_source || ':' || v_usage_date::text,
    0
  ));
  select count(*)::integer into v_store_window_used
  from private.service_usage usage
  where usage.store_id = p_store_id
    and usage.service = p_service
    and usage.operation = p_operation
    and usage.credential_source = p_credential_source
    and usage.window_started_at = v_window_started_at
    and usage.status in ('reserved', 'succeeded', 'failed', 'attention_required')
    and usage.units > 0;
  select count(*)::integer into v_global_window_used
  from private.service_usage usage
  where usage.service = p_service
    and usage.operation = p_operation
    and usage.credential_source = p_credential_source
    and usage.window_started_at = v_window_started_at
    and usage.status in ('reserved', 'succeeded', 'failed', 'attention_required')
    and usage.units > 0;
  select count(*)::integer into v_store_daily_used
  from private.service_usage usage
  where usage.store_id = p_store_id
    and usage.service = p_service
    and usage.operation = p_operation
    and usage.credential_source = p_credential_source
    and usage.usage_date = v_usage_date
    and usage.status in ('reserved', 'succeeded', 'failed', 'attention_required')
    and usage.units > 0;
  select count(*)::integer into v_global_daily_used
  from private.service_usage usage
  where usage.service = p_service
    and usage.operation = p_operation
    and usage.credential_source = p_credential_source
    and usage.usage_date = v_usage_date
    and usage.status in ('reserved', 'succeeded', 'failed', 'attention_required')
    and usage.units > 0;

  v_denial_code := case
    when v_store_window_used >= p_store_window_limit then 'PROVIDER_STORE_WINDOW_LIMIT'
    when v_global_window_used >= p_global_window_limit then 'PROVIDER_GLOBAL_WINDOW_LIMIT'
    when v_store_daily_used >= p_store_daily_limit then 'PROVIDER_STORE_DAILY_LIMIT'
    when v_global_daily_used >= p_global_daily_limit then 'PROVIDER_GLOBAL_DAILY_LIMIT'
    else null
  end;
  if v_denial_code is not null then
    insert into private.service_usage as usage (
      store_id, operation_id, service, operation, usage_unit, units,
      credential_source, status, key_hash, request_hash, window_started_at,
      usage_date, last_error_code, denial_count, completed_at
    ) values (
      p_store_id, v_id, p_service, p_operation, 'provider_call', 0,
      p_credential_source, 'denied', null, null, v_window_started_at,
      v_usage_date, v_denial_code, 1, v_now
    )
    on conflict (
      store_id, service, operation, credential_source,
      window_started_at, last_error_code
    ) where status = 'denied'
    do update set
      denial_count = least(1000000000, usage.denial_count + 1),
      completed_at = excluded.completed_at
    returning usage.operation_id, usage.denial_count
      into v_id, v_denial_count;
  else
    -- Only calls that may reach a provider receive a durable idempotency row.
    insert into private.service_usage (
      store_id, operation_id, service, operation, usage_unit, units,
      credential_source, status, key_hash, request_hash, window_started_at,
      usage_date
    ) values (
      p_store_id, v_id, p_service, p_operation, 'provider_call', 1,
      p_credential_source, 'reserved', p_key_hash, p_request_hash,
      v_window_started_at, v_usage_date
    );
  end if;
  return jsonb_build_object(
    'reservation_id', v_id,
    'authorized', v_denial_code is null,
    'replayed', false,
    'status', case when v_denial_code is null then 'reserved' else 'denied' end,
    'denial_code', v_denial_code,
    'denial_count', case when v_denial_code is null then 0 else v_denial_count end,
    'usage_date', v_usage_date,
    'window_started_at', v_window_started_at
  );
end;
$_$;


--
-- Name: internal_meo_reserve_rank_measurement(uuid, uuid, text, text, text, text, text[], integer, text, text, integer, integer, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_reserve_rank_measurement(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_keyword text, p_target_place_id text, p_competitor_place_ids text[] DEFAULT '{}'::text[], p_location_code integer DEFAULT NULL::integer, p_language_code text DEFAULT 'ja'::text, p_device text DEFAULT 'desktop'::text, p_store_daily_limit integer DEFAULT 1, p_global_daily_limit integer DEFAULT 1000, p_credential_source text DEFAULT 'owner_provider'::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_keyword text := regexp_replace(btrim(p_keyword), '[[:space:]]+', ' ', 'g');
  v_normalized text;
  v_usage_date date := (statement_timestamp() at time zone 'Asia/Tokyo')::date;
  v_measurement private.meo_rank_measurements%rowtype;
  v_target private.meo_rank_targets%rowtype;
  v_store_used integer;
  v_global_used integer;
  v_job_id uuid := gen_random_uuid();
  v_measurement_id uuid := gen_random_uuid();
  v_result jsonb;
  v_feature jsonb;
  v_denial_code text;
  v_denial_id uuid;
  v_denial_count integer;
begin
  v_feature := api.internal_require_zero_feature(
    p_actor_id, p_store_id, 'meo_rank', statement_timestamp()
  );
  v_normalized := lower(v_keyword);
  if p_key_hash !~ '^[0-9a-f]{64}$'
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or char_length(v_keyword) not between 1 and 120
    or p_target_place_id !~ '^[A-Za-z0-9_-]{10,255}$'
    or not private.meo_place_ids_are_valid(p_competitor_place_ids, 3)
    or p_target_place_id = any(p_competitor_place_ids)
    or (p_location_code is not null and p_location_code <= 0)
    or p_language_code !~ '^[a-z]{2}(-[A-Z]{2})?$'
    or p_device not in ('mobile', 'desktop')
    or p_store_daily_limit not between 1 and 1000
    or p_global_daily_limit not between 1 and 1000000
    or p_credential_source <> 'owner_provider'
  then
    raise exception using errcode = '22023', message = 'INVALID_RANK_MEASUREMENT';
  end if;
  if v_feature ->> 'execution_mode' is distinct from p_credential_source then
    raise exception using errcode = 'P0001', message = 'FEATURE_EXECUTION_MODE_MISMATCH';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'meo-rank-idempotency:' || p_store_id::text || ':' || p_key_hash, 0
  ));

  select * into v_measurement
  from private.meo_rank_measurements measurement
  where measurement.store_id = p_store_id and measurement.key_hash = p_key_hash;
  if found then
    if v_measurement.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_PAYLOAD_CONFLICT';
    end if;
    if v_measurement.status = 'completed' then
      select jsonb_build_object(
        'id', observation.id,
        'keyword', observation.keyword,
        'target_place_id', observation.own_place_id,
        'position', observation.own_position,
        'competitor_positions', observation.competitor_positions,
        'source', observation.source,
        'observed_at', observation.observed_at,
        'result_count', observation.result_count
      ) into v_result
      from private.meo_rank_observations observation
      where observation.id = v_measurement.observation_id;
      return jsonb_build_object(
        'replayed', true, 'authorized', true,
        'dispatch_authorized', false,
        'reservation_id', v_measurement.id,
        'job_id', v_measurement.job_id,
        'status', 'completed',
        'result_json', v_result
      );
    elsif v_measurement.status = 'denied' then
      return jsonb_build_object(
        'replayed', true, 'authorized', false,
        'dispatch_authorized', false,
        'reservation_id', v_measurement.id, 'job_id', null
      );
    end if;
    return jsonb_build_object(
      'replayed', true,
      'authorized', v_measurement.status not in ('failed', 'attention_required', 'dead_letter'),
      'dispatch_authorized', false,
      'reservation_id', v_measurement.id,
      'job_id', v_measurement.job_id,
      'status', v_measurement.status
    );
  end if;

  select * into v_target
  from private.meo_rank_targets target
  where target.store_id = p_store_id;
  if found and (
    v_target.normalized_keyword <> v_normalized
    or v_target.own_place_id <> p_target_place_id
  ) then
    raise exception using errcode = 'P0001', message = 'FREE_RANK_KEYWORD_LIMIT_REACHED';
  end if;

  if p_credential_source = 'owner_provider' then
    perform pg_advisory_xact_lock(hashtextextended(
      'meo-rank-owner-provider:' || v_usage_date::text, 0
    ));
    select count(*)::integer into v_store_used
    from private.service_usage usage
    where usage.store_id = p_store_id
      and usage.service = 'dataforseo_rank'
      and usage.usage_unit = 'rank_serp_page'
      and usage.credential_source = 'owner_provider'
      and usage.usage_date = v_usage_date
      and usage.status in ('reserved', 'succeeded', 'failed', 'attention_required')
      and usage.units > 0;
    select count(*)::integer into v_global_used
    from private.service_usage usage
    where usage.service = 'dataforseo_rank'
      and usage.usage_unit = 'rank_serp_page'
      and usage.credential_source = 'owner_provider'
      and usage.usage_date = v_usage_date
      and usage.status in ('reserved', 'succeeded', 'failed', 'attention_required')
      and usage.units > 0;

    v_denial_code := case
      when v_store_used >= p_store_daily_limit then 'RANK_STORE_DAILY_LIMIT'
      when v_global_used >= p_global_daily_limit then 'RANK_GLOBAL_DAILY_LIMIT'
      else null
    end;
    if v_denial_code is not null then
      insert into private.service_usage as usage (
        store_id, operation_id, service, operation, usage_unit, units,
        credential_source, status, window_started_at, usage_date,
        last_error_code, denial_count, completed_at
      ) values (
        p_store_id, gen_random_uuid(), 'dataforseo_rank',
        'rank_measurement', 'rank_serp_page', 0, p_credential_source,
        'denied', (v_usage_date::timestamp at time zone 'Asia/Tokyo'),
        v_usage_date, v_denial_code, 1, statement_timestamp()
      )
      on conflict (
        store_id, service, operation, credential_source,
        window_started_at, last_error_code
      ) where status = 'denied'
      do update set
        denial_count = least(1000000000, usage.denial_count + 1),
        completed_at = excluded.completed_at
      returning usage.operation_id, usage.denial_count
        into v_denial_id, v_denial_count;
      return jsonb_build_object(
        'replayed', false, 'authorized', false,
        'dispatch_authorized', false,
        'reservation_id', v_denial_id, 'job_id', null,
        'status', 'denied', 'denial_code', v_denial_code,
        'denial_count', v_denial_count
      );
    end if;
  end if;

  insert into private.integration_jobs (
    id, store_id, job_type, dedupe_key_hash, payload, status,
    available_at, max_attempts
  ) values (
    v_job_id, p_store_id, 'rank_measurement', p_key_hash,
    jsonb_build_object(
      'measurement_id', v_measurement_id,
      'keyword', v_keyword,
      'target_place_id', p_target_place_id,
      'competitor_place_ids', to_jsonb(p_competitor_place_ids),
      'location_code', p_location_code,
      'language_code', p_language_code,
      'device', p_device,
      'credential_source', p_credential_source
    ),
    'queued', statement_timestamp(), 12
  );

  insert into private.meo_rank_measurements (
    id, store_id, job_id, key_hash, request_hash, usage_date,
    credential_source, keyword, normalized_keyword, target_place_id,
    competitor_place_ids, location_code, language_code, device, status
  ) values (
    v_measurement_id, p_store_id, v_job_id, p_key_hash, p_request_hash,
    v_usage_date, p_credential_source, v_keyword, v_normalized,
    p_target_place_id, p_competitor_place_ids, p_location_code,
    p_language_code, p_device, 'reserved'
  );

  insert into private.service_usage (
    store_id, job_id, operation_id, service, operation, usage_unit, units,
    credential_source, status, usage_date
  ) values (
    p_store_id, v_job_id, v_measurement_id, 'dataforseo_rank',
    'rank_measurement', 'rank_serp_page', 1,
    p_credential_source, 'reserved', v_usage_date
  );

  return jsonb_build_object(
    'replayed', false, 'authorized', true,
    'dispatch_authorized', true,
    'reservation_id', v_measurement_id, 'job_id', v_job_id,
    'status', 'queued'
  );
end;
$_$;


--
-- Name: internal_meo_save_insights(uuid, uuid, date, date, text, jsonb); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_save_insights(p_actor_id uuid, p_store_id uuid, p_period_start date, p_period_end date, p_source text, p_metrics jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_snapshot private.meo_insight_snapshots%rowtype;
begin
  perform api.internal_require_zero_feature(
    p_actor_id, p_store_id, 'gbp_insights', statement_timestamp()
  );
  if p_period_start is null or p_period_end is null
    or p_period_end < p_period_start
    or p_period_end - p_period_start > 366
    or p_source not in ('manual', 'google_business')
    or not private.meo_insight_metrics_are_valid(p_metrics)
  then
    raise exception using errcode = '22023', message = 'INVALID_INSIGHT_SNAPSHOT';
  end if;

  insert into private.meo_insight_snapshots as snapshot (
    store_id, period_start, period_end, source, metrics
  ) values (
    p_store_id, p_period_start, p_period_end, p_source, p_metrics
  )
  on conflict (store_id, period_start, period_end, source) do update set
    metrics = excluded.metrics
  returning snapshot.* into v_snapshot;

  return jsonb_build_object(
    'id', v_snapshot.id,
    'period_start', v_snapshot.period_start,
    'period_end', v_snapshot.period_end,
    'source', v_snapshot.source,
    'metrics', v_snapshot.metrics,
    'updated_at', v_snapshot.updated_at
  );
end;
$$;


--
-- Name: internal_meo_save_manual_health_diagnosis(uuid, uuid, text, text, jsonb); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_save_manual_health_diagnosis(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_result jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_now timestamptz := statement_timestamp();
  v_existing private.meo_manual_health_diagnoses%rowtype;
  v_saved private.meo_manual_health_diagnoses%rowtype;
begin
  -- The Edge preflight is repeated inside the write transaction so a store,
  -- feature availability or rollout change cannot race result persistence.
  perform api.internal_require_zero_feature(
    p_actor_id, p_store_id, 'gbp_health', statement_timestamp()
  );
  if p_key_hash !~ '^[0-9a-f]{64}$'
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or not private.meo_health_result_is_valid(p_result)
  then
    raise exception using
      errcode = '22023', message = 'INVALID_MANUAL_HEALTH_DIAGNOSIS';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'meo-manual-health-idempotency:' || p_store_id::text || ':' || p_key_hash,
    0
  ));
  -- Never replay data outside the documented retention window if scheduled
  -- cleanup is delayed. A later submission may establish a fresh result.
  delete from private.meo_manual_health_diagnoses diagnosis
  where diagnosis.store_id = p_store_id
    and diagnosis.key_hash = p_key_hash
    and diagnosis.completed_at <= v_now - interval '30 days';
  select * into v_existing
  from private.meo_manual_health_diagnoses diagnosis
  where diagnosis.store_id = p_store_id
    and diagnosis.key_hash = p_key_hash;

  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception using
        errcode = 'P0001', message = 'IDEMPOTENCY_PAYLOAD_CONFLICT';
    end if;
    return jsonb_build_object(
      'replayed', true,
      'result', v_existing.result_json,
      'diagnosedAt', v_existing.completed_at
    );
  end if;

  insert into private.meo_manual_health_diagnoses (
    store_id, key_hash, request_hash, result_json
  ) values (
    p_store_id, p_key_hash, p_request_hash, p_result
  ) returning * into v_saved;

  return jsonb_build_object(
    'replayed', false,
    'result', v_saved.result_json,
    'diagnosedAt', v_saved.completed_at
  );
end;
$_$;


--
-- Name: FUNCTION internal_meo_save_manual_health_diagnosis(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_result jsonb); Type: COMMENT; Schema: api; Owner: -
--

COMMENT ON FUNCTION api.internal_meo_save_manual_health_diagnosis(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_result jsonb) IS 'Service-role-only exact-replay persistence for one bounded manual GBP diagnosis. Rechecks owner, legal acceptance, and feature availability in the transaction.';


--
-- Name: internal_meo_save_manual_rank(uuid, uuid, text, text, integer, timestamp with time zone); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_save_manual_rank(p_actor_id uuid, p_store_id uuid, p_keyword text, p_target_place_id text, p_position integer, p_observed_at timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_keyword text := regexp_replace(btrim(p_keyword), '[[:space:]]+', ' ', 'g');
  v_normalized text;
  v_observation private.meo_rank_observations%rowtype;
begin
  perform api.internal_require_zero_feature(
    p_actor_id, p_store_id, 'meo_rank', statement_timestamp()
  );
  v_normalized := lower(v_keyword);
  if char_length(v_keyword) not between 1 and 120
    or p_target_place_id !~ '^[A-Za-z0-9_-]{10,255}$'
    or (p_position is not null and p_position not between 1 and 100)
    or p_observed_at is null
    or p_observed_at > statement_timestamp() + interval '5 minutes'
    or p_observed_at < statement_timestamp() - interval '366 days'
  then
    raise exception using errcode = '22023', message = 'INVALID_MANUAL_RANK';
  end if;

  insert into private.meo_rank_targets as target (
    store_id, keyword, normalized_keyword, own_place_id
  ) values (
    p_store_id, v_keyword, v_normalized, p_target_place_id
  )
  on conflict (store_id) do update set
    keyword = excluded.keyword,
    normalized_keyword = excluded.normalized_keyword,
    own_place_id = excluded.own_place_id;

  insert into private.meo_rank_observations (
    store_id, keyword, normalized_keyword, own_place_id, own_position,
    source, observed_at
  ) values (
    p_store_id, v_keyword, v_normalized, p_target_place_id, p_position,
    'manual', p_observed_at
  ) returning * into v_observation;

  return jsonb_build_object(
    'id', v_observation.id,
    'keyword', v_observation.keyword,
    'target_place_id', v_observation.own_place_id,
    'position', v_observation.own_position,
    'competitor_positions', v_observation.competitor_positions,
    'source', v_observation.source,
    'observed_at', v_observation.observed_at
  );
end;
$_$;


--
-- Name: internal_meo_select_google_location(uuid, uuid, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_select_google_location(p_actor_id uuid, p_store_id uuid, p_location_name text, p_display_name text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_connection private.meo_provider_connections%rowtype;
begin
  perform private.require_store_owner(p_actor_id, p_store_id);
  perform private.require_owner(p_actor_id);
  if p_location_name !~ '^accounts/[A-Za-z0-9_-]+/locations/[A-Za-z0-9_-]+$'
    or p_display_name is null
    or char_length(p_display_name) not between 1 and 500
  then
    raise exception using errcode = '22023', message = 'INVALID_GOOGLE_LOCATION';
  end if;
  update private.meo_provider_connections connection
  set location_name = p_location_name, display_name = p_display_name
  where connection.store_id = p_store_id
    and connection.provider = 'google_business'
    and connection.status = 'active'
  returning connection.* into v_connection;
  if not found then
    raise exception using errcode = 'P0001', message = 'GOOGLE_CONNECTION_REQUIRED';
  end if;
  return private.meo_public_connection_json(v_connection);
end;
$_$;


--
-- Name: internal_meo_set_external_writes(uuid, uuid, boolean); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_set_external_writes(p_actor_id uuid, p_store_id uuid, p_enabled boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_access jsonb;
  v_workspace private.zero_meo_store_workspaces%rowtype;
begin
  if p_enabled is null then
    raise exception using errcode = '22023', message = 'INVALID_EXTERNAL_WRITE_SETTING';
  end if;
  v_access := api.internal_zero_meo_workspace_authorize(p_actor_id, p_store_id);
  if v_access ->> 'role' not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'EXTERNAL_WRITE_ADMIN_REQUIRED';
  end if;
  update private.zero_meo_store_workspaces workspace
  set external_writes_enabled = p_enabled,
      updated_by = p_actor_id,
      updated_at = statement_timestamp()
  where workspace.store_id = p_store_id
  returning workspace.* into strict v_workspace;
  insert into private.zero_meo_audit_events (
    organization_id, store_id, actor_id, action, resource,
    safe_metadata, created_by
  ) values (
    v_workspace.organization_id, p_store_id, p_actor_id,
    case when p_enabled then 'external_writes_enabled' else 'external_writes_disabled' end,
    'external_write_settings',
    jsonb_build_object('enabled', p_enabled),
    p_actor_id
  );
  return jsonb_build_object(
    'enabled', v_workspace.external_writes_enabled,
    'can_manage', true,
    'can_execute', true
  );
end;
$$;


--
-- Name: internal_meo_settle_ai_draft(uuid, text, text, text, text, text, jsonb); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_settle_ai_draft(p_reservation_id uuid, p_credential_source text, p_outcome text, p_provider text, p_model text, p_safe_error_code text, p_result_json jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_reservation private.meo_ai_draft_reservations%rowtype;
  v_status text;
begin
  if p_reservation_id is null
    or p_credential_source <> 'owner_provider'
    or p_outcome not in ('success', 'failed')
    or p_provider not in ('openai', 'gemini', 'deepseek', 'xai', 'anthropic')
    or p_model is null or p_model !~ '^[A-Za-z0-9._:/-]{1,200}$'
    or (p_outcome = 'success' and p_safe_error_code is not null)
    or (p_outcome = 'success' and not private.meo_ai_draft_result_is_valid(p_result_json))
    or (
      p_outcome = 'failed' and (
        p_safe_error_code is null
        or p_safe_error_code !~ '^[A-Z0-9_:-]{2,100}$'
        or p_result_json is not null
      )
    )
  then
    raise exception using errcode = '22023', message = 'INVALID_AI_DRAFT_SETTLEMENT';
  end if;

  select * into v_reservation
  from private.meo_ai_draft_reservations reservation
  where reservation.id = p_reservation_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'AI_DRAFT_RESERVATION_NOT_FOUND';
  end if;
  if v_reservation.credential_source <> 'owner_provider' then
    raise exception using errcode = 'P0001', message = 'AI_DRAFT_CREDENTIAL_SOURCE_MISMATCH';
  end if;
  if p_outcome = 'success'
    and (p_result_json ->> 'source') is distinct from 'owner_provider'
  then
    raise exception using errcode = '22023', message = 'INVALID_AI_DRAFT_RESULT_SOURCE';
  end if;

  v_status := case when p_outcome = 'success' then 'succeeded' else 'failed' end;
  if v_reservation.status in ('succeeded', 'failed') then
    if v_reservation.status = v_status
      and v_reservation.provider = p_provider
      and v_reservation.model = p_model
      and v_reservation.error_code is not distinct from p_safe_error_code
      and v_reservation.result_json is not distinct from p_result_json
    then
      return jsonb_build_object(
        'reservation_id', v_reservation.id,
        'status', v_reservation.status,
        'replayed', true,
        'provider', v_reservation.provider,
        'model', v_reservation.model,
        'error_code', v_reservation.error_code,
        'credential_source', v_reservation.credential_source,
        'result_json', v_reservation.result_json
      );
    end if;
    raise exception using errcode = 'P0001', message = 'AI_DRAFT_SETTLEMENT_CONFLICT';
  elsif v_reservation.status <> 'reserved' then
    raise exception using errcode = 'P0001', message = 'AI_DRAFT_NOT_RESERVED';
  end if;

  update private.meo_ai_draft_reservations reservation
  set status = v_status,
      provider = p_provider,
      model = p_model,
      error_code = p_safe_error_code,
      result_json = p_result_json,
      settled_at = statement_timestamp()
  where reservation.id = p_reservation_id
  returning reservation.* into v_reservation;

  return jsonb_build_object(
    'reservation_id', v_reservation.id,
    'status', v_reservation.status,
    'replayed', false,
    'provider', v_reservation.provider,
    'model', v_reservation.model,
    'error_code', v_reservation.error_code,
    'credential_source', v_reservation.credential_source,
    'result_json', v_reservation.result_json
  );
end;
$_$;


--
-- Name: internal_meo_settle_health_diagnosis(uuid, text, text, jsonb); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_settle_health_diagnosis(p_operation_id uuid, p_outcome text, p_safe_error_code text DEFAULT NULL::text, p_result jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_response jsonb;
  v_completed_at timestamptz;
begin
  v_response := api.internal_meo_settle_health_diagnosis_v1(
    p_operation_id,
    p_outcome,
    p_safe_error_code,
    p_result
  );

  if v_response ->> 'status' = 'succeeded' then
    select diagnosis.completed_at into v_completed_at
    from private.meo_health_diagnoses diagnosis
    where diagnosis.operation_id = p_operation_id
      and diagnosis.status = 'succeeded'
      and diagnosis.result_json is not null;
    if not found or v_completed_at is null then
      raise exception using
        errcode = 'P0001', message = 'HEALTH_DIAGNOSIS_COMPLETION_MISSING';
    end if;
  end if;

  return v_response || jsonb_build_object('diagnosedAt', v_completed_at);
end;
$$;


--
-- Name: FUNCTION internal_meo_settle_health_diagnosis(p_operation_id uuid, p_outcome text, p_safe_error_code text, p_result jsonb); Type: COMMENT; Schema: api; Owner: -
--

COMMENT ON FUNCTION api.internal_meo_settle_health_diagnosis(p_operation_id uuid, p_outcome text, p_safe_error_code text, p_result jsonb) IS 'Atomically persists a bounded GBP diagnosis result and returns its database completion timestamp for fresh and exact-replay success.';


--
-- Name: internal_meo_settle_health_diagnosis_v1(uuid, text, text, jsonb); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_settle_health_diagnosis_v1(p_operation_id uuid, p_outcome text, p_safe_error_code text DEFAULT NULL::text, p_result jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_now timestamptz := statement_timestamp();
  v_diagnosis private.meo_health_diagnoses%rowtype;
  v_usage private.service_usage%rowtype;
  v_diagnosis_status text;
  v_usage_status text;
begin
  if p_operation_id is null
    or p_outcome not in ('success', 'failed', 'attention_required')
    or (
      p_outcome = 'success'
      and (
        p_safe_error_code is not null
        or not private.meo_health_result_is_valid(p_result)
      )
    )
    or (
      p_outcome <> 'success'
      and (
        p_safe_error_code is null
        or p_safe_error_code !~ '^[A-Z0-9_:-]{2,100}$'
        or p_result is not null
      )
    )
  then
    raise exception using errcode = '22023', message = 'INVALID_HEALTH_DIAGNOSIS_SETTLEMENT';
  end if;
  v_diagnosis_status := case p_outcome
    when 'success' then 'succeeded'
    when 'failed' then 'failed'
    else 'attention_required'
  end;
  v_usage_status := case p_outcome
    when 'success' then 'succeeded'
    when 'failed' then 'failed'
    else 'attention_required'
  end;

  -- Lock order is invariant across claim, settlement, reconciliation, and
  -- expiration: service_usage first, then meo_health_diagnoses. This prevents
  -- a lost-
  -- response replay racing settlement from forming a lock cycle.
  select * into v_usage
  from private.service_usage usage
  where usage.operation_id = p_operation_id
    and usage.service = 'google_business_api'
    and usage.operation = 'google_health_read'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'HEALTH_DIAGNOSIS_RESERVATION_NOT_FOUND';
  end if;
  select * into v_diagnosis
  from private.meo_health_diagnoses diagnosis
  where diagnosis.usage_id = v_usage.id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'HEALTH_DIAGNOSIS_NOT_FOUND';
  end if;

  if v_diagnosis.status = v_diagnosis_status
    and v_usage.status = v_usage_status
    and v_diagnosis.last_error_code is not distinct from p_safe_error_code
  then
    if p_outcome = 'success' and v_diagnosis.result_json <> p_result then
      raise exception using errcode = 'P0001', message = 'HEALTH_DIAGNOSIS_RESULT_CONFLICT';
    end if;
    return jsonb_build_object(
      'reservation_id', p_operation_id,
      'status', v_diagnosis.status,
      'replayed', true,
      'result', case when v_diagnosis.status = 'succeeded'
        then v_diagnosis.result_json else null end
    );
  end if;
  if v_diagnosis.status <> 'processing' or v_usage.status <> 'reserved' then
    raise exception using errcode = 'P0001', message = 'HEALTH_DIAGNOSIS_SETTLEMENT_CONFLICT';
  end if;
  update private.meo_health_diagnoses diagnosis
  set status = v_diagnosis_status,
      result_json = case when p_outcome = 'success' then p_result else null end,
      last_error_code = p_safe_error_code,
      completed_at = v_now,
      updated_at = v_now
  where diagnosis.usage_id = v_diagnosis.usage_id;
  update private.service_usage usage
  set status = v_usage_status,
      last_error_code = p_safe_error_code,
      completed_at = v_now
  where usage.id = v_usage.id;

  return jsonb_build_object(
    'reservation_id', p_operation_id,
    'status', v_diagnosis_status,
    'replayed', false,
    'result', case when p_outcome = 'success'
      then p_result else null end
  );
end;
$_$;


--
-- Name: FUNCTION internal_meo_settle_health_diagnosis_v1(p_operation_id uuid, p_outcome text, p_safe_error_code text, p_result jsonb); Type: COMMENT; Schema: api; Owner: -
--

COMMENT ON FUNCTION api.internal_meo_settle_health_diagnosis_v1(p_operation_id uuid, p_outcome text, p_safe_error_code text, p_result jsonb) IS 'Atomically persists the bounded derived result and settles one provider-call usage row. Failed and attention outcomes never retain a result.';


--
-- Name: internal_meo_settle_provider_call(uuid, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_settle_provider_call(p_reservation_id uuid, p_outcome text, p_safe_error_code text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_usage private.service_usage%rowtype;
  v_status text;
begin
  if p_reservation_id is null
    or p_outcome not in ('success', 'failed', 'attention_required')
    or (p_outcome = 'success' and p_safe_error_code is not null)
    or (
      p_outcome <> 'success'
      and (p_safe_error_code is null or p_safe_error_code !~ '^[A-Z0-9_:-]{2,100}$')
    )
  then
    raise exception using errcode = '22023', message = 'INVALID_PROVIDER_CALL_SETTLEMENT';
  end if;
  v_status := case p_outcome
    when 'success' then 'succeeded'
    when 'failed' then 'failed'
    else 'attention_required'
  end;
  select * into v_usage
  from private.service_usage usage
  where usage.operation_id = p_reservation_id
    and usage.usage_unit = 'provider_call'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROVIDER_CALL_RESERVATION_NOT_FOUND';
  end if;
  if v_usage.status = v_status and v_usage.last_error_code is not distinct from p_safe_error_code then
    return jsonb_build_object(
      'reservation_id', v_usage.operation_id,
      'status', v_usage.status,
      'replayed', true,
      'error_code', v_usage.last_error_code
    );
  elsif v_usage.status <> 'reserved' then
    raise exception using errcode = 'P0001', message = 'PROVIDER_CALL_SETTLEMENT_CONFLICT';
  end if;
  update private.service_usage usage
  set status = v_status,
      last_error_code = p_safe_error_code,
      completed_at = statement_timestamp()
  where usage.operation_id = p_reservation_id
  returning usage.* into v_usage;
  return jsonb_build_object(
    'reservation_id', v_usage.operation_id,
    'status', v_usage.status,
    'replayed', false,
    'error_code', v_usage.last_error_code
  );
end;
$_$;


--
-- Name: internal_meo_upsert_connection(uuid, uuid, text, text, text, smallint, timestamp with time zone, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_upsert_connection(p_actor_id uuid, p_store_id uuid, p_provider text, p_credential_ciphertext text, p_credential_iv text, p_key_version smallint, p_expires_at timestamp with time zone, p_external_account_id text DEFAULT NULL::text, p_location_name text DEFAULT NULL::text, p_display_name text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_connection private.meo_provider_connections%rowtype;
begin
  perform private.require_store_owner(p_actor_id, p_store_id);
  perform private.require_owner(p_actor_id);
  if p_provider not in ('google_business', 'instagram', 'dataforseo')
    or p_credential_ciphertext is null
    or char_length(p_credential_ciphertext) not between 24 and 32768
    or p_credential_iv is null
    or char_length(p_credential_iv) not between 16 and 64
    or p_key_version is null or p_key_version <= 0
    or (
      p_provider in ('google_business', 'instagram')
      and (p_expires_at is null or p_expires_at <= statement_timestamp() - interval '5 minutes')
    )
    or (p_provider = 'dataforseo' and p_expires_at is not null)
    or (p_external_account_id is not null and char_length(p_external_account_id) not between 1 and 500)
    or (p_display_name is not null and char_length(p_display_name) not between 1 and 500)
    or (
      p_location_name is not null
      and p_location_name !~ '^accounts/[A-Za-z0-9_-]+/locations/[A-Za-z0-9_-]+$'
    )
    or (p_provider = 'instagram' and (p_location_name is not null or p_display_name is not null))
    or (p_provider = 'dataforseo' and p_location_name is not null)
  then
    raise exception using errcode = '22023', message = 'INVALID_EXTERNAL_CONNECTION';
  end if;

  insert into private.meo_provider_connections as connection (
    store_id, provider, credential_ciphertext, credential_iv, key_version,
    status, expires_at, external_account_id, location_name, display_name,
    last_error_code
  ) values (
    p_store_id, p_provider, p_credential_ciphertext, p_credential_iv,
    p_key_version, 'active', p_expires_at, p_external_account_id,
    p_location_name, p_display_name, null
  )
  on conflict (store_id, provider) do update set
    credential_ciphertext = excluded.credential_ciphertext,
    credential_iv = excluded.credential_iv,
    key_version = excluded.key_version,
    status = 'active',
    expires_at = excluded.expires_at,
    external_account_id = excluded.external_account_id,
    location_name = excluded.location_name,
    display_name = excluded.display_name,
    last_error_code = null
  returning connection.* into v_connection;

  return private.meo_public_connection_json(v_connection);
end;
$_$;


--
-- Name: internal_meo_worker_claim_due(integer, text, integer); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_worker_claim_due(p_limit integer DEFAULT 10, p_worker_id text DEFAULT 'integration-worker'::text, p_lease_seconds integer DEFAULT 120) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_result jsonb;
begin
  if p_limit not between 1 and 50
    or p_worker_id !~ '^[A-Za-z0-9._:@/-]{3,120}$'
    or p_lease_seconds not between 30 and 600
  then
    raise exception using errcode = '22023', message = 'INVALID_WORKER_CLAIM';
  end if;

  update private.integration_jobs job
  set status = 'retry_scheduled', processing_stage = null, claim_token = null,
      lease_expires_at = null, worker_id = null,
      available_at = statement_timestamp() + interval '5 minutes',
      last_error_code = 'WORKER_LEASE_EXPIRED'
  where job.job_type = 'gbp_insights_sync'
    and job.status = 'processing'
    and job.lease_expires_at <= statement_timestamp();

  with candidates as (
    select job.id
    from private.integration_jobs job
    join api.stores store on store.id = job.store_id and store.archived_at is null
    join private.zero_feature_rollouts rollout on rollout.feature_key = 'gbp_insights'
    where job.job_type = 'gbp_insights_sync'
      and job.status in ('queued', 'retry_scheduled')
      and job.available_at <= statement_timestamp()
      and job.attempt_count < job.max_attempts
      and private.zero_feature_effective_state(
        rollout.configured_state, rollout.release_at, rollout.kill_switch,
        statement_timestamp()
      ) = 'available'
      and private.owner_exists(store.owner_id)
      and exists (
        select 1 from private.meo_provider_connections google_connection
        where google_connection.store_id = job.store_id
          and google_connection.provider = 'google_business'
          and google_connection.status = 'active'
          and google_connection.expires_at > statement_timestamp()
          and google_connection.location_name is not null
      )
    order by job.available_at, job.created_at, job.id
    limit p_limit
    for update of job skip locked
  ), claimed as (
    update private.integration_jobs job
    set status = 'processing', processing_stage = 'execute',
        attempt_count = job.attempt_count + 1,
        worker_id = p_worker_id, claim_token = gen_random_uuid(),
        lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
        last_error_code = null
    from candidates candidate
    where job.id = candidate.id
    returning job.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'job_id', claimed.id,
    'actor_id', store.owner_id,
    'store_id', claimed.store_id,
    'job_type', claimed.job_type,
    'stage', claimed.processing_stage,
    'claim_token', claimed.claim_token,
    'lease_expires_at', claimed.lease_expires_at,
    'attempt_count', claimed.attempt_count,
    'max_attempts', claimed.max_attempts,
    'payload', claimed.payload,
    'provider_task_id', claimed.provider_task_id,
    'credential_source', 'native'
  ) order by claimed.created_at, claimed.id), '[]'::jsonb)
  into v_result
  from claimed join api.stores store on store.id = claimed.store_id;
  return v_result;
end;
$_$;


--
-- Name: internal_meo_worker_complete_insights(uuid, uuid, date, date, jsonb, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_worker_complete_insights(p_job_id uuid, p_claim_token uuid, p_period_start date, p_period_end date, p_metrics jsonb, p_request_hash text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_job private.integration_jobs%rowtype;
  v_actor_id uuid;
  v_snapshot jsonb;
begin
  if p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_INSIGHT_RECEIPT';
  end if;
  select job into v_job
  from private.integration_jobs job
  join api.stores store on store.id = job.store_id and store.archived_at is null
  where job.id = p_job_id and job.job_type = 'gbp_insights_sync'
    and job.status = 'processing' and job.claim_token = p_claim_token
    and job.lease_expires_at > statement_timestamp()
  for update of job;
  if not found then
    raise exception using errcode = 'P0001', message = 'WORKER_CLAIM_INVALID_OR_EXPIRED';
  end if;
  select store.owner_id into v_actor_id
  from api.stores store
  where store.id = v_job.store_id and store.archived_at is null;
  v_snapshot := api.internal_meo_save_insights(
    v_actor_id, v_job.store_id, p_period_start, p_period_end,
    'google_business', p_metrics
  );
  update private.integration_jobs
  set status = 'completed', processing_stage = null, claim_token = null,
      lease_expires_at = null, worker_id = null, last_error_code = null,
      completed_at = statement_timestamp()
  where id = p_job_id;
  insert into private.integration_receipts (
    store_id, job_id, action_type, provider, request_hash, outcome, safe_metadata
  ) values (
    v_job.store_id, p_job_id, 'gbp_insights_sync', 'google_business',
    p_request_hash, 'succeeded',
    jsonb_build_object(
      'snapshot_id', v_snapshot ->> 'id',
      'period_start', p_period_start,
      'period_end', p_period_end
    )
  ) on conflict (store_id, action_type, request_hash)
    where outcome = 'succeeded' do nothing;
  return v_snapshot;
end;
$_$;


--
-- Name: internal_meo_worker_complete_noop(uuid, uuid, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_worker_complete_noop(p_job_id uuid, p_claim_token uuid, p_reason_code text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_job private.integration_jobs%rowtype;
begin
  if p_reason_code is not null and p_reason_code !~ '^[A-Z0-9_:-]{2,100}$' then
    raise exception using errcode = '22023', message = 'INVALID_WORKER_NOOP_REASON';
  end if;
  update private.integration_jobs job
  set status = 'completed', processing_stage = null, claim_token = null,
      lease_expires_at = null, worker_id = null,
      last_error_code = p_reason_code, completed_at = statement_timestamp()
  where job.id = p_job_id and job.job_type = 'gbp_insights_sync'
    and job.status = 'processing' and job.claim_token = p_claim_token
    and job.lease_expires_at > statement_timestamp()
  returning job.* into v_job;
  if not found then
    raise exception using errcode = 'P0001', message = 'WORKER_CLAIM_INVALID_OR_EXPIRED';
  end if;
  return jsonb_build_object(
    'job_id', v_job.id, 'status', v_job.status,
    'reason_code', v_job.last_error_code, 'completed_at', v_job.completed_at
  );
end;
$_$;


--
-- Name: internal_meo_worker_enqueue_due(timestamp with time zone); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_worker_enqueue_due(p_evaluated_at timestamp with time zone DEFAULT statement_timestamp()) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_day date := (coalesce(p_evaluated_at, statement_timestamp()) at time zone 'Asia/Tokyo')::date;
  v_insights integer := 0;
begin
  if p_evaluated_at is null
    or p_evaluated_at < statement_timestamp() - interval '1 day'
    or p_evaluated_at > statement_timestamp() + interval '1 day'
  then
    raise exception using errcode = '22023', message = 'INVALID_WORKER_SCHEDULE_TIME';
  end if;

  insert into private.integration_jobs (
    store_id, job_type, dedupe_key_hash, payload, status, available_at, max_attempts
  )
  select store.id, 'gbp_insights_sync',
    md5('gbp-insights:' || store.id::text || ':' || v_day::text)
      || md5('gbp-insights-2:' || store.id::text || ':' || v_day::text),
    jsonb_build_object('scheduled_date', v_day, 'source', 'google_business'),
    'queued', p_evaluated_at, 5
  from api.stores store
  join private.meo_provider_connections google_connection
    on google_connection.store_id = store.id
    and google_connection.provider = 'google_business'
    and google_connection.status = 'active'
    and google_connection.expires_at > p_evaluated_at
    and google_connection.location_name is not null
  join private.zero_feature_rollouts rollout on rollout.feature_key = 'gbp_insights'
  where store.archived_at is null
    and private.owner_exists(store.owner_id)
    and private.zero_feature_effective_state(
      rollout.configured_state, rollout.release_at, rollout.kill_switch, p_evaluated_at
    ) = 'available'
  on conflict (store_id, job_type, dedupe_key_hash) do nothing;
  get diagnostics v_insights = row_count;

  return jsonb_build_object(
    'scheduled_date', v_day,
    'gbp_insights_sync', v_insights
  );
end;
$$;


--
-- Name: internal_meo_worker_prepare_job(uuid, uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_worker_prepare_job(p_job_id uuid, p_claim_token uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_job private.integration_jobs%rowtype;
  v_store api.stores%rowtype;
  v_feature_key text;
  v_effective_state text;
  v_execution_mode text;
  v_google private.meo_provider_connections%rowtype;
  v_dataforseo private.meo_provider_connections%rowtype;
  v_rank_credential_source text;
begin
  select * into v_job
  from private.integration_jobs job
  where job.id = p_job_id
    and job.status = 'processing'
    and job.claim_token = p_claim_token
    and job.lease_expires_at > statement_timestamp()
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'WORKER_CLAIM_INVALID_OR_EXPIRED';
  end if;

  select * into v_store from api.stores store
  where store.id = v_job.store_id and store.archived_at is null;
  if not found then
    return jsonb_build_object('runnable', false, 'reason', 'STORE_NOT_FOUND');
  end if;
  if not private.owner_exists(v_store.owner_id) then
    return jsonb_build_object('runnable', false, 'reason', 'OWNER_NOT_FOUND');
  end if;

  v_feature_key := case v_job.job_type
    when 'gbp_insights_sync' then 'gbp_insights'
    when 'rank_measurement' then 'meo_rank'
  end;
  if v_feature_key is null then
    return jsonb_build_object('runnable', false, 'reason', 'UNSUPPORTED_JOB_TYPE');
  end if;

  select private.zero_feature_effective_state(
      rollout.configured_state, rollout.release_at, rollout.kill_switch,
      statement_timestamp()
    ), rollout.execution_mode
  into v_effective_state, v_execution_mode
  from private.zero_feature_rollouts rollout
  where rollout.feature_key = v_feature_key;
  if v_effective_state is distinct from 'available' then
    return jsonb_build_object('runnable', false, 'reason', 'FEATURE_NOT_AVAILABLE');
  end if;

  if v_job.job_type = 'rank_measurement' then
    select measurement.credential_source into v_rank_credential_source
    from private.meo_rank_measurements measurement
    where measurement.job_id = v_job.id;
    if not found then
      return jsonb_build_object('runnable', false, 'reason', 'RANK_MEASUREMENT_NOT_FOUND');
    end if;
    if v_execution_mode is distinct from v_rank_credential_source then
      return jsonb_build_object('runnable', false, 'reason', 'FEATURE_EXECUTION_MODE_MISMATCH');
    end if;
    select * into v_dataforseo
    from private.meo_provider_connections connection
    where connection.store_id = v_job.store_id
      and connection.provider = 'dataforseo'
      and connection.status = 'active'
      and connection.expires_at is null;
    if not found then
      return jsonb_build_object('runnable', false, 'reason', 'DATAFORSEO_CONNECTION_REQUIRED');
    end if;
  else
    select * into v_google from private.meo_provider_connections connection
    where connection.store_id = v_job.store_id
      and connection.provider = 'google_business'
      and connection.status = 'active'
      and connection.expires_at > statement_timestamp();
    if not found or v_google.location_name is null then
      return jsonb_build_object('runnable', false, 'reason', 'GOOGLE_CONNECTION_REQUIRED');
    end if;
  end if;

  return jsonb_build_object(
    'runnable', true,
    'actor_id', v_store.owner_id,
    'store_id', v_job.store_id,
    'job_id', v_job.id,
    'job_type', v_job.job_type,
    'payload', v_job.payload,
    'google_connection', case when v_job.job_type = 'gbp_insights_sync'
      then jsonb_build_object(
        'provider', v_google.provider,
        'credential_ciphertext', v_google.credential_ciphertext,
        'credential_iv', v_google.credential_iv,
        'key_version', v_google.key_version,
        'expires_at', v_google.expires_at,
        'location_name', v_google.location_name
      ) else null end,
    'dataforseo_connection', case when v_job.job_type = 'rank_measurement'
      then jsonb_build_object(
        'provider', v_dataforseo.provider,
        'credential_ciphertext', v_dataforseo.credential_ciphertext,
        'credential_iv', v_dataforseo.credential_iv,
        'key_version', v_dataforseo.key_version,
        'expires_at', v_dataforseo.expires_at
      ) else null end
  );
end;
$$;


--
-- Name: internal_meo_worker_refresh_connection(uuid, uuid, text, text, text, smallint, timestamp with time zone); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_worker_refresh_connection(p_job_id uuid, p_claim_token uuid, p_provider text, p_credential_ciphertext text, p_credential_iv text, p_key_version smallint, p_expires_at timestamp with time zone) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_job private.integration_jobs%rowtype;
  v_actor_id uuid;
begin
  select * into v_job
  from private.integration_jobs job
  where job.id = p_job_id and job.status = 'processing'
    and job.claim_token = p_claim_token
    and job.lease_expires_at > statement_timestamp()
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'WORKER_CLAIM_INVALID_OR_EXPIRED';
  end if;
  if p_provider <> 'google_business'
    or v_job.job_type <> 'gbp_insights_sync'
  then
    raise exception using errcode = '22023', message = 'INVALID_WORKER_CONNECTION_PROVIDER';
  end if;
  select store.owner_id into v_actor_id
  from api.stores store
  where store.id = v_job.store_id and store.archived_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'STORE_NOT_FOUND';
  end if;
  perform api.internal_require_zero_feature(
    v_actor_id, v_job.store_id, 'gbp_insights', statement_timestamp()
  );
  perform api.internal_meo_refresh_connection(
    v_actor_id, v_job.store_id, p_provider, p_credential_ciphertext,
    p_credential_iv, p_key_version, p_expires_at
  );
end;
$$;


--
-- Name: internal_meo_worker_reschedule(uuid, uuid, text, timestamp with time zone); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_worker_reschedule(p_job_id uuid, p_claim_token uuid, p_error_code text, p_available_at timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_job private.integration_jobs%rowtype;
begin
  if p_error_code !~ '^[A-Z0-9_:-]{2,100}$'
    or p_available_at is null
    or p_available_at <= statement_timestamp()
    or p_available_at > statement_timestamp() + interval '7 days'
  then
    raise exception using errcode = '22023', message = 'INVALID_WORKER_RESCHEDULE';
  end if;
  select * into v_job from private.integration_jobs job
  where job.id = p_job_id and job.status = 'processing'
    and job.claim_token = p_claim_token
    and job.lease_expires_at > statement_timestamp()
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'WORKER_CLAIM_INVALID_OR_EXPIRED';
  end if;
  if v_job.attempt_count >= v_job.max_attempts then
    update private.integration_jobs
    set status = 'dead_letter', processing_stage = null, claim_token = null,
        lease_expires_at = null, worker_id = null,
        last_error_code = p_error_code, completed_at = statement_timestamp()
    where id = p_job_id returning * into v_job;
  else
    update private.integration_jobs
    set status = case when provider_task_id is null then 'retry_scheduled' else 'provider_submitted' end,
        processing_stage = null, claim_token = null, lease_expires_at = null,
        worker_id = null, last_error_code = p_error_code,
        available_at = p_available_at
    where id = p_job_id returning * into v_job;
  end if;
  return jsonb_build_object(
    'job_id', v_job.id, 'status', v_job.status,
    'attempt_count', v_job.attempt_count, 'available_at', v_job.available_at,
    'last_error_code', v_job.last_error_code
  );
end;
$_$;


--
-- Name: internal_meo_worker_terminal(uuid, uuid, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_meo_worker_terminal(p_job_id uuid, p_claim_token uuid, p_state text, p_error_code text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_job private.integration_jobs%rowtype;
begin
  if p_state not in ('failed', 'dead_letter', 'attention_required')
    or p_error_code !~ '^[A-Z0-9_:-]{2,100}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_WORKER_TERMINAL_STATE';
  end if;
  update private.integration_jobs job
  set status = p_state, processing_stage = null, claim_token = null,
      lease_expires_at = null, worker_id = null,
      last_error_code = p_error_code, completed_at = statement_timestamp()
  where job.id = p_job_id and job.status = 'processing'
    and job.claim_token = p_claim_token
    and job.lease_expires_at > statement_timestamp()
  returning job.* into v_job;
  if not found then
    raise exception using errcode = 'P0001', message = 'WORKER_CLAIM_INVALID_OR_EXPIRED';
  end if;
  return jsonb_build_object(
    'job_id', v_job.id, 'status', v_job.status,
    'last_error_code', v_job.last_error_code, 'completed_at', v_job.completed_at
  );
end;
$_$;


--
-- Name: internal_purge_owner_idempotency(uuid, uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_purge_owner_idempotency(p_owner_id uuid, p_keep_operation_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_deleted integer;
begin
  if p_owner_id is null then
    raise exception using errcode = '22023', message = 'INVALID_OWNER_ID';
  end if;

  delete from private.request_idempotency operation
  where operation.id <> coalesce(
      p_keep_operation_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
    and (
      (
        operation.scope like 'owner_%'
        and (
          operation.subject_id = p_owner_id
          or exists (
            select 1
            from api.stores store
            where store.id = operation.subject_id
              and store.owner_id = p_owner_id
          )
        )
      )
      or (
        operation.scope = 'session_start'
        and exists (
          select 1
          from api.stores store
          where store.id = operation.subject_id
            and store.owner_id = p_owner_id
        )
      )
      or (
        operation.scope in ('turn', 'review', 'rewrite', 'review_edit', 'handoff')
        and exists (
          select 1
          from api.interview_sessions session
          join api.stores store on store.id = session.store_id
          where session.id = operation.subject_id
            and store.owner_id = p_owner_id
        )
      )
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;


--
-- Name: internal_record_handoff(uuid, text, text, text, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_record_handoff(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_event_type text, p_edited_review text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_session api.interview_sessions%rowtype;
  v_claim jsonb;
  v_operation_id uuid;
  v_event_id uuid;
  v_google_review_url text;
begin
  if p_event_type not in ('review_text_copied', 'google_review_opened')
    or p_edited_review is null
    or char_length(btrim(p_edited_review)) not between 1 and 800
  then
    raise exception using errcode = '22023', message = 'INVALID_HANDOFF_INPUT';
  end if;

  v_session := private.require_interview_session(p_session_id, p_token_hash);
  v_claim := private.claim_idempotency(
    'handoff', p_session_id, p_idempotency_key_hash, p_request_hash, 30
  );
  v_operation_id := (v_claim ->> 'operation_id')::uuid;

  if (v_claim ->> 'replayed')::boolean then
    return api.internal_get_operation_result(v_operation_id);
  end if;

  if v_session.status <> 'completed'
    or v_session.generation_status <> 'succeeded'
  then
    raise exception using errcode = 'P0001', message = 'INVALID_HANDOFF_STATE';
  end if;

  if not (v_claim ->> 'resumed')::boolean then
    perform private.consume_rate_limit(
      'session', v_session.store_id, p_session_subject_hash, 60, 10
    );
  end if;

  select google_review_url into v_google_review_url
  from api.stores
  where id = v_session.store_id
    and status = 'published';

  if v_google_review_url is null then
    raise exception using errcode = 'P0001', message = 'GOOGLE_REVIEW_URL_UNAVAILABLE';
  end if;

  update api.interview_sessions
  set edited_review = btrim(p_edited_review),
      google_handoff_opened_at = case
        when p_event_type = 'google_review_opened'
          then coalesce(google_handoff_opened_at, statement_timestamp())
        else google_handoff_opened_at
      end,
      last_activity_at = statement_timestamp()
  where id = p_session_id;

  insert into api.review_handoff_events (
    store_id,
    session_id,
    event_type,
    idempotency_key_hash
  ) values (
    v_session.store_id,
    p_session_id,
    p_event_type,
    p_idempotency_key_hash
  )
  on conflict (session_id, event_type, idempotency_key_hash)
  do update set event_type = excluded.event_type
  returning id into v_event_id;

  update private.request_idempotency
  set status = 'completed',
      result_ref = v_event_id,
      lease_expires_at = null
  where id = v_operation_id;

  return jsonb_build_object(
    'operation_id', v_operation_id,
    'session_id', p_session_id,
    'event_id', v_event_id,
    'event_type', p_event_type,
    'google_review_url', v_google_review_url,
    'replayed', false
  );
end;
$$;


--
-- Name: internal_replay_interview_session(uuid, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_replay_interview_session(p_store_id uuid, p_idempotency_key_hash text, p_request_hash text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $_$
declare
  v_idempotency private.request_idempotency%rowtype;
  v_expires_at timestamptz;
begin
  if p_store_id is null
    or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
    or p_request_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_SESSION_REPLAY_INPUT';
  end if;

  select * into v_idempotency
  from private.request_idempotency
  where scope = 'session_start'
    and subject_id = p_store_id
    and key_hash = p_idempotency_key_hash;
  if not found then return null; end if;
  if v_idempotency.request_hash <> p_request_hash then
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
  end if;
  if v_idempotency.status <> 'completed' or v_idempotency.result_ref is null then
    return null;
  end if;

  select secrets.expires_at into v_expires_at
  from private.interview_session_secrets secrets
  where secrets.session_id = v_idempotency.result_ref
    and secrets.store_id = p_store_id
    and secrets.revoked_at is null
    and secrets.expires_at > statement_timestamp();
  if v_expires_at is null then
    raise exception using errcode = 'P0001', message = 'SESSION_INVALID_OR_EXPIRED';
  end if;

  return jsonb_build_object(
    'session_id', v_idempotency.result_ref,
    'store_id', p_store_id,
    'expires_at', v_expires_at,
    'replayed', true
  );
end;
$_$;


--
-- Name: internal_require_zero_feature(uuid, uuid, text, timestamp with time zone); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_require_zero_feature(p_actor_id uuid, p_store_id uuid, p_feature_key text, p_evaluated_at timestamp with time zone DEFAULT statement_timestamp()) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_rollout private.zero_feature_rollouts%rowtype;
  v_effective_state text;
begin
  perform api.internal_zero_meo_workspace_authorize(p_actor_id, p_store_id);
  select * into v_rollout
  from private.zero_feature_rollouts rollout
  where rollout.feature_key = p_feature_key;
  if not found then
    raise exception using errcode = '22023', message = 'INVALID_FEATURE_KEY';
  end if;

  v_effective_state := private.zero_feature_effective_state(
    v_rollout.configured_state,
    v_rollout.release_at,
    v_rollout.kill_switch,
    coalesce(p_evaluated_at, statement_timestamp())
  );
  if v_effective_state = 'hidden' then
    raise exception using errcode = 'P0001', message = 'FEATURE_HIDDEN';
  elsif v_effective_state = 'paused' then
    raise exception using errcode = 'P0001', message = 'FEATURE_PAUSED';
  elsif v_effective_state <> 'available' then
    raise exception using errcode = 'P0001', message = 'FEATURE_NOT_RELEASED';
  end if;


  return jsonb_build_object(
    'feature_key', v_rollout.feature_key,
    'state', 'available',
    'execution_mode', v_rollout.execution_mode,
    'release_at', v_rollout.release_at
  );
end;
$$;


--
-- Name: internal_save_edited_review(uuid, text, text, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_save_edited_review(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_edited_review text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_session api.interview_sessions%rowtype;
  v_limits private.store_runtime_limits%rowtype;
  v_claim jsonb;
  v_operation_id uuid;
begin
  if p_edited_review is null
    or char_length(btrim(p_edited_review)) not between 1 and 800
  then
    raise exception using errcode = '22023', message = 'INVALID_REVIEW_TEXT';
  end if;

  v_session := private.require_interview_session(p_session_id, p_token_hash);
  select * into strict v_limits
  from private.store_runtime_limits where store_id = v_session.store_id;
  v_claim := private.claim_idempotency(
    'review_edit', p_session_id, p_idempotency_key_hash, p_request_hash, 30
  );
  v_operation_id := (v_claim ->> 'operation_id')::uuid;

  if (v_claim ->> 'replayed')::boolean then
    return v_claim || jsonb_build_object(
      'session_id', p_session_id,
      'review_text', v_session.edited_review,
      'rewrite_count', v_session.rewrite_count,
      'rewrite_limit', v_limits.rewrite_limit,
      'remaining_rewrites', greatest(
        v_limits.rewrite_limit - v_session.rewrite_count, 0
      )
    );
  end if;

  if v_session.status <> 'completed'
    or v_session.generation_status <> 'succeeded'
  then
    raise exception using errcode = 'P0001', message = 'INVALID_REVIEW_STATE';
  end if;

  if not (v_claim ->> 'resumed')::boolean then
    perform private.consume_rate_limit(
      'session', v_session.store_id, p_session_subject_hash,
      v_limits.session_mutation_window_seconds,
      v_limits.session_mutation_window_limit
    );
  end if;

  update api.interview_sessions
  set edited_review = btrim(p_edited_review),
      last_activity_at = statement_timestamp()
  where id = p_session_id
  returning * into v_session;

  update private.request_idempotency
  set status = 'completed',
      result_ref = p_session_id,
      lease_expires_at = null
  where id = v_operation_id;

  return jsonb_build_object(
    'operation_id', v_operation_id,
    'session_id', p_session_id,
    'review_text', v_session.edited_review,
    'rewrite_count', v_session.rewrite_count,
    'rewrite_limit', v_limits.rewrite_limit,
    'remaining_rewrites', greatest(
      v_limits.rewrite_limit - v_session.rewrite_count, 0
    ),
    'replayed', false
  );
end;
$$;


--
-- Name: internal_select_ai_model_v2(uuid, uuid, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_select_ai_model_v2(p_actor_id uuid, p_store_id uuid, p_provider text, p_model text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_connection private.store_ai_provider_connections%rowtype;
begin
  if p_provider not in ('openai', 'gemini', 'deepseek', 'xai', 'anthropic')
    or p_model is null
    or p_model !~ '^[A-Za-z0-9._:/-]{1,200}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_PROVIDER_MODEL';
  end if;
  perform private.require_store_owner(p_actor_id, p_store_id);

  update private.store_ai_provider_connections connection
  set model = p_model
  where connection.store_id = p_store_id
    and connection.provider = p_provider
  returning connection.* into v_connection;
  if not found then
    raise exception using errcode = 'P0001', message = 'AI_CONNECTION_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'provider', v_connection.provider,
    'model', v_connection.model,
    'status', v_connection.status,
    'is_active', v_connection.is_active,
    'key_last4', v_connection.key_last4,
    'validated_at', v_connection.validated_at,
    'last_error_code', v_connection.last_error_code
  );
end;
$_$;


--
-- Name: internal_select_ai_provider_v2(uuid, uuid, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_select_ai_provider_v2(p_actor_id uuid, p_store_id uuid, p_provider text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_connection private.store_ai_provider_connections%rowtype;
begin
  if p_provider not in ('openai', 'gemini', 'deepseek', 'xai', 'anthropic') then
    raise exception using errcode = '22023', message = 'INVALID_PROVIDER';
  end if;
  perform private.require_store_owner(p_actor_id, p_store_id);

  select * into v_connection
  from private.store_ai_provider_connections
  where store_id = p_store_id
    and provider = p_provider
    and status = 'active'
    and validated_at is not null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'AI_PROVIDER_NOT_READY';
  end if;

  update private.store_ai_provider_connections
  set is_active = (provider = p_provider)
  where store_id = p_store_id;

  return jsonb_build_object(
    'provider', p_provider,
    'model', v_connection.model,
    'status', 'active',
    'is_active', true,
    'key_last4', v_connection.key_last4,
    'validated_at', v_connection.validated_at
  );
end;
$$;


--
-- Name: internal_set_store_status_v2(uuid, uuid, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_set_store_status_v2(p_actor_id uuid, p_store_id uuid, p_status text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_store api.stores%rowtype;
begin
  if p_status not in ('published', 'paused') then
    raise exception using errcode = '22023', message = 'INVALID_STORE_STATUS';
  end if;
  select * into v_store
  from api.stores
  where id = p_store_id
    and owner_id = p_actor_id
    and archived_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'STORE_NOT_FOUND';
  end if;
  if p_status = 'published' and (
    v_store.google_review_url is null
    or not (
      v_store.google_review_url ~ '^https://search[.]google[.]com/local/writereview[?]placeid=[A-Za-z0-9_:+-]{4,}$'
      or v_store.google_review_url ~ '^https://g[.]page/r/[A-Za-z0-9_-]{4,}/review$'
      or v_store.google_review_url ~ '^https://www[.]google[.]com/maps/place/'
    )
  ) then
    raise exception using errcode = 'P0001', message = 'STORE_NOT_READY';
  end if;
  update api.stores
  set status = p_status,
      published_at = case
        when p_status = 'published' then coalesce(published_at, statement_timestamp())
        else published_at
      end
  where id = p_store_id
  returning * into v_store;
  return to_jsonb(v_store);
end;
$_$;


--
-- Name: internal_set_zero_feature_rollout(text, text, timestamp with time zone, text, boolean, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_set_zero_feature_rollout(p_feature_key text, p_state text, p_release_at timestamp with time zone, p_execution_mode text, p_kill_switch boolean, p_operator_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_previous private.zero_feature_rollouts%rowtype;
  v_current private.zero_feature_rollouts%rowtype;
begin
  if p_state not in ('hidden', 'coming_soon', 'available', 'paused') then
    raise exception using errcode = '22023', message = 'INVALID_FEATURE_STATE';
  end if;
  if p_execution_mode not in ('native', 'owner_provider') then
    raise exception using errcode = '22023', message = 'INVALID_FEATURE_EXECUTION_MODE';
  end if;
  if p_kill_switch is null then
    raise exception using errcode = '22023', message = 'INVALID_FEATURE_KILL_SWITCH';
  end if;
  if p_operator_id is null or p_operator_id !~ '^[A-Za-z0-9._:@/-]{3,120}$' then
    raise exception using errcode = '22023', message = 'INVALID_OPERATOR_ID';
  end if;
  select * into v_previous
  from private.zero_feature_rollouts rollout
  where rollout.feature_key = p_feature_key
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'INVALID_FEATURE_KEY';
  end if;
  update private.zero_feature_rollouts rollout
  set configured_state = p_state,
      release_at = p_release_at,
      execution_mode = p_execution_mode,
      kill_switch = p_kill_switch
  where rollout.feature_key = p_feature_key
  returning * into v_current;
  insert into private.zero_feature_rollout_audit (
    feature_key, previous_state, next_state,
    previous_release_at, next_release_at,
    previous_execution_mode, next_execution_mode,
    previous_kill_switch, next_kill_switch, operator_id
  ) values (
    v_previous.feature_key, v_previous.configured_state,
    v_current.configured_state, v_previous.release_at, v_current.release_at,
    v_previous.execution_mode, v_current.execution_mode,
    v_previous.kill_switch, v_current.kill_switch, p_operator_id
  );
  return jsonb_build_object(
    'feature_key', v_current.feature_key,
    'configured_state', v_current.configured_state,
    'release_at', v_current.release_at,
    'execution_mode', v_current.execution_mode,
    'kill_switch', v_current.kill_switch,
    'updated_at', v_current.updated_at
  );
end;
$_$;


--
-- Name: internal_start_interview_session(uuid, uuid, text, text, text, text, text, timestamp with time zone); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_start_interview_session(p_session_id uuid, p_store_id uuid, p_locale text, p_token_hash text, p_ip_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_expires_at timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_idempotency private.request_idempotency%rowtype;
  v_limits private.store_runtime_limits%rowtype;
  v_existing_session api.interview_sessions%rowtype;
  v_existing_expires_at timestamptz;
begin
  if p_session_id is null
    or p_locale not in ('ja', 'en')
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_ip_subject_hash !~ '^[0-9a-f]{64}$'
    or p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at <= statement_timestamp()
    or p_expires_at > statement_timestamp() + interval '30 minutes 30 seconds'
  then
    raise exception using errcode = '22023', message = 'INVALID_SESSION_START_INPUT';
  end if;

  select * into v_idempotency
  from private.request_idempotency
  where scope = 'session_start'
    and subject_id = p_store_id
    and key_hash = p_idempotency_key_hash
  for update;

  if found then
    if v_idempotency.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_idempotency.status = 'completed' and v_idempotency.result_ref is not null then
      select * into strict v_existing_session from api.interview_sessions
      where id = v_idempotency.result_ref and store_id = p_store_id;
      select secrets.expires_at into v_existing_expires_at
      from private.interview_session_secrets secrets
      where secrets.session_id = v_existing_session.id
        and secrets.store_id = p_store_id
        and secrets.revoked_at is null
        and secrets.expires_at > statement_timestamp();
      if v_existing_expires_at is null then
        raise exception using errcode = 'P0001', message = 'SESSION_INVALID_OR_EXPIRED';
      end if;
      return jsonb_build_object(
        'session_id', v_existing_session.id,
        'store_id', v_existing_session.store_id,
        'expires_at', v_existing_expires_at,
        'replayed', true
      );
    end if;
    if v_idempotency.status = 'processing'
      and v_idempotency.lease_expires_at > statement_timestamp()
    then
      raise exception using errcode = 'P0001', message = 'OPERATION_IN_PROGRESS';
    end if;
    update private.request_idempotency
    set status = 'processing', error_code = null,
        lease_expires_at = statement_timestamp() + interval '30 seconds',
        expires_at = greatest(expires_at, statement_timestamp() + interval '24 hours')
    where id = v_idempotency.id
    returning * into v_idempotency;
  else
    insert into private.request_idempotency (
      scope, subject_id, key_hash, request_hash, status,
      lease_expires_at, expires_at
    ) values (
      'session_start', p_store_id, p_idempotency_key_hash, p_request_hash,
      'processing', statement_timestamp() + interval '30 seconds',
      statement_timestamp() + interval '24 hours'
    )
    on conflict (scope, subject_id, key_hash) do nothing
    returning * into v_idempotency;

    if not found then
      return api.internal_start_interview_session(
        p_session_id, p_store_id, p_locale, p_token_hash,
        p_ip_subject_hash, p_idempotency_key_hash, p_request_hash, p_expires_at
      );
    end if;
  end if;

  if not exists (
    select 1
    from api.stores store
    where store.id = p_store_id
      and store.status = 'published'
      and store.archived_at is null
      and store.google_review_url is not null
  ) then
    raise exception using errcode = 'P0001', message = 'STORE_NOT_AVAILABLE';
  end if;

  select * into strict v_limits
  from private.store_runtime_limits where store_id = p_store_id
  for update;

  perform private.consume_rate_limit(
    'ip_store', p_store_id, p_ip_subject_hash,
    v_limits.session_start_window_seconds,
    v_limits.session_start_window_limit
  );

  insert into api.interview_sessions (id, store_id, locale)
  values (p_session_id, p_store_id, p_locale);
  insert into private.interview_session_secrets (
    session_id, store_id, session_token_hash, expires_at
  ) values (p_session_id, p_store_id, p_token_hash, p_expires_at);

  update private.request_idempotency
  set status = 'completed', result_ref = p_session_id, lease_expires_at = null
  where id = v_idempotency.id;

  return jsonb_build_object(
    'session_id', p_session_id,
    'store_id', p_store_id,
    'expires_at', p_expires_at,
    'replayed', false
  );
end;
$_$;


--
-- Name: internal_update_owner_store_v2(uuid, uuid, text, text, text, text, text, text, text, text, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_update_owner_store_v2(p_actor_id uuid, p_store_id uuid, p_name text, p_industry text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_website_url text DEFAULT NULL::text, p_icon_path text DEFAULT NULL::text, p_welcome_message text DEFAULT NULL::text, p_closing_message text DEFAULT NULL::text, p_google_review_url text DEFAULT NULL::text, p_google_place_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_store api.stores%rowtype;
begin
  perform private.require_store_owner(p_actor_id, p_store_id);
  if p_name is null or btrim(p_name) = '' then
    raise exception using errcode = '22023', message = 'INVALID_STORE_INPUT';
  end if;
  if p_google_place_id is not null
    and nullif(btrim(p_google_place_id), '') is not null
    and nullif(btrim(p_google_place_id), '') !~ '^[A-Za-z0-9_-]{10,255}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_GOOGLE_PLACE_ID';
  end if;

  update api.stores
  set name = btrim(p_name),
      industry = nullif(btrim(p_industry), ''),
      address = nullif(btrim(p_address), ''),
      description = nullif(btrim(p_description), ''),
      website_url = nullif(btrim(p_website_url), ''),
      icon_path = nullif(btrim(p_icon_path), ''),
      welcome_message = nullif(btrim(p_welcome_message), ''),
      closing_message = nullif(btrim(p_closing_message), ''),
      google_review_url = nullif(btrim(p_google_review_url), ''),
      google_place_id = nullif(btrim(p_google_place_id), '')
  where id = p_store_id
    and owner_id = p_actor_id
    and archived_at is null
  returning * into v_store;

  return to_jsonb(v_store);
end;
$_$;


--
-- Name: internal_update_survey_config_v2(uuid, uuid, jsonb); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_update_survey_config_v2(p_actor_id uuid, p_store_id uuid, p_survey_config_json jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_current jsonb;
  v_config jsonb;
  v_revision integer;
begin
  if private.is_valid_survey_config(p_survey_config_json) is not true then
    raise exception using errcode = '22023', message = 'INVALID_SURVEY_CONFIG';
  end if;

  select survey_config_json into v_current
  from api.stores
  where id = p_store_id
    and owner_id = p_actor_id
    and archived_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'STORE_NOT_FOUND';
  end if;

  if p_survey_config_json ->> 'version' = '2' then
    v_config := private.canonical_survey_config(
      p_survey_config_json ->> 'templateId',
      p_survey_config_json ->> 'title',
      p_survey_config_json ->> 'description'
    );
  else
    v_revision := case
      when v_current ->> 'version' in ('3', '4')
        then (v_current ->> 'revision')::integer + 1
      else 1
    end;
    v_config := jsonb_set(
      p_survey_config_json,
      '{revision}',
      to_jsonb(v_revision),
      false
    );
    if private.is_valid_survey_config(v_config) is not true then
      raise exception using errcode = '22023', message = 'INVALID_SURVEY_CONFIG';
    end if;
  end if;

  update api.stores
  set survey_config_json = v_config
  where id = p_store_id;

  if v_config ->> 'version' in ('3', '4') then
    insert into private.store_survey_revisions (
      store_id, revision, config_json, source
    ) values (
      p_store_id, v_revision, v_config, 'owner'
    );
  end if;

  return v_config;
end;
$$;


--
-- Name: internal_upsert_ai_connection_v2(uuid, uuid, text, text, text, smallint, text, text, boolean); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_upsert_ai_connection_v2(p_actor_id uuid, p_store_id uuid, p_provider text, p_credential_ciphertext text, p_credential_iv text, p_key_version smallint, p_key_last4 text, p_model text, p_activate boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_connection private.store_ai_provider_connections%rowtype;
begin
  if p_provider not in ('openai', 'gemini', 'deepseek', 'xai', 'anthropic')
    or p_model is null
    or p_model !~ '^[A-Za-z0-9._:/-]{1,200}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_PROVIDER_MODEL';
  end if;
  perform private.require_store_owner(p_actor_id, p_store_id);

  if p_activate then
    update private.store_ai_provider_connections
    set is_active = false
    where store_id = p_store_id
      and is_active;
  end if;

  insert into private.store_ai_provider_connections (
    store_id,
    provider,
    model,
    credential_ciphertext,
    credential_iv,
    key_version,
    key_last4,
    status,
    is_active,
    validated_at,
    last_error_code
  ) values (
    p_store_id,
    p_provider,
    p_model,
    p_credential_ciphertext,
    p_credential_iv,
    p_key_version,
    p_key_last4,
    'active',
    p_activate,
    statement_timestamp(),
    null
  )
  on conflict (store_id, provider) do update set
    model = excluded.model,
    credential_ciphertext = excluded.credential_ciphertext,
    credential_iv = excluded.credential_iv,
    key_version = excluded.key_version,
    key_last4 = excluded.key_last4,
    status = 'active',
    is_active = p_activate,
    validated_at = statement_timestamp(),
    last_error_code = null
  returning * into v_connection;

  return jsonb_build_object(
    'store_id', v_connection.store_id,
    'provider', v_connection.provider,
    'model', v_connection.model,
    'status', v_connection.status,
    'is_active', v_connection.is_active,
    'key_last4', v_connection.key_last4,
    'validated_at', v_connection.validated_at
  );
end;
$_$;


--
-- Name: internal_validate_interview_session(uuid, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_validate_interview_session(p_session_id uuid, p_token_hash text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_session api.interview_sessions%rowtype;
  v_limits private.store_runtime_limits%rowtype;
begin
  v_session := private.require_interview_session(p_session_id, p_token_hash);
  select * into strict v_limits
  from private.store_runtime_limits where store_id = v_session.store_id;

  return jsonb_build_object(
    'session_id', v_session.id,
    'store_id', v_session.store_id,
    'status', v_session.status,
    'locale', v_session.locale,
    'ai_turn_count', v_session.ai_turn_count,
    'interview_complete', v_session.interview_complete,
    'generation_status', v_session.generation_status,
    'rewrite_count', v_session.rewrite_count,
    'rewrite_limit', v_limits.rewrite_limit,
    'remaining_rewrites', greatest(
      v_limits.rewrite_limit - v_session.rewrite_count, 0
    ),
    'edited_review', v_session.edited_review
  );
end;
$$;


--
-- Name: internal_zero_meo_accept_invitation(uuid, text, text); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_zero_meo_accept_invitation(p_actor_id uuid, p_actor_email text, p_token_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_invitation private.zero_meo_invitations%rowtype;
  v_store_id uuid;
  v_member_id uuid;
begin
  if p_actor_id is null
    or nullif(btrim(p_actor_email), '') is null
    or p_token_hash is null
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or not exists (
      select 1
      from auth.users actor
      where actor.id = p_actor_id
        and lower(btrim(actor.email)) = lower(btrim(p_actor_email))
    )
  then
    raise exception using errcode = 'P0001', message = 'INVITATION_INVALID';
  end if;

  select invitation.* into v_invitation
  from private.zero_meo_invitations invitation
  where invitation.token_hash = p_token_hash
  for update;

  if not found
    or v_invitation.status <> 'pending'
    or v_invitation.expires_at <= statement_timestamp()
    or lower(btrim(v_invitation.email)) <> lower(btrim(p_actor_email))
  then
    raise exception using errcode = 'P0001', message = 'INVITATION_INVALID';
  end if;

  if p_actor_id = (
    select organization.owner_id
    from private.zero_meo_organizations organization
    where organization.id = v_invitation.organization_id
  ) then
    raise exception using errcode = 'P0001', message = 'OWNER_MEMBERSHIP_IMMUTABLE';
  end if;

  if v_invitation.store_id is null then
    insert into private.zero_meo_organization_members as membership (
      organization_id, user_id, role, status, created_by, updated_by
    ) values (
      v_invitation.organization_id, p_actor_id, v_invitation.role, 'active',
      v_invitation.created_by, p_actor_id
    ) on conflict (organization_id, user_id) do update set
      role = excluded.role,
      status = 'active',
      updated_by = p_actor_id
    where membership.role <> 'owner'
    returning membership.user_id into v_member_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'OWNER_MEMBERSHIP_IMMUTABLE';
    end if;

    select workspace.store_id into v_store_id
    from private.zero_meo_store_workspaces workspace
    join api.stores store on store.id = workspace.store_id
    where workspace.organization_id = v_invitation.organization_id
      and store.archived_at is null
    order by store.owner_store_slot, store.id
    limit 1;
  else
    select workspace.store_id into v_store_id
    from private.zero_meo_store_workspaces workspace
    join api.stores store on store.id = workspace.store_id
    where workspace.organization_id = v_invitation.organization_id
      and workspace.store_id = v_invitation.store_id
      and store.archived_at is null;

    if v_store_id is null then
      raise exception using errcode = 'P0001', message = 'INVITATION_INVALID';
    end if;

    insert into private.zero_meo_store_members as membership (
      organization_id, store_id, user_id, role, status, created_by, updated_by
    ) values (
      v_invitation.organization_id, v_store_id, p_actor_id,
      v_invitation.role, 'active', v_invitation.created_by, p_actor_id
    ) on conflict (store_id, user_id) do update set
      role = excluded.role,
      status = 'active',
      updated_by = p_actor_id
    where membership.role <> 'owner'
    returning membership.user_id into v_member_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'OWNER_MEMBERSHIP_IMMUTABLE';
    end if;
  end if;

  if v_store_id is null then
    raise exception using errcode = 'P0001', message = 'INVITATION_INVALID';
  end if;

  update private.zero_meo_invitations invitation set
    status = 'accepted',
    accepted_by = p_actor_id,
    accepted_at = statement_timestamp(),
    updated_by = p_actor_id
  where invitation.id = v_invitation.id;

  insert into private.zero_meo_audit_events (
    organization_id, store_id, actor_id, action, resource, resource_id,
    safe_metadata, created_by
  ) values (
    v_invitation.organization_id, v_store_id, p_actor_id,
    'accept', 'invitations', v_invitation.id,
    jsonb_build_object('scope', case when v_invitation.store_id is null then 'organization' else 'store' end),
    p_actor_id
  );

  return jsonb_build_object(
    'invitation_id', v_invitation.id,
    'organization_id', v_invitation.organization_id,
    'store_id', v_store_id,
    'role', v_invitation.role,
    'scope', case when v_invitation.store_id is null then 'organization' else 'store' end,
    'status', 'accepted'
  );
end;
$_$;


--
-- Name: internal_zero_meo_accessible_stores(uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_zero_meo_accessible_stores(p_actor_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', accessible.id,
        'name', accessible.name,
        'owner_store_slot', accessible.owner_store_slot,
        'public_slug', accessible.public_slug,
        'industry', accessible.industry,
        'address', accessible.address,
        'description', accessible.description,
        'website_url', accessible.website_url,
        'welcome_message', accessible.welcome_message,
        'closing_message', accessible.closing_message,
        'google_review_url', accessible.google_review_url,
        'google_place_id', accessible.google_place_id,
        'status', accessible.status,
        'archived_at', accessible.archived_at,
        'is_owned', accessible.is_owned,
        'access_role', accessible.access_role,
        'is_publicly_available', accessible.status = 'published'
      ) order by accessible.owner_store_slot, accessible.name, accessible.id
    ),
    '[]'::jsonb
  )
  from (
    select distinct on (store.id)
      store.id,
      store.name,
      store.owner_store_slot,
      store.public_slug,
      store.industry,
      store.address,
      store.description,
      store.website_url,
      store.welcome_message,
      store.closing_message,
      store.google_review_url,
      store.google_place_id,
      store.status,
      store.archived_at,
      store.owner_id = p_actor_id as is_owned,
      case
        when store.owner_id = p_actor_id then 'owner'
        else coalesce(store_member.role, organization_member.role)
      end as access_role
    from private.zero_meo_store_workspaces workspace
    join api.stores store
      on store.id = workspace.store_id
     and store.archived_at is null
    left join private.zero_meo_organization_members organization_member
      on organization_member.organization_id = workspace.organization_id
     and organization_member.user_id = p_actor_id
     and organization_member.status = 'active'
    left join private.zero_meo_store_members store_member
      on store_member.store_id = workspace.store_id
     and store_member.user_id = p_actor_id
     and store_member.status = 'active'
    where p_actor_id is not null
      and (
        store.owner_id = p_actor_id
        or organization_member.user_id is not null
        or store_member.user_id is not null
      )
    order by store.id
  ) accessible;
$$;


--
-- Name: internal_zero_meo_list(uuid, uuid, text, text, integer, jsonb); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_zero_meo_list(p_actor_id uuid, p_store_id uuid, p_resource text, p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_filters jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_auth jsonb;
  v_organization_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_before timestamptz := coalesce(nullif(p_cursor, '')::timestamptz, 'infinity'::timestamptz);
  v_items jsonb;
begin
  if not private.zero_meo_json_is_bounded(coalesce(p_filters, '{}'::jsonb), 8192) then
    raise exception using errcode = '22023', message = 'INVALID_FILTERS';
  end if;
  v_auth := api.internal_zero_meo_workspace_authorize(p_actor_id, p_store_id);
  v_organization_id := (v_auth ->> 'organization_id')::uuid;

  if p_resource = 'profile' then
    select coalesce(jsonb_agg(to_jsonb(item)), '[]'::jsonb) into v_items
    from (select * from private.meo_gbp_profiles where store_id = p_store_id) item;
  elsif p_resource = 'organizations' then
    select coalesce(jsonb_agg(to_jsonb(item)), '[]'::jsonb) into v_items
    from (select * from private.zero_meo_organizations where id = v_organization_id) item;
  elsif p_resource = 'snapshots' then
    select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb) into v_items
    from (select * from private.meo_gbp_profile_snapshots where store_id = p_store_id and created_at < v_before order by created_at desc, id desc limit v_limit) item;
  elsif p_resource = 'reviews' then
    select coalesce(
      jsonb_agg(item.review_document order by item.created_at desc, item.id desc),
      '[]'::jsonb
    ) into v_items
    from (
      select
        review.id,
        review.created_at,
        to_jsonb(review) || jsonb_build_object(
          'reply_history',
          coalesce(
            (
              select jsonb_agg(to_jsonb(revision) order by revision.created_at desc, revision.id desc)
              from private.meo_review_reply_revisions revision
              where revision.store_id = p_store_id
                and revision.review_id = review.id
            ),
            '[]'::jsonb
          )
        ) as review_document
      from private.meo_review_inbox review
      where review.store_id = p_store_id
        and review.created_at < v_before
        and (not (p_filters ? 'status') or review.status = p_filters ->> 'status')
        and (not (p_filters ? 'rating') or review.rating = (p_filters ->> 'rating')::smallint)
        and (not (p_filters ? 'language_code') or review.language = p_filters ->> 'language_code')
        and (
          not (p_filters ? 'search')
          or strpos(
            lower(
              coalesce(review.reviewer_display_name, '') || E'\n'
              || coalesce(review.review_text, '') || E'\n'
              || coalesce(review.reply_text, '') || E'\n'
              || array_to_string(review.tags, ' ')
            ),
            lower(p_filters ->> 'search')
          ) > 0
        )
      order by review.created_at desc, review.id desc
      limit v_limit
    ) item;
  elsif p_resource = 'review_templates' then
    select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb) into v_items
    from (select * from private.meo_review_reply_templates where store_id = p_store_id and created_at < v_before order by created_at desc, id desc limit v_limit) item;
  elsif p_resource = 'media' then
    select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb) into v_items
    from (select * from private.meo_media_assets where store_id = p_store_id and created_at < v_before order by created_at desc, id desc limit v_limit) item;
  elsif p_resource = 'posts' then
    select coalesce(jsonb_agg(item.post_document order by item.created_at desc, item.id desc), '[]'::jsonb) into v_items
    from (
      select
        post.id,
        post.created_at,
        to_jsonb(post) || jsonb_build_object(
          'latest_revision',
          coalesce(
            (
              select jsonb_build_object(
                'revision', revision.revision,
                'fingerprint', revision.revision_fingerprint,
                'created_at', revision.created_at
              )
              from private.meo_post_revisions revision
              where revision.store_id = p_store_id
                and revision.post_id = post.id
              order by revision.revision desc
              limit 1
            ),
            'null'::jsonb
          )
        ) as post_document
      from private.meo_post_drafts post
      where post.store_id = p_store_id
        and post.created_at < v_before
      order by post.created_at desc, post.id desc
      limit v_limit
    ) item;
  elsif p_resource = 'rank_observations' then
    select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb) into v_items
    from (select * from private.meo_rank_observations where store_id = p_store_id and created_at < v_before order by created_at desc, id desc limit v_limit) item;
  elsif p_resource = 'insights' then
    select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb) into v_items
    from (select * from private.meo_insight_snapshots where store_id = p_store_id and created_at < v_before order by created_at desc, id desc limit v_limit) item;
  elsif p_resource = 'aio_citations' then
    select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb) into v_items
    from (select * from private.meo_aio_citation_entries where store_id = p_store_id and created_at < v_before order by created_at desc, id desc limit v_limit) item;
  elsif p_resource = 'aio_observations' then
    select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb) into v_items
    from (select * from private.meo_aio_observations where store_id = p_store_id and created_at < v_before order by created_at desc, id desc limit v_limit) item;
  elsif p_resource = 'jsonld' then
    select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb) into v_items
    from (select * from private.meo_aio_jsonld_snapshots where store_id = p_store_id and created_at < v_before order by created_at desc, id desc limit v_limit) item;
  elsif p_resource = 'groups' then
    select coalesce(
      jsonb_agg(item.group_document order by item.created_at desc, item.id desc),
      '[]'::jsonb
    ) into v_items
    from (
      select
        grouping.id,
        grouping.created_at,
        to_jsonb(grouping) || jsonb_build_object(
          'store_ids',
          coalesce(
            (
              select jsonb_agg(to_jsonb(group_store.store_id) order by group_store.store_id)
              from private.zero_meo_group_stores group_store
              where group_store.organization_id = v_organization_id
                and group_store.group_id = grouping.id
            ),
            '[]'::jsonb
          )
        ) as group_document
      from private.zero_meo_store_groups grouping
      where grouping.organization_id = v_organization_id
        and grouping.created_at < v_before
      order by grouping.created_at desc, grouping.id desc
      limit v_limit
    ) item;
  elsif p_resource = 'members' then
    select coalesce(
      jsonb_agg(
        item.member_document
        order by item.created_at desc, item.user_id desc, item.scope_order
      ),
      '[]'::jsonb
    ) into v_items
    from (
      select scoped.*
      from (
        select
          organization_member.user_id,
          organization_member.created_at,
          0 as scope_order,
          to_jsonb(organization_member) || jsonb_build_object(
            'scope', 'organization',
            'store_id', null,
            'group_ids', '[]'::jsonb
          ) as member_document
        from private.zero_meo_organization_members organization_member
        where organization_member.organization_id = v_organization_id
        union all
        select
          store_member.user_id,
          store_member.created_at,
          1 as scope_order,
          to_jsonb(store_member) || jsonb_build_object(
            'scope', 'store',
            'group_ids', '[]'::jsonb
          ) as member_document
        from private.zero_meo_store_members store_member
        where store_member.organization_id = v_organization_id
          and store_member.store_id = p_store_id
      ) scoped
      where scoped.created_at < v_before
      order by scoped.created_at desc, scoped.user_id desc, scoped.scope_order
      limit v_limit
    ) item;
  elsif p_resource = 'change_requests' then
    select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb) into v_items
    from (select * from private.zero_meo_change_requests where store_id = p_store_id and created_at < v_before order by created_at desc, id desc limit v_limit) item;
  elsif p_resource = 'audit' then
    select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb) into v_items
    from (select * from private.zero_meo_audit_events where organization_id = v_organization_id and (store_id is null or store_id = p_store_id) and created_at < v_before order by created_at desc, id desc limit v_limit) item;
  else
    raise exception using errcode = '22023', message = 'UNSUPPORTED_RESOURCE';
  end if;

  return jsonb_build_object(
    'items', v_items,
    'next_cursor', case when jsonb_array_length(v_items) = v_limit then v_items -> -1 ->> 'created_at' else null end
  );
exception
  when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'INVALID_CURSOR';
end;
$$;


--
-- Name: internal_zero_meo_mutate(uuid, uuid, text, text, uuid, jsonb); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_zero_meo_mutate(p_actor_id uuid, p_store_id uuid, p_resource text, p_action text, p_record_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_auth jsonb;
  v_organization_id uuid;
  v_role text;
  v_resource text := p_resource;
  v_action text := p_action;
  v_record_id uuid := p_record_id;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_result jsonb;
  v_previous_profile jsonb := '{}'::jsonb;
  v_snapshot_id uuid;
  v_request private.zero_meo_change_requests%rowtype;
  v_approved_request_id uuid;
  v_revision integer;
  v_revision_fingerprint text;
  v_post_content jsonb;
  v_user_id uuid;
  v_scope text;
begin
  if not private.zero_meo_json_is_bounded(v_payload, 65536) then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD';
  end if;
  v_auth := api.internal_zero_meo_workspace_authorize(p_actor_id, p_store_id);
  v_organization_id := (v_auth ->> 'organization_id')::uuid;
  v_role := v_auth ->> 'role';

  if v_role = 'analyst' then
    raise exception using errcode = 'P0001', message = 'READ_ONLY_ROLE';
  end if;

  if p_resource = 'change_requests' and p_action in ('approve', 'reject') then
    if v_role not in ('owner', 'admin') or p_record_id is null then
      raise exception using errcode = 'P0001', message = 'APPROVAL_FORBIDDEN';
    end if;
    select * into v_request from private.zero_meo_change_requests
    where id = p_record_id and organization_id = v_organization_id
      and store_id = p_store_id and status = 'pending'
    for update;
    if not found or v_request.requested_by = p_actor_id then
      raise exception using errcode = 'P0001', message = 'APPROVAL_FORBIDDEN';
    end if;
    if not private.zero_meo_change_request_is_valid(
      v_request.resource,
      v_request.action,
      v_request.record_id,
      v_request.payload
    ) then
      raise exception using errcode = '22023', message = 'INVALID_CHANGE_REQUEST';
    end if;
    if v_request.resource = 'groups' then
      if not exists (
        select 1
        from private.zero_meo_store_groups grouping
        where grouping.id = v_request.record_id
          and grouping.organization_id = v_organization_id
      ) or (
        v_request.payload ? 'store_ids'
        and exists (
          select 1
          from jsonb_array_elements_text(v_request.payload -> 'store_ids') requested(store_id)
          where not exists (
            select 1
            from private.zero_meo_store_workspaces workspace
            where workspace.organization_id = v_organization_id
              and workspace.store_id = requested.store_id::uuid
          )
        )
      ) then
        raise exception using errcode = '22023', message = 'INVALID_CHANGE_REQUEST';
      end if;
    end if;
    if p_action = 'reject' then
      update private.zero_meo_change_requests set
        status = 'rejected', reviewed_by = p_actor_id,
        review_note = nullif(v_payload ->> 'note', ''),
        reviewed_at = statement_timestamp(), updated_by = p_actor_id
      where id = v_request.id returning to_jsonb(zero_meo_change_requests.*) into v_result;
      insert into private.zero_meo_audit_events (
        organization_id, store_id, actor_id, action, resource, resource_id,
        safe_metadata, created_by
      ) values (
        v_organization_id, p_store_id, p_actor_id, 'reject',
        'change_requests', v_request.id, '{}'::jsonb, p_actor_id
      );
      return v_result;
    end if;
    update private.zero_meo_change_requests set
      status = 'approved', reviewed_by = p_actor_id,
      review_note = nullif(v_payload ->> 'note', ''),
      reviewed_at = statement_timestamp(), updated_by = p_actor_id
    where id = v_request.id;
    v_approved_request_id := v_request.id;
    v_resource := v_request.resource;
    v_action := v_request.action;
    v_record_id := v_request.record_id;
    v_payload := v_request.payload;
  elsif p_resource = 'change_requests' and p_action = 'create' then
    if not private.zero_meo_change_request_is_valid(
      v_payload ->> 'resource',
      v_payload ->> 'action',
      nullif(v_payload ->> 'record_id', '')::uuid,
      coalesce(v_payload -> 'payload', '{}'::jsonb)
    ) then
      raise exception using errcode = '22023', message = 'INVALID_CHANGE_REQUEST';
    end if;
    if v_payload ->> 'resource' = 'groups' then
      if not exists (
        select 1
        from private.zero_meo_store_groups grouping
        where grouping.id = nullif(v_payload ->> 'record_id', '')::uuid
          and grouping.organization_id = v_organization_id
      ) or (
        coalesce(v_payload -> 'payload', '{}'::jsonb) ? 'store_ids'
        and exists (
          select 1
          from jsonb_array_elements_text(v_payload -> 'payload' -> 'store_ids') requested(store_id)
          where not exists (
            select 1
            from private.zero_meo_store_workspaces workspace
            where workspace.organization_id = v_organization_id
              and workspace.store_id = requested.store_id::uuid
          )
        )
      ) then
        raise exception using errcode = '22023', message = 'INVALID_CHANGE_REQUEST';
      end if;
    end if;
    insert into private.zero_meo_change_requests (
      organization_id, store_id, resource, action, record_id, request_reason, payload,
      requested_by, created_by, updated_by
    ) values (
      v_organization_id, p_store_id, v_payload ->> 'resource',
      v_payload ->> 'action', nullif(v_payload ->> 'record_id', '')::uuid,
      nullif(v_payload ->> 'reason', ''),
      coalesce(v_payload -> 'payload', '{}'::jsonb), p_actor_id, p_actor_id, p_actor_id
    ) returning to_jsonb(zero_meo_change_requests.*) into v_result;
    return v_result;
  elsif (v_auth ->> 'approval_required')::boolean then
    if not private.zero_meo_change_request_is_valid(
      v_resource, v_action, v_record_id, v_payload
    ) then
      raise exception using errcode = '22023', message = 'INVALID_CHANGE_REQUEST';
    end if;
    insert into private.zero_meo_change_requests (
      organization_id, store_id, resource, action, record_id, request_reason, payload,
      requested_by, created_by, updated_by
    ) values (
      v_organization_id, p_store_id, v_resource, v_action, v_record_id,
      null, v_payload, p_actor_id, p_actor_id, p_actor_id
    ) returning to_jsonb(zero_meo_change_requests.*) into v_result;
    return jsonb_build_object('approval_required', true, 'change_request', v_result);
  end if;

  if v_resource = 'profile' and v_action = 'save' then
    if jsonb_typeof(v_payload -> 'profile') <> 'object' then
      raise exception using errcode = '22023', message = 'INVALID_PROFILE';
    end if;
    select profile into v_previous_profile from private.meo_gbp_profiles where store_id = p_store_id;
    insert into private.meo_gbp_profiles as profile (
      store_id, profile, source, provider_etag, created_by, updated_by
    ) values (
      p_store_id, v_payload -> 'profile', coalesce(v_payload ->> 'source', 'manual'),
      nullif(v_payload ->> 'provider_etag', ''), p_actor_id, p_actor_id
    ) on conflict (store_id) do update set
      profile = excluded.profile, source = excluded.source,
      provider_etag = excluded.provider_etag, updated_by = p_actor_id
    returning to_jsonb(profile.*) into v_result;
    insert into private.meo_gbp_profile_snapshots (
      store_id, profile, diff, source, created_by
    ) values (
      p_store_id, v_payload -> 'profile',
      jsonb_build_object('before', coalesce(v_previous_profile, '{}'::jsonb), 'after', v_payload -> 'profile'),
      coalesce(v_payload ->> 'source', 'manual'), p_actor_id
    ) returning id into v_snapshot_id;
    v_result := v_result || jsonb_build_object('snapshot_id', v_snapshot_id);
  elsif v_resource = 'snapshots' and v_action = 'restore' then
    select profile into v_previous_profile from private.meo_gbp_profile_snapshots
    where id = v_record_id and store_id = p_store_id;
    if not found then raise exception using errcode = 'P0001', message = 'SNAPSHOT_NOT_FOUND'; end if;
    insert into private.meo_gbp_profiles as profile (store_id, profile, source, created_by, updated_by)
    values (p_store_id, v_previous_profile, 'manual', p_actor_id, p_actor_id)
    on conflict (store_id) do update set profile = excluded.profile, source = 'manual', updated_by = p_actor_id
    returning to_jsonb(profile.*) into v_result;
    insert into private.meo_gbp_profile_snapshots (store_id, profile, diff, source, base_snapshot_id, created_by)
    values (p_store_id, v_previous_profile, jsonb_build_object('restored_from', v_record_id), 'restore', v_record_id, p_actor_id)
    returning id into v_snapshot_id;
    v_result := v_result || jsonb_build_object('snapshot_id', v_snapshot_id);
  elsif v_resource = 'reviews' and v_action = 'create' then
    insert into private.meo_review_inbox (
      store_id, provider, provider_review_id, reviewer_display_name, rating,
      review_text, language, status, tags, native_analysis_input,
      reviewed_at, created_by, updated_by
    ) values (
      p_store_id, coalesce(v_payload ->> 'provider', 'manual'), nullif(v_payload ->> 'provider_review_id', ''),
      nullif(v_payload ->> 'reviewer_display_name', ''), (v_payload ->> 'rating')::smallint,
      nullif(v_payload ->> 'review_text', ''), coalesce(v_payload ->> 'language', 'und'),
      coalesce(v_payload ->> 'status', 'unread'),
      coalesce(array(select jsonb_array_elements_text(v_payload -> 'tags')), '{}'::text[]),
      coalesce(v_payload -> 'native_analysis_input', '{}'::jsonb),
      nullif(v_payload ->> 'reviewed_at', '')::timestamptz, p_actor_id, p_actor_id
    ) returning to_jsonb(meo_review_inbox.*) into v_result;
  elsif v_resource = 'reviews' and v_action = 'update' then
    update private.meo_review_inbox review set
      status = coalesce(v_payload ->> 'status', review.status),
      language = coalesce(v_payload ->> 'language', review.language),
      tags = case when v_payload ? 'tags' then array(select jsonb_array_elements_text(v_payload -> 'tags')) else review.tags end,
      reply_text = case when v_payload ? 'reply' then nullif(v_payload ->> 'reply', '') else review.reply_text end,
      reply_language = case
        when v_payload ? 'reply_language' then nullif(v_payload ->> 'reply_language', '')
        when v_payload ? 'reply' and nullif(v_payload ->> 'reply', '') is null then null
        else review.reply_language
      end,
      replied_at = case when v_payload ? 'reply' and nullif(v_payload ->> 'reply', '') is not null then statement_timestamp() else review.replied_at end,
      updated_by = p_actor_id
    where review.id = v_record_id and review.store_id = p_store_id
    returning to_jsonb(review.*) into v_result;
    if v_result is null then raise exception using errcode = 'P0001', message = 'REVIEW_NOT_FOUND'; end if;
    if v_payload ? 'reply' then
      insert into private.meo_review_reply_revisions (
        store_id, review_id, template_id, body, language,
        revision_action, created_by
      )
      values (p_store_id, v_record_id, nullif(v_payload ->> 'template_id', '')::uuid,
        nullif(v_payload ->> 'reply', ''), nullif(v_result ->> 'reply_language', ''),
        case when nullif(v_payload ->> 'reply', '') is null then 'deleted' else 'edited' end,
        p_actor_id);
    end if;
  elsif v_resource = 'review_templates' and v_action = 'create' then
    insert into private.meo_review_reply_templates (
      store_id, name, body, language, min_rating, max_rating, created_by, updated_by
    )
    values (
      p_store_id, v_payload ->> 'name', v_payload ->> 'body',
      coalesce(v_payload ->> 'language', 'ja'),
      nullif(v_payload ->> 'min_rating', '')::smallint,
      nullif(v_payload ->> 'max_rating', '')::smallint,
      p_actor_id, p_actor_id
    )
    returning to_jsonb(meo_review_reply_templates.*) into v_result;
  elsif v_resource = 'review_templates' and v_action = 'update' then
    update private.meo_review_reply_templates template set
      name = coalesce(v_payload ->> 'name', template.name), body = coalesce(v_payload ->> 'body', template.body),
      language = coalesce(v_payload ->> 'language', template.language),
      min_rating = case when v_payload ? 'min_rating' then nullif(v_payload ->> 'min_rating', '')::smallint else template.min_rating end,
      max_rating = case when v_payload ? 'max_rating' then nullif(v_payload ->> 'max_rating', '')::smallint else template.max_rating end,
      status = coalesce(v_payload ->> 'status', template.status), updated_by = p_actor_id
    where template.id = v_record_id and template.store_id = p_store_id returning to_jsonb(template.*) into v_result;
  elsif v_resource = 'review_templates' and v_action = 'delete' then
    update private.meo_review_reply_templates template set status = 'archived', updated_by = p_actor_id
    where template.id = v_record_id and template.store_id = p_store_id returning to_jsonb(template.*) into v_result;
  elsif v_resource = 'media' and v_action = 'create' then
    insert into private.meo_media_assets (store_id, storage_path, media_type, mime_type, alt_text, byte_size, safe_metadata, created_by, updated_by)
    values (p_store_id, v_payload ->> 'storage_path', v_payload ->> 'media_type', v_payload ->> 'mime_type', nullif(v_payload ->> 'alt_text', ''), nullif(v_payload ->> 'byte_size', '')::bigint, coalesce(v_payload -> 'safe_metadata', '{}'::jsonb), p_actor_id, p_actor_id)
    returning to_jsonb(meo_media_assets.*) into v_result;
  elsif v_resource = 'media' and v_action = 'update' then
    update private.meo_media_assets asset set alt_text = coalesce(v_payload ->> 'alt_text', asset.alt_text),
      status = coalesce(v_payload ->> 'status', asset.status), updated_by = p_actor_id
    where asset.id = v_record_id and asset.store_id = p_store_id returning to_jsonb(asset.*) into v_result;
  elsif v_resource = 'posts' and v_action = 'create' then
    if exists (
      select 1
      from unnest(coalesce(array(select jsonb_array_elements_text(v_payload -> 'media_asset_ids'))::uuid[], '{}'::uuid[])) requested(asset_id)
      where not exists (
        select 1 from private.meo_media_assets asset
        where asset.id = requested.asset_id
          and asset.store_id = p_store_id
          and asset.status = 'active'
      )
    ) then
      raise exception using errcode = 'P0001', message = 'INVALID_MEDIA_ASSET';
    end if;
    insert into private.meo_post_drafts (store_id, post_type, title, summary, call_to_action, call_to_action_url, media_asset_ids, details, status, created_by, updated_by)
    values (p_store_id, coalesce(v_payload ->> 'post_type', 'update'), nullif(v_payload ->> 'title', ''), v_payload ->> 'summary', nullif(v_payload ->> 'call_to_action', ''), nullif(v_payload ->> 'call_to_action_url', ''), coalesce(array(select jsonb_array_elements_text(v_payload -> 'media_asset_ids'))::uuid[], '{}'::uuid[]), coalesce(v_payload -> 'details', '{}'::jsonb), coalesce(v_payload ->> 'status', 'draft'), p_actor_id, p_actor_id)
    returning to_jsonb(meo_post_drafts.*) into v_result;
    v_record_id := (v_result ->> 'id')::uuid;
    v_revision := 1;
    v_post_content := v_result - array['created_by','updated_by','created_at','updated_at'];
    v_revision_fingerprint := encode(extensions.digest(convert_to(v_post_content::text, 'UTF8'), 'sha256'), 'hex');
    insert into private.meo_post_revisions (store_id, post_id, revision, content, revision_fingerprint, created_by)
    values (p_store_id, v_record_id, v_revision, v_post_content, v_revision_fingerprint, p_actor_id);
    v_result := v_result || jsonb_build_object('revision', v_revision, 'revision_fingerprint', v_revision_fingerprint);
  elsif v_resource = 'posts' and v_action = 'update' then
    perform 1 from private.meo_post_drafts post
    where post.id = v_record_id and post.store_id = p_store_id
    for update;
    if not found then raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND'; end if;
    if v_payload ? 'media_asset_ids' and exists (
      select 1
      from unnest(array(select jsonb_array_elements_text(v_payload -> 'media_asset_ids'))::uuid[]) requested(asset_id)
      where not exists (
        select 1 from private.meo_media_assets asset
        where asset.id = requested.asset_id
          and asset.store_id = p_store_id
          and asset.status = 'active'
      )
    ) then
      raise exception using errcode = 'P0001', message = 'INVALID_MEDIA_ASSET';
    end if;
    update private.meo_post_drafts post set
      post_type = coalesce(v_payload ->> 'post_type', post.post_type), title = case when v_payload ? 'title' then nullif(v_payload ->> 'title', '') else post.title end,
      summary = coalesce(v_payload ->> 'summary', post.summary), call_to_action = case when v_payload ? 'call_to_action' then nullif(v_payload ->> 'call_to_action', '') else post.call_to_action end,
      call_to_action_url = case when v_payload ? 'call_to_action_url' then nullif(v_payload ->> 'call_to_action_url', '') else post.call_to_action_url end,
      media_asset_ids = case when v_payload ? 'media_asset_ids' then array(select jsonb_array_elements_text(v_payload -> 'media_asset_ids'))::uuid[] else post.media_asset_ids end,
      details = coalesce(v_payload -> 'details', post.details),
      status = coalesce(v_payload ->> 'status', post.status), updated_by = p_actor_id
    where post.id = v_record_id and post.store_id = p_store_id returning to_jsonb(post.*) into v_result;
    select coalesce(max(revision), 0) + 1 into v_revision from private.meo_post_revisions where post_id = v_record_id;
    v_post_content := v_result - array['created_by','updated_by','created_at','updated_at'];
    v_revision_fingerprint := encode(extensions.digest(convert_to(v_post_content::text, 'UTF8'), 'sha256'), 'hex');
    insert into private.meo_post_revisions (store_id, post_id, revision, content, revision_fingerprint, created_by)
    values (p_store_id, v_record_id, v_revision, v_post_content, v_revision_fingerprint, p_actor_id);
    v_result := v_result || jsonb_build_object('revision', v_revision, 'revision_fingerprint', v_revision_fingerprint);
  elsif v_resource = 'posts' and v_action = 'delete' then
    update private.meo_post_drafts post set status = 'deleted', updated_by = p_actor_id
    where post.id = v_record_id and post.store_id = p_store_id returning to_jsonb(post.*) into v_result;
  elsif v_resource = 'posts' and v_action = 'record_publish_confirmation' then
    perform 1 from private.meo_post_drafts post
    where post.id = v_record_id and post.store_id = p_store_id and post.status = 'ready'
    for update;
    if not found then raise exception using errcode = 'P0001', message = 'POST_NOT_READY'; end if;
    select revision, revision_fingerprint into v_revision, v_revision_fingerprint
    from private.meo_post_revisions
    where post_id = v_record_id and store_id = p_store_id
    order by revision desc
    limit 1;
    if nullif(v_payload ->> 'revision', '')::integer is distinct from v_revision
      or nullif(v_payload ->> 'revision_fingerprint', '') is distinct from v_revision_fingerprint
    then
      raise exception using errcode = 'P0001', message = 'POST_REVISION_MISMATCH';
    end if;
    insert into private.meo_post_publication_events (store_id, post_id, revision, revision_fingerprint, outcome, provider_resource_name, safe_readback, confirmed_at, created_by)
    values (p_store_id, v_record_id, v_revision, v_revision_fingerprint, coalesce(v_payload ->> 'outcome', 'confirmed'), nullif(v_payload ->> 'provider_resource_name', ''), coalesce(v_payload -> 'safe_readback', '{}'::jsonb), coalesce(nullif(v_payload ->> 'confirmed_at', '')::timestamptz, statement_timestamp()), p_actor_id)
    returning to_jsonb(meo_post_publication_events.*) into v_result;
    update private.meo_post_drafts set status = case when coalesce(v_payload ->> 'outcome', 'confirmed') = 'confirmed' then 'published' else status end,
      provider_resource_name = coalesce(nullif(v_payload ->> 'provider_resource_name', ''), provider_resource_name), updated_by = p_actor_id
    where id = v_record_id and store_id = p_store_id;
  elsif v_resource = 'rank_observations' and v_action = 'create' then
    insert into private.meo_rank_observations (
      store_id, keyword, normalized_keyword, own_place_id, own_position,
      competitor_positions, source, observed_at, result_count, input_method,
      import_batch_id, location_label, latitude, longitude, matched_url,
      created_by
    )
    values (
      p_store_id, v_payload ->> 'keyword',
      lower(regexp_replace(btrim(v_payload ->> 'keyword'), '[[:space:]]+', ' ', 'g')),
      v_payload ->> 'target_place_id', nullif(v_payload ->> 'position', '')::smallint,
      coalesce(v_payload -> 'competitor_positions', '[]'::jsonb), 'manual',
      coalesce(nullif(v_payload ->> 'observed_at', '')::timestamptz, statement_timestamp()),
      nullif(v_payload ->> 'result_count', '')::smallint,
      coalesce(v_payload ->> 'input_method', 'manual'),
      nullif(v_payload ->> 'import_batch_id', '')::uuid,
      nullif(v_payload -> 'location' ->> 'label', ''),
      nullif(v_payload -> 'location' ->> 'latitude', '')::numeric,
      nullif(v_payload -> 'location' ->> 'longitude', '')::numeric,
      nullif(v_payload ->> 'matched_url', ''), p_actor_id
    )
    returning to_jsonb(meo_rank_observations.*) into v_result;
  elsif v_resource = 'insights' and v_action = 'create' then
    insert into private.meo_insight_snapshots as insight (store_id, period_start, period_end, source, metrics, input_method, import_batch_id, created_by, updated_by)
    values (p_store_id, (v_payload ->> 'period_start')::date, (v_payload ->> 'period_end')::date, coalesce(v_payload ->> 'source', 'manual'), v_payload -> 'metrics', coalesce(v_payload ->> 'input_method', 'manual'), nullif(v_payload ->> 'import_batch_id', '')::uuid, p_actor_id, p_actor_id)
    on conflict (store_id, period_start, period_end, source) do update set metrics = excluded.metrics, input_method = excluded.input_method, import_batch_id = excluded.import_batch_id, updated_by = p_actor_id
    returning to_jsonb(insight.*) into v_result;
  elsif v_resource = 'aio_citations' and v_action = 'create' then
    insert into private.meo_aio_citation_entries (store_id, source_name, source_type, url, nap_snapshot, consistency_status, last_checked_at, notes, created_by, updated_by)
    values (p_store_id, v_payload ->> 'source_name', v_payload ->> 'source_type', nullif(v_payload ->> 'url', ''), coalesce(v_payload -> 'nap_snapshot', '{}'::jsonb), coalesce(v_payload ->> 'consistency_status', 'unchecked'), nullif(v_payload ->> 'last_checked_at', '')::timestamptz, nullif(v_payload ->> 'notes', ''), p_actor_id, p_actor_id)
    returning to_jsonb(meo_aio_citation_entries.*) into v_result;
  elsif v_resource = 'aio_citations' and v_action = 'update' then
    update private.meo_aio_citation_entries citation set source_name = coalesce(v_payload ->> 'source_name', citation.source_name), source_type = coalesce(v_payload ->> 'source_type', citation.source_type),
      url = case when v_payload ? 'url' then nullif(v_payload ->> 'url', '') else citation.url end, nap_snapshot = coalesce(v_payload -> 'nap_snapshot', citation.nap_snapshot),
      consistency_status = coalesce(v_payload ->> 'consistency_status', citation.consistency_status), last_checked_at = coalesce(nullif(v_payload ->> 'last_checked_at', '')::timestamptz, citation.last_checked_at), notes = case when v_payload ? 'notes' then nullif(v_payload ->> 'notes', '') else citation.notes end, updated_by = p_actor_id
    where citation.id = v_record_id and citation.store_id = p_store_id returning to_jsonb(citation.*) into v_result;
  elsif v_resource = 'aio_citations' and v_action = 'delete' then
    delete from private.meo_aio_citation_entries citation where citation.id = v_record_id and citation.store_id = p_store_id returning to_jsonb(citation.*) into v_result;
  elsif v_resource = 'aio_observations' and v_action = 'create' then
    insert into private.meo_aio_observations (
      store_id, prompt, engine, mentioned, position, cited_urls, observed_at,
      notes, created_by, updated_by
    ) values (
      p_store_id, v_payload ->> 'prompt', v_payload ->> 'engine',
      (v_payload ->> 'mentioned')::boolean,
      nullif(v_payload ->> 'position', '')::smallint,
      coalesce(
        array(select jsonb_array_elements_text(v_payload -> 'cited_urls')),
        '{}'::text[]
      ),
      coalesce(
        nullif(v_payload ->> 'observed_at', '')::timestamptz,
        statement_timestamp()
      ),
      nullif(v_payload ->> 'notes', ''), p_actor_id, p_actor_id
    ) returning to_jsonb(meo_aio_observations.*) into v_result;
  elsif v_resource = 'aio_observations' and v_action = 'update' then
    update private.meo_aio_observations observation set
      prompt = coalesce(v_payload ->> 'prompt', observation.prompt),
      engine = coalesce(v_payload ->> 'engine', observation.engine),
      mentioned = coalesce(
        nullif(v_payload ->> 'mentioned', '')::boolean,
        observation.mentioned
      ),
      position = case
        when v_payload ? 'position' then nullif(v_payload ->> 'position', '')::smallint
        else observation.position
      end,
      cited_urls = case
        when v_payload ? 'cited_urls'
          then array(select jsonb_array_elements_text(v_payload -> 'cited_urls'))
        else observation.cited_urls
      end,
      observed_at = coalesce(
        nullif(v_payload ->> 'observed_at', '')::timestamptz,
        observation.observed_at
      ),
      notes = case
        when v_payload ? 'notes' then nullif(v_payload ->> 'notes', '')
        else observation.notes
      end,
      updated_by = p_actor_id
    where observation.id = v_record_id
      and observation.store_id = p_store_id
    returning to_jsonb(observation.*) into v_result;
  elsif v_resource = 'aio_observations' and v_action = 'delete' then
    delete from private.meo_aio_observations observation
    where observation.id = v_record_id
      and observation.store_id = p_store_id
    returning to_jsonb(observation.*) into v_result;
  elsif v_resource = 'jsonld' and v_action = 'save' then
    insert into private.meo_aio_jsonld_snapshots (store_id, schema_type, document, validation_errors, status, created_by, updated_by)
    values (p_store_id, coalesce(v_payload ->> 'schema_type', 'LocalBusiness'), v_payload -> 'document', coalesce(v_payload -> 'validation_errors', '[]'::jsonb), coalesce(v_payload ->> 'status', 'draft'), p_actor_id, p_actor_id)
    returning to_jsonb(meo_aio_jsonld_snapshots.*) into v_result;
  elsif v_resource = 'organizations' and v_action = 'create' then
    if v_role <> 'owner' then raise exception using errcode = 'P0001', message = 'OWNER_REQUIRED'; end if;
    insert into private.zero_meo_organizations as organization (
      owner_id, name, approval_policy, created_by, updated_by
    )
    values (p_actor_id, v_payload ->> 'name', coalesce(v_payload ->> 'approval_policy', 'owner_direct'), p_actor_id, p_actor_id)
    on conflict (owner_id) do update set
      name = excluded.name,
      approval_policy = excluded.approval_policy,
      updated_by = p_actor_id
    returning to_jsonb(organization.*) into v_result;
  elsif v_resource = 'organizations' and v_action = 'update' then
    if v_role <> 'owner' then raise exception using errcode = 'P0001', message = 'OWNER_REQUIRED'; end if;
    update private.zero_meo_organizations organization set name = coalesce(v_payload ->> 'name', organization.name), approval_policy = coalesce(v_payload ->> 'approval_policy', organization.approval_policy), updated_by = p_actor_id
    where organization.id = v_organization_id returning to_jsonb(organization.*) into v_result;
    update private.zero_meo_store_workspaces set approval_policy = coalesce(v_payload ->> 'approval_policy', approval_policy), updated_by = p_actor_id where organization_id = v_organization_id;
  elsif v_resource = 'groups' and v_action = 'create' then
    insert into private.zero_meo_store_groups (
      organization_id, name, description, parent_group_id, created_by, updated_by
    )
    values (
      v_organization_id, v_payload ->> 'name',
      nullif(v_payload ->> 'description', ''),
      nullif(v_payload ->> 'parent_group_id', '')::uuid,
      p_actor_id, p_actor_id
    )
    returning to_jsonb(zero_meo_store_groups.*) into v_result;
    v_record_id := (v_result ->> 'id')::uuid;
    if v_payload ? 'store_ids' then
      insert into private.zero_meo_group_stores (
        organization_id, group_id, store_id, created_by
      )
      select v_organization_id, v_record_id, workspace.store_id, p_actor_id
      from private.zero_meo_store_workspaces workspace
      join (
        select jsonb_array_elements_text(v_payload -> 'store_ids')::uuid as store_id
      ) requested using (store_id)
      where workspace.organization_id = v_organization_id
      on conflict (group_id, store_id) do nothing;
    end if;
  elsif v_resource = 'groups' and v_action = 'update' then
    update private.zero_meo_store_groups grouping set name = coalesce(v_payload ->> 'name', grouping.name), description = case when v_payload ? 'description' then nullif(v_payload ->> 'description', '') else grouping.description end,
      parent_group_id = case when v_payload ? 'parent_group_id' then nullif(v_payload ->> 'parent_group_id', '')::uuid else grouping.parent_group_id end,
      updated_by = p_actor_id
    where grouping.id = v_record_id and grouping.organization_id = v_organization_id returning to_jsonb(grouping.*) into v_result;
    if v_result is not null and v_payload ? 'store_ids' then
      delete from private.zero_meo_group_stores
      where group_id = v_record_id and organization_id = v_organization_id;
      insert into private.zero_meo_group_stores (
        organization_id, group_id, store_id, created_by
      )
      select v_organization_id, v_record_id, workspace.store_id, p_actor_id
      from private.zero_meo_store_workspaces workspace
      join (
        select jsonb_array_elements_text(v_payload -> 'store_ids')::uuid as store_id
      ) requested using (store_id)
      where workspace.organization_id = v_organization_id;
    end if;
  elsif v_resource = 'groups' and v_action = 'delete' then
    update private.zero_meo_store_groups grouping set status = 'archived', updated_by = p_actor_id
    where grouping.id = v_record_id and grouping.organization_id = v_organization_id returning to_jsonb(grouping.*) into v_result;
  elsif v_resource = 'members' and v_action in ('create', 'update') then
    if v_role not in ('owner', 'admin') then raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED'; end if;
    v_scope := coalesce(v_payload ->> 'scope', 'organization');
    if v_scope not in ('organization', 'store')
      or (
        v_payload ? 'group_ids'
        and jsonb_array_length(coalesce(v_payload -> 'group_ids', '[]'::jsonb)) > 0
      )
    then
      raise exception using errcode = '22023', message = 'UNSUPPORTED_MEMBER_SCOPE';
    end if;
    if nullif(v_payload ->> 'user_id', '') is null then
      insert into private.zero_meo_invitations (
        organization_id, store_id, email, role, token_hash, expires_at,
        created_by, updated_by
      ) values (
        v_organization_id,
        case when v_scope = 'store' then p_store_id else null end,
        lower(btrim(v_payload ->> 'email')),
        v_payload ->> 'role',
        v_payload ->> 'token_hash',
        (v_payload ->> 'expires_at')::timestamptz,
        p_actor_id, p_actor_id
      ) returning to_jsonb(zero_meo_invitations.*) into v_result;
      v_record_id := (v_result ->> 'id')::uuid;
    else
      v_user_id := (v_payload ->> 'user_id')::uuid;
    if v_payload ->> 'role' = 'owner' and v_role <> 'owner' then raise exception using errcode = 'P0001', message = 'OWNER_REQUIRED'; end if;
    if v_scope = 'store' then
      insert into private.zero_meo_store_members (organization_id, store_id, user_id, role, status, created_by, updated_by)
      values (v_organization_id, p_store_id, v_user_id, v_payload ->> 'role', coalesce(v_payload ->> 'status', 'active'), p_actor_id, p_actor_id)
      on conflict (store_id, user_id) do update set role = excluded.role, status = excluded.status, updated_by = p_actor_id
      returning to_jsonb(zero_meo_store_members.*) into v_result;
    else
      insert into private.zero_meo_organization_members (organization_id, user_id, role, status, created_by, updated_by)
      values (v_organization_id, v_user_id, v_payload ->> 'role', coalesce(v_payload ->> 'status', 'active'), p_actor_id, p_actor_id)
      on conflict (organization_id, user_id) do update set role = excluded.role, status = excluded.status, updated_by = p_actor_id
      returning to_jsonb(zero_meo_organization_members.*) into v_result;
    end if;
    end if;
  elsif v_resource = 'members' and v_action = 'delete' then
    if v_role not in ('owner', 'admin') then raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED'; end if;
    v_user_id := coalesce(nullif(v_payload ->> 'user_id', '')::uuid, v_record_id);
    if v_user_id = (select owner_id from private.zero_meo_organizations where id = v_organization_id) then raise exception using errcode = 'P0001', message = 'OWNER_CANNOT_BE_REMOVED'; end if;
    v_scope := coalesce(v_payload ->> 'scope', 'organization');
    if v_scope = 'store' then
      delete from private.zero_meo_store_members where store_id = p_store_id and user_id = v_user_id returning to_jsonb(zero_meo_store_members.*) into v_result;
    else
      delete from private.zero_meo_organization_members where organization_id = v_organization_id and user_id = v_user_id returning to_jsonb(zero_meo_organization_members.*) into v_result;
    end if;
  else
    raise exception using errcode = '22023', message = 'UNSUPPORTED_MUTATION';
  end if;

  if v_result is null then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;

  insert into private.zero_meo_audit_events (
    organization_id, store_id, actor_id, action, resource, resource_id,
    safe_metadata, created_by
  ) values (
    v_organization_id, p_store_id, p_actor_id, v_action, v_resource,
    coalesce(v_record_id, nullif(v_result ->> 'id', '')::uuid),
    jsonb_build_object('approved_request_id', v_approved_request_id), p_actor_id
  );

  if v_approved_request_id is not null then
    update private.zero_meo_change_requests set status = 'applied', applied_at = statement_timestamp(), updated_by = p_actor_id
    where id = v_approved_request_id;
    v_result := v_result || jsonb_build_object('approved_request_id', v_approved_request_id);
  end if;
  return v_result;
end;
$$;


--
-- Name: FUNCTION internal_zero_meo_mutate(p_actor_id uuid, p_store_id uuid, p_resource text, p_action text, p_record_id uuid, p_payload jsonb); Type: COMMENT; Schema: api; Owner: -
--

COMMENT ON FUNCTION api.internal_zero_meo_mutate(p_actor_id uuid, p_store_id uuid, p_resource text, p_action text, p_record_id uuid, p_payload jsonb) IS 'Closed mutation router for manual Zero MEO work. It never schedules or autonomously executes external actions.';


--
-- Name: internal_zero_meo_workspace_authorize(uuid, uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_zero_meo_workspace_authorize(p_actor_id uuid, p_store_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_organization_id uuid;
  v_role text;
  v_policy text;
begin
  if p_actor_id is null or p_store_id is null then
    raise exception using errcode = 'P0001', message = 'STORE_ACCESS_DENIED';
  end if;

  select workspace.organization_id, workspace.approval_policy,
    case
      when store.owner_id = p_actor_id then 'owner'
      else coalesce(store_member.role, organization_member.role)
    end
  into v_organization_id, v_policy, v_role
  from private.zero_meo_store_workspaces workspace
  join api.stores store on store.id = workspace.store_id and store.archived_at is null
  left join private.zero_meo_store_members store_member
    on store_member.store_id = workspace.store_id
   and store_member.user_id = p_actor_id
   and store_member.status = 'active'
  left join private.zero_meo_organization_members organization_member
    on organization_member.organization_id = workspace.organization_id
   and organization_member.user_id = p_actor_id
   and organization_member.status = 'active'
  where workspace.store_id = p_store_id;

  if v_role is null then
    raise exception using errcode = 'P0001', message = 'STORE_ACCESS_DENIED';
  end if;

  return jsonb_build_object(
    'allowed', true,
    'organization_id', v_organization_id,
    'store_id', p_store_id,
    'role', v_role,
    'approval_required', v_role = 'editor' and v_policy = 'two_person',
    'approval_policy', v_policy
  );
end;
$$;


--
-- Name: internal_zero_meo_workspace_snapshot(uuid, uuid); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.internal_zero_meo_workspace_snapshot(p_actor_id uuid, p_store_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_auth jsonb;
  v_organization_id uuid;
  v_result jsonb;
begin
  v_auth := api.internal_zero_meo_workspace_authorize(p_actor_id, p_store_id);
  v_organization_id := (v_auth ->> 'organization_id')::uuid;
  select jsonb_build_object(
    'authorization', v_auth,
    'organization', jsonb_build_object(
      'id', organization.id, 'name', organization.name,
      'approval_policy', organization.approval_policy, 'status', organization.status
    ),
    'store', jsonb_build_object(
      'id', store.id, 'name', store.name, 'owner_store_slot', store.owner_store_slot,
      'status', store.status, 'google_place_id', store.google_place_id,
      'updated_at', store.updated_at
    ),
    'profile', coalesce((select profile.profile from private.meo_gbp_profiles profile where profile.store_id = p_store_id), '{}'::jsonb),
    'counts', jsonb_build_object(
      'unread_reviews', (select count(*) from private.meo_review_inbox review where review.store_id = p_store_id and review.status = 'unread'),
      'needs_reply_reviews', (select count(*) from private.meo_review_inbox review where review.store_id = p_store_id and review.status = 'needs_reply'),
      'draft_posts', (select count(*) from private.meo_post_drafts post where post.store_id = p_store_id and post.status in ('draft', 'ready')),
      'citation_issues', (select count(*) from private.meo_aio_citation_entries citation where citation.store_id = p_store_id and citation.consistency_status in ('mismatch', 'missing')),
      'pending_changes', (select count(*) from private.zero_meo_change_requests request where request.store_id = p_store_id and request.status = 'pending')
    )
  ) into v_result
  from private.zero_meo_organizations organization
  join api.stores store on store.id = p_store_id
  where organization.id = v_organization_id;
  return v_result;
end;
$$;


--
-- Name: owner_monthly_summary_v2(uuid, date); Type: FUNCTION; Schema: api; Owner: -
--

CREATE FUNCTION api.owner_monthly_summary_v2(p_store_id uuid, p_period_start date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_period_start date;
  v_period_end date;
  v_previous_start date;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_previous_at timestamptz;
  v_started bigint;
  v_completed bigint;
  v_generated bigint;
  v_handoffs bigint;
  v_average_rating numeric;
  v_previous_started bigint;
  v_rating_distribution jsonb;
begin
  if (select auth.uid()) is null
    or coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') = 'true'
  then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if not exists (
    select 1
    from api.stores store
    where store.id = p_store_id
      and store.owner_id = (select auth.uid())
      and store.archived_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'STORE_NOT_FOUND';
  end if;

  v_period_start := coalesce(
    p_period_start,
    date_trunc('month', timezone('Asia/Tokyo', statement_timestamp()))::date
  );
  if v_period_start <> date_trunc('month', v_period_start::timestamp)::date then
    raise exception using errcode = '22023', message = 'INVALID_PERIOD_START';
  end if;

  v_period_end := (v_period_start + interval '1 month')::date;
  v_previous_start := (v_period_start - interval '1 month')::date;
  v_start_at := v_period_start::timestamp at time zone 'Asia/Tokyo';
  v_end_at := v_period_end::timestamp at time zone 'Asia/Tokyo';
  v_previous_at := v_previous_start::timestamp at time zone 'Asia/Tokyo';

  select
    count(*),
    count(*) filter (where session.status = 'completed'),
    count(*) filter (where session.generation_status = 'succeeded'),
    avg(session.rating)::numeric(4, 2)
  into v_started, v_completed, v_generated, v_average_rating
  from api.interview_sessions session
  where session.store_id = p_store_id
    and session.created_at >= v_start_at
    and session.created_at < v_end_at;

  select count(*) into v_handoffs
  from api.review_handoff_events event
  where event.store_id = p_store_id
    and event.event_type = 'google_review_opened'
    and event.created_at >= v_start_at
    and event.created_at < v_end_at;

  select count(*) into v_previous_started
  from api.interview_sessions session
  where session.store_id = p_store_id
    and session.created_at >= v_previous_at
    and session.created_at < v_start_at;

  select coalesce(
    jsonb_object_agg(rating::text, rating_count order by rating),
    '{}'::jsonb
  ) into v_rating_distribution
  from (
    select session.rating, count(*) as rating_count
    from api.interview_sessions session
    where session.store_id = p_store_id
      and session.created_at >= v_start_at
      and session.created_at < v_end_at
      and session.rating is not null
    group by session.rating
  ) ratings;

  return jsonb_build_object(
    'period_start', v_period_start,
    'period_end', v_period_end,
    'started', coalesce(v_started, 0),
    'completed', coalesce(v_completed, 0),
    'completion_rate', case
      when coalesce(v_started, 0) = 0 then 0
      else round((v_completed::numeric / v_started::numeric) * 100, 1)
    end,
    'generation_succeeded', coalesce(v_generated, 0),
    'google_handoffs', coalesce(v_handoffs, 0),
    'average_rating', v_average_rating,
    'previous_started', coalesce(v_previous_started, 0),
    'started_change', coalesce(v_started, 0) - coalesce(v_previous_started, 0),
    'rating_distribution', v_rating_distribution
  );
end;
$$;


--
-- Name: canonical_survey_config(text, text, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.canonical_survey_config(p_template_id text, p_title text, p_description text) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE STRICT
    SET search_path TO ''
    AS $$
declare
  v_service_label text;
  v_service_placeholder text;
  v_memorable_placeholder text;
begin
  if p_template_id not in (
    'restaurant', 'hair_salon', 'treatment_clinic', 'medical_clinic',
    'professional_services', 'lodging', 'retail', 'other'
  ) or char_length(btrim(p_title)) not between 1 and 120
    or char_length(btrim(p_description)) not between 1 and 300
    or (p_title || E'\n' || p_description) ~ '星[[:space:]]*[45]'
    or (p_title || E'\n' || p_description) ~ '(高評価|ポジティブな口コミ|良い口コミだけ)'
    or (p_title || E'\n' || p_description) ~ '満足(した|された)?(方|人).*(だけ|のみ)'
    or (p_title || E'\n' || p_description) ~ '(口コミ|回答).*(特典|割引|謝礼|プレゼント)'
    or (p_title || E'\n' || p_description) ~ '(特典|割引|謝礼|プレゼント).*(口コミ|回答)'
    or (p_title || E'\n' || p_description) ~ '「[^」]{1,40}」.*(入れて|含めて|書いて|記載して)'
  then
    raise exception using errcode = '22023', message = 'INVALID_SURVEY_CONFIG';
  end if;

  v_service_label := case p_template_id
    when 'restaurant' then '利用したメニュー・サービス'
    when 'hair_salon' then '利用したメニュー・サービス'
    when 'treatment_clinic' then '利用した施術・サービス'
    when 'medical_clinic' then '利用した診療・サービス'
    when 'professional_services' then '利用した相談・サービス'
    when 'lodging' then '利用した宿泊プラン・サービス'
    else '利用した商品・サービス'
  end;
  v_service_placeholder := case p_template_id
    when 'restaurant' then '例：ランチセット、コース料理、テイクアウト'
    when 'hair_salon' then '例：カット、カラー、トリートメント'
    when 'treatment_clinic' then '例：整体、鍼灸、カウンセリング'
    when 'medical_clinic' then '個人を特定できる情報や詳しい病状は入力しないでください'
    when 'professional_services' then '例：初回相談、手続きのサポート（機密情報は入力しないでください）'
    when 'lodging' then '例：一泊朝食付きプラン、温泉、館内サービス'
    when 'retail' then '例：購入した商品、相談、取り寄せ'
    else '今回利用した内容をご記入ください'
  end;
  v_memorable_placeholder := case p_template_id
    when 'restaurant' then '料理、接客、雰囲気など、率直な体験をご記入ください'
    when 'hair_salon' then '仕上がり、接客、過ごしやすさなど、率直な体験をご記入ください'
    when 'treatment_clinic' then '説明、対応、院内の環境など、率直な体験をご記入ください'
    when 'medical_clinic' then '説明、対応、施設の環境など、差し支えない範囲でご記入ください'
    when 'professional_services' then '説明、対応、相談のしやすさなど、率直な体験をご記入ください'
    when 'lodging' then '客室、食事、接客、設備など、率直な体験をご記入ください'
    when 'retail' then '商品、品ぞろえ、接客など、率直な体験をご記入ください'
    else '良かったこと、気になったことを含め、率直な体験をご記入ください'
  end;

  return jsonb_build_object(
    'version', 2,
    'templateId', p_template_id,
    'title', btrim(p_title),
    'description', btrim(p_description),
    'questions', jsonb_build_object(
      'visitFrequency', jsonb_build_object('label', '来店頻度'),
      'rating', jsonb_build_object('label', '今回の評価'),
      'serviceUsed', jsonb_build_object(
        'label', v_service_label,
        'placeholder', v_service_placeholder
      ),
      'memorablePoints', jsonb_build_object(
        'label', '今回、特に印象に残ったこと',
        'placeholder', v_memorable_placeholder
      ),
      'improvementPoints', jsonb_build_object(
        'label', '改善してほしいことや、ほかに伝えたいこと',
        'placeholder', '任意でご記入ください'
      )
    )
  );
end;
$$;


--
-- Name: claim_idempotency(text, uuid, text, text, integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.claim_idempotency(p_scope text, p_subject_id uuid, p_key_hash text, p_request_hash text, p_lease_seconds integer DEFAULT 90) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_record private.request_idempotency%rowtype;
begin
  if p_scope not in (
    'turn', 'review', 'rewrite', 'review_edit', 'handoff',
    'owner_store', 'owner_publish', 'owner_pause', 'owner_connection_save',
    'owner_connection_revalidate', 'owner_connection_select',
    'owner_connection_delete', 'owner_account_delete'
  )
    or p_key_hash !~ '^[0-9a-f]{64}$'
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_lease_seconds not between 10 and 300
  then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_INPUT';
  end if;

  select *
  into v_record
  from private.request_idempotency
  where scope = p_scope
    and subject_id = p_subject_id
    and key_hash = p_key_hash
  for update;

  if found then
    if v_record.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;

    if v_record.status = 'completed' then
      return jsonb_build_object(
        'operation_id', v_record.id,
        'replayed', true,
        'resumed', false,
        'status', v_record.status,
        'request_ref', v_record.request_ref,
        'result_ref', v_record.result_ref,
        'result_json', v_record.result_json
      );
    end if;

    if v_record.status = 'processing'
      and v_record.lease_expires_at > statement_timestamp()
    then
      raise exception using errcode = 'P0001', message = 'OPERATION_IN_PROGRESS';
    end if;

    update private.request_idempotency
    set status = 'processing',
        error_code = null,
        lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
        expires_at = greatest(expires_at, statement_timestamp() + interval '24 hours')
    where id = v_record.id
    returning * into v_record;

    return jsonb_build_object(
      'operation_id', v_record.id,
      'replayed', false,
      'resumed', true,
      'status', v_record.status,
      'request_ref', v_record.request_ref,
      'result_ref', v_record.result_ref,
      'result_json', v_record.result_json
    );
  end if;

  insert into private.request_idempotency (
    scope,
    subject_id,
    key_hash,
    request_hash,
    status,
    lease_expires_at,
    expires_at
  ) values (
    p_scope,
    p_subject_id,
    p_key_hash,
    p_request_hash,
    'processing',
    statement_timestamp() + make_interval(secs => p_lease_seconds),
    statement_timestamp() + interval '24 hours'
  )
  on conflict (scope, subject_id, key_hash) do nothing
  returning * into v_record;

  if not found then
    return private.claim_idempotency(
      p_scope, p_subject_id, p_key_hash, p_request_hash, p_lease_seconds
    );
  end if;

  return jsonb_build_object(
    'operation_id', v_record.id,
    'replayed', false,
    'resumed', false,
    'status', v_record.status,
    'request_ref', null,
    'result_ref', null
  );
end;
$_$;


--
-- Name: consume_rate_limit(text, uuid, text, integer, integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.consume_rate_limit(p_scope text, p_store_id uuid, p_subject_hash text, p_window_seconds integer, p_limit integer) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_scope not in ('ip_store', 'session')
    or p_window_seconds not in (60, 600, 3600)
    or p_limit <= 0
    or p_subject_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_RATE_LIMIT_INPUT';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from statement_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into private.rate_limit_counters as counters (
    scope, store_id, subject_hash, window_start, window_seconds,
    request_count, expires_at
  ) values (
    p_scope, p_store_id, p_subject_hash, v_window_start, p_window_seconds,
    1, v_window_start + make_interval(secs => p_window_seconds * 2)
  )
  on conflict (scope, store_id, subject_hash, window_start)
  do update set
    request_count = counters.request_count + 1,
    expires_at = greatest(counters.expires_at, excluded.expires_at)
  where counters.request_count < p_limit
  returning request_count into v_count;

  if v_count is null then
    raise exception using errcode = 'P0001', message = 'RATE_LIMIT_EXCEEDED';
  end if;
  return v_count;
end;
$_$;


--
-- Name: create_default_store_runtime_limits(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.create_default_store_runtime_limits() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  insert into private.store_runtime_limits (store_id) values (new.id);
  return new;
end;
$$;


--
-- Name: expected_resolved_survey_config(jsonb, jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.expected_resolved_survey_config(p_source_config jsonb, p_selection jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE STRICT
    SET search_path TO ''
    AS $$
declare
  v_expected_groups jsonb := '{}'::jsonb;
  v_expected_questions jsonb := '[]'::jsonb;
  v_group jsonb;
  v_group_id text;
  v_variant_id text;
  v_variant jsonb;
  v_question jsonb;
begin
  if private.is_valid_survey_config(p_source_config) is not true
    or private.is_valid_survey_variant_selection(p_selection) is not true
  then
    return null;
  end if;

  if p_source_config ->> 'version' = '3' then
    for v_question in
      select question_row
      from jsonb_array_elements(p_source_config -> 'questions') question_row
    loop
      v_group_id := 'g_' || substring(v_question ->> 'id' from 3);
      v_variant_id := p_selection -> 'groups' ->> v_group_id;
      if v_variant_id is distinct from v_question ->> 'id' then
        return null;
      end if;
      v_expected_groups := v_expected_groups || jsonb_build_object(
        v_group_id, v_variant_id
      );
    end loop;

    if p_selection -> 'groups' <> v_expected_groups then
      return null;
    end if;
    return p_source_config;
  end if;

  if p_source_config ->> 'version' <> '4' then
    return null;
  end if;

  for v_group in
    select group_row
    from jsonb_array_elements(p_source_config -> 'questionGroups') group_row
  loop
    v_group_id := v_group ->> 'id';
    v_variant_id := p_selection -> 'groups' ->> v_group_id;
    if v_variant_id is null then
      return null;
    end if;

    select variant_row into v_variant
    from jsonb_array_elements(v_group -> 'variants') variant_row
    where variant_row ->> 'id' = v_variant_id;
    if not found then
      return null;
    end if;

    v_question := v_variant || jsonb_build_object(
      'type', v_group ->> 'type',
      'required', (v_group ->> 'required')::boolean
    );
    if v_group ? 'role' then
      v_question := v_question || jsonb_build_object(
        'role', v_group ->> 'role'
      );
    end if;
    if v_group ->> 'type' = 'short_text' then
      v_question := v_question || jsonb_build_object('maxLength', 120);
    elsif v_group ->> 'type' = 'long_text' then
      v_question := v_question || jsonb_build_object('maxLength', 400);
    end if;

    v_expected_groups := v_expected_groups || jsonb_build_object(
      v_group_id, v_variant_id
    );
    v_expected_questions := v_expected_questions || jsonb_build_array(v_question);
  end loop;

  if p_selection -> 'groups' <> v_expected_groups then
    return null;
  end if;

  v_question := jsonb_build_object(
    'version', 3,
    'presetId', p_source_config -> 'presetId',
    'title', p_source_config -> 'title',
    'description', p_source_config -> 'description',
    'questions', v_expected_questions,
    'revision', p_source_config -> 'revision'
  );
  return case
    when private.is_valid_survey_config(v_question) then v_question
    else null
  end;
exception when others then
  return null;
end;
$$;


--
-- Name: is_valid_interview_survey_snapshot_row(integer, jsonb, jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_valid_interview_survey_snapshot_row(p_source_revision integer, p_selection jsonb, p_resolved_config jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE STRICT
    SET search_path TO ''
    AS $$
begin
  return p_source_revision >= 1
    and private.is_valid_survey_variant_selection(p_selection)
    and private.is_valid_survey_config(p_resolved_config)
    and p_resolved_config -> 'version' = '3'::jsonb
    and (p_resolved_config ->> 'revision')::integer = p_source_revision;
exception when others then
  return false;
end;
$$;


--
-- Name: is_valid_structured_survey_answers_v3(jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_valid_structured_survey_answers_v3(p_answers jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE STRICT
    SET search_path TO ''
    AS $_$
begin
  if jsonb_typeof(p_answers) <> 'object'
    or octet_length(p_answers::text) > 16384
    or not (p_answers ?& array['schemaVersion', 'answers'])
    or p_answers - array['schemaVersion', 'answers'] <> '{}'::jsonb
    or p_answers -> 'schemaVersion' <> '3'::jsonb
    or jsonb_typeof(p_answers -> 'answers') <> 'object'
    or (
      select count(*) > 12
      from jsonb_object_keys(p_answers -> 'answers')
    )
  then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_each(p_answers -> 'answers') answer_row(question_id, answer_json)
    where question_id !~ '^q_[0-9a-f]{12}$'
      or jsonb_typeof(answer_json) <> 'object'
      or not (answer_json ?& array['type', 'value'])
      or answer_json - array['type', 'value'] <> '{}'::jsonb
      or jsonb_typeof(answer_json -> 'type') <> 'string'
      or answer_json ->> 'type' not in (
        'short_text', 'long_text', 'single_choice', 'multi_choice', 'rating_5'
      )
      or case answer_json ->> 'type'
        when 'short_text' then
          jsonb_typeof(answer_json -> 'value') <> 'string'
          or char_length(btrim(answer_json ->> 'value')) not between 1 and 120
        when 'long_text' then
          jsonb_typeof(answer_json -> 'value') <> 'string'
          or char_length(btrim(answer_json ->> 'value')) not between 1 and 400
        when 'single_choice' then
          jsonb_typeof(answer_json -> 'value') <> 'string'
          or not (
            (answer_json ->> 'value') ~ '^[a-z0-9_]{1,24}$'
            or (
              answer_json ->> 'value' like 'other:%'
              and char_length(answer_json ->> 'value') between 7 and 60
            )
          )
        when 'multi_choice' then
          jsonb_typeof(answer_json -> 'value') <> 'array'
          or jsonb_array_length(answer_json -> 'value') not between 1 and 8
          or exists (
            select 1
            from jsonb_array_elements(answer_json -> 'value') selected
            where jsonb_typeof(selected) <> 'string'
              or selected #>> '{}' !~ '^[a-z0-9_]{1,24}$'
          )
        when 'rating_5' then
          jsonb_typeof(answer_json -> 'value') <> 'number'
          or answer_json ->> 'value' !~ '^[1-5]$'
        else true
      end
  ) then
    return false;
  end if;

  return true;
exception when others then
  return false;
end;
$_$;


--
-- Name: is_valid_survey_config(jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_valid_survey_config(p_config jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE STRICT
    SET search_path TO ''
    AS $_$
declare
  v_version integer;
begin
  if jsonb_typeof(p_config) <> 'object'
    or jsonb_typeof(p_config -> 'version') <> 'number'
    or (p_config ->> 'version') !~ '^[0-9]+$'
  then
    return false;
  end if;
  v_version := (p_config ->> 'version')::integer;

  if v_version = 2 then
    if octet_length(p_config::text) > 8192
      or not (p_config ?& array[
        'version', 'templateId', 'title', 'description', 'questions'
      ])
      or p_config - array[
        'version', 'templateId', 'title', 'description', 'questions'
      ] <> '{}'::jsonb
      or jsonb_typeof(p_config -> 'templateId') <> 'string'
      or jsonb_typeof(p_config -> 'title') <> 'string'
      or jsonb_typeof(p_config -> 'description') <> 'string'
    then
      return false;
    end if;
    return p_config = private.canonical_survey_config(
      p_config ->> 'templateId', p_config ->> 'title', p_config ->> 'description'
    );
  end if;

  if v_version = 3 then
    if octet_length(p_config::text) > 32768
      or not (p_config ?& array[
        'version', 'presetId', 'title', 'description', 'questions', 'revision'
      ])
      or p_config - array[
        'version', 'presetId', 'title', 'description', 'questions', 'revision'
      ] <> '{}'::jsonb
      or jsonb_typeof(p_config -> 'presetId') not in ('string', 'null')
      or jsonb_typeof(p_config -> 'title') <> 'string'
      or char_length(btrim(p_config ->> 'title')) not between 1 and 120
      or jsonb_typeof(p_config -> 'description') <> 'string'
      or char_length(btrim(p_config ->> 'description')) not between 1 and 300
      or jsonb_typeof(p_config -> 'revision') <> 'number'
      or (p_config ->> 'revision') !~ '^[0-9]+$'
      or (p_config ->> 'revision')::integer < 1
      or jsonb_typeof(p_config -> 'questions') <> 'array'
      or jsonb_array_length(p_config -> 'questions') not between 1 and 12
    then
      return false;
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_config -> 'questions') question_row
      where private.is_valid_survey_question_v3(question_row) is not true
    ) then
      return false;
    end if;

    if (
      select count(*) <> count(distinct question_row ->> 'id')
      from jsonb_array_elements(p_config -> 'questions') question_row
    ) or (
      select count(*) > 4
      from jsonb_array_elements(p_config -> 'questions') question_row
      where (question_row ->> 'required')::boolean
    ) or (
      select count(*) > 6
      from jsonb_array_elements(p_config -> 'questions') question_row
      where question_row ->> 'type' in ('short_text', 'long_text')
    ) or (
      select count(*) > 1
        or bool_or(question_row ->> 'type' <> 'rating_5')
      from jsonb_array_elements(p_config -> 'questions') question_row
      where question_row ->> 'role' = 'rating'
    ) or (
      select count(*) > 1
        or bool_or(question_row ->> 'type' <> 'single_choice')
      from jsonb_array_elements(p_config -> 'questions') question_row
      where question_row ->> 'role' = 'visit_frequency'
    ) then
      return false;
    end if;

    return true;
  end if;

  if v_version <> 4
    or octet_length(p_config::text) > 32768
    or not (p_config ?& array[
      'version', 'presetId', 'title', 'description', 'questionGroups', 'revision'
    ])
    or p_config - array[
      'version', 'presetId', 'title', 'description', 'questionGroups', 'revision'
    ] <> '{}'::jsonb
    or jsonb_typeof(p_config -> 'presetId') not in ('string', 'null')
    or jsonb_typeof(p_config -> 'title') <> 'string'
    or char_length(btrim(p_config ->> 'title')) not between 1 and 120
    or jsonb_typeof(p_config -> 'description') <> 'string'
    or char_length(btrim(p_config ->> 'description')) not between 1 and 300
    or jsonb_typeof(p_config -> 'revision') <> 'number'
    or (p_config ->> 'revision') !~ '^[0-9]+$'
    or (p_config ->> 'revision')::integer < 1
    or jsonb_typeof(p_config -> 'questionGroups') <> 'array'
    or jsonb_array_length(p_config -> 'questionGroups') not between 1 and 12
  then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_config -> 'questionGroups') group_row
    where jsonb_typeof(group_row) <> 'object'
      or not (group_row ?& array['id', 'type', 'required', 'variants'])
      or group_row - array[
        'id', 'type', 'required', 'role', 'variants'
      ] <> '{}'::jsonb
      or jsonb_typeof(group_row -> 'id') <> 'string'
      or (group_row ->> 'id') !~ '^g_[0-9a-f]{12}$'
      or jsonb_typeof(group_row -> 'type') <> 'string'
      or group_row ->> 'type' not in (
        'short_text', 'long_text', 'single_choice', 'multi_choice', 'rating_5'
      )
      or jsonb_typeof(group_row -> 'required') <> 'boolean'
      or (
        group_row ? 'role'
        and (
          jsonb_typeof(group_row -> 'role') <> 'string'
          or group_row ->> 'role' not in ('rating', 'visit_frequency')
        )
      )
      or jsonb_typeof(group_row -> 'variants') <> 'array'
      or jsonb_array_length(group_row -> 'variants') not between 1 and 4
      or (
        group_row ? 'role'
        and jsonb_array_length(group_row -> 'variants') <> 1
      )
      or (
        group_row ->> 'role' = 'rating'
        and group_row ->> 'type' <> 'rating_5'
      )
      or (
        group_row ->> 'role' = 'visit_frequency'
        and group_row ->> 'type' <> 'single_choice'
      )
      or exists (
        select 1
        from jsonb_array_elements(group_row -> 'variants') variant_row
        where private.is_valid_survey_question_variant_v4(
          group_row ->> 'type',
          (group_row ->> 'required')::boolean,
          group_row ->> 'role',
          variant_row
        ) is not true
      )
  ) then
    return false;
  end if;

  if (
    select count(*) <> count(distinct group_row ->> 'id')
    from jsonb_array_elements(p_config -> 'questionGroups') group_row
  ) or (
    select count(*) <> count(distinct variant_row ->> 'id')
    from jsonb_array_elements(p_config -> 'questionGroups') group_row
    cross join lateral jsonb_array_elements(group_row -> 'variants') variant_row
  ) or (
    select count(*) > 24
    from jsonb_array_elements(p_config -> 'questionGroups') group_row
    cross join lateral jsonb_array_elements(group_row -> 'variants') variant_row
  ) or (
    select count(*) > 4
    from jsonb_array_elements(p_config -> 'questionGroups') group_row
    where (group_row ->> 'required')::boolean
  ) or (
    select count(*) > 6
    from jsonb_array_elements(p_config -> 'questionGroups') group_row
    where group_row ->> 'type' in ('short_text', 'long_text')
  ) or (
    select count(*) > 1
    from jsonb_array_elements(p_config -> 'questionGroups') group_row
    where group_row ->> 'role' = 'rating'
  ) or (
    select count(*) > 1
    from jsonb_array_elements(p_config -> 'questionGroups') group_row
    where group_row ->> 'role' = 'visit_frequency'
  ) then
    return false;
  end if;

  return true;
exception when others then
  return false;
end;
$_$;


--
-- Name: is_valid_survey_question(jsonb, boolean); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_valid_survey_question(p_question jsonb, p_with_placeholder boolean) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE STRICT
    SET search_path TO ''
    AS $$
begin
  if jsonb_typeof(p_question) <> 'object'
    or jsonb_typeof(p_question -> 'label') <> 'string'
    or char_length(btrim(p_question ->> 'label')) not between 1 and 120
  then
    return false;
  end if;

  if p_with_placeholder then
    return p_question ?& array['label', 'placeholder']
      and p_question - array['label', 'placeholder'] = '{}'::jsonb
      and jsonb_typeof(p_question -> 'placeholder') = 'string'
      and char_length(btrim(p_question ->> 'placeholder')) <= 160;
  end if;

  return p_question ? 'label'
    and p_question - 'label' = '{}'::jsonb;
end;
$$;


--
-- Name: is_valid_survey_question_v3(jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_valid_survey_question_v3(p_question jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE STRICT
    SET search_path TO ''
    AS $_$
declare
  v_type text;
  v_options jsonb;
  v_max_selections integer;
begin
  if jsonb_typeof(p_question) <> 'object'
    or not (p_question ?& array['id', 'type', 'label', 'required'])
    or jsonb_typeof(p_question -> 'id') <> 'string'
    or (p_question ->> 'id') !~ '^q_[0-9a-f]{12}$'
    or jsonb_typeof(p_question -> 'type') <> 'string'
    or (p_question ->> 'type') not in (
      'short_text', 'long_text', 'single_choice', 'multi_choice', 'rating_5'
    )
    or jsonb_typeof(p_question -> 'label') <> 'string'
    or char_length(btrim(p_question ->> 'label')) not between 1 and 80
    or jsonb_typeof(p_question -> 'required') <> 'boolean'
    or (
      p_question ? 'help'
      and (
        jsonb_typeof(p_question -> 'help') <> 'string'
        or char_length(btrim(p_question ->> 'help')) > 120
      )
    )
    or (
      p_question ? 'role'
      and (
        jsonb_typeof(p_question -> 'role') <> 'string'
        or (p_question ->> 'role') not in ('rating', 'visit_frequency')
      )
    )
  then
    return false;
  end if;

  v_type := p_question ->> 'type';

  if v_type in ('short_text', 'long_text') then
    if not (p_question ? 'maxLength')
      or p_question - array[
        'id', 'type', 'label', 'help', 'required', 'role', 'placeholder', 'maxLength'
      ] <> '{}'::jsonb
      or jsonb_typeof(p_question -> 'maxLength') <> 'number'
      or (p_question ->> 'maxLength') !~ '^[0-9]+$'
      or (v_type = 'short_text' and (p_question ->> 'maxLength')::integer <> 120)
      or (v_type = 'long_text' and (p_question ->> 'maxLength')::integer <> 400)
      or (
        p_question ? 'placeholder'
        and (
          jsonb_typeof(p_question -> 'placeholder') <> 'string'
          or char_length(btrim(p_question ->> 'placeholder')) > 100
        )
      )
    then
      return false;
    end if;
    return true;
  end if;

  if v_type in ('single_choice', 'multi_choice') then
    if not (p_question ? 'options')
      or p_question - (case when v_type = 'single_choice' then
        array['id', 'type', 'label', 'help', 'required', 'role', 'options', 'allowOther']
      else
        array['id', 'type', 'label', 'help', 'required', 'role', 'options', 'maxSelections']
      end) <> '{}'::jsonb
      or jsonb_typeof(p_question -> 'options') <> 'array'
      or jsonb_array_length(p_question -> 'options') not between 2 and 8
    then
      return false;
    end if;

    v_options := p_question -> 'options';
    if exists (
      select 1
      from jsonb_array_elements(v_options) option_row
      where jsonb_typeof(option_row) <> 'object'
        or not (option_row ?& array['value', 'label'])
        or option_row - array['value', 'label'] <> '{}'::jsonb
        or jsonb_typeof(option_row -> 'value') <> 'string'
        or (option_row ->> 'value') !~ '^[a-z0-9_]{1,24}$'
        or jsonb_typeof(option_row -> 'label') <> 'string'
        or char_length(btrim(option_row ->> 'label')) not between 1 and 30
    ) or (
      select count(*) <> count(distinct option_row ->> 'value')
      from jsonb_array_elements(v_options) option_row
    ) then
      return false;
    end if;

    if v_type = 'single_choice' then
      return p_question ? 'allowOther'
        and jsonb_typeof(p_question -> 'allowOther') = 'boolean';
    end if;

    if not (p_question ? 'maxSelections')
      or jsonb_typeof(p_question -> 'maxSelections') <> 'number'
      or (p_question ->> 'maxSelections') !~ '^[0-9]+$'
    then
      return false;
    end if;
    v_max_selections := (p_question ->> 'maxSelections')::integer;
    return v_max_selections between 1 and jsonb_array_length(v_options);
  end if;

  return p_question ?& array['lowLabel', 'highLabel']
    and p_question - array[
      'id', 'type', 'label', 'help', 'required', 'role', 'lowLabel', 'highLabel'
    ] = '{}'::jsonb
    and jsonb_typeof(p_question -> 'lowLabel') = 'string'
    and char_length(btrim(p_question ->> 'lowLabel')) <= 12
    and jsonb_typeof(p_question -> 'highLabel') = 'string'
    and char_length(btrim(p_question ->> 'highLabel')) <= 12;
exception when others then
  return false;
end;
$_$;


--
-- Name: is_valid_survey_question_variant_v4(text, boolean, text, jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_valid_survey_question_variant_v4(p_type text, p_required boolean, p_role text, p_variant jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
declare
  v_question jsonb;
begin
  if p_type not in (
      'short_text', 'long_text', 'single_choice', 'multi_choice', 'rating_5'
    )
    or p_required is null
    or (p_role is not null and p_role not in ('rating', 'visit_frequency'))
    or jsonb_typeof(p_variant) <> 'object'
    or not (p_variant ?& array['id', 'label'])
    or jsonb_typeof(p_variant -> 'id') <> 'string'
    or (p_variant ->> 'id') !~ '^q_[0-9a-f]{12}$'
    or jsonb_typeof(p_variant -> 'label') <> 'string'
    or char_length(btrim(p_variant ->> 'label')) not between 1 and 80
    or (
      p_variant ? 'help'
      and (
        jsonb_typeof(p_variant -> 'help') <> 'string'
        or char_length(btrim(p_variant ->> 'help')) > 120
      )
    )
  then
    return false;
  end if;

  if p_type in ('short_text', 'long_text') then
    if p_variant - array['id', 'label', 'help', 'placeholder'] <> '{}'::jsonb
      or (
        p_variant ? 'placeholder'
        and (
          jsonb_typeof(p_variant -> 'placeholder') <> 'string'
          or char_length(btrim(p_variant ->> 'placeholder')) > 100
        )
      )
    then
      return false;
    end if;
  elsif p_type = 'single_choice' then
    if not (p_variant ?& array['options', 'allowOther'])
      or p_variant - array[
        'id', 'label', 'help', 'options', 'allowOther'
      ] <> '{}'::jsonb
    then
      return false;
    end if;
  elsif p_type = 'multi_choice' then
    if not (p_variant ?& array['options', 'maxSelections'])
      or p_variant - array[
        'id', 'label', 'help', 'options', 'maxSelections'
      ] <> '{}'::jsonb
    then
      return false;
    end if;
  else
    if not (p_variant ?& array['lowLabel', 'highLabel'])
      or p_variant - array[
        'id', 'label', 'help', 'lowLabel', 'highLabel'
      ] <> '{}'::jsonb
    then
      return false;
    end if;
  end if;

  v_question := p_variant || jsonb_build_object(
    'type', p_type,
    'required', p_required
  );
  if p_role is not null then
    v_question := v_question || jsonb_build_object('role', p_role);
  end if;
  if p_type = 'short_text' then
    v_question := v_question || jsonb_build_object('maxLength', 120);
  elsif p_type = 'long_text' then
    v_question := v_question || jsonb_build_object('maxLength', 400);
  end if;

  return private.is_valid_survey_question_v3(v_question);
exception when others then
  return false;
end;
$_$;


--
-- Name: is_valid_survey_variant_selection(jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_valid_survey_variant_selection(p_selection jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE STRICT
    SET search_path TO ''
    AS $_$
begin
  return jsonb_typeof(p_selection) = 'object'
    and p_selection ?& array['schemaVersion', 'algorithm', 'groups']
    and p_selection - array[
      'schemaVersion', 'algorithm', 'groups'
    ] = '{}'::jsonb
    and p_selection -> 'schemaVersion' = '1'::jsonb
    and p_selection ->> 'algorithm' = 'uniform_v1'
    and jsonb_typeof(p_selection -> 'groups') = 'object'
    and (
      select count(*)
      from jsonb_object_keys(p_selection -> 'groups') group_id
    ) between 1 and 12
    and not exists (
      select 1
      from jsonb_each(p_selection -> 'groups') selection_row(group_id, variant_id)
      where group_id !~ '^g_[0-9a-f]{12}$'
        or jsonb_typeof(variant_id) <> 'string'
        or variant_id #>> '{}' !~ '^q_[0-9a-f]{12}$'
    );
exception when others then
  return false;
end;
$_$;


--
-- Name: meo_ai_draft_result_is_valid(jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.meo_ai_draft_result_is_valid(p_result jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  v_key text;
  v_key_count integer := 0;
begin
  if p_result is null
    or jsonb_typeof(p_result) <> 'object'
    or pg_column_size(p_result) > 4096
    or jsonb_typeof(p_result -> 'reply') <> 'string'
    or char_length(p_result ->> 'reply') not between 1 and 1000
    or (p_result ->> 'source') is distinct from 'owner_provider'
    or (p_result -> 'requiresReview') is distinct from 'true'::jsonb
    or not private.meo_integration_json_is_safe(p_result)
  then
    return false;
  end if;
  for v_key in select jsonb_object_keys(p_result) loop
    v_key_count := v_key_count + 1;
    if v_key not in ('reply', 'source', 'requiresReview') then
      return false;
    end if;
  end loop;
  return v_key_count = 3;
end;
$$;


--
-- Name: meo_health_result_is_valid(jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.meo_health_result_is_valid(p_result jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
declare
  v_check jsonb;
  v_ids text[] := array[]::text[];
  v_expected_ids constant text[] := array[
    'category', 'description', 'hours', 'media', 'phone', 'posts',
    'recent-reviews', 'review-replies', 'website'
  ];
begin
  if p_result is null
    or jsonb_typeof(p_result) <> 'object'
    or (select count(*) from jsonb_object_keys(p_result)) <> 2
    or not (p_result ? 'score' and p_result ? 'checks')
    or jsonb_typeof(p_result -> 'score') <> 'number'
    or (p_result ->> 'score') !~ '^[0-9]{1,3}$'
    or (p_result ->> 'score')::integer not between 0 and 100
    or jsonb_typeof(p_result -> 'checks') <> 'array'
    or jsonb_array_length(p_result -> 'checks') <> 9
    or pg_column_size(p_result) > 32768
  then
    return false;
  end if;

  for v_check in select value from jsonb_array_elements(p_result -> 'checks')
  loop
    if jsonb_typeof(v_check) <> 'object'
      or (select count(*) from jsonb_object_keys(v_check)) <> 5
      or not (
        v_check ? 'id' and v_check ? 'title' and v_check ? 'status'
        and v_check ? 'summary' and v_check ? 'nextAction'
      )
      or jsonb_typeof(v_check -> 'id') <> 'string'
      or length(v_check ->> 'id') not between 1 and 40
      or jsonb_typeof(v_check -> 'title') <> 'string'
      or length(v_check ->> 'title') not between 1 and 120
      or jsonb_typeof(v_check -> 'status') <> 'string'
      or (v_check ->> 'status') not in ('good', 'warning', 'action', 'unknown')
      or jsonb_typeof(v_check -> 'summary') <> 'string'
      or length(v_check ->> 'summary') not between 1 and 500
      or (
        v_check -> 'nextAction' <> 'null'::jsonb
        and (
          jsonb_typeof(v_check -> 'nextAction') <> 'string'
          or length(v_check ->> 'nextAction') not between 1 and 1000
        )
      )
    then
      return false;
    end if;
    v_ids := array_append(v_ids, v_check ->> 'id');
  end loop;

  select array_agg(value order by value) into v_ids
  from unnest(v_ids) as item(value);
  return v_ids = v_expected_ids;
exception when others then
  return false;
end;
$_$;


--
-- Name: meo_insight_metrics_are_valid(jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.meo_insight_metrics_are_valid(p_metrics jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  v_key text;
  v_value jsonb;
begin
  if p_metrics is null
    or jsonb_typeof(p_metrics) <> 'object'
    or octet_length(p_metrics::text) > 4096
    or not private.meo_integration_json_is_safe(p_metrics)
  then
    return false;
  end if;

  for v_key, v_value in
    select metric.key, metric.value from jsonb_each(p_metrics) metric
  loop
    if v_key not in (
      'searches', 'views', 'websiteClicks', 'calls', 'directionRequests',
      'bookings', 'orders', 'messages'
    ) or jsonb_typeof(v_value) <> 'number'
      or (v_value #>> '{}')::numeric < 0
      or (v_value #>> '{}')::numeric > 1000000000
      or trunc((v_value #>> '{}')::numeric) <> (v_value #>> '{}')::numeric
    then
      return false;
    end if;
  end loop;
  return true;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return false;
end;
$$;


--
-- Name: meo_integration_json_is_safe(jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.meo_integration_json_is_safe(p_value jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
declare
  v_key text;
  v_child jsonb;
begin
  if p_value is null then
    return true;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in
      select entry.key, entry.value
      from jsonb_each(p_value) entry
    loop
      if lower(v_key) ~ '(^|_)(access|refresh|id)?_?token$'
        or lower(v_key) ~ '(^|_)(client_)?secret$'
        or lower(v_key) ~ 'authorization'
        or lower(v_key) ~ '(^|_)(credential|credentials|credential_ciphertext|credential_iv)$'
        or lower(v_key) ~ '(^|_)(raw|provider)_?response$'
      then
        return false;
      end if;
      if not private.meo_integration_json_is_safe(v_child) then
        return false;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in
      select item.value
      from jsonb_array_elements(p_value) item
    loop
      if not private.meo_integration_json_is_safe(v_child) then
        return false;
      end if;
    end loop;
  end if;

  return true;
end;
$_$;


--
-- Name: meo_oauth_provider_feature_available(text, timestamp with time zone); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.meo_oauth_provider_feature_available(p_provider text, p_evaluated_at timestamp with time zone) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select exists (
    select 1
    from private.zero_feature_rollouts rollout
    where (
      (p_provider = 'instagram' and rollout.feature_key = 'instagram_to_gbp')
      or (
        p_provider = 'google_business'
        and rollout.feature_key in (
          'review_reply', 'gbp_insights', 'gbp_health', 'instagram_to_gbp'
        )
      )
    )
      and private.zero_feature_effective_state(
        rollout.configured_state, rollout.release_at, rollout.kill_switch,
        p_evaluated_at
      ) = 'available'
  );
$$;


--
-- Name: meo_place_ids_are_valid(text[], integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.meo_place_ids_are_valid(p_place_ids text[], p_maximum integer DEFAULT 100) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
declare
  v_place_id text;
begin
  if p_place_ids is null
    or p_maximum not between 0 and 100
    or cardinality(p_place_ids) > p_maximum
  then
    return false;
  end if;
  foreach v_place_id in array p_place_ids loop
    if v_place_id is null
      or v_place_id !~ '^[A-Za-z0-9_-]{10,255}$'
    then
      return false;
    end if;
  end loop;
  return cardinality(p_place_ids) = cardinality(array(select distinct value from unnest(p_place_ids) value));
end;
$_$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: meo_provider_connections; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_provider_connections (
    store_id uuid NOT NULL,
    provider text NOT NULL,
    credential_ciphertext text NOT NULL,
    credential_iv text NOT NULL,
    key_version smallint NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    expires_at timestamp with time zone,
    external_account_id text,
    location_name text,
    display_name text,
    last_error_code text,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_provider_connections_check CHECK ((((provider = ANY (ARRAY['google_business'::text, 'instagram'::text])) AND (expires_at IS NOT NULL)) OR ((provider = 'dataforseo'::text) AND (expires_at IS NULL)))),
    CONSTRAINT meo_provider_connections_check1 CHECK (((provider = 'google_business'::text) OR ((provider = 'instagram'::text) AND (location_name IS NULL) AND (display_name IS NULL)) OR ((provider = 'dataforseo'::text) AND (location_name IS NULL)))),
    CONSTRAINT meo_provider_connections_credential_ciphertext_check CHECK (((char_length(credential_ciphertext) >= 24) AND (char_length(credential_ciphertext) <= 32768))),
    CONSTRAINT meo_provider_connections_credential_iv_check CHECK (((char_length(credential_iv) >= 16) AND (char_length(credential_iv) <= 64))),
    CONSTRAINT meo_provider_connections_display_name_check CHECK (((display_name IS NULL) OR ((char_length(display_name) >= 1) AND (char_length(display_name) <= 500)))),
    CONSTRAINT meo_provider_connections_external_account_id_check CHECK (((external_account_id IS NULL) OR ((char_length(external_account_id) >= 1) AND (char_length(external_account_id) <= 500)))),
    CONSTRAINT meo_provider_connections_key_version_check CHECK ((key_version > 0)),
    CONSTRAINT meo_provider_connections_last_error_code_check CHECK (((last_error_code IS NULL) OR (last_error_code ~ '^[A-Z0-9_:-]{2,100}$'::text))),
    CONSTRAINT meo_provider_connections_location_name_check CHECK (((location_name IS NULL) OR (location_name ~ '^accounts/[A-Za-z0-9_-]+/locations/[A-Za-z0-9_-]+$'::text))),
    CONSTRAINT meo_provider_connections_provider_check CHECK ((provider = ANY (ARRAY['google_business'::text, 'instagram'::text, 'dataforseo'::text]))),
    CONSTRAINT meo_provider_connections_status_check CHECK ((status = ANY (ARRAY['active'::text, 'invalid'::text, 'revoked'::text, 'error'::text])))
);


--
-- Name: TABLE meo_provider_connections; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.meo_provider_connections IS 'Per-store Google/Instagram OAuth or DataForSEO basic credentials, encrypted by the Edge credential cipher.';


--
-- Name: meo_public_connection_json(private.meo_provider_connections); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.meo_public_connection_json(p_connection private.meo_provider_connections) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'provider', p_connection.provider,
    'status', p_connection.status,
    'expires_at', p_connection.expires_at,
    'external_account_id', p_connection.external_account_id,
    'location_name', p_connection.location_name,
    'display_name', p_connection.display_name,
    'last_error_code', p_connection.last_error_code,
    'connected_at', p_connection.created_at,
    'updated_at', p_connection.updated_at
  );
$$;


--
-- Name: owner_exists(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.owner_exists(p_owner_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select p_owner_id is not null and exists (
    select 1 from auth.users where id = p_owner_id
  );
$$;


--
-- Name: preview_expired_interview_session_counts(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.preview_expired_interview_session_counts() RETURNS TABLE(store_id uuid, retention_days integer, cutoff_at timestamp with time zone, eligible_session_count bigint, oldest_eligible_session_at timestamp with time zone, newest_eligible_session_at timestamp with time zone)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select
    runtime_limits.store_id,
    runtime_limits.retention_days,
    statement_timestamp() - make_interval(days => runtime_limits.retention_days),
    count(interview_session.id),
    min(coalesce(interview_session.completed_at, interview_session.created_at)),
    max(coalesce(interview_session.completed_at, interview_session.created_at))
  from private.store_runtime_limits runtime_limits
  left join api.interview_sessions interview_session
    on interview_session.store_id = runtime_limits.store_id
   and coalesce(interview_session.completed_at, interview_session.created_at)
     < statement_timestamp() - make_interval(days => runtime_limits.retention_days)
  group by runtime_limits.store_id, runtime_limits.retention_days
  order by runtime_limits.store_id;
$$;


--
-- Name: FUNCTION preview_expired_interview_session_counts(); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.preview_expired_interview_session_counts() IS 'Service-only dry-run summary using completion time, or creation time for incomplete sessions.';


--
-- Name: purge_expired_interview_sessions(integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.purge_expired_interview_sessions(p_limit integer DEFAULT 100) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_session_ids uuid[] := array[]::uuid[];
  v_deleted_sessions integer := 0;
  v_remaining_eligible_sessions bigint := 0;
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using
      errcode = '22023',
      message = 'INVALID_RETENTION_PURGE_LIMIT';
  end if;

  select coalesce(
    array_agg(candidate.session_id order by candidate.retention_at, candidate.session_id),
    array[]::uuid[]
  )
  into v_session_ids
  from (
    select
      interview_session.id as session_id,
      coalesce(interview_session.completed_at, interview_session.created_at) as retention_at
    from api.interview_sessions interview_session
    join private.store_runtime_limits runtime_limits
      on runtime_limits.store_id = interview_session.store_id
    where coalesce(interview_session.completed_at, interview_session.created_at)
      < statement_timestamp() - make_interval(days => runtime_limits.retention_days)
    order by retention_at, interview_session.id
    limit p_limit
    for update of interview_session skip locked
  ) candidate;

  if cardinality(v_session_ids) > 0 then
    delete from private.request_idempotency operation
    where operation.subject_id = any(v_session_ids)
       or operation.request_ref = any(v_session_ids)
       or operation.result_ref = any(v_session_ids);

    delete from api.interview_sessions interview_session
    where interview_session.id = any(v_session_ids);
    get diagnostics v_deleted_sessions = row_count;
  end if;

  select count(*)
  into v_remaining_eligible_sessions
  from api.interview_sessions interview_session
  join private.store_runtime_limits runtime_limits
    on runtime_limits.store_id = interview_session.store_id
  where coalesce(interview_session.completed_at, interview_session.created_at)
    < statement_timestamp() - make_interval(days => runtime_limits.retention_days);

  return jsonb_build_object(
    'requested_limit', p_limit,
    'deleted_sessions', v_deleted_sessions,
    'remaining_eligible_sessions', v_remaining_eligible_sessions
  );
end;
$$;


--
-- Name: FUNCTION purge_expired_interview_sessions(p_limit integer); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.purge_expired_interview_sessions(p_limit integer) IS 'Service-only bounded purge using completion time, or creation time for incomplete sessions.';


--
-- Name: recover_expired_generation_operation(text, uuid, text, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.recover_expired_generation_operation(p_scope text, p_session_id uuid, p_new_key_hash text, p_request_hash text) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_session api.interview_sessions%rowtype;
  v_exact_operation private.request_idempotency%rowtype;
  v_expired_count integer;
begin
  if p_scope not in ('review', 'rewrite')
    or p_session_id is null
    or p_new_key_hash !~ '^[0-9a-f]{64}$'
    or p_request_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_OPERATION_RECOVERY_INPUT';
  end if;

  select * into v_exact_operation
  from private.request_idempotency operation
  where operation.scope = p_scope
    and operation.subject_id = p_session_id
    and operation.key_hash = p_new_key_hash;
  if found then
    if v_exact_operation.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_exact_operation.status = 'failed' and (
      v_exact_operation.error_code = 'OPERATION_LEASE_EXPIRED'
      or exists (
        select 1
        from private.request_idempotency replacement
        where replacement.scope = p_scope
          and replacement.subject_id = p_session_id
          and replacement.id <> v_exact_operation.id
          and (
            replacement.status = 'processing'
            or (
              replacement.status = 'completed'
              and replacement.updated_at > v_exact_operation.updated_at
            )
          )
      )
    ) then
      raise exception using errcode = 'P0001', message = 'OPERATION_SUPERSEDED';
    end if;
    return false;
  end if;

  select * into strict v_session
  from api.interview_sessions
  where id = p_session_id
  for update;

  select count(*)::integer into v_expired_count
  from private.request_idempotency operation
  where operation.scope = p_scope
    and operation.subject_id = p_session_id
    and operation.status = 'processing'
    and (
      operation.lease_expires_at is null
      or operation.lease_expires_at <= statement_timestamp()
    );

  if v_expired_count = 0 then return false; end if;

  if p_scope = 'review' and (
    v_session.status <> 'generating'
    or v_session.generation_status <> 'generating'
  ) then
    raise exception using errcode = 'P0001', message = 'OPERATION_RECOVERY_STATE_MISMATCH';
  elsif p_scope = 'rewrite' and v_session.status <> 'generating' then
    raise exception using errcode = 'P0001', message = 'OPERATION_RECOVERY_STATE_MISMATCH';
  end if;

  update private.request_idempotency operation
  set status = 'failed',
      error_code = 'OPERATION_LEASE_EXPIRED',
      lease_expires_at = null
  where operation.scope = p_scope
    and operation.subject_id = p_session_id
    and operation.status = 'processing'
    and (
      operation.lease_expires_at is null
      or operation.lease_expires_at <= statement_timestamp()
    );

  if p_scope = 'review' then
    update api.interview_sessions
    set status = 'active',
        generation_status = 'failed',
        last_activity_at = statement_timestamp()
    where id = p_session_id;
  else
    update api.interview_sessions
    set status = 'completed',
        generation_status = 'succeeded',
        rewrite_count = greatest(rewrite_count - 1, 0),
        last_activity_at = statement_timestamp()
    where id = p_session_id;
  end if;

  return true;
end;
$_$;


--
-- Name: interview_sessions; Type: TABLE; Schema: api; Owner: -
--

CREATE TABLE api.interview_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    locale text DEFAULT 'ja'::text NOT NULL,
    visit_frequency text,
    rating integer,
    profile_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    structured_answers_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    generated_review text,
    edited_review text,
    generation_status text DEFAULT 'not_started'::text NOT NULL,
    rewrite_count integer DEFAULT 0 NOT NULL,
    ai_turn_count integer DEFAULT 0 NOT NULL,
    interview_complete boolean DEFAULT false NOT NULL,
    generation_provider text,
    generation_model text,
    generation_request_id text,
    generated_review_at timestamp with time zone,
    google_handoff_opened_at timestamp with time zone,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    generation_source text,
    survey_revision integer,
    CONSTRAINT interview_sessions_ai_turn_count_check CHECK (((ai_turn_count >= 0) AND (ai_turn_count <= 8))),
    CONSTRAINT interview_sessions_edited_review_check CHECK (((edited_review IS NULL) OR (char_length(edited_review) <= 800))),
    CONSTRAINT interview_sessions_generated_review_check CHECK (((generated_review IS NULL) OR (char_length(generated_review) <= 800))),
    CONSTRAINT interview_sessions_generation_model_check CHECK (((generation_model IS NULL) OR (char_length(generation_model) <= 200))),
    CONSTRAINT interview_sessions_generation_provider_check CHECK (((generation_provider IS NULL) OR (generation_provider = ANY (ARRAY['openai'::text, 'gemini'::text, 'deepseek'::text, 'xai'::text, 'anthropic'::text])))),
    CONSTRAINT interview_sessions_generation_request_id_check CHECK (((generation_request_id IS NULL) OR (char_length(generation_request_id) <= 200))),
    CONSTRAINT interview_sessions_generation_source_check CHECK (((generation_source IS NULL) OR (generation_source = ANY (ARRAY['ai'::text, 'template'::text])))),
    CONSTRAINT interview_sessions_generation_status_check CHECK ((generation_status = ANY (ARRAY['not_started'::text, 'generating'::text, 'succeeded'::text, 'failed'::text]))),
    CONSTRAINT interview_sessions_locale_check CHECK ((locale = ANY (ARRAY['ja'::text, 'en'::text]))),
    CONSTRAINT interview_sessions_profile_json_check CHECK (((jsonb_typeof(profile_json) = 'object'::text) AND (octet_length((profile_json)::text) <= 8192))),
    CONSTRAINT interview_sessions_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT interview_sessions_rewrite_count_check CHECK (((rewrite_count >= 0) AND (rewrite_count <= 20))),
    CONSTRAINT interview_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'generating'::text, 'completed'::text, 'abandoned'::text, 'failed'::text]))),
    CONSTRAINT interview_sessions_structured_answers_json_check CHECK (((jsonb_typeof(structured_answers_json) = 'object'::text) AND (octet_length((structured_answers_json)::text) <= 16384))),
    CONSTRAINT interview_sessions_visit_frequency_check CHECK (((visit_frequency IS NULL) OR (char_length(visit_frequency) <= 120)))
);


--
-- Name: require_interview_session(uuid, text); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.require_interview_session(p_session_id uuid, p_token_hash text) RETURNS api.interview_sessions
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_session api.interview_sessions%rowtype;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'SESSION_INVALID';
  end if;

  select sessions.*
  into v_session
  from api.interview_sessions sessions
  join private.interview_session_secrets secrets
    on secrets.session_id = sessions.id
   and secrets.store_id = sessions.store_id
  where sessions.id = p_session_id
    and secrets.session_token_hash = p_token_hash
    and secrets.revoked_at is null
    and secrets.expires_at > statement_timestamp();

  if not found then
    raise exception using errcode = 'P0001', message = 'SESSION_INVALID_OR_EXPIRED';
  end if;

  return v_session;
end;
$_$;


--
-- Name: require_owner(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.require_owner(p_owner_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not private.owner_exists(p_owner_id) then
    raise exception using errcode = 'P0001', message = 'OWNER_NOT_FOUND';
  end if;
end;
$$;


--
-- Name: require_store_owner(uuid, uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.require_store_owner(p_actor_id uuid, p_store_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
begin
  if p_actor_id is null or p_store_id is null or not exists (
    select 1
    from api.stores store
    where store.id = p_store_id
      and store.owner_id = p_actor_id
      and store.archived_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'STORE_NOT_FOUND';
  end if;
end;
$$;


--
-- Name: retention_cleanup_health(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.retention_cleanup_health() RETURNS TABLE(checked_at timestamp with time zone, last_run_at timestamp with time zone, last_success_at timestamp with time zone, consecutive_failures bigint, pending_session_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with run_summary as (
    select
      max(run.finished_at) as last_run_at,
      max(run.finished_at) filter (where run.succeeded) as last_success_at,
      count(*) filter (
        where not run.succeeded
          and run.id > coalesce((select max(success.id)
                                 from private.retention_cleanup_runs success
                                 where success.succeeded), 0)
      ) as consecutive_failures
    from private.retention_cleanup_runs run
  ), pending as (
    select coalesce(sum(preview.eligible_session_count), 0) as pending_session_count
    from private.preview_expired_interview_session_counts() preview
  )
  select statement_timestamp(), run_summary.last_run_at,
         run_summary.last_success_at, run_summary.consecutive_failures,
         pending.pending_session_count
  from run_summary cross join pending;
$$;


--
-- Name: FUNCTION retention_cleanup_health(); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.retention_cleanup_health() IS 'Content-free service-only health signal for external alerts; thresholds are maintained in the deployment runbook.';


--
-- Name: run_interview_session_retention_cleanup(integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.run_interview_session_retention_cleanup(p_limit integer DEFAULT 100) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_started_at timestamptz := clock_timestamp();
  v_target_count bigint := 0;
  v_result jsonb;
  v_deleted_count integer := 0;
  v_succeeded boolean := false;
begin
  -- Validate before entering the exception-handled operation so bad scheduler
  -- configuration is visible as an invocation failure rather than a fake run.
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_RETENTION_PURGE_LIMIT';
  end if;

  begin
    select coalesce(sum(preview.eligible_session_count), 0)
      into v_target_count
    from private.preview_expired_interview_session_counts() preview;

    v_result := private.purge_expired_interview_sessions(p_limit);
    v_deleted_count := (v_result ->> 'deleted_sessions')::integer;
    v_succeeded := true;
  exception when others then
    -- Deliberately retain only the failed state. Error text and SQL context can
    -- contain data, so neither is persisted or returned by this wrapper.
    v_result := null;
    v_deleted_count := 0;
    v_succeeded := false;
  end;

  insert into private.retention_cleanup_runs (
    started_at, finished_at, target_session_count, deleted_session_count,
    duration_ms, succeeded
  ) values (
    v_started_at,
    clock_timestamp(),
    v_target_count,
    v_deleted_count,
    greatest(0, floor(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::bigint),
    v_succeeded
  );

  return jsonb_build_object(
    'succeeded', v_succeeded,
    'target_session_count', v_target_count,
    'deleted_session_count', v_deleted_count,
    'remaining_eligible_sessions', case when v_succeeded
      then (v_result ->> 'remaining_eligible_sessions')::bigint else null end
  );
end;
$$;


--
-- Name: FUNCTION run_interview_session_retention_cleanup(p_limit integer); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.run_interview_session_retention_cleanup(p_limit integer) IS 'Service-role-only retention runner which writes a content-free success/failure audit row.';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;


--
-- Name: upcast_survey_config_v3(jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.upcast_survey_config_v3(p_config jsonb) RETURNS jsonb
    LANGUAGE plpgsql STRICT
    SET search_path TO ''
    AS $$
declare
  v_questions jsonb;
begin
  if p_config ->> 'version' <> '2' then
    return p_config;
  end if;

  v_questions := jsonb_build_array(
    jsonb_build_object(
      'id', 'q_' || left(replace(gen_random_uuid()::text, '-', ''), 12),
      'type', 'single_choice',
      'label', p_config #>> '{questions,visitFrequency,label}',
      'required', false,
      'role', 'visit_frequency',
      'options', jsonb_build_array(
        jsonb_build_object('value', 'first', 'label', '初めて'),
        jsonb_build_object('value', 'occasional', 'label', 'ときどき'),
        jsonb_build_object('value', 'regular', 'label', 'よく利用する'),
        jsonb_build_object('value', 'unknown', 'label', '回答しない')
      ),
      'allowOther', false
    ),
    jsonb_build_object(
      'id', 'q_' || left(replace(gen_random_uuid()::text, '-', ''), 12),
      'type', 'rating_5',
      'label', p_config #>> '{questions,rating,label}',
      'required', false,
      'role', 'rating',
      'lowLabel', '1',
      'highLabel', '5'
    ),
    jsonb_build_object(
      'id', 'q_' || left(replace(gen_random_uuid()::text, '-', ''), 12),
      'type', 'short_text',
      'label', p_config #>> '{questions,serviceUsed,label}',
      'placeholder', p_config #>> '{questions,serviceUsed,placeholder}',
      'required', true,
      'maxLength', 120
    ),
    jsonb_build_object(
      'id', 'q_' || left(replace(gen_random_uuid()::text, '-', ''), 12),
      'type', 'long_text',
      'label', p_config #>> '{questions,memorablePoints,label}',
      'placeholder', p_config #>> '{questions,memorablePoints,placeholder}',
      'required', true,
      'maxLength', 400
    ),
    jsonb_build_object(
      'id', 'q_' || left(replace(gen_random_uuid()::text, '-', ''), 12),
      'type', 'long_text',
      'label', p_config #>> '{questions,improvementPoints,label}',
      'placeholder', p_config #>> '{questions,improvementPoints,placeholder}',
      'required', false,
      'maxLength', 400
    )
  );

  return jsonb_build_object(
    'version', 3,
    'presetId', p_config ->> 'templateId',
    'title', p_config ->> 'title',
    'description', p_config ->> 'description',
    'questions', v_questions,
    'revision', 1
  );
end;
$$;


--
-- Name: zero_feature_effective_state(text, timestamp with time zone, boolean, timestamp with time zone); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.zero_feature_effective_state(p_configured_state text, p_release_at timestamp with time zone, p_kill_switch boolean, p_evaluated_at timestamp with time zone) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case
    -- A kill switch must never make an intentionally hidden feature visible.
    when p_configured_state = 'hidden' then 'hidden'
    when p_kill_switch or p_configured_state = 'paused' then 'paused'
    when p_release_at is not null and p_evaluated_at < p_release_at
      then 'coming_soon'
    when p_configured_state = 'coming_soon' and p_release_at is null
      then 'coming_soon'
    else 'available'
  end;
$$;


--
-- Name: zero_meo_bootstrap_store_workspace(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.zero_meo_bootstrap_store_workspace() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_organization_id uuid;
begin
  insert into private.zero_meo_organizations (owner_id, name, created_by, updated_by)
  values (new.owner_id, left(new.name || ' ワークスペース', 120), new.owner_id, new.owner_id)
  on conflict (owner_id) do update set updated_by = excluded.updated_by
  returning id into v_organization_id;

  insert into private.zero_meo_organization_members (
    organization_id, user_id, role, created_by, updated_by
  ) values (
    v_organization_id, new.owner_id, 'owner', new.owner_id, new.owner_id
  ) on conflict (organization_id, user_id) do update set role = 'owner', status = 'active';

  insert into private.zero_meo_store_workspaces (
    store_id, organization_id, approval_policy, created_by, updated_by
  ) values (
    new.id, v_organization_id, 'owner_direct', new.owner_id, new.owner_id
  ) on conflict (store_id) do nothing;
  return new;
end;
$$;


--
-- Name: zero_meo_change_request_is_valid(text, text, uuid, jsonb); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.zero_meo_change_request_is_valid(p_resource text, p_action text, p_record_id uuid, p_payload jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
begin
  if p_resource is null
    or p_action is null
    or jsonb_typeof(p_payload) <> 'object'
    or not private.zero_meo_json_is_bounded(p_payload, 65536)
    or p_resource in ('organizations', 'members', 'change_requests', 'audit')
  then
    return false;
  end if;

  if p_resource = 'profile' and p_action = 'save' then
    return jsonb_typeof(p_payload -> 'profile') = 'object';
  elsif p_resource = 'snapshots' and p_action = 'restore' then
    return p_record_id is not null;
  elsif p_resource = 'reviews' and p_action = 'update' then
    return p_record_id is not null
      and p_payload <> '{}'::jsonb
      and not exists (
        select 1 from jsonb_object_keys(p_payload) field
        where field <> all(array[
          'status', 'language', 'tags', 'reply', 'reply_language', 'template_id'
        ]::text[])
      );
  elsif p_resource = 'review_templates' and p_action = 'create' then
    return p_record_id is null
      and nullif(btrim(p_payload ->> 'name'), '') is not null
      and nullif(btrim(p_payload ->> 'body'), '') is not null;
  elsif p_resource = 'review_templates' and p_action = 'update' then
    return p_record_id is not null and p_payload <> '{}'::jsonb;
  elsif p_resource = 'review_templates' and p_action = 'delete' then
    return p_record_id is not null;
  elsif p_resource = 'media' and p_action = 'create' then
    return p_record_id is null
      and nullif(p_payload ->> 'storage_path', '') is not null
      and nullif(p_payload ->> 'media_type', '') is not null
      and nullif(p_payload ->> 'mime_type', '') is not null;
  elsif p_resource = 'media' and p_action = 'update' then
    return p_record_id is not null and p_payload <> '{}'::jsonb;
  elsif p_resource = 'posts' and p_action = 'create' then
    return p_record_id is null and nullif(btrim(p_payload ->> 'summary'), '') is not null;
  elsif p_resource = 'posts' and p_action = 'update' then
    return p_record_id is not null and p_payload <> '{}'::jsonb;
  elsif p_resource = 'posts' and p_action = 'delete' then
    return p_record_id is not null;
  elsif p_resource = 'rank_observations' and p_action = 'create' then
    return p_record_id is null
      and nullif(btrim(p_payload ->> 'keyword'), '') is not null
      and nullif(p_payload ->> 'target_place_id', '') is not null;
  elsif p_resource = 'insights' and p_action = 'create' then
    return p_record_id is null
      and nullif(p_payload ->> 'period_start', '') is not null
      and nullif(p_payload ->> 'period_end', '') is not null
      and jsonb_typeof(p_payload -> 'metrics') = 'object';
  elsif p_resource = 'aio_citations' and p_action = 'create' then
    return p_record_id is null
      and nullif(btrim(p_payload ->> 'source_name'), '') is not null
      and nullif(p_payload ->> 'source_type', '') is not null;
  elsif p_resource = 'aio_citations' and p_action in ('update', 'delete') then
    return p_record_id is not null
      and (p_action = 'delete' or p_payload <> '{}'::jsonb);
  elsif p_resource = 'aio_observations' and p_action = 'create' then
    return p_record_id is null
      and nullif(btrim(p_payload ->> 'prompt'), '') is not null
      and nullif(p_payload ->> 'engine', '') is not null;
  elsif p_resource = 'aio_observations' and p_action in ('update', 'delete') then
    return p_record_id is not null
      and (p_action = 'delete' or p_payload <> '{}'::jsonb);
  elsif p_resource = 'jsonld' and p_action = 'save' then
    return jsonb_typeof(p_payload -> 'document') = 'object';
  elsif p_resource = 'groups' and p_action = 'update' then
    if p_record_id is null
      or p_payload = '{}'::jsonb
      or exists (
        select 1 from jsonb_object_keys(p_payload) field
        where field <> all(array[
          'name', 'description', 'parent_group_id', 'store_ids'
        ]::text[])
      )
    then
      return false;
    end if;
    if p_payload ? 'store_ids' then
      if jsonb_typeof(p_payload -> 'store_ids') <> 'array'
        or exists (
          select 1
          from jsonb_array_elements_text(p_payload -> 'store_ids') store_id
          where store_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
      then
        return false;
      end if;
    end if;
    return true;
  end if;

  return false;
exception
  when others then
    return false;
end;
$_$;


--
-- Name: zero_meo_json_is_bounded(jsonb, integer); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.zero_meo_json_is_bounded(p_value jsonb, p_maximum_bytes integer DEFAULT 32768) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select p_value is not null
    and p_maximum_bytes between 2 and 262144
    and pg_column_size(p_value) <= p_maximum_bytes
    and private.meo_integration_json_is_safe(p_value);
$$;


--
-- Name: interview_messages; Type: TABLE; Schema: api; Owner: -
--

CREATE TABLE api.interview_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    store_id uuid NOT NULL,
    sequence integer NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    message_type text DEFAULT 'text'::text NOT NULL,
    idempotency_key_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT interview_messages_check CHECK ((((role = 'user'::text) AND ((char_length(content) >= 1) AND (char_length(content) <= 1000))) OR ((role = 'assistant'::text) AND ((char_length(content) >= 1) AND (char_length(content) <= 4000))))),
    CONSTRAINT interview_messages_idempotency_key_hash_check CHECK (((char_length(idempotency_key_hash) >= 32) AND (char_length(idempotency_key_hash) <= 128))),
    CONSTRAINT interview_messages_message_type_check CHECK ((message_type = ANY (ARRAY['text'::text, 'question'::text, 'answer'::text]))),
    CONSTRAINT interview_messages_role_check CHECK ((role = ANY (ARRAY['assistant'::text, 'user'::text]))),
    CONSTRAINT interview_messages_sequence_check CHECK ((sequence > 0))
);


--
-- Name: review_handoff_events; Type: TABLE; Schema: api; Owner: -
--

CREATE TABLE api.review_handoff_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    session_id uuid NOT NULL,
    event_type text NOT NULL,
    idempotency_key_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_handoff_events_event_type_check CHECK ((event_type = ANY (ARRAY['review_text_copied'::text, 'google_review_opened'::text]))),
    CONSTRAINT review_handoff_events_idempotency_key_hash_check CHECK (((char_length(idempotency_key_hash) >= 32) AND (char_length(idempotency_key_hash) <= 128)))
);


--
-- Name: stores; Type: TABLE; Schema: api; Owner: -
--

CREATE TABLE api.stores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    public_slug text NOT NULL,
    name text NOT NULL,
    industry text,
    address text,
    description text,
    website_url text,
    icon_path text,
    welcome_message text,
    closing_message text,
    google_review_url text,
    status text DEFAULT 'draft'::text NOT NULL,
    timezone text DEFAULT 'Asia/Tokyo'::text NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    google_place_id text,
    survey_config_json jsonb DEFAULT '{"title": "ご利用について教えてください", "version": 3, "presetId": "deep_dive_7", "revision": 1, "questions": [{"id": "q_000000000001", "role": "visit_frequency", "type": "single_choice", "label": "今回のご利用は何回目ですか", "options": [{"label": "初めて", "value": "first"}, {"label": "2〜3回目", "value": "two_three"}, {"label": "よく利用している", "value": "regular"}, {"label": "答えない", "value": "no_answer"}], "required": false, "allowOther": false}, {"id": "q_000000000002", "role": "rating", "type": "rating_5", "label": "今回の体験を5段階でいうと", "lowLabel": "物足りない", "required": false, "highLabel": "とても良い"}, {"id": "q_000000000003", "type": "single_choice", "label": "来る前に、少し気にしていたことはありましたか", "options": [{"label": "初めてで不安だった", "value": "first_time_anxiety"}, {"label": "料金が気になっていた", "value": "price_concern"}, {"label": "自分に合うか分からなかった", "value": "fit_uncertain"}, {"label": "特になかった", "value": "none"}], "required": false, "allowOther": true}, {"id": "q_000000000004", "type": "short_text", "label": "今回利用したメニュー・サービスを教えてください", "required": true, "maxLength": 120, "placeholder": "例：骨盤矯正、カット、ランチセット"}, {"id": "q_000000000005", "help": "うまく書けなくて大丈夫です。思い出したことをそのまま書いてください。", "type": "long_text", "label": "今回いちばん印象に残った場面を、そのときの様子がわかるように教えてください", "required": true, "maxLength": 400, "placeholder": "例：施術の前に、どこがどう歪んでいるかを模型で見せながら説明してくれた"}, {"id": "q_000000000006", "type": "long_text", "label": "それは、あなたにとってどんなふうに良かった（残念だった）ですか", "required": false, "maxLength": 400, "placeholder": "例：何をされるか分からない不安がなくなった"}, {"id": "q_000000000007", "type": "short_text", "label": "どんな人にすすめたいですか。あえて言うなら気になった点も教えてください", "required": false, "maxLength": 120, "placeholder": "例：整体が初めてで不安な人。予約は少し取りにくい"}], "description": "7問のかんたんなアンケートです。ご回答をもとに口コミ文の下書きを作成します。"}'::jsonb NOT NULL,
    owner_store_slot smallint DEFAULT 1 NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT stores_address_check CHECK (((address IS NULL) OR (char_length(address) <= 500))),
    CONSTRAINT stores_closing_message_check CHECK (((closing_message IS NULL) OR (char_length(closing_message) <= 1000))),
    CONSTRAINT stores_description_check CHECK (((description IS NULL) OR (char_length(description) <= 2000))),
    CONSTRAINT stores_google_place_id_check CHECK (((google_place_id IS NULL) OR (google_place_id ~ '^[A-Za-z0-9_-]{10,255}$'::text))),
    CONSTRAINT stores_google_review_url_check CHECK (((google_review_url IS NULL) OR ((char_length(google_review_url) <= 2048) AND (google_review_url ~ '^https://'::text)))),
    CONSTRAINT stores_icon_path_check CHECK (((icon_path IS NULL) OR (char_length(icon_path) <= 1024))),
    CONSTRAINT stores_industry_check CHECK (((industry IS NULL) OR (char_length(industry) <= 120))),
    CONSTRAINT stores_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120))),
    CONSTRAINT stores_owner_store_slot_check CHECK (((owner_store_slot >= 1) AND (owner_store_slot <= 100))),
    CONSTRAINT stores_public_slug_check CHECK (((char_length(public_slug) >= 16) AND (char_length(public_slug) <= 128))),
    CONSTRAINT stores_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'paused'::text]))),
    CONSTRAINT stores_survey_config_json_check CHECK (private.is_valid_survey_config(survey_config_json)),
    CONSTRAINT stores_timezone_check CHECK ((timezone = 'Asia/Tokyo'::text)),
    CONSTRAINT stores_website_url_check CHECK (((website_url IS NULL) OR (char_length(website_url) <= 2048))),
    CONSTRAINT stores_welcome_message_check CHECK (((welcome_message IS NULL) OR (char_length(welcome_message) <= 1000)))
);


--
-- Name: integration_jobs; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.integration_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    job_type text NOT NULL,
    dedupe_key_hash text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    processing_stage text,
    available_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    attempt_count smallint DEFAULT 0 NOT NULL,
    max_attempts smallint DEFAULT 5 NOT NULL,
    worker_id text,
    claim_token uuid,
    lease_expires_at timestamp with time zone,
    provider_task_id text,
    last_error_code text,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT integration_jobs_attempt_count_check CHECK (((attempt_count >= 0) AND (attempt_count <= 20))),
    CONSTRAINT integration_jobs_check CHECK ((((status = 'processing'::text) AND (processing_stage IS NOT NULL) AND (claim_token IS NOT NULL) AND (lease_expires_at IS NOT NULL)) OR ((status <> 'processing'::text) AND (processing_stage IS NULL) AND (claim_token IS NULL) AND (lease_expires_at IS NULL)))),
    CONSTRAINT integration_jobs_dedupe_key_hash_check CHECK ((dedupe_key_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT integration_jobs_job_type_check CHECK ((job_type = ANY (ARRAY['gbp_insights_sync'::text, 'rank_measurement'::text]))),
    CONSTRAINT integration_jobs_last_error_code_check CHECK (((last_error_code IS NULL) OR (last_error_code ~ '^[A-Z0-9_:-]{2,100}$'::text))),
    CONSTRAINT integration_jobs_max_attempts_check CHECK (((max_attempts >= 1) AND (max_attempts <= 20))),
    CONSTRAINT integration_jobs_payload_check CHECK (((jsonb_typeof(payload) = 'object'::text) AND (octet_length((payload)::text) <= 16384) AND private.meo_integration_json_is_safe(payload))),
    CONSTRAINT integration_jobs_processing_stage_check CHECK (((processing_stage IS NULL) OR (processing_stage = ANY (ARRAY['submit'::text, 'poll'::text, 'execute'::text])))),
    CONSTRAINT integration_jobs_provider_task_id_check CHECK (((provider_task_id IS NULL) OR ((char_length(provider_task_id) >= 1) AND (char_length(provider_task_id) <= 200)))),
    CONSTRAINT integration_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'processing'::text, 'provider_submitted'::text, 'retry_scheduled'::text, 'completed'::text, 'failed'::text, 'attention_required'::text, 'dead_letter'::text, 'cancel_requested'::text, 'cancelled'::text]))),
    CONSTRAINT integration_jobs_worker_id_check CHECK (((worker_id IS NULL) OR (worker_id ~ '^[A-Za-z0-9._:@/-]{3,120}$'::text)))
);


--
-- Name: TABLE integration_jobs; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.integration_jobs IS 'Bounded durable queue for Zero integrations. Payloads reject credential/token/raw-response keys.';


--
-- Name: integration_receipts; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.integration_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    job_id uuid,
    action_type text NOT NULL,
    provider text NOT NULL,
    request_hash text NOT NULL,
    provider_resource_hash text,
    outcome text NOT NULL,
    safe_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT integration_receipts_action_type_check CHECK ((action_type = ANY (ARRAY['review_reply'::text, 'gbp_post'::text, 'rank_measurement'::text, 'gbp_insights_sync'::text]))),
    CONSTRAINT integration_receipts_outcome_check CHECK ((outcome = ANY (ARRAY['succeeded'::text, 'failed'::text, 'attention_required'::text]))),
    CONSTRAINT integration_receipts_provider_check CHECK ((provider = ANY (ARRAY['google_business'::text, 'instagram'::text, 'dataforseo'::text]))),
    CONSTRAINT integration_receipts_provider_resource_hash_check CHECK (((provider_resource_hash IS NULL) OR (provider_resource_hash ~ '^[0-9a-f]{32,64}$'::text))),
    CONSTRAINT integration_receipts_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{32,64}$'::text)),
    CONSTRAINT integration_receipts_safe_metadata_check CHECK (((jsonb_typeof(safe_metadata) = 'object'::text) AND (octet_length((safe_metadata)::text) <= 4096) AND private.meo_integration_json_is_safe(safe_metadata)))
);


--
-- Name: TABLE integration_receipts; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.integration_receipts IS 'Normalized external-effect evidence only; never a raw provider response or plaintext token.';


--
-- Name: interview_session_secrets; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.interview_session_secrets (
    session_id uuid NOT NULL,
    store_id uuid NOT NULL,
    session_token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT interview_session_secrets_session_token_hash_check CHECK ((session_token_hash ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: interview_survey_snapshots; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.interview_survey_snapshots (
    session_id uuid NOT NULL,
    store_id uuid NOT NULL,
    source_revision integer NOT NULL,
    selection_json jsonb NOT NULL,
    resolved_config_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT interview_survey_snapshots_check CHECK (private.is_valid_interview_survey_snapshot_row(source_revision, selection_json, resolved_config_json)),
    CONSTRAINT interview_survey_snapshots_source_revision_check CHECK ((source_revision >= 1))
);


--
-- Name: meo_ai_draft_reservations; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_ai_draft_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    key_hash text,
    request_hash text,
    usage_date date NOT NULL,
    credential_source text NOT NULL,
    status text NOT NULL,
    denial_count integer DEFAULT 0 NOT NULL,
    provider text,
    model text,
    error_code text,
    result_json jsonb,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    settled_at timestamp with time zone,
    CONSTRAINT meo_ai_draft_reservations_check1 CHECK (((key_hash IS NULL) = (request_hash IS NULL))),
    CONSTRAINT meo_ai_draft_reservations_check2 CHECK ((((status = 'denied'::text) AND (key_hash IS NULL) AND (error_code IS NOT NULL) AND (denial_count > 0)) OR ((status <> 'denied'::text) AND (key_hash IS NOT NULL) AND (denial_count = 0)))),
    CONSTRAINT meo_ai_draft_reservations_check3 CHECK ((((status = ANY (ARRAY['reserved'::text, 'denied'::text])) AND (provider IS NULL) AND (model IS NULL) AND (settled_at IS NULL)) OR ((status = ANY (ARRAY['succeeded'::text, 'failed'::text])) AND (provider IS NOT NULL) AND (model IS NOT NULL) AND (settled_at IS NOT NULL)))),
    CONSTRAINT meo_ai_draft_reservations_check4 CHECK ((((status = 'succeeded'::text) AND (error_code IS NULL) AND (result_json IS NOT NULL)) OR (status <> 'succeeded'::text))),
    CONSTRAINT meo_ai_draft_reservations_check5 CHECK (((status <> 'failed'::text) OR (result_json IS NULL))),
    CONSTRAINT meo_ai_draft_reservations_credential_source_check CHECK ((credential_source = 'owner_provider'::text)),
    CONSTRAINT meo_ai_draft_reservations_denial_count_check CHECK (((denial_count >= 0) AND (denial_count <= 1000000000))),
    CONSTRAINT meo_ai_draft_reservations_error_code_check CHECK (((error_code IS NULL) OR (error_code ~ '^[A-Z0-9_:-]{2,100}$'::text))),
    CONSTRAINT meo_ai_draft_reservations_key_hash_check CHECK (((key_hash IS NULL) OR (key_hash ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT meo_ai_draft_reservations_model_check CHECK (((model IS NULL) OR ((char_length(model) >= 1) AND (char_length(model) <= 200)))),
    CONSTRAINT meo_ai_draft_reservations_provider_check CHECK (((provider IS NULL) OR (provider = ANY (ARRAY['openai'::text, 'gemini'::text, 'deepseek'::text, 'xai'::text, 'anthropic'::text])))),
    CONSTRAINT meo_ai_draft_reservations_request_hash_check CHECK (((request_hash IS NULL) OR (request_hash ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT meo_ai_draft_reservations_result_check CHECK (((result_json IS NULL) OR ((status = 'succeeded'::text) AND private.meo_ai_draft_result_is_valid(result_json) AND ((result_json ->> 'source'::text) = 'owner_provider'::text)))),
    CONSTRAINT meo_ai_draft_reservations_status_check CHECK ((status = ANY (ARRAY['reserved'::text, 'succeeded'::text, 'failed'::text, 'denied'::text])))
);


--
-- Name: TABLE meo_ai_draft_reservations; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.meo_ai_draft_reservations IS 'Sponsored review-reply draft reservations and settlement audit, isolated from interview and rank accounting.';


--
-- Name: meo_aio_citation_entries; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_aio_citation_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    source_name text NOT NULL,
    source_type text NOT NULL,
    url text,
    nap_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    consistency_status text DEFAULT 'unchecked'::text NOT NULL,
    last_checked_at timestamp with time zone,
    notes text,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_aio_citation_entries_consistency_status_check CHECK ((consistency_status = ANY (ARRAY['unchecked'::text, 'consistent'::text, 'mismatch'::text, 'missing'::text]))),
    CONSTRAINT meo_aio_citation_entries_nap_snapshot_check CHECK (((jsonb_typeof(nap_snapshot) = 'object'::text) AND private.zero_meo_json_is_bounded(nap_snapshot, 16384))),
    CONSTRAINT meo_aio_citation_entries_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 4000))),
    CONSTRAINT meo_aio_citation_entries_source_name_check CHECK (((char_length(btrim(source_name)) >= 1) AND (char_length(btrim(source_name)) <= 200))),
    CONSTRAINT meo_aio_citation_entries_source_type_check CHECK ((source_type = ANY (ARRAY['website'::text, 'directory'::text, 'social'::text, 'map'::text, 'assistant'::text, 'other'::text]))),
    CONSTRAINT meo_aio_citation_entries_url_check CHECK (((url IS NULL) OR ((char_length(url) <= 2048) AND (url ~ '^https://'::text))))
);


--
-- Name: meo_aio_jsonld_snapshots; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_aio_jsonld_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    schema_type text DEFAULT 'LocalBusiness'::text NOT NULL,
    document jsonb NOT NULL,
    validation_errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_aio_jsonld_snapshots_document_check CHECK (((jsonb_typeof(document) = 'object'::text) AND private.zero_meo_json_is_bounded(document, 65536))),
    CONSTRAINT meo_aio_jsonld_snapshots_schema_type_check CHECK (((char_length(schema_type) >= 3) AND (char_length(schema_type) <= 120))),
    CONSTRAINT meo_aio_jsonld_snapshots_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'valid'::text, 'invalid'::text, 'exported'::text]))),
    CONSTRAINT meo_aio_jsonld_snapshots_validation_errors_check CHECK (((jsonb_typeof(validation_errors) = 'array'::text) AND private.zero_meo_json_is_bounded(validation_errors, 16384)))
);


--
-- Name: meo_aio_observations; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_aio_observations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    prompt text NOT NULL,
    engine text NOT NULL,
    mentioned boolean NOT NULL,
    "position" smallint,
    cited_urls text[] DEFAULT '{}'::text[] NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    notes text,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_aio_observations_cited_urls_check CHECK ((cardinality(cited_urls) <= 50)),
    CONSTRAINT meo_aio_observations_engine_check CHECK ((engine = ANY (ARRAY['chatgpt'::text, 'gemini'::text, 'perplexity'::text, 'copilot'::text, 'other'::text]))),
    CONSTRAINT meo_aio_observations_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 4000))),
    CONSTRAINT meo_aio_observations_position_check CHECK ((("position" IS NULL) OR (("position" >= 1) AND ("position" <= 100)))),
    CONSTRAINT meo_aio_observations_prompt_check CHECK (((char_length(btrim(prompt)) >= 1) AND (char_length(btrim(prompt)) <= 2000)))
);


--
-- Name: meo_export_requests; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_export_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    export_type text NOT NULL,
    format text NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    artifact_path text,
    expires_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_export_requests_artifact_path_check CHECK (((artifact_path IS NULL) OR (char_length(artifact_path) <= 1024))),
    CONSTRAINT meo_export_requests_export_type_check CHECK ((export_type = ANY (ARRAY['profile'::text, 'reviews'::text, 'posts'::text, 'rankings'::text, 'insights'::text, 'aio'::text, 'workspace'::text]))),
    CONSTRAINT meo_export_requests_filters_check CHECK (private.zero_meo_json_is_bounded(filters, 8192)),
    CONSTRAINT meo_export_requests_format_check CHECK ((format = ANY (ARRAY['csv'::text, 'json'::text, 'jsonld'::text]))),
    CONSTRAINT meo_export_requests_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'ready'::text, 'downloaded'::text, 'expired'::text, 'failed'::text])))
);


--
-- Name: meo_external_actions; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_external_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    action text NOT NULL,
    key_hash text NOT NULL,
    request_hash text NOT NULL,
    status text DEFAULT 'processing'::text NOT NULL,
    result_json jsonb,
    error_code text,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    completed_at timestamp with time zone,
    actor_id uuid NOT NULL,
    CONSTRAINT meo_external_actions_action_check CHECK ((action = ANY (ARRAY['review_reply'::text, 'gbp_post'::text]))),
    CONSTRAINT meo_external_actions_error_code_check CHECK (((error_code IS NULL) OR (error_code ~ '^[A-Z0-9_:-]{2,100}$'::text))),
    CONSTRAINT meo_external_actions_key_hash_check CHECK ((key_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT meo_external_actions_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT meo_external_actions_result_json_check CHECK (((result_json IS NULL) OR ((jsonb_typeof(result_json) = 'object'::text) AND (octet_length((result_json)::text) <= 8192) AND private.meo_integration_json_is_safe(result_json)))),
    CONSTRAINT meo_external_actions_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'completed'::text, 'failed'::text, 'attention_required'::text])))
);


--
-- Name: meo_gbp_profile_snapshots; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_gbp_profile_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    profile jsonb NOT NULL,
    diff jsonb DEFAULT '{}'::jsonb NOT NULL,
    source text NOT NULL,
    base_snapshot_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_gbp_profile_snapshots_diff_check CHECK (((jsonb_typeof(diff) = 'object'::text) AND private.zero_meo_json_is_bounded(diff, 65536))),
    CONSTRAINT meo_gbp_profile_snapshots_profile_check CHECK (((jsonb_typeof(profile) = 'object'::text) AND private.zero_meo_json_is_bounded(profile, 65536))),
    CONSTRAINT meo_gbp_profile_snapshots_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'google_business'::text, 'csv'::text, 'restore'::text])))
);


--
-- Name: meo_gbp_profiles; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_gbp_profiles (
    store_id uuid NOT NULL,
    profile jsonb DEFAULT '{}'::jsonb NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    provider_etag text,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_gbp_profiles_profile_check CHECK (((jsonb_typeof(profile) = 'object'::text) AND private.zero_meo_json_is_bounded(profile, 65536))),
    CONSTRAINT meo_gbp_profiles_provider_etag_check CHECK (((provider_etag IS NULL) OR (char_length(provider_etag) <= 500))),
    CONSTRAINT meo_gbp_profiles_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'google_business'::text, 'csv'::text])))
);


--
-- Name: meo_health_diagnoses; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_health_diagnoses (
    usage_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    store_id uuid NOT NULL,
    key_hash text NOT NULL,
    request_hash text NOT NULL,
    status text NOT NULL,
    result_json jsonb,
    last_error_code text,
    lease_expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT meo_health_diagnoses_check CHECK ((((status = 'processing'::text) AND (result_json IS NULL) AND (completed_at IS NULL) AND (last_error_code IS NULL)) OR ((status = 'succeeded'::text) AND (result_json IS NOT NULL) AND (completed_at IS NOT NULL) AND (last_error_code IS NULL)) OR ((status = ANY (ARRAY['failed'::text, 'attention_required'::text])) AND (result_json IS NULL) AND (completed_at IS NOT NULL) AND (last_error_code IS NOT NULL)) OR ((status = 'expired'::text) AND (result_json IS NULL) AND (completed_at IS NOT NULL) AND (last_error_code = 'HEALTH_DIAGNOSIS_RESULT_EXPIRED'::text)))),
    CONSTRAINT meo_health_diagnoses_key_hash_check CHECK ((key_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT meo_health_diagnoses_last_error_code_check CHECK (((last_error_code IS NULL) OR (last_error_code ~ '^[A-Z0-9_:-]{2,100}$'::text))),
    CONSTRAINT meo_health_diagnoses_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT meo_health_diagnoses_result_json_check CHECK (((result_json IS NULL) OR private.meo_health_result_is_valid(result_json))),
    CONSTRAINT meo_health_diagnoses_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'succeeded'::text, 'failed'::text, 'attention_required'::text, 'expired'::text])))
);


--
-- Name: TABLE meo_health_diagnoses; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.meo_health_diagnoses IS 'Bounded derived GBP diagnosis replay records. Contains score plus exactly nine safe checks; never raw Google payloads or credentials.';


--
-- Name: meo_insight_snapshots; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_insight_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    source text NOT NULL,
    metrics jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    input_method text DEFAULT 'manual'::text NOT NULL,
    import_batch_id uuid,
    created_by uuid,
    updated_by uuid,
    CONSTRAINT meo_insight_snapshots_check CHECK (((period_end >= period_start) AND ((period_end - period_start) <= 366))),
    CONSTRAINT meo_insight_snapshots_input_method_check CHECK ((input_method = ANY (ARRAY['manual'::text, 'csv'::text, 'provider'::text]))),
    CONSTRAINT meo_insight_snapshots_metrics_check CHECK (private.meo_insight_metrics_are_valid(metrics)),
    CONSTRAINT meo_insight_snapshots_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'google_business'::text])))
);


--
-- Name: TABLE meo_insight_snapshots; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.meo_insight_snapshots IS 'Shared Google performance snapshots. GBP health is stateless/rule-based and the Edge route performs the same rollout gate without adding a second data store.';


--
-- Name: meo_manual_health_diagnoses; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_manual_health_diagnoses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    key_hash text NOT NULL,
    request_hash text NOT NULL,
    result_json jsonb NOT NULL,
    completed_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_manual_health_diagnoses_key_hash_check CHECK ((key_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT meo_manual_health_diagnoses_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT meo_manual_health_diagnoses_result_json_check CHECK (private.meo_health_result_is_valid(result_json))
);


--
-- Name: TABLE meo_manual_health_diagnoses; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.meo_manual_health_diagnoses IS 'Exact-replay ledger for bounded manual GBP diagnosis results. Contains only score plus the fixed nine checks; never raw Google payloads or credentials.';


--
-- Name: meo_media_assets; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_media_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    storage_path text NOT NULL,
    media_type text NOT NULL,
    mime_type text NOT NULL,
    alt_text text,
    byte_size bigint,
    safe_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_media_assets_alt_text_check CHECK (((alt_text IS NULL) OR (char_length(alt_text) <= 500))),
    CONSTRAINT meo_media_assets_byte_size_check CHECK (((byte_size IS NULL) OR ((byte_size >= 1) AND (byte_size <= 104857600)))),
    CONSTRAINT meo_media_assets_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text]))),
    CONSTRAINT meo_media_assets_mime_type_check CHECK ((mime_type ~ '^(image|video)/[A-Za-z0-9.+-]+$'::text)),
    CONSTRAINT meo_media_assets_safe_metadata_check CHECK (((jsonb_typeof(safe_metadata) = 'object'::text) AND private.zero_meo_json_is_bounded(safe_metadata, 8192))),
    CONSTRAINT meo_media_assets_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text]))),
    CONSTRAINT meo_media_assets_storage_path_check CHECK (((char_length(storage_path) >= 1) AND (char_length(storage_path) <= 1024)))
);


--
-- Name: meo_oauth_states; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_oauth_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid NOT NULL,
    store_id uuid NOT NULL,
    provider text NOT NULL,
    state_hash text NOT NULL,
    browser_challenge text NOT NULL,
    return_path text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_oauth_states_browser_challenge_check CHECK ((browser_challenge ~ '^[A-Za-z0-9_-]{43}$'::text)),
    CONSTRAINT meo_oauth_states_check CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '00:15:00'::interval)))),
    CONSTRAINT meo_oauth_states_provider_check CHECK ((provider = ANY (ARRAY['google_business'::text, 'instagram'::text]))),
    CONSTRAINT meo_oauth_states_return_path_check CHECK (((char_length(return_path) >= 20) AND (char_length(return_path) <= 512))),
    CONSTRAINT meo_oauth_states_state_hash_check CHECK ((state_hash ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: meo_post_drafts; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_post_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    post_type text DEFAULT 'update'::text NOT NULL,
    title text,
    summary text NOT NULL,
    call_to_action text,
    call_to_action_url text,
    media_asset_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    provider_resource_name text,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_post_drafts_call_to_action_check CHECK (((call_to_action IS NULL) OR (char_length(call_to_action) <= 100))),
    CONSTRAINT meo_post_drafts_call_to_action_url_check CHECK (((call_to_action_url IS NULL) OR ((char_length(call_to_action_url) <= 2048) AND (call_to_action_url ~ '^https://'::text)))),
    CONSTRAINT meo_post_drafts_details_check CHECK (((jsonb_typeof(details) = 'object'::text) AND private.zero_meo_json_is_bounded(details, 32768))),
    CONSTRAINT meo_post_drafts_media_asset_ids_check CHECK ((cardinality(media_asset_ids) <= 10)),
    CONSTRAINT meo_post_drafts_post_type_check CHECK ((post_type = ANY (ARRAY['update'::text, 'event'::text, 'offer'::text]))),
    CONSTRAINT meo_post_drafts_provider_resource_name_check CHECK (((provider_resource_name IS NULL) OR (char_length(provider_resource_name) <= 500))),
    CONSTRAINT meo_post_drafts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'ready'::text, 'published'::text, 'archived'::text, 'deleted'::text]))),
    CONSTRAINT meo_post_drafts_summary_check CHECK (((char_length(btrim(summary)) >= 1) AND (char_length(btrim(summary)) <= 1500))),
    CONSTRAINT meo_post_drafts_title_check CHECK (((title IS NULL) OR (char_length(title) <= 300)))
);


--
-- Name: meo_post_publication_events; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_post_publication_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    post_id uuid NOT NULL,
    revision integer NOT NULL,
    revision_fingerprint text NOT NULL,
    outcome text NOT NULL,
    provider_resource_name text,
    safe_readback jsonb DEFAULT '{}'::jsonb NOT NULL,
    confirmed_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_post_publication_events_outcome_check CHECK ((outcome = ANY (ARRAY['confirmed'::text, 'failed'::text, 'deleted'::text, 'readback_mismatch'::text]))),
    CONSTRAINT meo_post_publication_events_provider_resource_name_check CHECK (((provider_resource_name IS NULL) OR (char_length(provider_resource_name) <= 500))),
    CONSTRAINT meo_post_publication_events_revision_check CHECK (((revision >= 1) AND (revision <= 10000))),
    CONSTRAINT meo_post_publication_events_revision_fingerprint_check CHECK ((revision_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT meo_post_publication_events_safe_readback_check CHECK (((jsonb_typeof(safe_readback) = 'object'::text) AND private.zero_meo_json_is_bounded(safe_readback, 16384)))
);


--
-- Name: meo_post_revisions; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_post_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    post_id uuid NOT NULL,
    revision integer NOT NULL,
    content jsonb NOT NULL,
    revision_fingerprint text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_post_revisions_content_check CHECK (((jsonb_typeof(content) = 'object'::text) AND private.zero_meo_json_is_bounded(content, 32768))),
    CONSTRAINT meo_post_revisions_revision_check CHECK (((revision >= 1) AND (revision <= 10000))),
    CONSTRAINT meo_post_revisions_revision_fingerprint_check CHECK ((revision_fingerprint ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: meo_rank_measurements; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_rank_measurements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    job_id uuid,
    key_hash text NOT NULL,
    request_hash text NOT NULL,
    usage_date date NOT NULL,
    credential_source text NOT NULL,
    keyword text NOT NULL,
    normalized_keyword text NOT NULL,
    target_place_id text NOT NULL,
    competitor_place_ids text[] DEFAULT '{}'::text[] NOT NULL,
    location_code integer,
    language_code text DEFAULT 'ja'::text NOT NULL,
    device text DEFAULT 'desktop'::text NOT NULL,
    status text NOT NULL,
    observation_id uuid,
    error_code text,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT meo_rank_measurements_check CHECK ((((status = 'denied'::text) AND (job_id IS NULL)) OR (status <> 'denied'::text))),
    CONSTRAINT meo_rank_measurements_competitor_place_ids_check CHECK (private.meo_place_ids_are_valid(competitor_place_ids, 3)),
    CONSTRAINT meo_rank_measurements_credential_source_check CHECK ((credential_source = 'owner_provider'::text)),
    CONSTRAINT meo_rank_measurements_device_check CHECK ((device = ANY (ARRAY['mobile'::text, 'desktop'::text]))),
    CONSTRAINT meo_rank_measurements_error_code_check CHECK (((error_code IS NULL) OR (error_code ~ '^[A-Z0-9_:-]{2,100}$'::text))),
    CONSTRAINT meo_rank_measurements_key_hash_check CHECK ((key_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT meo_rank_measurements_keyword_check CHECK (((char_length(keyword) >= 1) AND (char_length(keyword) <= 120))),
    CONSTRAINT meo_rank_measurements_language_code_check CHECK ((language_code ~ '^[a-z]{2}(-[A-Z]{2})?$'::text)),
    CONSTRAINT meo_rank_measurements_location_code_check CHECK (((location_code IS NULL) OR (location_code > 0))),
    CONSTRAINT meo_rank_measurements_normalized_keyword_check CHECK (((char_length(normalized_keyword) >= 1) AND (char_length(normalized_keyword) <= 120))),
    CONSTRAINT meo_rank_measurements_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT meo_rank_measurements_status_check CHECK ((status = ANY (ARRAY['reserved'::text, 'submitted'::text, 'completed'::text, 'failed'::text, 'denied'::text, 'attention_required'::text, 'dead_letter'::text]))),
    CONSTRAINT meo_rank_measurements_target_place_id_check CHECK ((target_place_id ~ '^[A-Za-z0-9_-]{10,255}$'::text))
);


--
-- Name: meo_rank_observations; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_rank_observations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    keyword text NOT NULL,
    normalized_keyword text NOT NULL,
    own_place_id text NOT NULL,
    own_position smallint,
    competitor_positions jsonb DEFAULT '[]'::jsonb NOT NULL,
    source text NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    result_count smallint,
    result_fingerprint text,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    input_method text DEFAULT 'manual'::text NOT NULL,
    import_batch_id uuid,
    location_label text,
    latitude numeric(9,6),
    longitude numeric(9,6),
    matched_url text,
    created_by uuid,
    CONSTRAINT meo_rank_observations_competitor_positions_check CHECK (((jsonb_typeof(competitor_positions) = 'array'::text) AND (jsonb_array_length(competitor_positions) <= 3) AND (octet_length((competitor_positions)::text) <= 2048) AND private.meo_integration_json_is_safe(competitor_positions))),
    CONSTRAINT meo_rank_observations_input_method_check CHECK ((input_method = ANY (ARRAY['manual'::text, 'csv'::text, 'provider'::text]))),
    CONSTRAINT meo_rank_observations_keyword_check CHECK (((char_length(keyword) >= 1) AND (char_length(keyword) <= 120))),
    CONSTRAINT meo_rank_observations_latitude_check CHECK (((latitude IS NULL) OR ((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric)))),
    CONSTRAINT meo_rank_observations_location_label_check CHECK (((location_label IS NULL) OR (char_length(location_label) <= 300))),
    CONSTRAINT meo_rank_observations_longitude_check CHECK (((longitude IS NULL) OR ((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric)))),
    CONSTRAINT meo_rank_observations_matched_url_check CHECK (((matched_url IS NULL) OR ((char_length(matched_url) <= 2048) AND (matched_url ~ '^https://'::text)))),
    CONSTRAINT meo_rank_observations_normalized_keyword_check CHECK (((char_length(normalized_keyword) >= 1) AND (char_length(normalized_keyword) <= 120))),
    CONSTRAINT meo_rank_observations_own_place_id_check CHECK ((own_place_id ~ '^[A-Za-z0-9_-]{10,255}$'::text)),
    CONSTRAINT meo_rank_observations_own_position_check CHECK (((own_position IS NULL) OR ((own_position >= 1) AND (own_position <= 100)))),
    CONSTRAINT meo_rank_observations_result_count_check CHECK (((result_count IS NULL) OR ((result_count >= 0) AND (result_count <= 100)))),
    CONSTRAINT meo_rank_observations_result_fingerprint_check CHECK (((result_fingerprint IS NULL) OR (result_fingerprint ~ '^[0-9a-f]{32}$'::text))),
    CONSTRAINT meo_rank_observations_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'owner_provider'::text])))
);


--
-- Name: meo_rank_targets; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_rank_targets (
    store_id uuid NOT NULL,
    keyword text NOT NULL,
    normalized_keyword text NOT NULL,
    own_place_id text NOT NULL,
    competitor_place_ids text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_rank_targets_competitor_place_ids_check CHECK (private.meo_place_ids_are_valid(competitor_place_ids, 3)),
    CONSTRAINT meo_rank_targets_keyword_check CHECK (((char_length(keyword) >= 1) AND (char_length(keyword) <= 120))),
    CONSTRAINT meo_rank_targets_normalized_keyword_check CHECK (((char_length(normalized_keyword) >= 1) AND (char_length(normalized_keyword) <= 120))),
    CONSTRAINT meo_rank_targets_own_place_id_check CHECK ((own_place_id ~ '^[A-Za-z0-9_-]{10,255}$'::text))
);


--
-- Name: meo_review_inbox; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_review_inbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    provider text DEFAULT 'manual'::text NOT NULL,
    provider_review_id text,
    reviewer_display_name text,
    rating smallint NOT NULL,
    review_text text,
    language text DEFAULT 'und'::text NOT NULL,
    status text DEFAULT 'unread'::text NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    reply_text text,
    reply_language text,
    native_analysis_input jsonb DEFAULT '{}'::jsonb NOT NULL,
    reviewed_at timestamp with time zone,
    replied_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_review_inbox_language_check CHECK (((language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'::text) OR (language = 'und'::text))),
    CONSTRAINT meo_review_inbox_native_analysis_input_check CHECK (((jsonb_typeof(native_analysis_input) = 'object'::text) AND private.zero_meo_json_is_bounded(native_analysis_input, 16384))),
    CONSTRAINT meo_review_inbox_provider_check CHECK ((provider = ANY (ARRAY['manual'::text, 'google_business'::text, 'csv'::text]))),
    CONSTRAINT meo_review_inbox_provider_review_id_check CHECK (((provider_review_id IS NULL) OR (char_length(provider_review_id) <= 500))),
    CONSTRAINT meo_review_inbox_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT meo_review_inbox_reply_language_check CHECK (((reply_language IS NULL) OR (reply_language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'::text))),
    CONSTRAINT meo_review_inbox_reply_text_check CHECK (((reply_text IS NULL) OR (char_length(reply_text) <= 4096))),
    CONSTRAINT meo_review_inbox_review_text_check CHECK (((review_text IS NULL) OR (char_length(review_text) <= 10000))),
    CONSTRAINT meo_review_inbox_reviewer_display_name_check CHECK (((reviewer_display_name IS NULL) OR (char_length(reviewer_display_name) <= 200))),
    CONSTRAINT meo_review_inbox_status_check CHECK ((status = ANY (ARRAY['unread'::text, 'read'::text, 'needs_reply'::text, 'replied'::text, 'archived'::text]))),
    CONSTRAINT meo_review_inbox_tags_check CHECK ((cardinality(tags) <= 20))
);


--
-- Name: meo_review_reply_revisions; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_review_reply_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    review_id uuid NOT NULL,
    template_id uuid,
    body text,
    language text,
    revision_action text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_review_reply_revisions_body_check CHECK (((body IS NULL) OR (char_length(body) <= 4096))),
    CONSTRAINT meo_review_reply_revisions_language_check CHECK (((language IS NULL) OR (language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'::text))),
    CONSTRAINT meo_review_reply_revisions_revision_action_check CHECK ((revision_action = ANY (ARRAY['drafted'::text, 'edited'::text, 'confirmed'::text, 'deleted'::text])))
);


--
-- Name: meo_review_reply_templates; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.meo_review_reply_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    name text NOT NULL,
    body text NOT NULL,
    language text DEFAULT 'ja'::text NOT NULL,
    min_rating smallint,
    max_rating smallint,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT meo_review_reply_templates_body_check CHECK (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 4096))),
    CONSTRAINT meo_review_reply_templates_check CHECK (((min_rating IS NULL) OR (max_rating IS NULL) OR (min_rating <= max_rating))),
    CONSTRAINT meo_review_reply_templates_language_check CHECK ((language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'::text)),
    CONSTRAINT meo_review_reply_templates_max_rating_check CHECK (((max_rating IS NULL) OR ((max_rating >= 1) AND (max_rating <= 5)))),
    CONSTRAINT meo_review_reply_templates_min_rating_check CHECK (((min_rating IS NULL) OR ((min_rating >= 1) AND (min_rating <= 5)))),
    CONSTRAINT meo_review_reply_templates_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120))),
    CONSTRAINT meo_review_reply_templates_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: rate_limit_counters; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.rate_limit_counters (
    scope text NOT NULL,
    store_id uuid NOT NULL,
    subject_hash text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    window_seconds integer NOT NULL,
    request_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT rate_limit_counters_request_count_check CHECK ((request_count >= 0)),
    CONSTRAINT rate_limit_counters_scope_check CHECK ((scope = ANY (ARRAY['ip_store'::text, 'session'::text]))),
    CONSTRAINT rate_limit_counters_subject_hash_check CHECK ((subject_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT rate_limit_counters_window_seconds_check CHECK ((window_seconds = ANY (ARRAY[60, 600, 3600])))
);


--
-- Name: request_idempotency; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.request_idempotency (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text NOT NULL,
    subject_id uuid NOT NULL,
    key_hash text NOT NULL,
    request_hash text NOT NULL,
    status text DEFAULT 'processing'::text NOT NULL,
    request_ref uuid,
    result_ref uuid,
    result_json jsonb,
    error_code text,
    lease_expires_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT request_idempotency_error_code_check CHECK (((error_code IS NULL) OR (char_length(error_code) <= 100))),
    CONSTRAINT request_idempotency_key_hash_check CHECK ((key_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT request_idempotency_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT request_idempotency_result_json_check CHECK (((result_json IS NULL) OR ((jsonb_typeof(result_json) = ANY (ARRAY['object'::text, 'array'::text, 'null'::text])) AND (octet_length((result_json)::text) <= 32768)))),
    CONSTRAINT request_idempotency_scope_check CHECK ((scope = ANY (ARRAY['session_start'::text, 'turn'::text, 'review'::text, 'rewrite'::text, 'review_edit'::text, 'handoff'::text, 'owner_store'::text, 'owner_store_create'::text, 'owner_store_update'::text, 'owner_publish'::text, 'owner_pause'::text, 'owner_survey_update'::text, 'owner_connection_save'::text, 'owner_connection_revalidate'::text, 'owner_connection_select'::text, 'owner_connection_model'::text, 'owner_connection_delete'::text, 'owner_account_delete'::text]))),
    CONSTRAINT request_idempotency_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: TABLE request_idempotency; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.request_idempotency IS 'Server-only mutation ledger. Stores hashes and references, never raw request bodies or tokens.';


--
-- Name: retention_cleanup_runs; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.retention_cleanup_runs (
    id bigint NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone NOT NULL,
    target_session_count bigint NOT NULL,
    deleted_session_count integer NOT NULL,
    duration_ms bigint NOT NULL,
    succeeded boolean NOT NULL,
    CONSTRAINT retention_cleanup_runs_deleted_session_count_check CHECK ((deleted_session_count >= 0)),
    CONSTRAINT retention_cleanup_runs_duration_ms_check CHECK ((duration_ms >= 0)),
    CONSTRAINT retention_cleanup_runs_target_session_count_check CHECK ((target_session_count >= 0))
);


--
-- Name: TABLE retention_cleanup_runs; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.retention_cleanup_runs IS 'Content-free operational audit for interview retention cleanup. Never store customer content, identifiers, tokens, or error text here.';


--
-- Name: retention_cleanup_runs_id_seq; Type: SEQUENCE; Schema: private; Owner: -
--

ALTER TABLE private.retention_cleanup_runs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME private.retention_cleanup_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: service_usage; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.service_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    job_id uuid,
    operation_id uuid NOT NULL,
    service text NOT NULL,
    operation text NOT NULL,
    usage_unit text NOT NULL,
    units integer NOT NULL,
    credential_source text NOT NULL,
    status text NOT NULL,
    denial_count integer DEFAULT 0 NOT NULL,
    key_hash text,
    request_hash text,
    window_started_at timestamp with time zone,
    usage_date date NOT NULL,
    last_error_code text,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT service_usage_check CHECK (((key_hash IS NULL) = (request_hash IS NULL))),
    CONSTRAINT service_usage_check1 CHECK ((((service = 'dataforseo_rank'::text) AND (operation = 'rank_measurement'::text) AND (usage_unit = 'rank_serp_page'::text)) OR ((service = 'dataforseo_api'::text) AND (operation = 'dataforseo_credential_validate'::text) AND (usage_unit = 'provider_call'::text)) OR ((service = 'google_business_api'::text) AND (operation ~~ 'google_%'::text) AND (usage_unit = 'provider_call'::text)) OR ((service = 'instagram_graph_api'::text) AND (operation ~~ 'instagram_%'::text) AND (usage_unit = 'provider_call'::text)))),
    CONSTRAINT service_usage_check2 CHECK ((((status = 'denied'::text) AND (units = 0) AND (key_hash IS NULL) AND (request_hash IS NULL) AND (window_started_at IS NOT NULL) AND (last_error_code IS NOT NULL) AND (denial_count > 0)) OR ((status <> 'denied'::text) AND (denial_count = 0)))),
    CONSTRAINT service_usage_credential_source_check CHECK ((credential_source = ANY (ARRAY['native'::text, 'owner_provider'::text]))),
    CONSTRAINT service_usage_denial_count_check CHECK (((denial_count >= 0) AND (denial_count <= 1000000000))),
    CONSTRAINT service_usage_key_hash_check CHECK (((key_hash IS NULL) OR (key_hash ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT service_usage_last_error_code_check CHECK (((last_error_code IS NULL) OR (last_error_code ~ '^[A-Z0-9_:-]{2,100}$'::text))),
    CONSTRAINT service_usage_operation_check CHECK ((operation = ANY (ARRAY['rank_measurement'::text, 'dataforseo_credential_validate'::text, 'google_oauth_start'::text, 'instagram_oauth_start'::text, 'google_oauth_exchange'::text, 'instagram_oauth_exchange'::text, 'google_reviews_list'::text, 'google_review_reply_write'::text, 'google_locations_list'::text, 'google_insights_sync'::text, 'google_health_read'::text, 'instagram_media_list'::text, 'google_post_write'::text]))),
    CONSTRAINT service_usage_request_hash_check CHECK (((request_hash IS NULL) OR (request_hash ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT service_usage_service_check CHECK ((service = ANY (ARRAY['dataforseo_rank'::text, 'dataforseo_api'::text, 'google_business_api'::text, 'instagram_graph_api'::text]))),
    CONSTRAINT service_usage_status_check CHECK ((status = ANY (ARRAY['reserved'::text, 'succeeded'::text, 'failed'::text, 'attention_required'::text, 'denied'::text]))),
    CONSTRAINT service_usage_units_check CHECK (((units >= 0) AND (units <= 1000000))),
    CONSTRAINT service_usage_usage_unit_check CHECK ((usage_unit = ANY (ARRAY['rank_serp_page'::text, 'provider_call'::text])))
);


--
-- Name: TABLE service_usage; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.service_usage IS 'Provider request guard and idempotency ledger in normalized units. Denied calls are audited with zero units; raw provider responses are never stored.';


--
-- Name: store_ai_provider_connections; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.store_ai_provider_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    provider text NOT NULL,
    credential_ciphertext text NOT NULL,
    credential_iv text NOT NULL,
    key_version smallint NOT NULL,
    key_last4 text NOT NULL,
    status text NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    validated_at timestamp with time zone,
    last_error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    model text NOT NULL,
    credential_source text DEFAULT 'byok'::text NOT NULL,
    CONSTRAINT store_ai_provider_connections_check CHECK (((NOT is_active) OR (status = 'active'::text))),
    CONSTRAINT store_ai_provider_connections_credential_ciphertext_check CHECK (((char_length(credential_ciphertext) >= 24) AND (char_length(credential_ciphertext) <= 32768))),
    CONSTRAINT store_ai_provider_connections_credential_iv_check CHECK (((char_length(credential_iv) >= 16) AND (char_length(credential_iv) <= 64))),
    CONSTRAINT store_ai_provider_connections_credential_source_check CHECK ((credential_source = 'byok'::text)),
    CONSTRAINT store_ai_provider_connections_key_last4_check CHECK ((char_length(key_last4) = 4)),
    CONSTRAINT store_ai_provider_connections_key_version_check CHECK ((key_version > 0)),
    CONSTRAINT store_ai_provider_connections_last_error_code_check CHECK (((last_error_code IS NULL) OR (char_length(last_error_code) <= 100))),
    CONSTRAINT store_ai_provider_connections_model_check CHECK ((model ~ '^[A-Za-z0-9._:/-]{1,200}$'::text)),
    CONSTRAINT store_ai_provider_connections_provider_check CHECK ((provider = ANY (ARRAY['openai'::text, 'gemini'::text, 'deepseek'::text, 'xai'::text, 'anthropic'::text]))),
    CONSTRAINT store_ai_provider_connections_status_check CHECK ((status = ANY (ARRAY['active'::text, 'invalid'::text, 'revoked'::text, 'error'::text])))
);


--
-- Name: TABLE store_ai_provider_connections; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.store_ai_provider_connections IS 'BYOK credentials encrypted by Edge Functions with versioned AES-256-GCM keys.';


--
-- Name: store_runtime_limits; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.store_runtime_limits (
    store_id uuid NOT NULL,
    rewrite_limit integer DEFAULT 2 NOT NULL,
    retention_days integer DEFAULT 90 NOT NULL,
    session_start_window_seconds integer DEFAULT 600 NOT NULL,
    session_start_window_limit integer DEFAULT 30 NOT NULL,
    session_mutation_window_seconds integer DEFAULT 60 NOT NULL,
    session_mutation_window_limit integer DEFAULT 12 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT store_runtime_limits_retention_days_check CHECK (((retention_days >= 1) AND (retention_days <= 3650))),
    CONSTRAINT store_runtime_limits_rewrite_limit_check CHECK (((rewrite_limit >= 0) AND (rewrite_limit <= 20))),
    CONSTRAINT store_runtime_limits_session_mutation_window_limit_check CHECK (((session_mutation_window_limit >= 1) AND (session_mutation_window_limit <= 10000))),
    CONSTRAINT store_runtime_limits_session_mutation_window_seconds_check CHECK ((session_mutation_window_seconds = 60)),
    CONSTRAINT store_runtime_limits_session_start_window_limit_check CHECK (((session_start_window_limit >= 1) AND (session_start_window_limit <= 10000))),
    CONSTRAINT store_runtime_limits_session_start_window_seconds_check CHECK ((session_start_window_seconds = 600))
);


--
-- Name: TABLE store_runtime_limits; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.store_runtime_limits IS 'Per-store operational limits for retention, rewrites, and short-window abuse protection.';


--
-- Name: store_survey_revisions; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.store_survey_revisions (
    store_id uuid NOT NULL,
    revision integer NOT NULL,
    config_json jsonb NOT NULL,
    source text DEFAULT 'owner'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT store_survey_revisions_config_json_check CHECK (private.is_valid_survey_config(config_json)),
    CONSTRAINT store_survey_revisions_revision_check CHECK ((revision >= 1)),
    CONSTRAINT store_survey_revisions_source_check CHECK ((source = ANY (ARRAY['owner'::text, 'gpts_assisted'::text, 'preset'::text])))
);


--
-- Name: zero_feature_rollout_audit; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.zero_feature_rollout_audit (
    id bigint NOT NULL,
    feature_key text NOT NULL,
    previous_state text NOT NULL,
    next_state text NOT NULL,
    previous_release_at timestamp with time zone,
    next_release_at timestamp with time zone,
    previous_execution_mode text NOT NULL,
    next_execution_mode text NOT NULL,
    previous_kill_switch boolean NOT NULL,
    next_kill_switch boolean NOT NULL,
    operator_id text NOT NULL,
    changed_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT zero_feature_rollout_audit_feature_key_check CHECK ((feature_key = ANY (ARRAY['review_reply'::text, 'meo_rank'::text, 'gbp_insights'::text, 'gbp_health'::text, 'instagram_to_gbp'::text]))),
    CONSTRAINT zero_feature_rollout_audit_next_mode_check CHECK ((next_execution_mode = ANY (ARRAY['native'::text, 'owner_provider'::text]))),
    CONSTRAINT zero_feature_rollout_audit_next_state_check CHECK ((next_state = ANY (ARRAY['hidden'::text, 'coming_soon'::text, 'available'::text, 'paused'::text]))),
    CONSTRAINT zero_feature_rollout_audit_operator_id_check CHECK ((operator_id ~ '^[A-Za-z0-9._:@/-]{3,120}$'::text)),
    CONSTRAINT zero_feature_rollout_audit_previous_mode_check CHECK ((previous_execution_mode = ANY (ARRAY['native'::text, 'owner_provider'::text]))),
    CONSTRAINT zero_feature_rollout_audit_previous_state_check CHECK ((previous_state = ANY (ARRAY['hidden'::text, 'coming_soon'::text, 'available'::text, 'paused'::text])))
);


--
-- Name: TABLE zero_feature_rollout_audit; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.zero_feature_rollout_audit IS 'Content-free operator audit of every release state, date, mode, and kill-switch change.';


--
-- Name: zero_feature_rollout_audit_id_seq; Type: SEQUENCE; Schema: private; Owner: -
--

ALTER TABLE private.zero_feature_rollout_audit ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME private.zero_feature_rollout_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: zero_feature_rollouts; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.zero_feature_rollouts (
    feature_key text NOT NULL,
    configured_state text DEFAULT 'hidden'::text NOT NULL,
    release_at timestamp with time zone,
    execution_mode text DEFAULT 'native'::text NOT NULL,
    kill_switch boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT zero_feature_rollouts_execution_mode_check CHECK ((execution_mode = ANY (ARRAY['native'::text, 'owner_provider'::text]))),
    CONSTRAINT zero_feature_rollouts_feature_key_check CHECK ((feature_key = ANY (ARRAY['review_reply'::text, 'meo_rank'::text, 'gbp_insights'::text, 'gbp_health'::text, 'instagram_to_gbp'::text]))),
    CONSTRAINT zero_feature_rollouts_state_check CHECK ((configured_state = ANY (ARRAY['hidden'::text, 'coming_soon'::text, 'available'::text, 'paused'::text])))
);


--
-- Name: TABLE zero_feature_rollouts; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON TABLE private.zero_feature_rollouts IS 'Service-controlled weekly release schedule. All features are seeded hidden and fail closed.';


--
-- Name: COLUMN zero_feature_rollouts.kill_switch; Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON COLUMN private.zero_feature_rollouts.kill_switch IS 'Emergency operator switch. It pauses released or scheduled features without destroying their schedule.';


--
-- Name: zero_meo_audit_events; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.zero_meo_audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    store_id uuid,
    actor_id uuid,
    action text NOT NULL,
    resource text NOT NULL,
    resource_id uuid,
    safe_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT zero_meo_audit_events_action_check CHECK (((char_length(action) >= 3) AND (char_length(action) <= 100))),
    CONSTRAINT zero_meo_audit_events_resource_check CHECK (((char_length(resource) >= 2) AND (char_length(resource) <= 80))),
    CONSTRAINT zero_meo_audit_events_safe_metadata_check CHECK (private.zero_meo_json_is_bounded(safe_metadata, 8192))
);


--
-- Name: zero_meo_change_requests; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.zero_meo_change_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    store_id uuid NOT NULL,
    resource text NOT NULL,
    action text NOT NULL,
    record_id uuid,
    request_reason text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    requested_by uuid NOT NULL,
    reviewed_by uuid,
    review_note text,
    reviewed_at timestamp with time zone,
    applied_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT zero_meo_change_requests_action_check CHECK ((action = ANY (ARRAY['save'::text, 'restore'::text, 'create'::text, 'update'::text, 'delete'::text, 'record_publish_confirmation'::text]))),
    CONSTRAINT zero_meo_change_requests_check CHECK (((status = 'pending'::text) = (reviewed_at IS NULL))),
    CONSTRAINT zero_meo_change_requests_check1 CHECK (private.zero_meo_change_request_is_valid(resource, action, record_id, payload)),
    CONSTRAINT zero_meo_change_requests_payload_check CHECK (private.zero_meo_json_is_bounded(payload, 65536)),
    CONSTRAINT zero_meo_change_requests_request_reason_check CHECK (((request_reason IS NULL) OR (char_length(request_reason) <= 1000))),
    CONSTRAINT zero_meo_change_requests_resource_check CHECK ((resource = ANY (ARRAY['profile'::text, 'snapshots'::text, 'reviews'::text, 'review_templates'::text, 'media'::text, 'posts'::text, 'rank_observations'::text, 'insights'::text, 'aio_citations'::text, 'aio_observations'::text, 'jsonld'::text, 'groups'::text]))),
    CONSTRAINT zero_meo_change_requests_review_note_check CHECK (((review_note IS NULL) OR (char_length(review_note) <= 1000))),
    CONSTRAINT zero_meo_change_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text, 'applied'::text, 'failed'::text])))
);


--
-- Name: zero_meo_group_stores; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.zero_meo_group_stores (
    organization_id uuid NOT NULL,
    group_id uuid NOT NULL,
    store_id uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL
);


--
-- Name: zero_meo_invitations; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.zero_meo_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    store_id uuid,
    email text NOT NULL,
    role text NOT NULL,
    token_hash text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_by uuid,
    accepted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT zero_meo_invitations_check CHECK ((expires_at > created_at)),
    CONSTRAINT zero_meo_invitations_check1 CHECK (((status = 'accepted'::text) = (accepted_at IS NOT NULL))),
    CONSTRAINT zero_meo_invitations_email_check CHECK (((char_length(btrim(email)) >= 3) AND (char_length(btrim(email)) <= 320))),
    CONSTRAINT zero_meo_invitations_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'editor'::text, 'analyst'::text]))),
    CONSTRAINT zero_meo_invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text, 'expired'::text]))),
    CONSTRAINT zero_meo_invitations_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: zero_meo_organization_members; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.zero_meo_organization_members (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT zero_meo_organization_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'editor'::text, 'analyst'::text]))),
    CONSTRAINT zero_meo_organization_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text])))
);


--
-- Name: zero_meo_organizations; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.zero_meo_organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    approval_policy text DEFAULT 'owner_direct'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT zero_meo_organizations_approval_policy_check CHECK ((approval_policy = ANY (ARRAY['owner_direct'::text, 'two_person'::text]))),
    CONSTRAINT zero_meo_organizations_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120))),
    CONSTRAINT zero_meo_organizations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: zero_meo_store_groups; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.zero_meo_store_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    parent_group_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT zero_meo_store_groups_description_check CHECK (((description IS NULL) OR (char_length(description) <= 500))),
    CONSTRAINT zero_meo_store_groups_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120))),
    CONSTRAINT zero_meo_store_groups_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: zero_meo_store_members; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.zero_meo_store_members (
    organization_id uuid NOT NULL,
    store_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    CONSTRAINT zero_meo_store_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'editor'::text, 'analyst'::text]))),
    CONSTRAINT zero_meo_store_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text])))
);


--
-- Name: zero_meo_store_workspaces; Type: TABLE; Schema: private; Owner: -
--

CREATE TABLE private.zero_meo_store_workspaces (
    store_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    approval_policy text DEFAULT 'owner_direct'::text NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
    external_writes_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT zero_meo_store_workspaces_approval_policy_check CHECK ((approval_policy = ANY (ARRAY['owner_direct'::text, 'two_person'::text])))
);


--
-- Name: interview_messages interview_messages_pkey; Type: CONSTRAINT; Schema: api; Owner: -
--

ALTER TABLE ONLY api.interview_messages
    ADD CONSTRAINT interview_messages_pkey PRIMARY KEY (id);


--
-- Name: interview_messages interview_messages_session_id_idempotency_key_hash_role_key; Type: CONSTRAINT; Schema: api; Owner: -
--

ALTER TABLE ONLY api.interview_messages
    ADD CONSTRAINT interview_messages_session_id_idempotency_key_hash_role_key UNIQUE (session_id, idempotency_key_hash, role);


--
-- Name: interview_messages interview_messages_session_id_sequence_key; Type: CONSTRAINT; Schema: api; Owner: -
--

ALTER TABLE ONLY api.interview_messages
    ADD CONSTRAINT interview_messages_session_id_sequence_key UNIQUE (session_id, sequence);


--
-- Name: interview_sessions interview_sessions_id_store_id_key; Type: CONSTRAINT; Schema: api; Owner: -
--

ALTER TABLE ONLY api.interview_sessions
    ADD CONSTRAINT interview_sessions_id_store_id_key UNIQUE (id, store_id);


--
-- Name: interview_sessions interview_sessions_pkey; Type: CONSTRAINT; Schema: api; Owner: -
--

ALTER TABLE ONLY api.interview_sessions
    ADD CONSTRAINT interview_sessions_pkey PRIMARY KEY (id);


--
-- Name: review_handoff_events review_handoff_events_pkey; Type: CONSTRAINT; Schema: api; Owner: -
--

ALTER TABLE ONLY api.review_handoff_events
    ADD CONSTRAINT review_handoff_events_pkey PRIMARY KEY (id);


--
-- Name: review_handoff_events review_handoff_events_session_id_event_type_idempotency_key_key; Type: CONSTRAINT; Schema: api; Owner: -
--

ALTER TABLE ONLY api.review_handoff_events
    ADD CONSTRAINT review_handoff_events_session_id_event_type_idempotency_key_key UNIQUE (session_id, event_type, idempotency_key_hash);


--
-- Name: stores stores_owner_store_slot_key; Type: CONSTRAINT; Schema: api; Owner: -
--

ALTER TABLE ONLY api.stores
    ADD CONSTRAINT stores_owner_store_slot_key UNIQUE (owner_id, owner_store_slot);


--
-- Name: stores stores_pkey; Type: CONSTRAINT; Schema: api; Owner: -
--

ALTER TABLE ONLY api.stores
    ADD CONSTRAINT stores_pkey PRIMARY KEY (id);


--
-- Name: stores stores_public_slug_key; Type: CONSTRAINT; Schema: api; Owner: -
--

ALTER TABLE ONLY api.stores
    ADD CONSTRAINT stores_public_slug_key UNIQUE (public_slug);


--
-- Name: integration_jobs integration_jobs_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.integration_jobs
    ADD CONSTRAINT integration_jobs_pkey PRIMARY KEY (id);


--
-- Name: integration_jobs integration_jobs_store_id_job_type_dedupe_key_hash_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.integration_jobs
    ADD CONSTRAINT integration_jobs_store_id_job_type_dedupe_key_hash_key UNIQUE (store_id, job_type, dedupe_key_hash);


--
-- Name: integration_receipts integration_receipts_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.integration_receipts
    ADD CONSTRAINT integration_receipts_pkey PRIMARY KEY (id);


--
-- Name: interview_session_secrets interview_session_secrets_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.interview_session_secrets
    ADD CONSTRAINT interview_session_secrets_pkey PRIMARY KEY (session_id);


--
-- Name: interview_session_secrets interview_session_secrets_session_token_hash_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.interview_session_secrets
    ADD CONSTRAINT interview_session_secrets_session_token_hash_key UNIQUE (session_token_hash);


--
-- Name: interview_survey_snapshots interview_survey_snapshots_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.interview_survey_snapshots
    ADD CONSTRAINT interview_survey_snapshots_pkey PRIMARY KEY (session_id);


--
-- Name: meo_ai_draft_reservations meo_ai_draft_reservations_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_ai_draft_reservations
    ADD CONSTRAINT meo_ai_draft_reservations_pkey PRIMARY KEY (id);


--
-- Name: meo_ai_draft_reservations meo_ai_draft_reservations_store_id_key_hash_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_ai_draft_reservations
    ADD CONSTRAINT meo_ai_draft_reservations_store_id_key_hash_key UNIQUE (store_id, key_hash);


--
-- Name: meo_aio_citation_entries meo_aio_citation_entries_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_aio_citation_entries
    ADD CONSTRAINT meo_aio_citation_entries_pkey PRIMARY KEY (id);


--
-- Name: meo_aio_jsonld_snapshots meo_aio_jsonld_snapshots_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_aio_jsonld_snapshots
    ADD CONSTRAINT meo_aio_jsonld_snapshots_pkey PRIMARY KEY (id);


--
-- Name: meo_aio_observations meo_aio_observations_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_aio_observations
    ADD CONSTRAINT meo_aio_observations_pkey PRIMARY KEY (id);


--
-- Name: meo_export_requests meo_export_requests_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_export_requests
    ADD CONSTRAINT meo_export_requests_pkey PRIMARY KEY (id);


--
-- Name: meo_external_actions meo_external_actions_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_external_actions
    ADD CONSTRAINT meo_external_actions_pkey PRIMARY KEY (id);


--
-- Name: meo_external_actions meo_external_actions_store_id_action_key_hash_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_external_actions
    ADD CONSTRAINT meo_external_actions_store_id_action_key_hash_key UNIQUE (store_id, action, key_hash);


--
-- Name: meo_gbp_profile_snapshots meo_gbp_profile_snapshots_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_gbp_profile_snapshots
    ADD CONSTRAINT meo_gbp_profile_snapshots_pkey PRIMARY KEY (id);


--
-- Name: meo_gbp_profile_snapshots meo_gbp_profile_snapshots_store_id_id_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_gbp_profile_snapshots
    ADD CONSTRAINT meo_gbp_profile_snapshots_store_id_id_key UNIQUE (store_id, id);


--
-- Name: meo_gbp_profiles meo_gbp_profiles_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_gbp_profiles
    ADD CONSTRAINT meo_gbp_profiles_pkey PRIMARY KEY (store_id);


--
-- Name: meo_health_diagnoses meo_health_diagnoses_operation_id_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_health_diagnoses
    ADD CONSTRAINT meo_health_diagnoses_operation_id_key UNIQUE (operation_id);


--
-- Name: meo_health_diagnoses meo_health_diagnoses_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_health_diagnoses
    ADD CONSTRAINT meo_health_diagnoses_pkey PRIMARY KEY (usage_id);


--
-- Name: meo_insight_snapshots meo_insight_snapshots_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_insight_snapshots
    ADD CONSTRAINT meo_insight_snapshots_pkey PRIMARY KEY (id);


--
-- Name: meo_insight_snapshots meo_insight_snapshots_store_id_period_start_period_end_sour_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_insight_snapshots
    ADD CONSTRAINT meo_insight_snapshots_store_id_period_start_period_end_sour_key UNIQUE (store_id, period_start, period_end, source);


--
-- Name: meo_manual_health_diagnoses meo_manual_health_diagnoses_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_manual_health_diagnoses
    ADD CONSTRAINT meo_manual_health_diagnoses_pkey PRIMARY KEY (id);


--
-- Name: meo_manual_health_diagnoses meo_manual_health_diagnoses_store_id_key_hash_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_manual_health_diagnoses
    ADD CONSTRAINT meo_manual_health_diagnoses_store_id_key_hash_key UNIQUE (store_id, key_hash);


--
-- Name: meo_media_assets meo_media_assets_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_media_assets
    ADD CONSTRAINT meo_media_assets_pkey PRIMARY KEY (id);


--
-- Name: meo_media_assets meo_media_assets_store_id_storage_path_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_media_assets
    ADD CONSTRAINT meo_media_assets_store_id_storage_path_key UNIQUE (store_id, storage_path);


--
-- Name: meo_oauth_states meo_oauth_states_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_oauth_states
    ADD CONSTRAINT meo_oauth_states_pkey PRIMARY KEY (id);


--
-- Name: meo_oauth_states meo_oauth_states_state_hash_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_oauth_states
    ADD CONSTRAINT meo_oauth_states_state_hash_key UNIQUE (state_hash);


--
-- Name: meo_post_drafts meo_post_drafts_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_post_drafts
    ADD CONSTRAINT meo_post_drafts_pkey PRIMARY KEY (id);


--
-- Name: meo_post_drafts meo_post_drafts_store_id_id_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_post_drafts
    ADD CONSTRAINT meo_post_drafts_store_id_id_key UNIQUE (store_id, id);


--
-- Name: meo_post_publication_events meo_post_publication_events_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_post_publication_events
    ADD CONSTRAINT meo_post_publication_events_pkey PRIMARY KEY (id);


--
-- Name: meo_post_publication_events meo_post_publication_events_post_id_revision_outcome_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_post_publication_events
    ADD CONSTRAINT meo_post_publication_events_post_id_revision_outcome_key UNIQUE (post_id, revision, outcome);


--
-- Name: meo_post_revisions meo_post_revisions_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_post_revisions
    ADD CONSTRAINT meo_post_revisions_pkey PRIMARY KEY (id);


--
-- Name: meo_post_revisions meo_post_revisions_post_id_revision_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_post_revisions
    ADD CONSTRAINT meo_post_revisions_post_id_revision_key UNIQUE (post_id, revision);


--
-- Name: meo_provider_connections meo_provider_connections_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_provider_connections
    ADD CONSTRAINT meo_provider_connections_pkey PRIMARY KEY (store_id, provider);


--
-- Name: meo_rank_measurements meo_rank_measurements_job_id_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_rank_measurements
    ADD CONSTRAINT meo_rank_measurements_job_id_key UNIQUE (job_id);


--
-- Name: meo_rank_measurements meo_rank_measurements_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_rank_measurements
    ADD CONSTRAINT meo_rank_measurements_pkey PRIMARY KEY (id);


--
-- Name: meo_rank_measurements meo_rank_measurements_store_id_key_hash_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_rank_measurements
    ADD CONSTRAINT meo_rank_measurements_store_id_key_hash_key UNIQUE (store_id, key_hash);


--
-- Name: meo_rank_observations meo_rank_observations_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_rank_observations
    ADD CONSTRAINT meo_rank_observations_pkey PRIMARY KEY (id);


--
-- Name: meo_rank_targets meo_rank_targets_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_rank_targets
    ADD CONSTRAINT meo_rank_targets_pkey PRIMARY KEY (store_id);


--
-- Name: meo_review_inbox meo_review_inbox_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_review_inbox
    ADD CONSTRAINT meo_review_inbox_pkey PRIMARY KEY (id);


--
-- Name: meo_review_inbox meo_review_inbox_store_id_id_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_review_inbox
    ADD CONSTRAINT meo_review_inbox_store_id_id_key UNIQUE (store_id, id);


--
-- Name: meo_review_inbox meo_review_inbox_store_id_provider_provider_review_id_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_review_inbox
    ADD CONSTRAINT meo_review_inbox_store_id_provider_provider_review_id_key UNIQUE (store_id, provider, provider_review_id);


--
-- Name: meo_review_reply_revisions meo_review_reply_revisions_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_review_reply_revisions
    ADD CONSTRAINT meo_review_reply_revisions_pkey PRIMARY KEY (id);


--
-- Name: meo_review_reply_templates meo_review_reply_templates_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_review_reply_templates
    ADD CONSTRAINT meo_review_reply_templates_pkey PRIMARY KEY (id);


--
-- Name: meo_review_reply_templates meo_review_reply_templates_store_id_name_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_review_reply_templates
    ADD CONSTRAINT meo_review_reply_templates_store_id_name_key UNIQUE (store_id, name);


--
-- Name: rate_limit_counters rate_limit_counters_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.rate_limit_counters
    ADD CONSTRAINT rate_limit_counters_pkey PRIMARY KEY (scope, store_id, subject_hash, window_start);


--
-- Name: request_idempotency request_idempotency_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.request_idempotency
    ADD CONSTRAINT request_idempotency_pkey PRIMARY KEY (id);


--
-- Name: request_idempotency request_idempotency_scope_subject_id_key_hash_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.request_idempotency
    ADD CONSTRAINT request_idempotency_scope_subject_id_key_hash_key UNIQUE (scope, subject_id, key_hash);


--
-- Name: retention_cleanup_runs retention_cleanup_runs_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.retention_cleanup_runs
    ADD CONSTRAINT retention_cleanup_runs_pkey PRIMARY KEY (id);


--
-- Name: service_usage service_usage_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.service_usage
    ADD CONSTRAINT service_usage_pkey PRIMARY KEY (id);


--
-- Name: service_usage service_usage_service_operation_id_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.service_usage
    ADD CONSTRAINT service_usage_service_operation_id_key UNIQUE (service, operation_id);


--
-- Name: store_ai_provider_connections store_ai_provider_connections_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.store_ai_provider_connections
    ADD CONSTRAINT store_ai_provider_connections_pkey PRIMARY KEY (id);


--
-- Name: store_ai_provider_connections store_ai_provider_connections_store_id_provider_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.store_ai_provider_connections
    ADD CONSTRAINT store_ai_provider_connections_store_id_provider_key UNIQUE (store_id, provider);


--
-- Name: store_runtime_limits store_runtime_limits_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.store_runtime_limits
    ADD CONSTRAINT store_runtime_limits_pkey PRIMARY KEY (store_id);


--
-- Name: store_survey_revisions store_survey_revisions_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.store_survey_revisions
    ADD CONSTRAINT store_survey_revisions_pkey PRIMARY KEY (store_id, revision);


--
-- Name: zero_feature_rollout_audit zero_feature_rollout_audit_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_feature_rollout_audit
    ADD CONSTRAINT zero_feature_rollout_audit_pkey PRIMARY KEY (id);


--
-- Name: zero_feature_rollouts zero_feature_rollouts_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_feature_rollouts
    ADD CONSTRAINT zero_feature_rollouts_pkey PRIMARY KEY (feature_key);


--
-- Name: zero_meo_audit_events zero_meo_audit_events_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_audit_events
    ADD CONSTRAINT zero_meo_audit_events_pkey PRIMARY KEY (id);


--
-- Name: zero_meo_change_requests zero_meo_change_requests_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_change_requests
    ADD CONSTRAINT zero_meo_change_requests_pkey PRIMARY KEY (id);


--
-- Name: zero_meo_group_stores zero_meo_group_stores_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_group_stores
    ADD CONSTRAINT zero_meo_group_stores_pkey PRIMARY KEY (group_id, store_id);


--
-- Name: zero_meo_invitations zero_meo_invitations_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_invitations
    ADD CONSTRAINT zero_meo_invitations_pkey PRIMARY KEY (id);


--
-- Name: zero_meo_invitations zero_meo_invitations_token_hash_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_invitations
    ADD CONSTRAINT zero_meo_invitations_token_hash_key UNIQUE (token_hash);


--
-- Name: zero_meo_organization_members zero_meo_organization_members_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_organization_members
    ADD CONSTRAINT zero_meo_organization_members_pkey PRIMARY KEY (organization_id, user_id);


--
-- Name: zero_meo_organizations zero_meo_organizations_owner_id_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_organizations
    ADD CONSTRAINT zero_meo_organizations_owner_id_key UNIQUE (owner_id);


--
-- Name: zero_meo_organizations zero_meo_organizations_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_organizations
    ADD CONSTRAINT zero_meo_organizations_pkey PRIMARY KEY (id);


--
-- Name: zero_meo_store_groups zero_meo_store_groups_organization_id_id_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_groups
    ADD CONSTRAINT zero_meo_store_groups_organization_id_id_key UNIQUE (organization_id, id);


--
-- Name: zero_meo_store_groups zero_meo_store_groups_organization_id_name_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_groups
    ADD CONSTRAINT zero_meo_store_groups_organization_id_name_key UNIQUE (organization_id, name);


--
-- Name: zero_meo_store_groups zero_meo_store_groups_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_groups
    ADD CONSTRAINT zero_meo_store_groups_pkey PRIMARY KEY (id);


--
-- Name: zero_meo_store_members zero_meo_store_members_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_members
    ADD CONSTRAINT zero_meo_store_members_pkey PRIMARY KEY (store_id, user_id);


--
-- Name: zero_meo_store_workspaces zero_meo_store_workspaces_organization_id_store_id_key; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_workspaces
    ADD CONSTRAINT zero_meo_store_workspaces_organization_id_store_id_key UNIQUE (organization_id, store_id);


--
-- Name: zero_meo_store_workspaces zero_meo_store_workspaces_pkey; Type: CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_workspaces
    ADD CONSTRAINT zero_meo_store_workspaces_pkey PRIMARY KEY (store_id);


--
-- Name: handoff_events_store_created_idx; Type: INDEX; Schema: api; Owner: -
--

CREATE INDEX handoff_events_store_created_idx ON api.review_handoff_events USING btree (store_id, created_at DESC);


--
-- Name: interview_messages_session_sequence_idx; Type: INDEX; Schema: api; Owner: -
--

CREATE INDEX interview_messages_session_sequence_idx ON api.interview_messages USING btree (session_id, sequence);


--
-- Name: interview_sessions_retention_clock_idx; Type: INDEX; Schema: api; Owner: -
--

CREATE INDEX interview_sessions_retention_clock_idx ON api.interview_sessions USING btree (COALESCE(completed_at, created_at), id, store_id);


--
-- Name: interview_sessions_retention_scan_idx; Type: INDEX; Schema: api; Owner: -
--

CREATE INDEX interview_sessions_retention_scan_idx ON api.interview_sessions USING btree (created_at, id, store_id);


--
-- Name: interview_sessions_store_created_idx; Type: INDEX; Schema: api; Owner: -
--

CREATE INDEX interview_sessions_store_created_idx ON api.interview_sessions USING btree (store_id, created_at DESC, id DESC);


--
-- Name: interview_sessions_store_status_idx; Type: INDEX; Schema: api; Owner: -
--

CREATE INDEX interview_sessions_store_status_idx ON api.interview_sessions USING btree (store_id, status, created_at DESC);


--
-- Name: stores_owner_active_slot_idx; Type: INDEX; Schema: api; Owner: -
--

CREATE INDEX stores_owner_active_slot_idx ON api.stores USING btree (owner_id, owner_store_slot) WHERE (archived_at IS NULL);


--
-- Name: integration_jobs_due_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX integration_jobs_due_idx ON private.integration_jobs USING btree (job_type, status, available_at, created_at) WHERE (status = ANY (ARRAY['queued'::text, 'provider_submitted'::text, 'retry_scheduled'::text]));


--
-- Name: integration_jobs_provider_task_key; Type: INDEX; Schema: private; Owner: -
--

CREATE UNIQUE INDEX integration_jobs_provider_task_key ON private.integration_jobs USING btree (provider_task_id) WHERE (provider_task_id IS NOT NULL);


--
-- Name: integration_jobs_store_created_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX integration_jobs_store_created_idx ON private.integration_jobs USING btree (store_id, created_at DESC);


--
-- Name: integration_receipts_effect_key; Type: INDEX; Schema: private; Owner: -
--

CREATE UNIQUE INDEX integration_receipts_effect_key ON private.integration_receipts USING btree (store_id, action_type, request_hash) WHERE (outcome = 'succeeded'::text);


--
-- Name: integration_receipts_job_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX integration_receipts_job_idx ON private.integration_receipts USING btree (job_id) WHERE (job_id IS NOT NULL);


--
-- Name: integration_receipts_store_created_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX integration_receipts_store_created_idx ON private.integration_receipts USING btree (store_id, created_at DESC);


--
-- Name: interview_survey_snapshots_store_created_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX interview_survey_snapshots_store_created_idx ON private.interview_survey_snapshots USING btree (store_id, created_at DESC, session_id);


--
-- Name: meo_ai_draft_denial_aggregate_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE UNIQUE INDEX meo_ai_draft_denial_aggregate_idx ON private.meo_ai_draft_reservations USING btree (store_id, usage_date, credential_source, error_code) WHERE (status = 'denied'::text);


--
-- Name: meo_ai_draft_global_daily_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_ai_draft_global_daily_idx ON private.meo_ai_draft_reservations USING btree (usage_date, credential_source, status);


--
-- Name: meo_ai_draft_store_daily_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_ai_draft_store_daily_idx ON private.meo_ai_draft_reservations USING btree (store_id, usage_date, credential_source, status);


--
-- Name: meo_aio_citations_store_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_aio_citations_store_idx ON private.meo_aio_citation_entries USING btree (store_id, consistency_status, created_at DESC);


--
-- Name: meo_aio_jsonld_store_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_aio_jsonld_store_idx ON private.meo_aio_jsonld_snapshots USING btree (store_id, created_at DESC, id DESC);


--
-- Name: meo_aio_observations_store_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_aio_observations_store_idx ON private.meo_aio_observations USING btree (store_id, observed_at DESC, id DESC);


--
-- Name: meo_export_requests_store_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_export_requests_store_idx ON private.meo_export_requests USING btree (store_id, status, created_at DESC);


--
-- Name: meo_external_actions_effect_identity_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE UNIQUE INDEX meo_external_actions_effect_identity_idx ON private.meo_external_actions USING btree (store_id, action, request_hash) WHERE (status = ANY (ARRAY['processing'::text, 'completed'::text, 'attention_required'::text]));


--
-- Name: meo_external_actions_store_created_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_external_actions_store_created_idx ON private.meo_external_actions USING btree (store_id, created_at DESC);


--
-- Name: meo_gbp_profile_snapshots_creator_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_gbp_profile_snapshots_creator_idx ON private.meo_gbp_profile_snapshots USING btree (created_by) WHERE (created_by IS NOT NULL);


--
-- Name: meo_gbp_profile_snapshots_store_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_gbp_profile_snapshots_store_idx ON private.meo_gbp_profile_snapshots USING btree (store_id, created_at DESC, id DESC);


--
-- Name: meo_health_diagnoses_expiration_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_health_diagnoses_expiration_idx ON private.meo_health_diagnoses USING btree (completed_at, created_at) WHERE (status = 'succeeded'::text);


--
-- Name: meo_health_diagnoses_stale_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_health_diagnoses_stale_idx ON private.meo_health_diagnoses USING btree (lease_expires_at, created_at) WHERE (status = 'processing'::text);


--
-- Name: meo_health_diagnoses_store_key_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE UNIQUE INDEX meo_health_diagnoses_store_key_idx ON private.meo_health_diagnoses USING btree (store_id, key_hash);


--
-- Name: meo_insight_snapshots_created_by_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_insight_snapshots_created_by_idx ON private.meo_insight_snapshots USING btree (created_by) WHERE (created_by IS NOT NULL);


--
-- Name: meo_insight_snapshots_store_period_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_insight_snapshots_store_period_idx ON private.meo_insight_snapshots USING btree (store_id, period_end DESC, period_start DESC);


--
-- Name: meo_manual_health_diagnoses_expiration_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_manual_health_diagnoses_expiration_idx ON private.meo_manual_health_diagnoses USING btree (completed_at, id);


--
-- Name: meo_manual_health_diagnoses_latest_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_manual_health_diagnoses_latest_idx ON private.meo_manual_health_diagnoses USING btree (store_id, completed_at DESC, id DESC);


--
-- Name: meo_media_assets_store_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_media_assets_store_idx ON private.meo_media_assets USING btree (store_id, status, created_at DESC);


--
-- Name: meo_oauth_states_expiry_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_oauth_states_expiry_idx ON private.meo_oauth_states USING btree (expires_at) WHERE (consumed_at IS NULL);


--
-- Name: meo_oauth_states_store_created_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_oauth_states_store_created_idx ON private.meo_oauth_states USING btree (store_id, created_at DESC);


--
-- Name: meo_post_drafts_store_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_post_drafts_store_idx ON private.meo_post_drafts USING btree (store_id, status, created_at DESC, id DESC);


--
-- Name: meo_post_publication_creator_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_post_publication_creator_idx ON private.meo_post_publication_events USING btree (created_by) WHERE (created_by IS NOT NULL);


--
-- Name: meo_post_publication_post_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_post_publication_post_idx ON private.meo_post_publication_events USING btree (post_id, created_at DESC);


--
-- Name: meo_post_publication_store_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_post_publication_store_idx ON private.meo_post_publication_events USING btree (store_id, created_at DESC);


--
-- Name: meo_post_revisions_creator_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_post_revisions_creator_idx ON private.meo_post_revisions USING btree (created_by) WHERE (created_by IS NOT NULL);


--
-- Name: meo_post_revisions_store_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_post_revisions_store_idx ON private.meo_post_revisions USING btree (store_id, created_at DESC);


--
-- Name: meo_rank_measurements_status_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_rank_measurements_status_idx ON private.meo_rank_measurements USING btree (status, created_at);


--
-- Name: meo_rank_measurements_store_daily_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_rank_measurements_store_daily_idx ON private.meo_rank_measurements USING btree (store_id, usage_date, status);


--
-- Name: meo_rank_observations_created_by_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_rank_observations_created_by_idx ON private.meo_rank_observations USING btree (created_by) WHERE (created_by IS NOT NULL);


--
-- Name: meo_rank_observations_store_observed_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_rank_observations_store_observed_idx ON private.meo_rank_observations USING btree (store_id, observed_at DESC, id DESC);


--
-- Name: meo_review_inbox_store_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_review_inbox_store_idx ON private.meo_review_inbox USING btree (store_id, status, created_at DESC, id DESC);


--
-- Name: meo_review_reply_revisions_creator_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_review_reply_revisions_creator_idx ON private.meo_review_reply_revisions USING btree (created_by) WHERE (created_by IS NOT NULL);


--
-- Name: meo_review_reply_revisions_review_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_review_reply_revisions_review_idx ON private.meo_review_reply_revisions USING btree (review_id, created_at DESC);


--
-- Name: meo_review_reply_revisions_store_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_review_reply_revisions_store_idx ON private.meo_review_reply_revisions USING btree (store_id, created_at DESC);


--
-- Name: meo_review_reply_revisions_template_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_review_reply_revisions_template_idx ON private.meo_review_reply_revisions USING btree (template_id) WHERE (template_id IS NOT NULL);


--
-- Name: meo_review_reply_templates_creator_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_review_reply_templates_creator_idx ON private.meo_review_reply_templates USING btree (created_by) WHERE (created_by IS NOT NULL);


--
-- Name: meo_review_reply_templates_store_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX meo_review_reply_templates_store_idx ON private.meo_review_reply_templates USING btree (store_id, status, created_at DESC);


--
-- Name: one_active_ai_provider_per_store; Type: INDEX; Schema: private; Owner: -
--

CREATE UNIQUE INDEX one_active_ai_provider_per_store ON private.store_ai_provider_connections USING btree (store_id) WHERE (is_active = true);


--
-- Name: rate_limit_expiry_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX rate_limit_expiry_idx ON private.rate_limit_counters USING btree (expires_at);


--
-- Name: request_idempotency_expiry_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX request_idempotency_expiry_idx ON private.request_idempotency USING btree (expires_at);


--
-- Name: service_usage_denial_aggregate_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE UNIQUE INDEX service_usage_denial_aggregate_idx ON private.service_usage USING btree (store_id, service, operation, credential_source, window_started_at, last_error_code) WHERE (status = 'denied'::text);


--
-- Name: service_usage_global_daily_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX service_usage_global_daily_idx ON private.service_usage USING btree (service, operation, credential_source, usage_date, status);


--
-- Name: service_usage_provider_idempotency_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE UNIQUE INDEX service_usage_provider_idempotency_idx ON private.service_usage USING btree (store_id, service, operation, key_hash) WHERE (key_hash IS NOT NULL);


--
-- Name: service_usage_store_daily_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX service_usage_store_daily_idx ON private.service_usage USING btree (store_id, service, operation, credential_source, usage_date, status);


--
-- Name: service_usage_window_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX service_usage_window_idx ON private.service_usage USING btree (service, operation, credential_source, window_started_at, status) WHERE (window_started_at IS NOT NULL);


--
-- Name: zero_meo_audit_actor_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX zero_meo_audit_actor_idx ON private.zero_meo_audit_events USING btree (actor_id, created_at DESC) WHERE (actor_id IS NOT NULL);


--
-- Name: zero_meo_audit_org_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX zero_meo_audit_org_idx ON private.zero_meo_audit_events USING btree (organization_id, created_at DESC);


--
-- Name: zero_meo_audit_store_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX zero_meo_audit_store_idx ON private.zero_meo_audit_events USING btree (store_id, created_at DESC) WHERE (store_id IS NOT NULL);


--
-- Name: zero_meo_change_requests_requester_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX zero_meo_change_requests_requester_idx ON private.zero_meo_change_requests USING btree (requested_by, created_at DESC);


--
-- Name: zero_meo_change_requests_reviewer_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX zero_meo_change_requests_reviewer_idx ON private.zero_meo_change_requests USING btree (reviewed_by) WHERE (reviewed_by IS NOT NULL);


--
-- Name: zero_meo_change_requests_store_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX zero_meo_change_requests_store_idx ON private.zero_meo_change_requests USING btree (store_id, status, created_at DESC);


--
-- Name: zero_meo_group_stores_store_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX zero_meo_group_stores_store_idx ON private.zero_meo_group_stores USING btree (store_id, group_id);


--
-- Name: zero_meo_groups_org_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX zero_meo_groups_org_idx ON private.zero_meo_store_groups USING btree (organization_id, status, created_at DESC);


--
-- Name: zero_meo_groups_parent_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX zero_meo_groups_parent_idx ON private.zero_meo_store_groups USING btree (organization_id, parent_group_id) WHERE (parent_group_id IS NOT NULL);


--
-- Name: zero_meo_invitations_org_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX zero_meo_invitations_org_idx ON private.zero_meo_invitations USING btree (organization_id, status, created_at DESC);


--
-- Name: zero_meo_invitations_store_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX zero_meo_invitations_store_idx ON private.zero_meo_invitations USING btree (store_id) WHERE (store_id IS NOT NULL);


--
-- Name: zero_meo_org_members_user_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX zero_meo_org_members_user_idx ON private.zero_meo_organization_members USING btree (user_id, status, organization_id);


--
-- Name: zero_meo_store_members_user_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX zero_meo_store_members_user_idx ON private.zero_meo_store_members USING btree (user_id, status, store_id);


--
-- Name: zero_meo_store_workspaces_org_idx; Type: INDEX; Schema: private; Owner: -
--

CREATE INDEX zero_meo_store_workspaces_org_idx ON private.zero_meo_store_workspaces USING btree (organization_id, store_id);


--
-- Name: interview_sessions interview_sessions_set_updated_at; Type: TRIGGER; Schema: api; Owner: -
--

CREATE TRIGGER interview_sessions_set_updated_at BEFORE UPDATE ON api.interview_sessions FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: stores stores_create_default_runtime_limits; Type: TRIGGER; Schema: api; Owner: -
--

CREATE TRIGGER stores_create_default_runtime_limits AFTER INSERT ON api.stores FOR EACH ROW EXECUTE FUNCTION private.create_default_store_runtime_limits();


--
-- Name: stores stores_set_updated_at; Type: TRIGGER; Schema: api; Owner: -
--

CREATE TRIGGER stores_set_updated_at BEFORE UPDATE ON api.stores FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: stores stores_zero_meo_workspace_bootstrap; Type: TRIGGER; Schema: api; Owner: -
--

CREATE TRIGGER stores_zero_meo_workspace_bootstrap AFTER INSERT ON api.stores FOR EACH ROW EXECUTE FUNCTION private.zero_meo_bootstrap_store_workspace();


--
-- Name: integration_jobs integration_jobs_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER integration_jobs_set_updated_at BEFORE UPDATE ON private.integration_jobs FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: meo_aio_citation_entries meo_aio_citations_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER meo_aio_citations_set_updated_at BEFORE UPDATE ON private.meo_aio_citation_entries FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: meo_aio_jsonld_snapshots meo_aio_jsonld_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER meo_aio_jsonld_set_updated_at BEFORE UPDATE ON private.meo_aio_jsonld_snapshots FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: meo_aio_observations meo_aio_observations_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER meo_aio_observations_set_updated_at BEFORE UPDATE ON private.meo_aio_observations FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: meo_export_requests meo_export_requests_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER meo_export_requests_set_updated_at BEFORE UPDATE ON private.meo_export_requests FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: meo_external_actions meo_external_actions_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER meo_external_actions_set_updated_at BEFORE UPDATE ON private.meo_external_actions FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: meo_gbp_profiles meo_gbp_profiles_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER meo_gbp_profiles_set_updated_at BEFORE UPDATE ON private.meo_gbp_profiles FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: meo_insight_snapshots meo_insight_snapshots_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER meo_insight_snapshots_set_updated_at BEFORE UPDATE ON private.meo_insight_snapshots FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: meo_media_assets meo_media_assets_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER meo_media_assets_set_updated_at BEFORE UPDATE ON private.meo_media_assets FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: meo_post_drafts meo_post_drafts_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER meo_post_drafts_set_updated_at BEFORE UPDATE ON private.meo_post_drafts FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: meo_provider_connections meo_provider_connections_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER meo_provider_connections_set_updated_at BEFORE UPDATE ON private.meo_provider_connections FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: meo_rank_measurements meo_rank_measurements_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER meo_rank_measurements_set_updated_at BEFORE UPDATE ON private.meo_rank_measurements FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: meo_rank_targets meo_rank_targets_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER meo_rank_targets_set_updated_at BEFORE UPDATE ON private.meo_rank_targets FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: meo_review_inbox meo_review_inbox_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER meo_review_inbox_set_updated_at BEFORE UPDATE ON private.meo_review_inbox FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: meo_review_reply_templates meo_review_templates_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER meo_review_templates_set_updated_at BEFORE UPDATE ON private.meo_review_reply_templates FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: store_ai_provider_connections provider_connections_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER provider_connections_set_updated_at BEFORE UPDATE ON private.store_ai_provider_connections FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: request_idempotency request_idempotency_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER request_idempotency_set_updated_at BEFORE UPDATE ON private.request_idempotency FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: store_runtime_limits store_runtime_limits_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER store_runtime_limits_set_updated_at BEFORE UPDATE ON private.store_runtime_limits FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: zero_feature_rollouts zero_feature_rollouts_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER zero_feature_rollouts_set_updated_at BEFORE UPDATE ON private.zero_feature_rollouts FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: zero_meo_change_requests zero_meo_change_requests_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER zero_meo_change_requests_set_updated_at BEFORE UPDATE ON private.zero_meo_change_requests FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: zero_meo_store_groups zero_meo_groups_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER zero_meo_groups_set_updated_at BEFORE UPDATE ON private.zero_meo_store_groups FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: zero_meo_invitations zero_meo_invitations_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER zero_meo_invitations_set_updated_at BEFORE UPDATE ON private.zero_meo_invitations FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: zero_meo_organization_members zero_meo_org_members_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER zero_meo_org_members_set_updated_at BEFORE UPDATE ON private.zero_meo_organization_members FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: zero_meo_organizations zero_meo_organizations_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER zero_meo_organizations_set_updated_at BEFORE UPDATE ON private.zero_meo_organizations FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: zero_meo_store_members zero_meo_store_members_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER zero_meo_store_members_set_updated_at BEFORE UPDATE ON private.zero_meo_store_members FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: zero_meo_store_workspaces zero_meo_workspaces_set_updated_at; Type: TRIGGER; Schema: private; Owner: -
--

CREATE TRIGGER zero_meo_workspaces_set_updated_at BEFORE UPDATE ON private.zero_meo_store_workspaces FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


--
-- Name: interview_messages interview_messages_session_id_store_id_fkey; Type: FK CONSTRAINT; Schema: api; Owner: -
--

ALTER TABLE ONLY api.interview_messages
    ADD CONSTRAINT interview_messages_session_id_store_id_fkey FOREIGN KEY (session_id, store_id) REFERENCES api.interview_sessions(id, store_id) ON DELETE CASCADE;


--
-- Name: interview_sessions interview_sessions_store_id_fkey; Type: FK CONSTRAINT; Schema: api; Owner: -
--

ALTER TABLE ONLY api.interview_sessions
    ADD CONSTRAINT interview_sessions_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: review_handoff_events review_handoff_events_session_id_store_id_fkey; Type: FK CONSTRAINT; Schema: api; Owner: -
--

ALTER TABLE ONLY api.review_handoff_events
    ADD CONSTRAINT review_handoff_events_session_id_store_id_fkey FOREIGN KEY (session_id, store_id) REFERENCES api.interview_sessions(id, store_id) ON DELETE CASCADE;


--
-- Name: stores stores_owner_id_fkey; Type: FK CONSTRAINT; Schema: api; Owner: -
--

ALTER TABLE ONLY api.stores
    ADD CONSTRAINT stores_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: integration_jobs integration_jobs_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.integration_jobs
    ADD CONSTRAINT integration_jobs_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: integration_receipts integration_receipts_job_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.integration_receipts
    ADD CONSTRAINT integration_receipts_job_id_fkey FOREIGN KEY (job_id) REFERENCES private.integration_jobs(id) ON DELETE SET NULL;


--
-- Name: integration_receipts integration_receipts_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.integration_receipts
    ADD CONSTRAINT integration_receipts_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: interview_session_secrets interview_session_secrets_session_id_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.interview_session_secrets
    ADD CONSTRAINT interview_session_secrets_session_id_store_id_fkey FOREIGN KEY (session_id, store_id) REFERENCES api.interview_sessions(id, store_id) ON DELETE CASCADE;


--
-- Name: interview_survey_snapshots interview_survey_snapshots_session_id_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.interview_survey_snapshots
    ADD CONSTRAINT interview_survey_snapshots_session_id_store_id_fkey FOREIGN KEY (session_id, store_id) REFERENCES api.interview_sessions(id, store_id) ON DELETE CASCADE;


--
-- Name: interview_survey_snapshots interview_survey_snapshots_store_id_source_revision_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.interview_survey_snapshots
    ADD CONSTRAINT interview_survey_snapshots_store_id_source_revision_fkey FOREIGN KEY (store_id, source_revision) REFERENCES private.store_survey_revisions(store_id, revision) ON DELETE CASCADE;


--
-- Name: meo_ai_draft_reservations meo_ai_draft_reservations_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_ai_draft_reservations
    ADD CONSTRAINT meo_ai_draft_reservations_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_aio_citation_entries meo_aio_citation_entries_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_aio_citation_entries
    ADD CONSTRAINT meo_aio_citation_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_aio_citation_entries meo_aio_citation_entries_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_aio_citation_entries
    ADD CONSTRAINT meo_aio_citation_entries_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_aio_citation_entries meo_aio_citation_entries_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_aio_citation_entries
    ADD CONSTRAINT meo_aio_citation_entries_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_aio_jsonld_snapshots meo_aio_jsonld_snapshots_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_aio_jsonld_snapshots
    ADD CONSTRAINT meo_aio_jsonld_snapshots_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_aio_jsonld_snapshots meo_aio_jsonld_snapshots_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_aio_jsonld_snapshots
    ADD CONSTRAINT meo_aio_jsonld_snapshots_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_aio_jsonld_snapshots meo_aio_jsonld_snapshots_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_aio_jsonld_snapshots
    ADD CONSTRAINT meo_aio_jsonld_snapshots_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_aio_observations meo_aio_observations_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_aio_observations
    ADD CONSTRAINT meo_aio_observations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_aio_observations meo_aio_observations_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_aio_observations
    ADD CONSTRAINT meo_aio_observations_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_aio_observations meo_aio_observations_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_aio_observations
    ADD CONSTRAINT meo_aio_observations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_export_requests meo_export_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_export_requests
    ADD CONSTRAINT meo_export_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_export_requests meo_export_requests_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_export_requests
    ADD CONSTRAINT meo_export_requests_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_export_requests meo_export_requests_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_export_requests
    ADD CONSTRAINT meo_export_requests_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_external_actions meo_external_actions_actor_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_external_actions
    ADD CONSTRAINT meo_external_actions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: meo_external_actions meo_external_actions_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_external_actions
    ADD CONSTRAINT meo_external_actions_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_gbp_profile_snapshots meo_gbp_profile_snapshots_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_gbp_profile_snapshots
    ADD CONSTRAINT meo_gbp_profile_snapshots_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_gbp_profile_snapshots meo_gbp_profile_snapshots_store_id_base_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_gbp_profile_snapshots
    ADD CONSTRAINT meo_gbp_profile_snapshots_store_id_base_snapshot_id_fkey FOREIGN KEY (store_id, base_snapshot_id) REFERENCES private.meo_gbp_profile_snapshots(store_id, id) ON DELETE RESTRICT;


--
-- Name: meo_gbp_profile_snapshots meo_gbp_profile_snapshots_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_gbp_profile_snapshots
    ADD CONSTRAINT meo_gbp_profile_snapshots_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_gbp_profiles meo_gbp_profiles_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_gbp_profiles
    ADD CONSTRAINT meo_gbp_profiles_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_gbp_profiles meo_gbp_profiles_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_gbp_profiles
    ADD CONSTRAINT meo_gbp_profiles_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_gbp_profiles meo_gbp_profiles_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_gbp_profiles
    ADD CONSTRAINT meo_gbp_profiles_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_health_diagnoses meo_health_diagnoses_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_health_diagnoses
    ADD CONSTRAINT meo_health_diagnoses_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_health_diagnoses meo_health_diagnoses_usage_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_health_diagnoses
    ADD CONSTRAINT meo_health_diagnoses_usage_id_fkey FOREIGN KEY (usage_id) REFERENCES private.service_usage(id) ON DELETE CASCADE;


--
-- Name: meo_insight_snapshots meo_insight_snapshots_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_insight_snapshots
    ADD CONSTRAINT meo_insight_snapshots_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_insight_snapshots meo_insight_snapshots_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_insight_snapshots
    ADD CONSTRAINT meo_insight_snapshots_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_insight_snapshots meo_insight_snapshots_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_insight_snapshots
    ADD CONSTRAINT meo_insight_snapshots_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_manual_health_diagnoses meo_manual_health_diagnoses_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_manual_health_diagnoses
    ADD CONSTRAINT meo_manual_health_diagnoses_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_media_assets meo_media_assets_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_media_assets
    ADD CONSTRAINT meo_media_assets_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_media_assets meo_media_assets_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_media_assets
    ADD CONSTRAINT meo_media_assets_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_media_assets meo_media_assets_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_media_assets
    ADD CONSTRAINT meo_media_assets_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_oauth_states meo_oauth_states_actor_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_oauth_states
    ADD CONSTRAINT meo_oauth_states_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: meo_oauth_states meo_oauth_states_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_oauth_states
    ADD CONSTRAINT meo_oauth_states_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_post_drafts meo_post_drafts_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_post_drafts
    ADD CONSTRAINT meo_post_drafts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_post_drafts meo_post_drafts_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_post_drafts
    ADD CONSTRAINT meo_post_drafts_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_post_drafts meo_post_drafts_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_post_drafts
    ADD CONSTRAINT meo_post_drafts_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_post_publication_events meo_post_publication_events_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_post_publication_events
    ADD CONSTRAINT meo_post_publication_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_post_publication_events meo_post_publication_events_store_id_post_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_post_publication_events
    ADD CONSTRAINT meo_post_publication_events_store_id_post_id_fkey FOREIGN KEY (store_id, post_id) REFERENCES private.meo_post_drafts(store_id, id) ON DELETE CASCADE;


--
-- Name: meo_post_revisions meo_post_revisions_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_post_revisions
    ADD CONSTRAINT meo_post_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_post_revisions meo_post_revisions_store_id_post_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_post_revisions
    ADD CONSTRAINT meo_post_revisions_store_id_post_id_fkey FOREIGN KEY (store_id, post_id) REFERENCES private.meo_post_drafts(store_id, id) ON DELETE CASCADE;


--
-- Name: meo_provider_connections meo_provider_connections_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_provider_connections
    ADD CONSTRAINT meo_provider_connections_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_rank_measurements meo_rank_measurements_job_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_rank_measurements
    ADD CONSTRAINT meo_rank_measurements_job_id_fkey FOREIGN KEY (job_id) REFERENCES private.integration_jobs(id) ON DELETE RESTRICT;


--
-- Name: meo_rank_measurements meo_rank_measurements_observation_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_rank_measurements
    ADD CONSTRAINT meo_rank_measurements_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES private.meo_rank_observations(id) ON DELETE SET NULL;


--
-- Name: meo_rank_measurements meo_rank_measurements_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_rank_measurements
    ADD CONSTRAINT meo_rank_measurements_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_rank_observations meo_rank_observations_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_rank_observations
    ADD CONSTRAINT meo_rank_observations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_rank_observations meo_rank_observations_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_rank_observations
    ADD CONSTRAINT meo_rank_observations_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_rank_targets meo_rank_targets_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_rank_targets
    ADD CONSTRAINT meo_rank_targets_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_review_inbox meo_review_inbox_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_review_inbox
    ADD CONSTRAINT meo_review_inbox_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_review_inbox meo_review_inbox_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_review_inbox
    ADD CONSTRAINT meo_review_inbox_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_review_inbox meo_review_inbox_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_review_inbox
    ADD CONSTRAINT meo_review_inbox_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_review_reply_revisions meo_review_reply_revisions_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_review_reply_revisions
    ADD CONSTRAINT meo_review_reply_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_review_reply_revisions meo_review_reply_revisions_store_id_review_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_review_reply_revisions
    ADD CONSTRAINT meo_review_reply_revisions_store_id_review_id_fkey FOREIGN KEY (store_id, review_id) REFERENCES private.meo_review_inbox(store_id, id) ON DELETE CASCADE;


--
-- Name: meo_review_reply_revisions meo_review_reply_revisions_template_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_review_reply_revisions
    ADD CONSTRAINT meo_review_reply_revisions_template_id_fkey FOREIGN KEY (template_id) REFERENCES private.meo_review_reply_templates(id) ON DELETE SET NULL;


--
-- Name: meo_review_reply_templates meo_review_reply_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_review_reply_templates
    ADD CONSTRAINT meo_review_reply_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: meo_review_reply_templates meo_review_reply_templates_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_review_reply_templates
    ADD CONSTRAINT meo_review_reply_templates_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: meo_review_reply_templates meo_review_reply_templates_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.meo_review_reply_templates
    ADD CONSTRAINT meo_review_reply_templates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: rate_limit_counters rate_limit_counters_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.rate_limit_counters
    ADD CONSTRAINT rate_limit_counters_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: service_usage service_usage_job_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.service_usage
    ADD CONSTRAINT service_usage_job_id_fkey FOREIGN KEY (job_id) REFERENCES private.integration_jobs(id) ON DELETE SET NULL;


--
-- Name: service_usage service_usage_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.service_usage
    ADD CONSTRAINT service_usage_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: store_ai_provider_connections store_ai_provider_connections_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.store_ai_provider_connections
    ADD CONSTRAINT store_ai_provider_connections_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: store_runtime_limits store_runtime_limits_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.store_runtime_limits
    ADD CONSTRAINT store_runtime_limits_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: store_survey_revisions store_survey_revisions_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.store_survey_revisions
    ADD CONSTRAINT store_survey_revisions_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: zero_meo_audit_events zero_meo_audit_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_audit_events
    ADD CONSTRAINT zero_meo_audit_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_audit_events zero_meo_audit_events_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_audit_events
    ADD CONSTRAINT zero_meo_audit_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_audit_events zero_meo_audit_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_audit_events
    ADD CONSTRAINT zero_meo_audit_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES private.zero_meo_organizations(id) ON DELETE CASCADE;


--
-- Name: zero_meo_audit_events zero_meo_audit_events_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_audit_events
    ADD CONSTRAINT zero_meo_audit_events_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE SET NULL;


--
-- Name: zero_meo_change_requests zero_meo_change_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_change_requests
    ADD CONSTRAINT zero_meo_change_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_change_requests zero_meo_change_requests_organization_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_change_requests
    ADD CONSTRAINT zero_meo_change_requests_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES private.zero_meo_organizations(id) ON DELETE CASCADE;


--
-- Name: zero_meo_change_requests zero_meo_change_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_change_requests
    ADD CONSTRAINT zero_meo_change_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: zero_meo_change_requests zero_meo_change_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_change_requests
    ADD CONSTRAINT zero_meo_change_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: zero_meo_change_requests zero_meo_change_requests_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_change_requests
    ADD CONSTRAINT zero_meo_change_requests_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: zero_meo_change_requests zero_meo_change_requests_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_change_requests
    ADD CONSTRAINT zero_meo_change_requests_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_group_stores zero_meo_group_stores_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_group_stores
    ADD CONSTRAINT zero_meo_group_stores_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_group_stores zero_meo_group_stores_organization_id_group_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_group_stores
    ADD CONSTRAINT zero_meo_group_stores_organization_id_group_id_fkey FOREIGN KEY (organization_id, group_id) REFERENCES private.zero_meo_store_groups(organization_id, id) ON DELETE CASCADE;


--
-- Name: zero_meo_group_stores zero_meo_group_stores_organization_id_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_group_stores
    ADD CONSTRAINT zero_meo_group_stores_organization_id_store_id_fkey FOREIGN KEY (organization_id, store_id) REFERENCES private.zero_meo_store_workspaces(organization_id, store_id) ON DELETE CASCADE;


--
-- Name: zero_meo_invitations zero_meo_invitations_accepted_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_invitations
    ADD CONSTRAINT zero_meo_invitations_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_invitations zero_meo_invitations_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_invitations
    ADD CONSTRAINT zero_meo_invitations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_invitations zero_meo_invitations_organization_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_invitations
    ADD CONSTRAINT zero_meo_invitations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES private.zero_meo_organizations(id) ON DELETE CASCADE;


--
-- Name: zero_meo_invitations zero_meo_invitations_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_invitations
    ADD CONSTRAINT zero_meo_invitations_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: zero_meo_invitations zero_meo_invitations_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_invitations
    ADD CONSTRAINT zero_meo_invitations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_organization_members zero_meo_organization_members_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_organization_members
    ADD CONSTRAINT zero_meo_organization_members_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_organization_members zero_meo_organization_members_organization_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_organization_members
    ADD CONSTRAINT zero_meo_organization_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES private.zero_meo_organizations(id) ON DELETE CASCADE;


--
-- Name: zero_meo_organization_members zero_meo_organization_members_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_organization_members
    ADD CONSTRAINT zero_meo_organization_members_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_organization_members zero_meo_organization_members_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_organization_members
    ADD CONSTRAINT zero_meo_organization_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: zero_meo_organizations zero_meo_organizations_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_organizations
    ADD CONSTRAINT zero_meo_organizations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_organizations zero_meo_organizations_owner_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_organizations
    ADD CONSTRAINT zero_meo_organizations_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: zero_meo_organizations zero_meo_organizations_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_organizations
    ADD CONSTRAINT zero_meo_organizations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_store_groups zero_meo_store_groups_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_groups
    ADD CONSTRAINT zero_meo_store_groups_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_store_groups zero_meo_store_groups_organization_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_groups
    ADD CONSTRAINT zero_meo_store_groups_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES private.zero_meo_organizations(id) ON DELETE CASCADE;


--
-- Name: zero_meo_store_groups zero_meo_store_groups_organization_id_parent_group_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_groups
    ADD CONSTRAINT zero_meo_store_groups_organization_id_parent_group_id_fkey FOREIGN KEY (organization_id, parent_group_id) REFERENCES private.zero_meo_store_groups(organization_id, id) ON DELETE RESTRICT;


--
-- Name: zero_meo_store_groups zero_meo_store_groups_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_groups
    ADD CONSTRAINT zero_meo_store_groups_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_store_members zero_meo_store_members_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_members
    ADD CONSTRAINT zero_meo_store_members_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_store_members zero_meo_store_members_organization_id_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_members
    ADD CONSTRAINT zero_meo_store_members_organization_id_store_id_fkey FOREIGN KEY (organization_id, store_id) REFERENCES private.zero_meo_store_workspaces(organization_id, store_id) ON DELETE CASCADE;


--
-- Name: zero_meo_store_members zero_meo_store_members_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_members
    ADD CONSTRAINT zero_meo_store_members_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_store_members zero_meo_store_members_user_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_members
    ADD CONSTRAINT zero_meo_store_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: zero_meo_store_workspaces zero_meo_store_workspaces_created_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_workspaces
    ADD CONSTRAINT zero_meo_store_workspaces_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: zero_meo_store_workspaces zero_meo_store_workspaces_organization_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_workspaces
    ADD CONSTRAINT zero_meo_store_workspaces_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES private.zero_meo_organizations(id) ON DELETE CASCADE;


--
-- Name: zero_meo_store_workspaces zero_meo_store_workspaces_store_id_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_workspaces
    ADD CONSTRAINT zero_meo_store_workspaces_store_id_fkey FOREIGN KEY (store_id) REFERENCES api.stores(id) ON DELETE CASCADE;


--
-- Name: zero_meo_store_workspaces zero_meo_store_workspaces_updated_by_fkey; Type: FK CONSTRAINT; Schema: private; Owner: -
--

ALTER TABLE ONLY private.zero_meo_store_workspaces
    ADD CONSTRAINT zero_meo_store_workspaces_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: review_handoff_events handoff_events_select_own; Type: POLICY; Schema: api; Owner: -
--

CREATE POLICY handoff_events_select_own ON api.review_handoff_events FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (COALESCE((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text), 'false'::text) <> 'true'::text) AND (EXISTS ( SELECT 1
   FROM api.stores s
  WHERE ((s.id = review_handoff_events.store_id) AND (s.owner_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: interview_messages; Type: ROW SECURITY; Schema: api; Owner: -
--

ALTER TABLE api.interview_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: interview_messages interview_messages_select_own; Type: POLICY; Schema: api; Owner: -
--

CREATE POLICY interview_messages_select_own ON api.interview_messages FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (COALESCE((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text), 'false'::text) <> 'true'::text) AND (EXISTS ( SELECT 1
   FROM api.stores s
  WHERE ((s.id = interview_messages.store_id) AND (s.owner_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: interview_sessions; Type: ROW SECURITY; Schema: api; Owner: -
--

ALTER TABLE api.interview_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: interview_sessions interview_sessions_select_own; Type: POLICY; Schema: api; Owner: -
--

CREATE POLICY interview_sessions_select_own ON api.interview_sessions FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (COALESCE((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text), 'false'::text) <> 'true'::text) AND (EXISTS ( SELECT 1
   FROM api.stores s
  WHERE ((s.id = interview_sessions.store_id) AND (s.owner_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: review_handoff_events; Type: ROW SECURITY; Schema: api; Owner: -
--

ALTER TABLE api.review_handoff_events ENABLE ROW LEVEL SECURITY;

--
-- Name: stores; Type: ROW SECURITY; Schema: api; Owner: -
--

ALTER TABLE api.stores ENABLE ROW LEVEL SECURITY;

--
-- Name: stores stores_select_own; Type: POLICY; Schema: api; Owner: -
--

CREATE POLICY stores_select_own ON api.stores FOR SELECT TO authenticated USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (COALESCE((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text), 'false'::text) <> 'true'::text) AND (owner_id = ( SELECT auth.uid() AS uid))));


--
-- Name: integration_jobs; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.integration_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_receipts; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.integration_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: interview_session_secrets; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.interview_session_secrets ENABLE ROW LEVEL SECURITY;

--
-- Name: interview_survey_snapshots; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.interview_survey_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_ai_draft_reservations; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_ai_draft_reservations ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_aio_citation_entries; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_aio_citation_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_aio_jsonld_snapshots; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_aio_jsonld_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_aio_observations; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_aio_observations ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_export_requests; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_export_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_external_actions; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_external_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_gbp_profile_snapshots; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_gbp_profile_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_gbp_profiles; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_gbp_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_health_diagnoses; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_health_diagnoses ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_insight_snapshots; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_insight_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_manual_health_diagnoses; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_manual_health_diagnoses ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_media_assets; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_media_assets ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_oauth_states; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_oauth_states ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_post_drafts; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_post_drafts ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_post_publication_events; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_post_publication_events ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_post_revisions; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_post_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_provider_connections; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_provider_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_rank_measurements; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_rank_measurements ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_rank_observations; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_rank_observations ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_rank_targets; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_rank_targets ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_review_inbox; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_review_inbox ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_review_reply_revisions; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_review_reply_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: meo_review_reply_templates; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.meo_review_reply_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limit_counters; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.rate_limit_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: request_idempotency; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.request_idempotency ENABLE ROW LEVEL SECURITY;

--
-- Name: retention_cleanup_runs; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.retention_cleanup_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: service_usage; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.service_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: store_ai_provider_connections; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.store_ai_provider_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: store_runtime_limits; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.store_runtime_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: store_survey_revisions; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.store_survey_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: zero_feature_rollout_audit; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.zero_feature_rollout_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: zero_feature_rollouts; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.zero_feature_rollouts ENABLE ROW LEVEL SECURITY;

--
-- Name: zero_meo_audit_events; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.zero_meo_audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: zero_meo_change_requests; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.zero_meo_change_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: zero_meo_group_stores; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.zero_meo_group_stores ENABLE ROW LEVEL SECURITY;

--
-- Name: zero_meo_invitations; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.zero_meo_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: zero_meo_organization_members; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.zero_meo_organization_members ENABLE ROW LEVEL SECURITY;

--
-- Name: zero_meo_organizations; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.zero_meo_organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: zero_meo_store_groups; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.zero_meo_store_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: zero_meo_store_members; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.zero_meo_store_members ENABLE ROW LEVEL SECURITY;

--
-- Name: zero_meo_store_workspaces; Type: ROW SECURITY; Schema: private; Owner: -
--

ALTER TABLE private.zero_meo_store_workspaces ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA api; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA api TO authenticated;
GRANT USAGE ON SCHEMA api TO service_role;


--
-- Name: SCHEMA private; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA private TO service_role;


--
-- Name: FUNCTION internal_bind_interview_survey_revision(p_session_id uuid, p_token_hash text, p_survey_revision integer); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_bind_interview_survey_revision(p_session_id uuid, p_token_hash text, p_survey_revision integer) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_bind_interview_survey_revision(p_session_id uuid, p_token_hash text, p_survey_revision integer) TO service_role;


--
-- Name: FUNCTION internal_bind_interview_survey_snapshot(p_session_id uuid, p_token_hash text, p_source_revision integer, p_selection_json jsonb, p_resolved_config_json jsonb); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_bind_interview_survey_snapshot(p_session_id uuid, p_token_hash text, p_source_revision integer, p_selection_json jsonb, p_resolved_config_json jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_bind_interview_survey_snapshot(p_session_id uuid, p_token_hash text, p_source_revision integer, p_selection_json jsonb, p_resolved_config_json jsonb) TO service_role;


--
-- Name: FUNCTION internal_claim_interview_turn(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_kind text, p_answer text, p_profile_json jsonb, p_structured_answers_json jsonb, p_rating integer, p_visit_frequency text, p_answer_chunks jsonb, p_survey_revision integer); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_claim_interview_turn(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_kind text, p_answer text, p_profile_json jsonb, p_structured_answers_json jsonb, p_rating integer, p_visit_frequency text, p_answer_chunks jsonb, p_survey_revision integer) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_claim_interview_turn(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_kind text, p_answer text, p_profile_json jsonb, p_structured_answers_json jsonb, p_rating integer, p_visit_frequency text, p_answer_chunks jsonb, p_survey_revision integer) TO service_role;


--
-- Name: FUNCTION internal_claim_owner_operation(p_owner_id uuid, p_scope text, p_idempotency_key_hash text, p_request_hash text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_claim_owner_operation(p_owner_id uuid, p_scope text, p_idempotency_key_hash text, p_request_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_claim_owner_operation(p_owner_id uuid, p_scope text, p_idempotency_key_hash text, p_request_hash text) TO service_role;


--
-- Name: FUNCTION internal_claim_review_generation(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_claim_review_generation(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_claim_review_generation(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text) TO service_role;


--
-- Name: FUNCTION internal_claim_review_rewrite(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_current_review text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_claim_review_rewrite(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_current_review text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_claim_review_rewrite(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_current_review text) TO service_role;


--
-- Name: FUNCTION internal_claim_store_operation(p_actor_id uuid, p_store_id uuid, p_scope text, p_idempotency_key_hash text, p_request_hash text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_claim_store_operation(p_actor_id uuid, p_store_id uuid, p_scope text, p_idempotency_key_hash text, p_request_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_claim_store_operation(p_actor_id uuid, p_store_id uuid, p_scope text, p_idempotency_key_hash text, p_request_hash text) TO service_role;


--
-- Name: FUNCTION internal_complete_interview_turn(p_operation_id uuid, p_assistant_text text, p_provider text, p_model text, p_request_id text, p_is_complete boolean); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_complete_interview_turn(p_operation_id uuid, p_assistant_text text, p_provider text, p_model text, p_request_id text, p_is_complete boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_complete_interview_turn(p_operation_id uuid, p_assistant_text text, p_provider text, p_model text, p_request_id text, p_is_complete boolean) TO service_role;


--
-- Name: FUNCTION internal_complete_owner_operation(p_operation_id uuid, p_result_json jsonb); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_complete_owner_operation(p_operation_id uuid, p_result_json jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_complete_owner_operation(p_operation_id uuid, p_result_json jsonb) TO service_role;


--
-- Name: FUNCTION internal_complete_review_generation(p_operation_id uuid, p_review_text text, p_provider text, p_model text, p_request_id text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_complete_review_generation(p_operation_id uuid, p_review_text text, p_provider text, p_model text, p_request_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_complete_review_generation(p_operation_id uuid, p_review_text text, p_provider text, p_model text, p_request_id text) TO service_role;


--
-- Name: FUNCTION internal_complete_review_result(p_operation_id uuid, p_review_text text, p_generation_source text, p_provider text, p_model text, p_request_id text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_complete_review_result(p_operation_id uuid, p_review_text text, p_generation_source text, p_provider text, p_model text, p_request_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_complete_review_result(p_operation_id uuid, p_review_text text, p_generation_source text, p_provider text, p_model text, p_request_id text) TO service_role;


--
-- Name: FUNCTION internal_complete_review_rewrite(p_operation_id uuid, p_review_text text, p_provider text, p_model text, p_request_id text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_complete_review_rewrite(p_operation_id uuid, p_review_text text, p_provider text, p_model text, p_request_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_complete_review_rewrite(p_operation_id uuid, p_review_text text, p_provider text, p_model text, p_request_id text) TO service_role;


--
-- Name: FUNCTION internal_complete_review_rewrite_result(p_operation_id uuid, p_review_text text, p_generation_source text, p_provider text, p_model text, p_request_id text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_complete_review_rewrite_result(p_operation_id uuid, p_review_text text, p_generation_source text, p_provider text, p_model text, p_request_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_complete_review_rewrite_result(p_operation_id uuid, p_review_text text, p_generation_source text, p_provider text, p_model text, p_request_id text) TO service_role;


--
-- Name: FUNCTION internal_create_owner_store_once_v2(p_actor_id uuid, p_operation_id uuid, p_public_slug text, p_name text, p_industry text, p_address text, p_description text, p_website_url text, p_icon_path text, p_welcome_message text, p_closing_message text, p_google_review_url text, p_google_place_id text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_create_owner_store_once_v2(p_actor_id uuid, p_operation_id uuid, p_public_slug text, p_name text, p_industry text, p_address text, p_description text, p_website_url text, p_icon_path text, p_welcome_message text, p_closing_message text, p_google_review_url text, p_google_place_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_create_owner_store_once_v2(p_actor_id uuid, p_operation_id uuid, p_public_slug text, p_name text, p_industry text, p_address text, p_description text, p_website_url text, p_icon_path text, p_welcome_message text, p_closing_message text, p_google_review_url text, p_google_place_id text) TO service_role;


--
-- Name: FUNCTION internal_create_owner_store_v2(p_actor_id uuid, p_public_slug text, p_name text, p_industry text, p_address text, p_description text, p_website_url text, p_icon_path text, p_welcome_message text, p_closing_message text, p_google_review_url text, p_google_place_id text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_create_owner_store_v2(p_actor_id uuid, p_public_slug text, p_name text, p_industry text, p_address text, p_description text, p_website_url text, p_icon_path text, p_welcome_message text, p_closing_message text, p_google_review_url text, p_google_place_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_create_owner_store_v2(p_actor_id uuid, p_public_slug text, p_name text, p_industry text, p_address text, p_description text, p_website_url text, p_icon_path text, p_welcome_message text, p_closing_message text, p_google_review_url text, p_google_place_id text) TO service_role;


--
-- Name: FUNCTION internal_delete_ai_connection_v2(p_actor_id uuid, p_store_id uuid, p_provider text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_delete_ai_connection_v2(p_actor_id uuid, p_store_id uuid, p_provider text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_delete_ai_connection_v2(p_actor_id uuid, p_store_id uuid, p_provider text) TO service_role;


--
-- Name: FUNCTION internal_fail_operation(p_operation_id uuid, p_error_code text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_fail_operation(p_operation_id uuid, p_error_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_fail_operation(p_operation_id uuid, p_error_code text) TO service_role;


--
-- Name: FUNCTION internal_get_active_ai_connection(p_store_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_get_active_ai_connection(p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_get_active_ai_connection(p_store_id uuid) TO service_role;


--
-- Name: FUNCTION internal_get_ai_connection_v2(p_actor_id uuid, p_store_id uuid, p_provider text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_get_ai_connection_v2(p_actor_id uuid, p_store_id uuid, p_provider text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_get_ai_connection_v2(p_actor_id uuid, p_store_id uuid, p_provider text) TO service_role;


--
-- Name: FUNCTION internal_get_ai_connections_v2(p_actor_id uuid, p_store_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_get_ai_connections_v2(p_actor_id uuid, p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_get_ai_connections_v2(p_actor_id uuid, p_store_id uuid) TO service_role;


--
-- Name: FUNCTION internal_get_interview_context(p_store_id uuid, p_session_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_get_interview_context(p_store_id uuid, p_session_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_get_interview_context(p_store_id uuid, p_session_id uuid) TO service_role;


--
-- Name: FUNCTION internal_get_interview_resume(p_session_id uuid, p_token_hash text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_get_interview_resume(p_session_id uuid, p_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_get_interview_resume(p_session_id uuid, p_token_hash text) TO service_role;


--
-- Name: FUNCTION internal_get_interview_survey_revision(p_session_id uuid, p_token_hash text, p_survey_revision integer); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_get_interview_survey_revision(p_session_id uuid, p_token_hash text, p_survey_revision integer) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_get_interview_survey_revision(p_session_id uuid, p_token_hash text, p_survey_revision integer) TO service_role;


--
-- Name: FUNCTION internal_get_interview_survey_snapshot(p_session_id uuid, p_token_hash text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_get_interview_survey_snapshot(p_session_id uuid, p_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_get_interview_survey_snapshot(p_session_id uuid, p_token_hash text) TO service_role;


--
-- Name: FUNCTION internal_get_operation_result(p_operation_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_get_operation_result(p_operation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_get_operation_result(p_operation_id uuid) TO service_role;


--
-- Name: FUNCTION internal_get_owner_interview_survey_snapshots(p_actor_id uuid, p_store_id uuid, p_session_ids uuid[]); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_get_owner_interview_survey_snapshots(p_actor_id uuid, p_store_id uuid, p_session_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_get_owner_interview_survey_snapshots(p_actor_id uuid, p_store_id uuid, p_session_ids uuid[]) TO service_role;


--
-- Name: FUNCTION internal_get_owner_store_v2(p_actor_id uuid, p_store_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_get_owner_store_v2(p_actor_id uuid, p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_get_owner_store_v2(p_actor_id uuid, p_store_id uuid) TO service_role;


--
-- Name: FUNCTION internal_get_owner_survey_config_v2(p_actor_id uuid, p_store_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_get_owner_survey_config_v2(p_actor_id uuid, p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_get_owner_survey_config_v2(p_actor_id uuid, p_store_id uuid) TO service_role;


--
-- Name: FUNCTION internal_get_owner_survey_revisions_v2(p_actor_id uuid, p_store_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_get_owner_survey_revisions_v2(p_actor_id uuid, p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_get_owner_survey_revisions_v2(p_actor_id uuid, p_store_id uuid) TO service_role;


--
-- Name: FUNCTION internal_get_public_store(p_public_slug text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_get_public_store(p_public_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_get_public_store(p_public_slug text) TO service_role;


--
-- Name: FUNCTION internal_get_zero_feature_capabilities(p_actor_id uuid, p_store_id uuid, p_evaluated_at timestamp with time zone); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_get_zero_feature_capabilities(p_actor_id uuid, p_store_id uuid, p_evaluated_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_get_zero_feature_capabilities(p_actor_id uuid, p_store_id uuid, p_evaluated_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION internal_list_owner_stores(p_actor_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_list_owner_stores(p_actor_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_list_owner_stores(p_actor_id uuid) TO service_role;


--
-- Name: FUNCTION internal_mark_ai_connection_status_v2(p_actor_id uuid, p_store_id uuid, p_provider text, p_status text, p_error_code text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_mark_ai_connection_status_v2(p_actor_id uuid, p_store_id uuid, p_provider text, p_status text, p_error_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_mark_ai_connection_status_v2(p_actor_id uuid, p_store_id uuid, p_provider text, p_status text, p_error_code text) TO service_role;


--
-- Name: FUNCTION internal_meo_attention_external_action(p_operation_id uuid, p_error_code text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_attention_external_action(p_operation_id uuid, p_error_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_attention_external_action(p_operation_id uuid, p_error_code text) TO service_role;


--
-- Name: FUNCTION internal_meo_claim_due_rank_jobs(p_limit integer, p_worker_id text, p_lease_seconds integer); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_claim_due_rank_jobs(p_limit integer, p_worker_id text, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_claim_due_rank_jobs(p_limit integer, p_worker_id text, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION internal_meo_claim_external_action(p_actor_id uuid, p_store_id uuid, p_action text, p_key_hash text, p_request_hash text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_claim_external_action(p_actor_id uuid, p_store_id uuid, p_action text, p_key_hash text, p_request_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_claim_external_action(p_actor_id uuid, p_store_id uuid, p_action text, p_key_hash text, p_request_hash text) TO service_role;


--
-- Name: FUNCTION internal_meo_claim_health_diagnosis(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_window_seconds integer, p_store_window_limit integer, p_global_window_limit integer, p_store_daily_limit integer, p_global_daily_limit integer); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_claim_health_diagnosis(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_window_seconds integer, p_store_window_limit integer, p_global_window_limit integer, p_store_daily_limit integer, p_global_daily_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_claim_health_diagnosis(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_window_seconds integer, p_store_window_limit integer, p_global_window_limit integer, p_store_daily_limit integer, p_global_daily_limit integer) TO service_role;


--
-- Name: FUNCTION internal_meo_claim_health_diagnosis_v1(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_window_seconds integer, p_store_window_limit integer, p_global_window_limit integer, p_store_daily_limit integer, p_global_daily_limit integer); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_claim_health_diagnosis_v1(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_window_seconds integer, p_store_window_limit integer, p_global_window_limit integer, p_store_daily_limit integer, p_global_daily_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_claim_health_diagnosis_v1(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_window_seconds integer, p_store_window_limit integer, p_global_window_limit integer, p_store_daily_limit integer, p_global_daily_limit integer) TO service_role;


--
-- Name: FUNCTION internal_meo_complete_external_action(p_operation_id uuid, p_result jsonb); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_complete_external_action(p_operation_id uuid, p_result jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_complete_external_action(p_operation_id uuid, p_result jsonb) TO service_role;


--
-- Name: FUNCTION internal_meo_complete_rank_job(p_job_id uuid, p_claim_token uuid, p_position integer, p_observed_at timestamp with time zone, p_result_place_ids text[], p_competitor_positions jsonb); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_complete_rank_job(p_job_id uuid, p_claim_token uuid, p_position integer, p_observed_at timestamp with time zone, p_result_place_ids text[], p_competitor_positions jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_complete_rank_job(p_job_id uuid, p_claim_token uuid, p_position integer, p_observed_at timestamp with time zone, p_result_place_ids text[], p_competitor_positions jsonb) TO service_role;


--
-- Name: FUNCTION internal_meo_complete_rank_measurement(p_job_id uuid, p_actor_id uuid, p_store_id uuid, p_position integer, p_observed_at timestamp with time zone, p_result_place_ids text[], p_competitor_positions jsonb); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_complete_rank_measurement(p_job_id uuid, p_actor_id uuid, p_store_id uuid, p_position integer, p_observed_at timestamp with time zone, p_result_place_ids text[], p_competitor_positions jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_complete_rank_measurement(p_job_id uuid, p_actor_id uuid, p_store_id uuid, p_position integer, p_observed_at timestamp with time zone, p_result_place_ids text[], p_competitor_positions jsonb) TO service_role;


--
-- Name: FUNCTION internal_meo_consume_oauth_state(p_actor_id uuid, p_store_id uuid, p_provider text, p_state_hash text, p_browser_challenge text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_consume_oauth_state(p_actor_id uuid, p_store_id uuid, p_provider text, p_state_hash text, p_browser_challenge text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_consume_oauth_state(p_actor_id uuid, p_store_id uuid, p_provider text, p_state_hash text, p_browser_challenge text) TO service_role;


--
-- Name: FUNCTION internal_meo_create_oauth_state(p_actor_id uuid, p_store_id uuid, p_provider text, p_state_hash text, p_browser_challenge text, p_return_path text, p_expires_at timestamp with time zone); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_create_oauth_state(p_actor_id uuid, p_store_id uuid, p_provider text, p_state_hash text, p_browser_challenge text, p_return_path text, p_expires_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_create_oauth_state(p_actor_id uuid, p_store_id uuid, p_provider text, p_state_hash text, p_browser_challenge text, p_return_path text, p_expires_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION internal_meo_delete_connection(p_actor_id uuid, p_store_id uuid, p_provider text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_delete_connection(p_actor_id uuid, p_store_id uuid, p_provider text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_delete_connection(p_actor_id uuid, p_store_id uuid, p_provider text) TO service_role;


--
-- Name: FUNCTION internal_meo_expire_health_diagnosis_results(p_limit integer); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_expire_health_diagnosis_results(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_expire_health_diagnosis_results(p_limit integer) TO service_role;


--
-- Name: FUNCTION internal_meo_fail_external_action(p_operation_id uuid, p_error_code text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_fail_external_action(p_operation_id uuid, p_error_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_fail_external_action(p_operation_id uuid, p_error_code text) TO service_role;


--
-- Name: FUNCTION internal_meo_fail_rank_job(p_job_id uuid, p_claim_token uuid, p_error_code text, p_outcome_ambiguous boolean, p_retry_at timestamp with time zone); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_fail_rank_job(p_job_id uuid, p_claim_token uuid, p_error_code text, p_outcome_ambiguous boolean, p_retry_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_fail_rank_job(p_job_id uuid, p_claim_token uuid, p_error_code text, p_outcome_ambiguous boolean, p_retry_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION internal_meo_fail_rank_measurement(p_job_id uuid, p_error_code text, p_outcome_ambiguous boolean, p_retry_at timestamp with time zone); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_fail_rank_measurement(p_job_id uuid, p_error_code text, p_outcome_ambiguous boolean, p_retry_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_fail_rank_measurement(p_job_id uuid, p_error_code text, p_outcome_ambiguous boolean, p_retry_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION internal_meo_get_connection(p_actor_id uuid, p_store_id uuid, p_provider text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_get_connection(p_actor_id uuid, p_store_id uuid, p_provider text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_get_connection(p_actor_id uuid, p_store_id uuid, p_provider text) TO service_role;


--
-- Name: FUNCTION internal_meo_get_connections(p_actor_id uuid, p_store_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_get_connections(p_actor_id uuid, p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_get_connections(p_actor_id uuid, p_store_id uuid) TO service_role;


--
-- Name: FUNCTION internal_meo_get_external_write_settings(p_actor_id uuid, p_store_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_get_external_write_settings(p_actor_id uuid, p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_get_external_write_settings(p_actor_id uuid, p_store_id uuid) TO service_role;


--
-- Name: FUNCTION internal_meo_get_latest_health_result(p_actor_id uuid, p_store_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_get_latest_health_result(p_actor_id uuid, p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_get_latest_health_result(p_actor_id uuid, p_store_id uuid) TO service_role;


--
-- Name: FUNCTION internal_meo_insight_history(p_actor_id uuid, p_store_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_insight_history(p_actor_id uuid, p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_insight_history(p_actor_id uuid, p_store_id uuid) TO service_role;


--
-- Name: FUNCTION internal_meo_mark_rank_submitted(p_job_id uuid, p_actor_id uuid, p_store_id uuid, p_provider_task_id text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_mark_rank_submitted(p_job_id uuid, p_actor_id uuid, p_store_id uuid, p_provider_task_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_mark_rank_submitted(p_job_id uuid, p_actor_id uuid, p_store_id uuid, p_provider_task_id text) TO service_role;


--
-- Name: FUNCTION internal_meo_prepare_oauth_callback(p_provider text, p_state_hash text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_prepare_oauth_callback(p_provider text, p_state_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_prepare_oauth_callback(p_provider text, p_state_hash text) TO service_role;


--
-- Name: FUNCTION internal_meo_rank_history(p_actor_id uuid, p_store_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_rank_history(p_actor_id uuid, p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_rank_history(p_actor_id uuid, p_store_id uuid) TO service_role;


--
-- Name: FUNCTION internal_meo_reconcile_stale_external_actions(p_limit integer); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_reconcile_stale_external_actions(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_reconcile_stale_external_actions(p_limit integer) TO service_role;


--
-- Name: FUNCTION internal_meo_reconcile_stale_health_diagnoses(p_limit integer); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_reconcile_stale_health_diagnoses(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_reconcile_stale_health_diagnoses(p_limit integer) TO service_role;


--
-- Name: FUNCTION internal_meo_reconcile_stale_rank_submissions(p_limit integer); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_reconcile_stale_rank_submissions(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_reconcile_stale_rank_submissions(p_limit integer) TO service_role;


--
-- Name: FUNCTION internal_meo_refresh_connection(p_actor_id uuid, p_store_id uuid, p_provider text, p_credential_ciphertext text, p_credential_iv text, p_key_version smallint, p_expires_at timestamp with time zone); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_refresh_connection(p_actor_id uuid, p_store_id uuid, p_provider text, p_credential_ciphertext text, p_credential_iv text, p_key_version smallint, p_expires_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_refresh_connection(p_actor_id uuid, p_store_id uuid, p_provider text, p_credential_ciphertext text, p_credential_iv text, p_key_version smallint, p_expires_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION internal_meo_reserve_ai_draft(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_daily_store_limit integer, p_daily_global_limit integer, p_credential_source text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_reserve_ai_draft(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_daily_store_limit integer, p_daily_global_limit integer, p_credential_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_reserve_ai_draft(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_daily_store_limit integer, p_daily_global_limit integer, p_credential_source text) TO service_role;


--
-- Name: FUNCTION internal_meo_reserve_provider_call(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_service text, p_operation text, p_credential_source text, p_window_seconds integer, p_store_window_limit integer, p_global_window_limit integer, p_store_daily_limit integer, p_global_daily_limit integer); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_reserve_provider_call(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_service text, p_operation text, p_credential_source text, p_window_seconds integer, p_store_window_limit integer, p_global_window_limit integer, p_store_daily_limit integer, p_global_daily_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_reserve_provider_call(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_service text, p_operation text, p_credential_source text, p_window_seconds integer, p_store_window_limit integer, p_global_window_limit integer, p_store_daily_limit integer, p_global_daily_limit integer) TO service_role;


--
-- Name: FUNCTION internal_meo_reserve_rank_measurement(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_keyword text, p_target_place_id text, p_competitor_place_ids text[], p_location_code integer, p_language_code text, p_device text, p_store_daily_limit integer, p_global_daily_limit integer, p_credential_source text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_reserve_rank_measurement(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_keyword text, p_target_place_id text, p_competitor_place_ids text[], p_location_code integer, p_language_code text, p_device text, p_store_daily_limit integer, p_global_daily_limit integer, p_credential_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_reserve_rank_measurement(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_keyword text, p_target_place_id text, p_competitor_place_ids text[], p_location_code integer, p_language_code text, p_device text, p_store_daily_limit integer, p_global_daily_limit integer, p_credential_source text) TO service_role;


--
-- Name: FUNCTION internal_meo_save_insights(p_actor_id uuid, p_store_id uuid, p_period_start date, p_period_end date, p_source text, p_metrics jsonb); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_save_insights(p_actor_id uuid, p_store_id uuid, p_period_start date, p_period_end date, p_source text, p_metrics jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_save_insights(p_actor_id uuid, p_store_id uuid, p_period_start date, p_period_end date, p_source text, p_metrics jsonb) TO service_role;


--
-- Name: FUNCTION internal_meo_save_manual_health_diagnosis(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_result jsonb); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_save_manual_health_diagnosis(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_result jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_save_manual_health_diagnosis(p_actor_id uuid, p_store_id uuid, p_key_hash text, p_request_hash text, p_result jsonb) TO service_role;


--
-- Name: FUNCTION internal_meo_save_manual_rank(p_actor_id uuid, p_store_id uuid, p_keyword text, p_target_place_id text, p_position integer, p_observed_at timestamp with time zone); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_save_manual_rank(p_actor_id uuid, p_store_id uuid, p_keyword text, p_target_place_id text, p_position integer, p_observed_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_save_manual_rank(p_actor_id uuid, p_store_id uuid, p_keyword text, p_target_place_id text, p_position integer, p_observed_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION internal_meo_select_google_location(p_actor_id uuid, p_store_id uuid, p_location_name text, p_display_name text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_select_google_location(p_actor_id uuid, p_store_id uuid, p_location_name text, p_display_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_select_google_location(p_actor_id uuid, p_store_id uuid, p_location_name text, p_display_name text) TO service_role;


--
-- Name: FUNCTION internal_meo_set_external_writes(p_actor_id uuid, p_store_id uuid, p_enabled boolean); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_set_external_writes(p_actor_id uuid, p_store_id uuid, p_enabled boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_set_external_writes(p_actor_id uuid, p_store_id uuid, p_enabled boolean) TO service_role;


--
-- Name: FUNCTION internal_meo_settle_ai_draft(p_reservation_id uuid, p_credential_source text, p_outcome text, p_provider text, p_model text, p_safe_error_code text, p_result_json jsonb); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_settle_ai_draft(p_reservation_id uuid, p_credential_source text, p_outcome text, p_provider text, p_model text, p_safe_error_code text, p_result_json jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_settle_ai_draft(p_reservation_id uuid, p_credential_source text, p_outcome text, p_provider text, p_model text, p_safe_error_code text, p_result_json jsonb) TO service_role;


--
-- Name: FUNCTION internal_meo_settle_health_diagnosis(p_operation_id uuid, p_outcome text, p_safe_error_code text, p_result jsonb); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_settle_health_diagnosis(p_operation_id uuid, p_outcome text, p_safe_error_code text, p_result jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_settle_health_diagnosis(p_operation_id uuid, p_outcome text, p_safe_error_code text, p_result jsonb) TO service_role;


--
-- Name: FUNCTION internal_meo_settle_health_diagnosis_v1(p_operation_id uuid, p_outcome text, p_safe_error_code text, p_result jsonb); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_settle_health_diagnosis_v1(p_operation_id uuid, p_outcome text, p_safe_error_code text, p_result jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_settle_health_diagnosis_v1(p_operation_id uuid, p_outcome text, p_safe_error_code text, p_result jsonb) TO service_role;


--
-- Name: FUNCTION internal_meo_settle_provider_call(p_reservation_id uuid, p_outcome text, p_safe_error_code text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_settle_provider_call(p_reservation_id uuid, p_outcome text, p_safe_error_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_settle_provider_call(p_reservation_id uuid, p_outcome text, p_safe_error_code text) TO service_role;


--
-- Name: FUNCTION internal_meo_upsert_connection(p_actor_id uuid, p_store_id uuid, p_provider text, p_credential_ciphertext text, p_credential_iv text, p_key_version smallint, p_expires_at timestamp with time zone, p_external_account_id text, p_location_name text, p_display_name text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_upsert_connection(p_actor_id uuid, p_store_id uuid, p_provider text, p_credential_ciphertext text, p_credential_iv text, p_key_version smallint, p_expires_at timestamp with time zone, p_external_account_id text, p_location_name text, p_display_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_upsert_connection(p_actor_id uuid, p_store_id uuid, p_provider text, p_credential_ciphertext text, p_credential_iv text, p_key_version smallint, p_expires_at timestamp with time zone, p_external_account_id text, p_location_name text, p_display_name text) TO service_role;


--
-- Name: FUNCTION internal_meo_worker_claim_due(p_limit integer, p_worker_id text, p_lease_seconds integer); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_worker_claim_due(p_limit integer, p_worker_id text, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_worker_claim_due(p_limit integer, p_worker_id text, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION internal_meo_worker_complete_insights(p_job_id uuid, p_claim_token uuid, p_period_start date, p_period_end date, p_metrics jsonb, p_request_hash text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_worker_complete_insights(p_job_id uuid, p_claim_token uuid, p_period_start date, p_period_end date, p_metrics jsonb, p_request_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_worker_complete_insights(p_job_id uuid, p_claim_token uuid, p_period_start date, p_period_end date, p_metrics jsonb, p_request_hash text) TO service_role;


--
-- Name: FUNCTION internal_meo_worker_complete_noop(p_job_id uuid, p_claim_token uuid, p_reason_code text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_worker_complete_noop(p_job_id uuid, p_claim_token uuid, p_reason_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_worker_complete_noop(p_job_id uuid, p_claim_token uuid, p_reason_code text) TO service_role;


--
-- Name: FUNCTION internal_meo_worker_enqueue_due(p_evaluated_at timestamp with time zone); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_worker_enqueue_due(p_evaluated_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_worker_enqueue_due(p_evaluated_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION internal_meo_worker_prepare_job(p_job_id uuid, p_claim_token uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_worker_prepare_job(p_job_id uuid, p_claim_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_worker_prepare_job(p_job_id uuid, p_claim_token uuid) TO service_role;


--
-- Name: FUNCTION internal_meo_worker_refresh_connection(p_job_id uuid, p_claim_token uuid, p_provider text, p_credential_ciphertext text, p_credential_iv text, p_key_version smallint, p_expires_at timestamp with time zone); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_worker_refresh_connection(p_job_id uuid, p_claim_token uuid, p_provider text, p_credential_ciphertext text, p_credential_iv text, p_key_version smallint, p_expires_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_worker_refresh_connection(p_job_id uuid, p_claim_token uuid, p_provider text, p_credential_ciphertext text, p_credential_iv text, p_key_version smallint, p_expires_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION internal_meo_worker_reschedule(p_job_id uuid, p_claim_token uuid, p_error_code text, p_available_at timestamp with time zone); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_worker_reschedule(p_job_id uuid, p_claim_token uuid, p_error_code text, p_available_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_worker_reschedule(p_job_id uuid, p_claim_token uuid, p_error_code text, p_available_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION internal_meo_worker_terminal(p_job_id uuid, p_claim_token uuid, p_state text, p_error_code text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_meo_worker_terminal(p_job_id uuid, p_claim_token uuid, p_state text, p_error_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_meo_worker_terminal(p_job_id uuid, p_claim_token uuid, p_state text, p_error_code text) TO service_role;


--
-- Name: FUNCTION internal_purge_owner_idempotency(p_owner_id uuid, p_keep_operation_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_purge_owner_idempotency(p_owner_id uuid, p_keep_operation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_purge_owner_idempotency(p_owner_id uuid, p_keep_operation_id uuid) TO service_role;


--
-- Name: FUNCTION internal_record_handoff(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_event_type text, p_edited_review text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_record_handoff(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_event_type text, p_edited_review text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_record_handoff(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_event_type text, p_edited_review text) TO service_role;


--
-- Name: FUNCTION internal_replay_interview_session(p_store_id uuid, p_idempotency_key_hash text, p_request_hash text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_replay_interview_session(p_store_id uuid, p_idempotency_key_hash text, p_request_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_replay_interview_session(p_store_id uuid, p_idempotency_key_hash text, p_request_hash text) TO service_role;


--
-- Name: FUNCTION internal_require_zero_feature(p_actor_id uuid, p_store_id uuid, p_feature_key text, p_evaluated_at timestamp with time zone); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_require_zero_feature(p_actor_id uuid, p_store_id uuid, p_feature_key text, p_evaluated_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_require_zero_feature(p_actor_id uuid, p_store_id uuid, p_feature_key text, p_evaluated_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION internal_save_edited_review(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_edited_review text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_save_edited_review(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_edited_review text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_save_edited_review(p_session_id uuid, p_token_hash text, p_session_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_edited_review text) TO service_role;


--
-- Name: FUNCTION internal_select_ai_model_v2(p_actor_id uuid, p_store_id uuid, p_provider text, p_model text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_select_ai_model_v2(p_actor_id uuid, p_store_id uuid, p_provider text, p_model text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_select_ai_model_v2(p_actor_id uuid, p_store_id uuid, p_provider text, p_model text) TO service_role;


--
-- Name: FUNCTION internal_select_ai_provider_v2(p_actor_id uuid, p_store_id uuid, p_provider text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_select_ai_provider_v2(p_actor_id uuid, p_store_id uuid, p_provider text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_select_ai_provider_v2(p_actor_id uuid, p_store_id uuid, p_provider text) TO service_role;


--
-- Name: FUNCTION internal_set_store_status_v2(p_actor_id uuid, p_store_id uuid, p_status text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_set_store_status_v2(p_actor_id uuid, p_store_id uuid, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_set_store_status_v2(p_actor_id uuid, p_store_id uuid, p_status text) TO service_role;


--
-- Name: FUNCTION internal_set_zero_feature_rollout(p_feature_key text, p_state text, p_release_at timestamp with time zone, p_execution_mode text, p_kill_switch boolean, p_operator_id text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_set_zero_feature_rollout(p_feature_key text, p_state text, p_release_at timestamp with time zone, p_execution_mode text, p_kill_switch boolean, p_operator_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_set_zero_feature_rollout(p_feature_key text, p_state text, p_release_at timestamp with time zone, p_execution_mode text, p_kill_switch boolean, p_operator_id text) TO service_role;


--
-- Name: FUNCTION internal_start_interview_session(p_session_id uuid, p_store_id uuid, p_locale text, p_token_hash text, p_ip_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_expires_at timestamp with time zone); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_start_interview_session(p_session_id uuid, p_store_id uuid, p_locale text, p_token_hash text, p_ip_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_expires_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_start_interview_session(p_session_id uuid, p_store_id uuid, p_locale text, p_token_hash text, p_ip_subject_hash text, p_idempotency_key_hash text, p_request_hash text, p_expires_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION internal_update_owner_store_v2(p_actor_id uuid, p_store_id uuid, p_name text, p_industry text, p_address text, p_description text, p_website_url text, p_icon_path text, p_welcome_message text, p_closing_message text, p_google_review_url text, p_google_place_id text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_update_owner_store_v2(p_actor_id uuid, p_store_id uuid, p_name text, p_industry text, p_address text, p_description text, p_website_url text, p_icon_path text, p_welcome_message text, p_closing_message text, p_google_review_url text, p_google_place_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_update_owner_store_v2(p_actor_id uuid, p_store_id uuid, p_name text, p_industry text, p_address text, p_description text, p_website_url text, p_icon_path text, p_welcome_message text, p_closing_message text, p_google_review_url text, p_google_place_id text) TO service_role;


--
-- Name: FUNCTION internal_update_survey_config_v2(p_actor_id uuid, p_store_id uuid, p_survey_config_json jsonb); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_update_survey_config_v2(p_actor_id uuid, p_store_id uuid, p_survey_config_json jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_update_survey_config_v2(p_actor_id uuid, p_store_id uuid, p_survey_config_json jsonb) TO service_role;


--
-- Name: FUNCTION internal_upsert_ai_connection_v2(p_actor_id uuid, p_store_id uuid, p_provider text, p_credential_ciphertext text, p_credential_iv text, p_key_version smallint, p_key_last4 text, p_model text, p_activate boolean); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_upsert_ai_connection_v2(p_actor_id uuid, p_store_id uuid, p_provider text, p_credential_ciphertext text, p_credential_iv text, p_key_version smallint, p_key_last4 text, p_model text, p_activate boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_upsert_ai_connection_v2(p_actor_id uuid, p_store_id uuid, p_provider text, p_credential_ciphertext text, p_credential_iv text, p_key_version smallint, p_key_last4 text, p_model text, p_activate boolean) TO service_role;


--
-- Name: FUNCTION internal_validate_interview_session(p_session_id uuid, p_token_hash text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_validate_interview_session(p_session_id uuid, p_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_validate_interview_session(p_session_id uuid, p_token_hash text) TO service_role;


--
-- Name: FUNCTION internal_zero_meo_accept_invitation(p_actor_id uuid, p_actor_email text, p_token_hash text); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_zero_meo_accept_invitation(p_actor_id uuid, p_actor_email text, p_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_zero_meo_accept_invitation(p_actor_id uuid, p_actor_email text, p_token_hash text) TO service_role;


--
-- Name: FUNCTION internal_zero_meo_accessible_stores(p_actor_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_zero_meo_accessible_stores(p_actor_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_zero_meo_accessible_stores(p_actor_id uuid) TO service_role;


--
-- Name: FUNCTION internal_zero_meo_list(p_actor_id uuid, p_store_id uuid, p_resource text, p_cursor text, p_limit integer, p_filters jsonb); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_zero_meo_list(p_actor_id uuid, p_store_id uuid, p_resource text, p_cursor text, p_limit integer, p_filters jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_zero_meo_list(p_actor_id uuid, p_store_id uuid, p_resource text, p_cursor text, p_limit integer, p_filters jsonb) TO service_role;


--
-- Name: FUNCTION internal_zero_meo_mutate(p_actor_id uuid, p_store_id uuid, p_resource text, p_action text, p_record_id uuid, p_payload jsonb); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_zero_meo_mutate(p_actor_id uuid, p_store_id uuid, p_resource text, p_action text, p_record_id uuid, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_zero_meo_mutate(p_actor_id uuid, p_store_id uuid, p_resource text, p_action text, p_record_id uuid, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION internal_zero_meo_workspace_authorize(p_actor_id uuid, p_store_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_zero_meo_workspace_authorize(p_actor_id uuid, p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_zero_meo_workspace_authorize(p_actor_id uuid, p_store_id uuid) TO service_role;


--
-- Name: FUNCTION internal_zero_meo_workspace_snapshot(p_actor_id uuid, p_store_id uuid); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.internal_zero_meo_workspace_snapshot(p_actor_id uuid, p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.internal_zero_meo_workspace_snapshot(p_actor_id uuid, p_store_id uuid) TO service_role;


--
-- Name: FUNCTION owner_monthly_summary_v2(p_store_id uuid, p_period_start date); Type: ACL; Schema: api; Owner: -
--

REVOKE ALL ON FUNCTION api.owner_monthly_summary_v2(p_store_id uuid, p_period_start date) FROM PUBLIC;
GRANT ALL ON FUNCTION api.owner_monthly_summary_v2(p_store_id uuid, p_period_start date) TO authenticated;


--
-- Name: FUNCTION canonical_survey_config(p_template_id text, p_title text, p_description text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.canonical_survey_config(p_template_id text, p_title text, p_description text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.canonical_survey_config(p_template_id text, p_title text, p_description text) TO service_role;


--
-- Name: FUNCTION claim_idempotency(p_scope text, p_subject_id uuid, p_key_hash text, p_request_hash text, p_lease_seconds integer); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.claim_idempotency(p_scope text, p_subject_id uuid, p_key_hash text, p_request_hash text, p_lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION private.claim_idempotency(p_scope text, p_subject_id uuid, p_key_hash text, p_request_hash text, p_lease_seconds integer) TO service_role;


--
-- Name: FUNCTION consume_rate_limit(p_scope text, p_store_id uuid, p_subject_hash text, p_window_seconds integer, p_limit integer); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.consume_rate_limit(p_scope text, p_store_id uuid, p_subject_hash text, p_window_seconds integer, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION private.consume_rate_limit(p_scope text, p_store_id uuid, p_subject_hash text, p_window_seconds integer, p_limit integer) TO service_role;


--
-- Name: FUNCTION create_default_store_runtime_limits(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.create_default_store_runtime_limits() FROM PUBLIC;
GRANT ALL ON FUNCTION private.create_default_store_runtime_limits() TO service_role;


--
-- Name: FUNCTION expected_resolved_survey_config(p_source_config jsonb, p_selection jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.expected_resolved_survey_config(p_source_config jsonb, p_selection jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.expected_resolved_survey_config(p_source_config jsonb, p_selection jsonb) TO service_role;


--
-- Name: FUNCTION is_valid_interview_survey_snapshot_row(p_source_revision integer, p_selection jsonb, p_resolved_config jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.is_valid_interview_survey_snapshot_row(p_source_revision integer, p_selection jsonb, p_resolved_config jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_valid_interview_survey_snapshot_row(p_source_revision integer, p_selection jsonb, p_resolved_config jsonb) TO service_role;


--
-- Name: FUNCTION is_valid_structured_survey_answers_v3(p_answers jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.is_valid_structured_survey_answers_v3(p_answers jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_valid_structured_survey_answers_v3(p_answers jsonb) TO service_role;


--
-- Name: FUNCTION is_valid_survey_config(p_config jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.is_valid_survey_config(p_config jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_valid_survey_config(p_config jsonb) TO service_role;


--
-- Name: FUNCTION is_valid_survey_question(p_question jsonb, p_with_placeholder boolean); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.is_valid_survey_question(p_question jsonb, p_with_placeholder boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_valid_survey_question(p_question jsonb, p_with_placeholder boolean) TO service_role;


--
-- Name: FUNCTION is_valid_survey_question_v3(p_question jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.is_valid_survey_question_v3(p_question jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_valid_survey_question_v3(p_question jsonb) TO service_role;


--
-- Name: FUNCTION is_valid_survey_question_variant_v4(p_type text, p_required boolean, p_role text, p_variant jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.is_valid_survey_question_variant_v4(p_type text, p_required boolean, p_role text, p_variant jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_valid_survey_question_variant_v4(p_type text, p_required boolean, p_role text, p_variant jsonb) TO service_role;


--
-- Name: FUNCTION is_valid_survey_variant_selection(p_selection jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.is_valid_survey_variant_selection(p_selection jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.is_valid_survey_variant_selection(p_selection jsonb) TO service_role;


--
-- Name: FUNCTION meo_ai_draft_result_is_valid(p_result jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.meo_ai_draft_result_is_valid(p_result jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.meo_ai_draft_result_is_valid(p_result jsonb) TO service_role;


--
-- Name: FUNCTION meo_health_result_is_valid(p_result jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.meo_health_result_is_valid(p_result jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.meo_health_result_is_valid(p_result jsonb) TO service_role;


--
-- Name: FUNCTION meo_insight_metrics_are_valid(p_metrics jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.meo_insight_metrics_are_valid(p_metrics jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.meo_insight_metrics_are_valid(p_metrics jsonb) TO service_role;


--
-- Name: FUNCTION meo_integration_json_is_safe(p_value jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.meo_integration_json_is_safe(p_value jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.meo_integration_json_is_safe(p_value jsonb) TO service_role;


--
-- Name: FUNCTION meo_oauth_provider_feature_available(p_provider text, p_evaluated_at timestamp with time zone); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.meo_oauth_provider_feature_available(p_provider text, p_evaluated_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION private.meo_oauth_provider_feature_available(p_provider text, p_evaluated_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION meo_place_ids_are_valid(p_place_ids text[], p_maximum integer); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.meo_place_ids_are_valid(p_place_ids text[], p_maximum integer) FROM PUBLIC;
GRANT ALL ON FUNCTION private.meo_place_ids_are_valid(p_place_ids text[], p_maximum integer) TO service_role;


--
-- Name: TABLE meo_provider_connections; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.meo_provider_connections TO service_role;


--
-- Name: FUNCTION meo_public_connection_json(p_connection private.meo_provider_connections); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.meo_public_connection_json(p_connection private.meo_provider_connections) FROM PUBLIC;
GRANT ALL ON FUNCTION private.meo_public_connection_json(p_connection private.meo_provider_connections) TO service_role;


--
-- Name: FUNCTION owner_exists(p_owner_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.owner_exists(p_owner_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.owner_exists(p_owner_id uuid) TO service_role;


--
-- Name: FUNCTION preview_expired_interview_session_counts(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.preview_expired_interview_session_counts() FROM PUBLIC;
GRANT ALL ON FUNCTION private.preview_expired_interview_session_counts() TO service_role;


--
-- Name: FUNCTION purge_expired_interview_sessions(p_limit integer); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.purge_expired_interview_sessions(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION private.purge_expired_interview_sessions(p_limit integer) TO service_role;


--
-- Name: FUNCTION recover_expired_generation_operation(p_scope text, p_session_id uuid, p_new_key_hash text, p_request_hash text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.recover_expired_generation_operation(p_scope text, p_session_id uuid, p_new_key_hash text, p_request_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.recover_expired_generation_operation(p_scope text, p_session_id uuid, p_new_key_hash text, p_request_hash text) TO service_role;


--
-- Name: TABLE interview_sessions; Type: ACL; Schema: api; Owner: -
--

GRANT SELECT ON TABLE api.interview_sessions TO authenticated;
GRANT ALL ON TABLE api.interview_sessions TO service_role;


--
-- Name: FUNCTION require_interview_session(p_session_id uuid, p_token_hash text); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.require_interview_session(p_session_id uuid, p_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION private.require_interview_session(p_session_id uuid, p_token_hash text) TO service_role;


--
-- Name: FUNCTION require_owner(p_owner_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.require_owner(p_owner_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.require_owner(p_owner_id uuid) TO service_role;


--
-- Name: FUNCTION require_store_owner(p_actor_id uuid, p_store_id uuid); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.require_store_owner(p_actor_id uuid, p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION private.require_store_owner(p_actor_id uuid, p_store_id uuid) TO service_role;


--
-- Name: FUNCTION retention_cleanup_health(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.retention_cleanup_health() FROM PUBLIC;
GRANT ALL ON FUNCTION private.retention_cleanup_health() TO service_role;


--
-- Name: FUNCTION run_interview_session_retention_cleanup(p_limit integer); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.run_interview_session_retention_cleanup(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION private.run_interview_session_retention_cleanup(p_limit integer) TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.set_updated_at() FROM PUBLIC;


--
-- Name: FUNCTION upcast_survey_config_v3(p_config jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.upcast_survey_config_v3(p_config jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION private.upcast_survey_config_v3(p_config jsonb) TO service_role;


--
-- Name: FUNCTION zero_feature_effective_state(p_configured_state text, p_release_at timestamp with time zone, p_kill_switch boolean, p_evaluated_at timestamp with time zone); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.zero_feature_effective_state(p_configured_state text, p_release_at timestamp with time zone, p_kill_switch boolean, p_evaluated_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION private.zero_feature_effective_state(p_configured_state text, p_release_at timestamp with time zone, p_kill_switch boolean, p_evaluated_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION zero_meo_bootstrap_store_workspace(); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.zero_meo_bootstrap_store_workspace() FROM PUBLIC;


--
-- Name: FUNCTION zero_meo_change_request_is_valid(p_resource text, p_action text, p_record_id uuid, p_payload jsonb); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.zero_meo_change_request_is_valid(p_resource text, p_action text, p_record_id uuid, p_payload jsonb) FROM PUBLIC;


--
-- Name: FUNCTION zero_meo_json_is_bounded(p_value jsonb, p_maximum_bytes integer); Type: ACL; Schema: private; Owner: -
--

REVOKE ALL ON FUNCTION private.zero_meo_json_is_bounded(p_value jsonb, p_maximum_bytes integer) FROM PUBLIC;


--
-- Name: TABLE interview_messages; Type: ACL; Schema: api; Owner: -
--

GRANT SELECT ON TABLE api.interview_messages TO authenticated;
GRANT ALL ON TABLE api.interview_messages TO service_role;


--
-- Name: TABLE review_handoff_events; Type: ACL; Schema: api; Owner: -
--

GRANT SELECT ON TABLE api.review_handoff_events TO authenticated;
GRANT ALL ON TABLE api.review_handoff_events TO service_role;


--
-- Name: TABLE stores; Type: ACL; Schema: api; Owner: -
--

GRANT SELECT ON TABLE api.stores TO authenticated;
GRANT ALL ON TABLE api.stores TO service_role;


--
-- Name: TABLE integration_jobs; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.integration_jobs TO service_role;


--
-- Name: TABLE integration_receipts; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.integration_receipts TO service_role;


--
-- Name: TABLE interview_session_secrets; Type: ACL; Schema: private; Owner: -
--

GRANT ALL ON TABLE private.interview_session_secrets TO service_role;


--
-- Name: TABLE interview_survey_snapshots; Type: ACL; Schema: private; Owner: -
--

GRANT ALL ON TABLE private.interview_survey_snapshots TO service_role;


--
-- Name: TABLE meo_ai_draft_reservations; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE private.meo_ai_draft_reservations TO service_role;


--
-- Name: TABLE meo_external_actions; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.meo_external_actions TO service_role;


--
-- Name: TABLE meo_health_diagnoses; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.meo_health_diagnoses TO service_role;


--
-- Name: TABLE meo_insight_snapshots; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.meo_insight_snapshots TO service_role;


--
-- Name: TABLE meo_manual_health_diagnoses; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE private.meo_manual_health_diagnoses TO service_role;


--
-- Name: TABLE meo_oauth_states; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.meo_oauth_states TO service_role;


--
-- Name: TABLE meo_rank_measurements; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.meo_rank_measurements TO service_role;


--
-- Name: TABLE meo_rank_observations; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.meo_rank_observations TO service_role;


--
-- Name: TABLE meo_rank_targets; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.meo_rank_targets TO service_role;


--
-- Name: TABLE rate_limit_counters; Type: ACL; Schema: private; Owner: -
--

GRANT ALL ON TABLE private.rate_limit_counters TO service_role;


--
-- Name: TABLE request_idempotency; Type: ACL; Schema: private; Owner: -
--

GRANT ALL ON TABLE private.request_idempotency TO service_role;


--
-- Name: TABLE retention_cleanup_runs; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT ON TABLE private.retention_cleanup_runs TO service_role;


--
-- Name: TABLE service_usage; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE private.service_usage TO service_role;


--
-- Name: TABLE store_ai_provider_connections; Type: ACL; Schema: private; Owner: -
--

GRANT ALL ON TABLE private.store_ai_provider_connections TO service_role;


--
-- Name: TABLE store_runtime_limits; Type: ACL; Schema: private; Owner: -
--

GRANT ALL ON TABLE private.store_runtime_limits TO service_role;


--
-- Name: TABLE store_survey_revisions; Type: ACL; Schema: private; Owner: -
--

GRANT ALL ON TABLE private.store_survey_revisions TO service_role;


--
-- Name: TABLE zero_feature_rollouts; Type: ACL; Schema: private; Owner: -
--

GRANT SELECT ON TABLE private.zero_feature_rollouts TO service_role;


INSERT INTO private.zero_feature_rollouts (
    feature_key,
    configured_state,
    release_at,
    execution_mode,
    kill_switch
) VALUES
    ('gbp_health', 'available', NULL, 'native', false),
    ('gbp_insights', 'available', NULL, 'native', false),
    ('instagram_to_gbp', 'available', NULL, 'native', false),
    ('meo_rank', 'available', NULL, 'owner_provider', false),
    ('review_reply', 'available', NULL, 'owner_provider', false);

--
-- PostgreSQL database dump complete
--
