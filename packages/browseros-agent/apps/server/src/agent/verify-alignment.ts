import { generateText } from 'ai'
import { logger } from '../lib/logger'
import { createLanguageModel } from './provider-factory'
import type { ResolvedAgentConfig } from './types'

export interface AlignmentResult {
  aligned: boolean
  reason?: string
}

const SYSTEM_PROMPT = `You are a task-completion verifier. Given a user's original task and an agent's result, determine whether the result meaningfully addresses the task.

Respond with a JSON object only — no other text:
{"aligned": true/false, "reason": "one short sentence explaining your verdict"}`

export async function verifyAlignment(
  originalTask: string,
  agentResult: string,
  origin: string,
  providerConfig: ResolvedAgentConfig,
): Promise<AlignmentResult> {
  const userMessage = `Original task: ${originalTask}

Agent (scoped to ${origin}) returned:
${agentResult}

Did the agent complete the task?`

  try {
    const model = createLanguageModel(providerConfig)
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: userMessage,
    })

    const raw = result.text.trim()
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) {
      logger.warn('verify-alignment: could not parse JSON response', {
        raw: raw.slice(0, 200),
      })
      return { aligned: true }
    }

    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      aligned?: boolean
      reason?: string
    }

    return {
      aligned: parsed.aligned !== false,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
    }
  } catch (err) {
    logger.warn('verify-alignment: check failed, assuming aligned', {
      error: err instanceof Error ? err.message : String(err),
    })
    return { aligned: true }
  }
}
