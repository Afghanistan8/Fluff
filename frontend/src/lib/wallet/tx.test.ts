import { describe, expect, it, vi } from 'vitest'

import {
  cleanReason,
  isRetryableError,
  isWaitTimeout,
  TxTimeoutError,
  readableError,
  receiptFailureReason,
  receiptSucceeded,
  runTransaction,
  withRetry,
  type TxState,
} from './tx'

const successReceipt = {
  consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }] },
}

const failureReceipt = {
  consensus_data: {
    leader_receipt: [
      {
        execution_result: 'ERROR',
        genvm_result: { stderr: "FluffError('betting closed for this window')" },
      },
    ],
  },
}

describe('receiptSucceeded', () => {
  it('accepts a leader receipt that says SUCCESS', () => {
    expect(receiptSucceeded(successReceipt)).toBe(true)
  })

  it('rejects a leader receipt that says anything else', () => {
    expect(receiptSucceeded(failureReceipt)).toBe(false)
  })

  it('falls back to the top-level execution result', () => {
    expect(receiptSucceeded({ txExecutionResultName: 'SUCCESS' })).toBe(true)
    expect(receiptSucceeded({ txExecutionResultName: 'ERROR' })).toBe(false)
  })

  it('treats an unreadable receipt as unsuccessful rather than assuming', () => {
    expect(receiptSucceeded(null)).toBe(false)
    expect(receiptSucceeded({})).toBe(false)
    expect(receiptSucceeded('ok')).toBe(false)
  })
})

describe('receiptFailureReason', () => {
  it('surfaces the contract revert text', () => {
    expect(receiptFailureReason(failureReceipt)).toBe('Betting closed for this window.')
  })

  it('falls back to the transaction status', () => {
    expect(receiptFailureReason({ statusName: 'CANCELED' })).toBe(
      'The transaction ended as CANCELED.',
    )
  })
})

describe('cleanReason', () => {
  it('unwraps the contract error class', () => {
    expect(cleanReason("FluffError('minimum bet is 1 GEN')")).toBe('Minimum bet is 1 GEN.')
  })

  it('unwraps an EVM-style revert string', () => {
    expect(cleanReason('execution reverted: market already exists for this window')).toBe(
      'Market already exists for this window.',
    )
  })

  it('keeps only the first line of a stack', () => {
    expect(cleanReason('something broke\n  at frame one\n  at frame two')).toBe(
      'Something broke.',
    )
  })
})

describe('readableError', () => {
  it('names a wallet rejection plainly', () => {
    const rejection = Object.assign(new Error('User denied'), { code: 4001 })
    expect(readableError(rejection)).toBe('You rejected the request in your wallet.')
  })

  it('prefers a short message when one is present', () => {
    const error = Object.assign(new Error('long'), { shortMessage: 'insufficient funds' })
    expect(readableError(error)).toBe('Insufficient funds.')
  })

  it('handles a plain object with a reason', () => {
    expect(readableError({ reason: 'nonce too low' })).toBe('Nonce too low.')
  })

  it('never returns an empty string', () => {
    expect(readableError(undefined)).not.toBe('')
    expect(readableError(new Error(''))).not.toBe('')
  })
})

describe('runTransaction', () => {
  const noSleep = async (): Promise<void> => {}

  it('walks submitting, confirming and success in order', async () => {
    const phases: TxState['phase'][] = []
    await runTransaction({
      label: 'Bet on SOL',
      submit: async () => '0xhash',
      confirm: async () => successReceipt,
      onPhase: (state) => phases.push(state.phase),
    })
    expect(phases).toEqual(['submitting', 'confirming', 'success'])
  })

  it('carries the label through every phase', async () => {
    const labels: (string | null)[] = []
    await runTransaction({
      label: 'Claim winnings',
      submit: async () => '0xhash',
      confirm: async () => successReceipt,
      onPhase: (state) => labels.push(state.label),
    })
    expect(new Set(labels)).toEqual(new Set(['Claim winnings']))
  })

  it('fails without confirming when the wallet refuses', async () => {
    const phases: TxState['phase'][] = []
    const confirm = vi.fn()
    await expect(
      runTransaction({
        label: 'Bet on SOL',
        submit: async () => {
          throw Object.assign(new Error('User denied'), { code: 4001 })
        },
        confirm,
        onPhase: (state) => phases.push(state.phase),
      }),
    ).rejects.toThrow('You rejected the request in your wallet.')
    expect(phases).toEqual(['submitting', 'failure'])
    expect(confirm).not.toHaveBeenCalled()
  })

  it('fails when the receipt confirms but reports an execution error', async () => {
    const phases: TxState['phase'][] = []
    await expect(
      runTransaction({
        label: 'Bet on SOL',
        submit: async () => '0xhash',
        confirm: async () => failureReceipt,
        onPhase: (state) => phases.push(state.phase),
      }),
    ).rejects.toThrow('Betting closed for this window.')
    expect(phases).toEqual(['submitting', 'confirming', 'failure'])
  })

  it('reports the hash as soon as it has one, even on a later failure', async () => {
    const states: TxState[] = []
    await expect(
      runTransaction({
        label: 'Settle',
        submit: async () => '0xabc',
        confirm: async () => {
          throw new Error('node timed out')
        },
        onPhase: (state) => states.push(state),
      }),
    ).rejects.toThrow()
    expect(states.at(-1)?.hash).toBe('0xabc')
  })

  it('never treats an unreadable receipt as success', async () => {
    await expect(
      runTransaction({
        label: 'Claim',
        submit: async () => '0xhash',
        confirm: async () => ({}),
        onPhase: noSleep,
      }),
    ).rejects.toThrow()
  })
})

