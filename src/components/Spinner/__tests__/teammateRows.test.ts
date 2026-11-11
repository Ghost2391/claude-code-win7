import { describe, expect, test } from 'bun:test'
import { selectTeammateRows } from '../teammateRows.js'

describe('selectTeammateRows', () => {
  const tasks = Array.from({ length: 6 }, (_, index) => ({
    id: String(index),
    isIdle: true,
    awaitingPlanApproval: false,
  }))

  test('collapses surplus idle agents while retaining original indices', () => {
    const result = selectTeammateRows(tasks, false, '5')
    expect(result.rows.map(row => row.originalIndex)).toEqual([0, 1, 2, 5])
    expect(result.hiddenCount).toBe(2)
  })

  test('selection expands all agents even after the idle timeout', () => {
    const result = selectTeammateRows(tasks, true, undefined, true)
    expect(result.rows.map(row => row.originalIndex)).toEqual([
      0, 1, 2, 3, 4, 5,
    ])
    expect(result.hiddenCount).toBe(0)
  })

  test('never hides working, viewed, failed or approval-waiting rows', () => {
    const result = selectTeammateRows(
      [
        ...tasks,
        { id: 'working', isIdle: false, awaitingPlanApproval: false },
        {
          id: 'failed',
          isIdle: true,
          error: 'failed',
          awaitingPlanApproval: false,
        },
        { id: 'approval', isIdle: true, awaitingPlanApproval: true },
      ],
      false,
      '5',
      true,
    )
    expect(result.rows.map(row => row.teammate.id)).toEqual([
      '5',
      'working',
      'failed',
      'approval',
    ])
    expect(result.hiddenCount).toBe(5)
  })
})
