import { describe, expect, test } from 'bun:test'
import { buildLoopPrompt, parseLoopInput } from '../loopPrompt.js'

describe('parseLoopInput', () => {
  test('distinguishes explicit intervals from prompt words', () => {
    expect(parseLoopInput('5m check CI')).toEqual({
      interval: '5m',
      prompt: 'check CI',
    })
    expect(parseLoopInput('check CI every 2 hours')).toEqual({
      interval: '2h',
      prompt: 'check CI',
    })
    expect(parseLoopInput('check every PR')).toEqual({
      prompt: 'check every PR',
    })
    expect(parseLoopInput('15m')).toEqual({ interval: '15m', prompt: '' })
    expect(parseLoopInput('')).toEqual({ prompt: '' })
  })
})

describe('buildLoopPrompt', () => {
  const paths = ['/project/.claude/loop.md', '/home/.claude/loop.md']
  test('uses live default files only when no explicit prompt is given', () => {
    expect(buildLoopPrompt('', paths, 7, 0)).toContain(JSON.stringify(paths))
    expect(buildLoopPrompt('15m', paths, 7, 0)).toContain('on EVERY iteration')
    expect(buildLoopPrompt('5m check CI', paths, 7, 0)).not.toContain(
      '/project/',
    )
  })
  test('self-paced tasks retain one expiry and use one-shot scheduling', () => {
    const result = buildLoopPrompt('check CI', paths, 7, 0)
    expect(result).toContain('1970-01-08T00:00:00.000Z')
    expect(result).toContain('recurring:false')
    expect(result).toContain('1 to 60 minutes')
    expect(result).toContain('preserving the original expiry')
  })
  test('fixed intervals do not create a second dynamic schedule', () => {
    const result = buildLoopPrompt('5m check CI', paths, 7, 0)
    expect(result).toContain('interval 5m')
    expect(result).not.toContain('recurring:false')
    expect(result).toContain('execute the task once immediately')
  })
  test('rejects a zero interval', () => {
    expect(buildLoopPrompt('0m check CI', paths, 7)).toContain(
      'Do not schedule',
    )
  })
})
