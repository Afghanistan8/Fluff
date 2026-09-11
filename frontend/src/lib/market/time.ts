/**
 * GMT+1 window formatting.
 *
 * Fluff runs on a fixed UTC+1 clock all year. That is deliberately not a named zone:
 * `Europe/Paris` shifts an hour in summer and would relabel every historical window.
 * Shifting the instant by a constant hour and formatting in UTC gives the GMT+1 wall
 * clock exactly, in every viewer's browser, forever.
 */

import { addSeconds, format } from 'date-fns'

export const WINDOW_SECONDS = 1800
export const GMT_PLUS_ONE_OFFSET_SECONDS = 3600
export const TIMEZONE_LABEL = 'GMT+1'

function toWallClock(epochSeconds: number): Date {
  return new Date((epochSeconds + GMT_PLUS_ONE_OFFSET_SECONDS) * 1000)
}

function formatWall(epochSeconds: number, pattern: string): string {
  const wall = toWallClock(epochSeconds)
  // The shifted instant is read in UTC so the browser's own zone never interferes.
  return format(
    new Date(
      wall.getUTCFullYear(),
      wall.getUTCMonth(),
      wall.getUTCDate(),
      wall.getUTCHours(),
      wall.getUTCMinutes(),
      wall.getUTCSeconds(),
    ),
    pattern,
  )
}

/** "Fri 11 Sep 14:00–14:30 GMT+1" */
export function formatWindow(startEpoch: number): string {
  const endEpoch = startEpoch + WINDOW_SECONDS
  return `${formatWall(startEpoch, 'EEE d MMM HH:mm')}–${formatWall(endEpoch, 'HH:mm')} ${TIMEZONE_LABEL}`
}

/** "14:00–14:30" for tight spaces where the date is already on screen. */
export function formatWindowTimes(startEpoch: number): string {
  return `${formatWall(startEpoch, 'HH:mm')}–${formatWall(startEpoch + WINDOW_SECONDS, 'HH:mm')}`
}

/** "Fri 11 Sep" */
export function formatWindowDate(startEpoch: number): string {
  return formatWall(startEpoch, 'EEE d MMM')
}

/** "11 Sep 2026, 14:00 GMT+1" for timestamps that are not windows. */
export function formatMoment(epochSeconds: number): string {
  return `${formatWall(epochSeconds, 'd MMM yyyy, HH:mm')} ${TIMEZONE_LABEL}`
}

export function formatDayHeading(startEpoch: number): string {
  return formatWall(startEpoch, 'EEEE d MMMM')
}

/** True when two windows fall on the same GMT+1 calendar day. */
export function sameWallDay(a: number, b: number): boolean {
  return formatWall(a, 'yyyy-MM-dd') === formatWall(b, 'yyyy-MM-dd')
}

/**
 * Round an instant up to the next GMT+1 half-hour boundary.
 *
 * The offset is a whole number of half hours, so this lands on :00 or :30 of both the
 * GMT+1 and the UTC clock. The offset stays in the arithmetic because the rule is about
 * the GMT+1 wall clock, and writing it out keeps that visible.
 */
export function nextAlignedStart(epochSeconds: number): number {
  const shifted = epochSeconds + GMT_PLUS_ONE_OFFSET_SECONDS
  const remainder = ((shifted % WINDOW_SECONDS) + WINDOW_SECONDS) % WINDOW_SECONDS
  const rounded = shifted - remainder + WINDOW_SECONDS
  return rounded - GMT_PLUS_ONE_OFFSET_SECONDS
}

export function isAlignedStart(epochSeconds: number): boolean {
  return (epochSeconds + GMT_PLUS_ONE_OFFSET_SECONDS) % WINDOW_SECONDS === 0
}

/** The next `count` bettable windows, starting from the first one after `from`. */
export function upcomingSlots(from: number, count: number): number[] {
  const first = nextAlignedStart(from)
  return Array.from({ length: count }, (_, index) => first + index * WINDOW_SECONDS)
}

/** "4h 12m 08s", "12m 08s", "08s" — the leading unit is dropped once it is zero. */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(rest).padStart(2, '0')}s`
  if (minutes > 0) return `${minutes}m ${String(rest).padStart(2, '0')}s`
  return `${rest}s`
}

/** "3 minutes ago", "in 2 hours" — for activity feeds, never for protocol decisions. */
export function formatRelative(epochSeconds: number, now: number): string {
  const delta = epochSeconds - now
  const magnitude = Math.abs(delta)
  const units: [number, string][] = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ]
  for (const [size, name] of units) {
    if (magnitude >= size) {
      const count = Math.floor(magnitude / size)
      const plural = count === 1 ? name : `${name}s`
      return delta < 0 ? `${count} ${plural} ago` : `in ${count} ${plural}`
    }
  }
  return delta < 0 ? 'just now' : 'in a moment'
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/** Seconds to add to the browser clock to sit on the chain's clock. */
export function clockSkew(chainNow: number, localNow: number): number {
  return chainNow - localNow
}

export function addWindows(startEpoch: number, windows: number): number {
  return addSeconds(new Date(startEpoch * 1000), windows * WINDOW_SECONDS).getTime() / 1000
}
