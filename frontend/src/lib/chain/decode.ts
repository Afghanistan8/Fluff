/**
 * Typed readers for contract return values.
 *
 * Calldata arrives as a loose union, so every field is pulled out through a reader that
 * states what it expects and throws with the path when the shape is wrong. That keeps
 * `any` out of the adapter and turns a contract change into a legible error rather than
 * a silent `undefined` somewhere in the UI.
 */

export class DecodeError extends Error {
  constructor(path: string, expected: string, got: unknown) {
    super(`${path}: expected ${expected}, got ${describe(got)}`)
    this.name = 'DecodeError'
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `array(${value.length})`
  if (value instanceof Map) return 'map'
  return typeof value
}

export type Unknown = unknown

export function asRecord(value: unknown, path: string): Record<string, unknown> {
  // The client hands dictionaries back as either a Map or a plain object.
  if (value instanceof Map) return Object.fromEntries(value) as Record<string, unknown>
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new DecodeError(path, 'an object', value)
}

export function asArray(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value
  throw new DecodeError(path, 'an array', value)
}

export function field(source: Record<string, unknown>, key: string, path: string): unknown {
  if (!(key in source)) throw new DecodeError(`${path}.${key}`, 'a value', undefined)
  return source[key]
}

export function asString(value: unknown, path: string): string {
  if (typeof value === 'string') return value
  throw new DecodeError(path, 'a string', value)
}

export function asBoolean(value: unknown, path: string): boolean {
  if (typeof value === 'boolean') return value
  throw new DecodeError(path, 'a boolean', value)
}

/** Integers may arrive as `number` or `bigint`; base units always become `bigint`. */
export function asBigInt(value: unknown, path: string): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value)
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value)
  throw new DecodeError(path, 'an integer', value)
}

/** For counts and timestamps, which are small enough to live in a JS number. */
export function asNumber(value: unknown, path: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value)
  throw new DecodeError(path, 'a number', value)
}

/** Addresses come back as a string or as a byte array, depending on the call path. */
export function asAddress(value: unknown, path: string): string {
  if (typeof value === 'string') return value.toLowerCase()
  if (value instanceof Uint8Array) {
    return `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }
  throw new DecodeError(path, 'an address', value)
}

export function readString(source: Record<string, unknown>, key: string, path: string): string {
  return asString(field(source, key, path), `${path}.${key}`)
}

export function readBigInt(source: Record<string, unknown>, key: string, path: string): bigint {
  return asBigInt(field(source, key, path), `${path}.${key}`)
}

export function readNumber(source: Record<string, unknown>, key: string, path: string): number {
  return asNumber(field(source, key, path), `${path}.${key}`)
}

export function readBoolean(source: Record<string, unknown>, key: string, path: string): boolean {
  return asBoolean(field(source, key, path), `${path}.${key}`)
}

export function readAddress(source: Record<string, unknown>, key: string, path: string): string {
  return asAddress(field(source, key, path), `${path}.${key}`)
}

export function readRecord(
  source: Record<string, unknown>,
  key: string,
  path: string,
): Record<string, unknown> {
  return asRecord(field(source, key, path), `${path}.${key}`)
}

/** A one-of check against a closed set, so bad enum values fail loudly. */
export function readMember<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
): T {
  const raw = readString(source, key, path)
  if ((allowed as readonly string[]).includes(raw)) return raw as T
  throw new DecodeError(`${path}.${key}`, `one of ${allowed.join(', ')}`, raw)
}

/** Like `readMember`, but an empty string means "not set yet" rather than an error. */
export function readOptionalMember<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
): T | null {
  const raw = readString(source, key, path)
  if (raw === '') return null
  if ((allowed as readonly string[]).includes(raw)) return raw as T
  throw new DecodeError(`${path}.${key}`, `one of ${allowed.join(', ')} or empty`, raw)
}
