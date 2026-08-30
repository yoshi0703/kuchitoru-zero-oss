import type { RpcClient } from "../_shared/types.ts";
import { assertEquals, assertRejects } from "../tests/assert.ts";
import { WorkspaceRepository, workspaceRpcNames } from "./repository.ts";

const actorId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";

function client(
  handler: (name: string, params: Record<string, unknown>) => unknown,
): RpcClient {
  return {
    schema: (schema) => {
      assertEquals(schema, "api");
      return {
        rpc: (name: string, params: Record<string, unknown>) =>
          Promise.resolve({ data: handler(name, params), error: null }),
        from: () => ({}),
      };
    },
    auth: { admin: {} as never },
  } as RpcClient;
}

Deno.test("workspace repository uses the service-role-only RPC contract", async () => {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const repository = new WorkspaceRepository(client((name, params) => {
    calls.push({ name, params });
    if (name === workspaceRpcNames.authorize) {
      return {
        allowed: true,
        organization_id: organizationId,
        store_id: storeId,
        role: "editor",
        approval_required: true,
        approval_policy: "two_person",
      };
    }
    return { ok: true };
  }));

  assertEquals(await repository.authorize(actorId, storeId), {
    organizationId,
    storeId,
    role: "editor",
    approvalRequired: true,
  });
  await repository.accessibleStores(actorId);
  await repository.acceptInvitation(
    actorId,
    "owner@example.test",
    "a".repeat(64),
  );
  await repository.workspaceSnapshot(actorId, storeId);
  await repository.list({
    actorId,
    storeId,
    resource: "reviews",
    cursor: "cursor",
    limit: 50,
    filters: { status: "unread" },
  });
  await repository.mutate({
    actorId,
    storeId,
    resource: "reviews",
    action: "update",
    recordId: organizationId,
    payload: { status: "read" },
  });

  assertEquals(calls, [
    {
      name: "internal_zero_meo_workspace_authorize",
      params: { p_actor_id: actorId, p_store_id: storeId },
    },
    {
      name: "internal_zero_meo_accessible_stores",
      params: { p_actor_id: actorId },
    },
    {
      name: "internal_zero_meo_accept_invitation",
      params: {
        p_actor_id: actorId,
        p_actor_email: "owner@example.test",
        p_token_hash: "a".repeat(64),
      },
    },
    {
      name: "internal_zero_meo_workspace_snapshot",
      params: { p_actor_id: actorId, p_store_id: storeId },
    },
    {
      name: "internal_zero_meo_list",
      params: {
        p_actor_id: actorId,
        p_store_id: storeId,
        p_resource: "reviews",
        p_cursor: "cursor",
        p_limit: 50,
        p_filters: { status: "unread" },
      },
    },
    {
      name: "internal_zero_meo_mutate",
      params: {
        p_actor_id: actorId,
        p_store_id: storeId,
        p_resource: "reviews",
        p_action: "update",
        p_record_id: organizationId,
        p_payload: { status: "read" },
      },
    },
  ]);
});

Deno.test("workspace repository rejects malformed authorization output", async () => {
  const repository = new WorkspaceRepository(client(() => ({
    allowed: true,
    organization_id: organizationId,
    store_id: "99999999-9999-4999-8999-999999999999",
    role: "owner",
    approval_required: false,
  })));
  await assertRejects(
    () => repository.authorize(actorId, storeId),
    "WORKSPACE_AUTHORIZATION_DENIED",
  );
});
