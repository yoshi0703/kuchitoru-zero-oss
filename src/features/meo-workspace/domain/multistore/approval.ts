import type { ChangeRequest, ChangeRequestState, Role, UserId } from './types'

export type ChangeRequestEvent =
  | { type: 'submit' }
  | { type: 'approve'; actorId: UserId; actorRole: Role }
  | { type: 'reject'; actorId: UserId; actorRole: Role }
  | { type: 'cancel' }
  | { type: 'execute' }

const legalTransitions: Record<ChangeRequestState, readonly ChangeRequestEvent['type'][]> = {
  draft: ['submit', 'cancel'],
  pending: ['approve', 'reject', 'cancel'],
  approved: ['execute', 'cancel'],
  rejected: [],
  cancelled: [],
  executed: [],
}

export class InvalidChangeRequestTransition extends Error {}

export function transitionChangeRequest<T>(request: ChangeRequest<T>, event: ChangeRequestEvent): ChangeRequest<T> {
  if (!legalTransitions[request.state].includes(event.type)) {
    throw new InvalidChangeRequestTransition(`${request.state} cannot handle ${event.type}`)
  }
  if (event.type === 'approve' || event.type === 'reject') {
    if (event.actorRole !== 'owner' && event.actorRole !== 'admin') {
      throw new InvalidChangeRequestTransition('reviewer lacks review capability')
    }
    if (event.actorId === request.proposerId) {
      throw new InvalidChangeRequestTransition('proposer cannot review their own change')
    }
    return { ...request, state: event.type === 'approve' ? 'approved' : 'rejected', reviewerId: event.actorId }
  }
  const next: Record<Exclude<ChangeRequestEvent['type'], 'approve' | 'reject'>, ChangeRequestState> = {
    submit: 'pending', cancel: 'cancelled', execute: 'executed',
  }
  return { ...request, state: next[event.type] }
}

export function isLegalTransition(state: ChangeRequestState, event: ChangeRequestEvent['type']): boolean {
  return legalTransitions[state].includes(event)
}
