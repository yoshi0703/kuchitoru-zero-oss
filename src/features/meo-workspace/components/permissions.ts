import type { MeoWorkspaceRole } from './MeoWorkspace'

export function isMeoWorkspaceReadOnly(role: MeoWorkspaceRole): boolean {
  return role === 'analyst'
}
