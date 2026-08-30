import type { ApprovalPolicy, Role } from './types'

export type Capability =
  | 'read'
  | 'edit'
  | 'manage-stores'
  | 'manage-groups'
  | 'manage-members'
  | 'manage-invitations'
  | 'review-changes'
  | 'transfer-ownership'

const capabilities: Record<Role, ReadonlySet<Capability>> = {
  owner: new Set<Capability>(['read', 'edit', 'manage-stores', 'manage-groups', 'manage-members', 'manage-invitations', 'review-changes', 'transfer-ownership']),
  admin: new Set<Capability>(['read', 'edit', 'manage-stores', 'manage-groups', 'manage-members', 'manage-invitations', 'review-changes']),
  editor: new Set<Capability>(['read', 'edit']),
  analyst: new Set<Capability>(['read']),
}

export function can(role: Role, capability: Capability): boolean {
  return capabilities[role].has(capability)
}

export type EditDisposition = 'direct' | 'change-request' | 'denied'

export function editDisposition(role: Role, policy: ApprovalPolicy): EditDisposition {
  if (!can(role, 'edit')) return 'denied'
  if (role === 'editor' && policy.mode === 'two-person') return 'change-request'
  return 'direct'
}
