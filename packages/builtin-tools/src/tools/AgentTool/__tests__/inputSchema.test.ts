import { describe, expect, mock, test } from 'bun:test'

mock.module('bun:bundle', () => ({ feature: () => false }))

const { inputSchema } = await import('../AgentTool.js')

describe('AgentTool input schema model override', () => {
  test('accepts a configured custom model name', () => {
    const parsed = inputSchema().safeParse({
      description: 'Verify work',
      prompt: 'Verify the implementation',
      subagent_type: 'verification',
      model: 'deepseek-reasoner',
    })

    expect(parsed.success).toBe(true)
  })
})
