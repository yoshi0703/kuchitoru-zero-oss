import type { RpcClient } from "../_shared/types.ts";
import type { WorkspaceResource, WorkspaceRole } from "./contracts.ts";

export type WorkspaceAuthorization = {
  organizationId: string;
  storeId: string;
  role: WorkspaceRole;
  approvalRequired: boolean;
};

export type WorkspaceListInput = {
  actorId: string;
  storeId: string;
  resource: WorkspaceResource;
  cursor: string | null;
  limit: number;
  filters: Record<string, unknown>;
};

export type WorkspaceMutationInput = {
  actorId: string;
  storeId: string;
  resource: WorkspaceResource;
  action: string;
  recordId: string | null;
  payload: Record<string, unknown>;
};

export interface WorkspaceRepositoryPort {
  accessibleStores(actorId: string): Promise<unknown>;
  acceptInvitation(
    actorId: string,
    actorEmail: string,
    tokenHash: string,
  ): Promise<unknown>;
  authorize(actorId: string, storeId: string): Promise<WorkspaceAuthorization>;
  workspaceSnapshot(actorId: string, storeId: string): Promise<unknown>;
  list(input: WorkspaceListInput): Promise<unknown>;
  mutate(input: WorkspaceMutationInput): Promise<unknown>;
}

type ApiRpcClient = {
  rpc(name: string, params: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = new Set<WorkspaceRole>(["owner", "admin", "editor", "analyst"]);

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function authorization(
  value: unknown,
  expectedStoreId: string,
): WorkspaceAuthorization {
  const row = object(value);
  const allowed = row?.allowed ?? row?.authorized;
  const organizationId = row?.organization_id ?? row?.organizationId;
  const storeId = row?.store_id ?? row?.storeId;
  const role = row?.role;
  const approvalRequired = row?.approval_required ?? row?.approvalRequired;
  if (
    allowed !== true ||
    typeof organizationId !== "string" || !UUID_PATTERN.test(organizationId) ||
    typeof storeId !== "string" ||
    storeId.toLowerCase() !== expectedStoreId.toLowerCase() ||
    typeof role !== "string" || !ROLES.has(role as WorkspaceRole) ||
    typeof approvalRequired !== "boolean"
  ) {
    throw new Error("WORKSPACE_AUTHORIZATION_DENIED");
  }
  return {
    organizationId: organizationId.toLowerCase(),
    storeId: storeId.toLowerCase(),
    role: role as WorkspaceRole,
    approvalRequired,
  };
}

export const workspaceRpcNames = {
  accessibleStores: "internal_zero_meo_accessible_stores",
  acceptInvitation: "internal_zero_meo_accept_invitation",
  authorize: "internal_zero_meo_workspace_authorize",
  snapshot: "internal_zero_meo_workspace_snapshot",
  list: "internal_zero_meo_list",
  mutate: "internal_zero_meo_mutate",
} as const;

export class WorkspaceRepository implements WorkspaceRepositoryPort {
  readonly #api: ApiRpcClient;

  constructor(client: RpcClient) {
    this.#api = client.schema("api") as unknown as ApiRpcClient;
  }

  async #rpc(name: string, params: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.#api.rpc(name, params);
    if (error) throw error;
    return data;
  }

  async authorize(
    actorId: string,
    storeId: string,
  ): Promise<WorkspaceAuthorization> {
    const value = await this.#rpc(workspaceRpcNames.authorize, {
      p_actor_id: actorId,
      p_store_id: storeId,
    });
    return authorization(value, storeId);
  }

  accessibleStores(actorId: string): Promise<unknown> {
    return this.#rpc(workspaceRpcNames.accessibleStores, {
      p_actor_id: actorId,
    });
  }

  acceptInvitation(
    actorId: string,
    actorEmail: string,
    tokenHash: string,
  ): Promise<unknown> {
    return this.#rpc(workspaceRpcNames.acceptInvitation, {
      p_actor_id: actorId,
      p_actor_email: actorEmail,
      p_token_hash: tokenHash,
    });
  }

  workspaceSnapshot(actorId: string, storeId: string): Promise<unknown> {
    return this.#rpc(workspaceRpcNames.snapshot, {
      p_actor_id: actorId,
      p_store_id: storeId,
    });
  }

  list(input: WorkspaceListInput): Promise<unknown> {
    return this.#rpc(workspaceRpcNames.list, {
      p_actor_id: input.actorId,
      p_store_id: input.storeId,
      p_resource: input.resource,
      p_cursor: input.cursor,
      p_limit: input.limit,
      p_filters: input.filters,
    });
  }

  mutate(input: WorkspaceMutationInput): Promise<unknown> {
    return this.#rpc(workspaceRpcNames.mutate, {
      p_actor_id: input.actorId,
      p_store_id: input.storeId,
      p_resource: input.resource,
      p_action: input.action,
      p_record_id: input.recordId,
      p_payload: input.payload,
    });
  }
}
