import type { JsonValue } from './types'

export type DiffKind = 'add' | 'remove' | 'change'
export type ProfileDifference =
  | { readonly kind: 'add'; readonly path: string; readonly after: JsonValue }
  | { readonly kind: 'remove'; readonly path: string; readonly before: JsonValue }
  | { readonly kind: 'change'; readonly path: string; readonly before: JsonValue; readonly after: JsonValue }
const isObject = (value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } => value !== null && typeof value === 'object' && !Array.isArray(value)

export const diffProfileValues = (before: JsonValue, after: JsonValue): readonly ProfileDifference[] => {
  const differences: ProfileDifference[] = []
  const visit = (left: JsonValue | undefined, right: JsonValue | undefined, path: string): void => {
    if (left === undefined) { if (right !== undefined) differences.push({ kind: 'add', path, after: right }); return }
    if (right === undefined) { differences.push({ kind: 'remove', path, before: left }); return }
    if (isObject(left) && isObject(right)) { for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) visit(left[key], right[key], `${path}/${key}`); return }
    if (Array.isArray(left) && Array.isArray(right)) { const length = Math.max(left.length, right.length); for (let index = 0; index < length; index += 1) visit(left[index], right[index], `${path}/${index}`); return }
    if (JSON.stringify(left) !== JSON.stringify(right)) differences.push({ kind: 'change', path: path || '/', before: left, after: right })
  }
  visit(before, after, '')
  return differences
}
