import { normalizeProfile } from './normalize'
import type { GbpLocationProfile, ProfileInput } from './types'

export const serializeProfileSnapshot = (profile: ProfileInput): string => JSON.stringify(normalizeProfile(profile))
/** Stable UTF-8 input suitable for a caller-selected cryptographic hash. */
export const profileSnapshotHashInput = (profile: ProfileInput): Uint8Array => new TextEncoder().encode(serializeProfileSnapshot(profile))
export const parseProfileSnapshot = (snapshot: string): GbpLocationProfile => normalizeProfile(JSON.parse(snapshot) as ProfileInput)
