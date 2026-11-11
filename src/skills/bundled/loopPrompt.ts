export const LOOP_MAINTENANCE_PROMPT =
  'Continue unfinished work from this conversation. Then check the current branch pull request for review comments, failed CI, and merge conflicts. If nothing is pending, look for a small useful bug fix or simplification. Respect existing permissions and user instructions.'

export function parseLoopInput(args: string): {
  interval?: string
  prompt: string
} {
  const trimmed = args.trim()
  const leading = /^(\d+[smhd])(?:\s+|$)/i.exec(trimmed)
  if (leading) {
    return {
      interval: leading[1]!.toLowerCase(),
      prompt: trimmed.slice(leading[0].length).trim(),
    }
  }
  const trailing =
    /(?:^|\s+)every\s+(\d+)\s*(s|m|h|d|seconds?|minutes?|hours?|days?)$/i.exec(
      trimmed,
    )
  if (trailing) {
    return {
      interval: `${trailing[1]}${trailing[2]![0]!.toLowerCase()}`,
      prompt: trimmed.slice(0, trailing.index).trim(),
    }
  }
  return { prompt: trimmed }
}

export function buildLoopPrompt(
  args: string,
  defaultPaths: string[],
  maxAgeDays: number,
  now = Date.now(),
): string {
  const { interval, prompt } = parseLoopInput(args)
  if (interval && Number.parseInt(interval, 10) <= 0) {
    return 'The loop interval must be greater than zero. Do not schedule a task.'
  }
  const task =
    prompt ||
    `Read the first existing file in this ordered list using the file-reading tool, on EVERY iteration: ${JSON.stringify(defaultPaths)}. Use its first 25,000 bytes as the task instructions. Do not read the user file if the project file exists. If neither exists, use: ${LOOP_MAINTENANCE_PROMPT}`
  const expiresAt =
    maxAgeDays > 0
      ? new Date(now + maxAgeDays * 86_400_000).toISOString()
      : null
  const iteration = `Loop task: ${task}
Use normal permissions. Invoke slash commands only if they are model-invocable skills allowed in this session; do not bypass disabled skills or permission rules.
${interval ? '' : `This is a self-paced loop. After executing the task, choose a delay of 1 to 60 minutes based on the result. Stop if the user cancelled, the task is complete, or the expiry ${expiresAt ?? '(none)'} has been reached. Otherwise create exactly one CronCreate task with recurring:false and durable:false. Use local minute, hour, day-of-month and month for the chosen future time, with weekday *. Its prompt must be an exact copy of this entire loop task instruction, preserving the original expiry (do not nest or extend it). Report the next delay, reason, and new job ID. Do not use sleep or start a blocking polling loop.`}`
  return `# /loop

${
  interval
    ? `Create one recurring CronCreate task with durable:false for interval ${interval}. Convert seconds to whole minutes rounded up. Round intervals that do not divide a cron unit cleanly to a supported interval and explain the rounding. Use the loop task below as its prompt. Confirm the job ID, cadence, and ${maxAgeDays > 0 ? `${maxAgeDays}-day expiry` : 'no automatic expiry'}. Then execute the task once immediately without creating another recurring task.`
    : 'Execute the loop task below now, then follow its one-shot rescheduling instructions. Do not create a fixed recurring task.'
}
Cancel a pending job with CronDelete; list jobs with CronList. Cancellation uses these tools, not a promise that Escape cancels the scheduler.

${iteration}`
}
