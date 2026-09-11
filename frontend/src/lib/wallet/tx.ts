/**
 * Transaction lifecycle.
 *
 * One runner for every write: submit, wait, read the receipt, and report exactly what
 * the chain said. Nothing is treated as done before the receipt confirms it, so the UI
 * can never show an optimistic result that the chain later refuses.
 */

export type TxPhase =
  | 'idle'
  | 'submitting'
  | 'confirming'
  | 'success'
  | 'failure'
  /** Submitted and still running. Not a failure: the chain may still accept it. */
  | 'timeout'

export interface TxState {
  phase: TxPhase
  hash: string | null
  error: string | null
  /** What the caller was trying to do, used for the dialog heading. */
  label: string | null
}

export const IDLE_TX: TxState = { phase: 'idle', hash: null, error: null, label: null }

export const TX_PHASE_COPY: Record<TxPhase, string> = {
  idle: '',
  submitting: 'Waiting for your wallet',
  confirming: 'Waiting for validators',
  success: 'Confirmed',
  failure: 'Did not go through',
  timeout: 'Still running. Validators are taking longer than usual.',
}

/** Thrown when the receipt never arrived. The transaction may still be in flight. */
export class TxTimeoutError extends Error {
  readonly hash: string

  constructor(hash: string) {
    super('Timed out waiting for the receipt. The transaction may still be running.')
    this.name = 'TxTimeoutError'
    this.hash = hash
  }
}

/** Did this failure mean "no receipt yet" rather than "the chain refused it"? */
export function isWaitTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /timed out|timeout|WaitForTransactionReceipt/i.test(message)
}

/**
 * Pull a readable reason out of whatever the client threw.
 *
 * Wallet rejections, RPC errors and contract reverts all arrive shaped differently, so
 * this walks the likely places and falls back to the raw message rather than inventing
 * a friendlier one that might be wrong.
 */
export function readableError(error: unknown): string {
  if (typeof error === 'string') return cleanReason(error)
  if (error instanceof Error) {
    const withCode = error as Error & { code?: number | string; shortMessage?: string }
    if (withCode.code === 4001 || withCode.code === 'ACTION_REJECTED') {
      return 'You rejected the request in your wallet.'
    }
    if (typeof withCode.shortMessage === 'string' && withCode.shortMessage.length > 0) {
      return cleanReason(withCode.shortMessage)
    }
    return cleanReason(error.message)
  }
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>
    for (const key of ['shortMessage', 'message', 'reason', 'details']) {
      const value = record[key]
      if (typeof value === 'string' && value.length > 0) return cleanReason(value)
    }
  }
  return 'Something went wrong. Nothing was submitted.'
}

/** Strip the framing GenVM and wallets wrap around a contract's own revert text. */
export function cleanReason(raw: string): string {
  const patterns = [
    /FluffError\(['"]?(.+?)['"]?\)/,
    /Rollback[:\s]+(.+)/i,
    /execution reverted:?\s*(.+)/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(raw)
    if (match?.[1]) return sentence(match[1].trim())
  }
  return sentence(raw.split('\n')[0]?.trim() ?? raw)
}

function sentence(text: string): string {
  const trimmed = text.replace(/^['"]|['"]$/g, '').trim()
  if (trimmed.length === 0) return 'Something went wrong.'
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`
}

interface LeaderReceipt {
  execution_result?: string
  genvm_result?: { stdout?: string; stderr?: string }
}

interface ReceiptLike {
  consensus_data?: { leader_receipt?: LeaderReceipt[] }
  txExecutionResultName?: string
  statusName?: string
}

/** Mirrors the node's own success test: the leader receipt must say SUCCESS. */
export function receiptSucceeded(receipt: unknown): boolean {
  if (typeof receipt !== 'object' || receipt === null) return false
  const typed = receipt as ReceiptLike
  const leader = typed.consensus_data?.leader_receipt?.[0]
  if (leader?.execution_result) return leader.execution_result === 'SUCCESS'
  if (typed.txExecutionResultName) return typed.txExecutionResultName === 'SUCCESS'
  // Nothing in the receipt claims success, so do not assume it.
  return false
}

/** The contract's revert text, when the receipt carries one. */
export function receiptFailureReason(receipt: unknown): string {
  if (typeof receipt !== 'object' || receipt === null) return 'The transaction did not succeed.'
  const typed = receipt as ReceiptLike
  const leader = typed.consensus_data?.leader_receipt?.[0]
  const stderr = leader?.genvm_result?.stderr
  if (typeof stderr === 'string' && stderr.trim().length > 0) return cleanReason(stderr)
  if (typed.statusName) return `The transaction ended as ${typed.statusName}.`
  return 'The transaction did not succeed.'
}

export interface RunTxOptions {
  label: string
  submit: () => Promise<string>
  confirm: (hash: string) => Promise<unknown>
  onPhase?: (state: TxState) => void
  /**
   * Asks the chain whether the intended effect actually landed. Used when the receipt
   * never arrived, so a slow confirmation is not reported as a failure.
   */
  verify?: () => Promise<boolean>
}

/**
 * Submit, confirm, and resolve to the receipt, reporting each phase as it happens.
 * Throws with a readable message on any failure, including a receipt that confirms
 * but reports an execution error.
 */
export async function runTransaction(options: RunTxOptions): Promise<unknown> {
  const { label, submit, confirm, onPhase, verify } = options
  const report = (state: Omit<TxState, 'label'>): void => onPhase?.({ ...state, label })

  report({ phase: 'submitting', hash: null, error: null })
  let hash: string
  try {
    hash = await submit()
  } catch (error) {
    const message = readableError(error)
    report({ phase: 'failure', hash: null, error: message })
    throw new Error(message)
  }

  report({ phase: 'confirming', hash, error: null })
  let receipt: unknown
  try {
    receipt = await confirm(hash)
  } catch (error) {
    // A missing receipt is not a refusal. Ask the chain whether the effect landed
    // before telling anyone the transaction failed.
    if (isWaitTimeout(error)) {
      if (verify && (await verify().catch(() => false))) {
        report({ phase: 'success', hash, error: null })
        return null
      }
      report({ phase: 'timeout', hash, error: null })
      throw new TxTimeoutError(hash)
    }
    const message = readableError(error)
    report({ phase: 'failure', hash, error: message })
    throw new Error(message)
  }

  if (!receiptSucceeded(receipt)) {
    const message = receiptFailureReason(receipt)
    report({ phase: 'failure', hash, error: message })
    throw new Error(message)
  }

  report({ phase: 'success', hash, error: null })
  return receipt
}

/**
 * Retry a read that failed for a transient reason.
 *
 * Reads only. A write is never retried automatically: resubmitting a bet or a claim
 * because an RPC call timed out could place it twice.
 */
export interface RetryOptions {
  attempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  shouldRetry?: (error: unknown) => boolean
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/** A wrong argument or a revert will fail again the same way, so it is not retried. */
export function isRetryableError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  if (message.includes('rejected')) return false
  if (message.includes('not configured')) return false
  if (message.includes('unknown market')) return false
  if (message.includes('expected')) return false
  return true
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 300,
    maxDelayMs = 4000,
    sleep = defaultSleep,
    shouldRetry = isRetryableError,
  } = options

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error
      const isLast = attempt === attempts - 1
      if (isLast || !shouldRetry(error)) break
      await sleep(Math.min(baseDelayMs * 2 ** attempt, maxDelayMs))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(readableError(lastError))
}
