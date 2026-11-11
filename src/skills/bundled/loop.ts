import { join } from 'node:path'
import {
  DEFAULT_MAX_AGE_DAYS,
  isKairosCronEnabled,
} from '@claude-code-best/builtin-tools/tools/ScheduleCronTool/prompt.js'
import { getCwd } from '../../utils/cwd.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { registerBundledSkill } from '../bundledSkills.js'
import { buildLoopPrompt } from './loopPrompt.js'

export function registerLoopSkill(): void {
  registerBundledSkill({
    name: 'loop',
    description:
      'Repeat a task at a fixed or dynamically chosen interval; defaults to project maintenance',
    whenToUse:
      'When the user requests recurring work or polling. Do not invoke for one-off tasks.',
    argumentHint: '[interval] [prompt]',
    userInvocable: true,
    isEnabled: isKairosCronEnabled,
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: buildLoopPrompt(
            args,
            [
              join(getCwd(), '.claude', 'loop.md'),
              join(getClaudeConfigHomeDir(), 'loop.md'),
            ],
            DEFAULT_MAX_AGE_DAYS,
          ),
        },
      ]
    },
  })
}