describe('withRetry', () => {
  const instant = async (): Promise<void> => {}

  it('returns the first successful result without retrying', async () => {
    const operation = vi.fn(async () => 'ok')
    expect(await withRetry(operation, { sleep: instant })).toBe('ok')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('retries a transient failure and then succeeds', async () => {
    let calls = 0
    const result = await withRetry(
      async () => {
        calls += 1
        if (calls < 3) throw new Error('network hiccup')
        return 'recovered'
      },
      { sleep: instant },
    )
    expect(result).toBe('recovered')
    expect(calls).toBe(3)
  })

  it('gives up after the attempt budget and rethrows the last error', async () => {
    const operation = vi.fn(async () => {
      throw new Error('still down')
    })
    await expect(withRetry(operation, { attempts: 3, sleep: instant })).rejects.toThrow('still down')
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('does not retry an error that will fail the same way again', async () => {
    const operation = vi.fn(async () => {
      throw new Error('unknown market')
    })
    await expect(withRetry(operation, { sleep: instant })).rejects.toThrow('unknown market')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('backs off further on each attempt', async () => {
    const delays: number[] = []
    await expect(
      withRetry(
        async () => {
          throw new Error('flaky')
        },
        {
          attempts: 4,
          baseDelayMs: 100,
          sleep: async (ms) => {
            delays.push(ms)
          },
        },
      ),
    ).rejects.toThrow()
    expect(delays).toEqual([100, 200, 400])
  })

  it('respects the maximum delay', async () => {
    const delays: number[] = []
    await expect(
      withRetry(
        async () => {
          throw new Error('flaky')
        },
        {
          attempts: 4,
          baseDelayMs: 1000,
          maxDelayMs: 1500,
          sleep: async (ms) => {
            delays.push(ms)
          },
        },
      ),
    ).rejects.toThrow()
    expect(delays).toEqual([1000, 1500, 1500])
  })
})

describe('isRetryableError', () => {
  it('retries network-shaped failures', () => {
    expect(isRetryableError(new Error('fetch failed'))).toBe(true)
    expect(isRetryableError(new Error('504 gateway timeout'))).toBe(true)
  })

  it('does not retry a rejection, a bad shape or a missing market', () => {
    expect(isRetryableError(new Error('User rejected the request'))).toBe(false)
    expect(isRetryableError(new Error('unknown market'))).toBe(false)
    expect(isRetryableError(new Error('market: expected an object, got null'))).toBe(false)
  })
})

describe('timeout is not failure', () => {
  const slowReceipt = async (): Promise<never> => {
    throw new Error('Timed out while waiting for transaction with hash "0xabc" to be confirmed.')
  }

  it('classifies a receipt timeout separately from a refusal', () => {
    expect(isWaitTimeout(new Error('Timed out while waiting for transaction'))).toBe(true)
    expect(isWaitTimeout(new Error('WaitForTransactionReceiptTimeoutError'))).toBe(true)
    expect(isWaitTimeout(new Error('execution reverted: betting closed'))).toBe(false)
  })

  it('reports success when the effect landed despite no receipt', async () => {
    const phases: TxState['phase'][] = []
    await runTransaction({
      label: 'Settle this window',
      submit: async () => '0xabc',
      confirm: slowReceipt,
      verify: async () => true,
      onPhase: (state) => phases.push(state.phase),
    })
    expect(phases).toEqual(['submitting', 'confirming', 'success'])
  })

  it('reports a timeout, not a failure, when the effect has not landed yet', async () => {
    const phases: TxState['phase'][] = []
    await expect(
      runTransaction({
        label: 'Settle this window',
        submit: async () => '0xabc',
        confirm: slowReceipt,
        verify: async () => false,
        onPhase: (state) => phases.push(state.phase),
      }),
    ).rejects.toBeInstanceOf(TxTimeoutError)
    expect(phases).toEqual(['submitting', 'confirming', 'timeout'])
  })

  it('keeps the hash on a timeout so the transaction can still be followed', async () => {
    const states: TxState[] = []
    await expect(
      runTransaction({
        label: 'Settle',
        submit: async () => '0xdeadbeef',
        confirm: slowReceipt,
        onPhase: (state) => states.push(state),
      }),
    ).rejects.toBeInstanceOf(TxTimeoutError)
    expect(states.at(-1)?.phase).toBe('timeout')
    expect(states.at(-1)?.hash).toBe('0xdeadbeef')
  })

  it('still reports a real revert as a failure', async () => {
    const phases: TxState['phase'][] = []
    await expect(
      runTransaction({
        label: 'Bet on SOL',
        submit: async () => '0xabc',
        confirm: async () => {
          throw new Error('execution reverted: betting closed for this window')
        },
        verify: async () => true,
        onPhase: (state) => phases.push(state.phase),
      }),
    ).rejects.toThrow('Betting closed for this window.')
    expect(phases).toEqual(['submitting', 'confirming', 'failure'])
  })
})
