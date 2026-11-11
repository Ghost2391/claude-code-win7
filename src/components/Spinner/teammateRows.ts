type TeammateRow = {
  id: string
  isIdle: boolean
  error?: string
  awaitingPlanApproval: boolean
}

export function selectTeammateRows<T extends TeammateRow>(
  teammates: readonly T[],
  selecting: boolean,
  viewingId?: string,
  hideIdle = false,
): { rows: { teammate: T; originalIndex: number }[]; hiddenCount: number } {
  let idleCount = 0
  let hiddenCount = 0
  const rows: { teammate: T; originalIndex: number }[] = []
  teammates.forEach((teammate, originalIndex) => {
    const collapsible =
      teammate.isIdle &&
      !teammate.error &&
      !teammate.awaitingPlanApproval &&
      teammate.id !== viewingId
    if (!selecting && collapsible && (hideIdle || idleCount >= 3)) {
      hiddenCount++
      return
    }
    if (collapsible) idleCount++
    rows.push({ teammate, originalIndex })
  })
  return { rows, hiddenCount }
}
