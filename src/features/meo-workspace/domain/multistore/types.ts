export type OrganizationId = string
export type GroupId = string
export type StoreId = string
export type UserId = string

export interface Organization {
  id: OrganizationId
  name: string
  approvalPolicy: ApprovalPolicy
}

export interface StoreGroup {
  id: GroupId
  organizationId: OrganizationId
  name: string
  storeIds: readonly StoreId[]
}

export type Role = 'owner' | 'admin' | 'editor' | 'analyst'
export type Scope =
  | { kind: 'organization'; organizationId: OrganizationId }
  | { kind: 'group'; organizationId: OrganizationId; groupId: GroupId }
  | { kind: 'store'; organizationId: OrganizationId; storeId: StoreId }

export interface ScopedRole { role: Role; scope: Scope }

export interface Membership {
  userId: UserId
  organizationId: OrganizationId
  roles: readonly ScopedRole[]
  status: 'active' | 'suspended'
}

export interface Invitation {
  id: string
  organizationId: OrganizationId
  email: string
  roles: readonly ScopedRole[]
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  expiresAt: string
}

export type ApprovalPolicy = { mode: 'direct' } | { mode: 'two-person' }
export type ChangeRequestState = 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled' | 'executed'

export interface ChangeRequest<T = Readonly<Record<string, unknown>>> {
  id: string
  organizationId: OrganizationId
  storeIds: readonly StoreId[]
  proposerId: UserId
  payload: T
  state: ChangeRequestState
  reviewerId?: UserId
}

export interface AuditSummary {
  actorId: UserId
  action: string
  storeIds: readonly StoreId[]
  occurredAt: string
  changeRequestId?: string
}

export interface StoreSummary {
  id: StoreId
  organizationId: OrganizationId
  groupId?: GroupId
  name: string
  locationCode: string
}
