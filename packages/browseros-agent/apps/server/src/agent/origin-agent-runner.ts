import { AGENT_LIMITS } from '@browseros/shared/constants/limits'
import { stepCountIs, ToolLoopAgent } from 'ai'
import { logger } from '../lib/logger'
import type { ToolContext } from '../tools/framework'
import { buildBrowserToolSet } from '../tools/tool-adapter'
import type { ToolRegistry } from '../tools/tool-registry'
import { buildOriginAgentSystemPrompt } from './prompt'
import { createLanguageModel } from './provider-factory'
import type { ResolvedAgentConfig } from './types'

export interface OriginAgentResult {
  summary: string
  success: boolean
}

export interface OriginAgentRunnerConfig {
  origin: string
  task: string
  context?: string
  /** Inherited from the coordinator's session. */
  providerConfig: ResolvedAgentConfig
  browser: ToolContext['browser']
  registry: ToolRegistry
  abortSignal?: AbortSignal
}

export async function runOriginAgent(
  config: OriginAgentRunnerConfig,
): Promise<OriginAgentResult> {
  const { origin, task, context, providerConfig, browser, registry } = config

  // Acquire a Chromium-level origin scope token.
  // This causes the browser process itself to enforce origin matching in
  // Target.attachToTarget — before any CDP session is created, before any
  // content reaches the agent. Works in tandem with the TypeScript-level
  // assignedOrigin check (defense-in-depth).
  let agentOriginScopeToken: string | undefined
  try {
    agentOriginScopeToken = await browser.createAgentOriginScope(origin)
    logger.info('Origin agent: Chromium scope token acquired', {
      origin,
      scopeToken: agentOriginScopeToken,
    })
  } catch (err) {
    // Chromium patch may not be built yet — fall back to TypeScript-only enforcement.
    logger.warn(
      'Origin agent: could not acquire Chromium scope token (patch not active?)',
      {
        origin,
        error: err instanceof Error ? err.message : String(err),
      },
    )
  }

  const toolCtx: ToolContext = {
    browser,
    directories: { workingDir: providerConfig.workingDir },
    assignedOrigin: origin,
    agentOriginScopeToken,
  }

  const browserTools = buildBrowserToolSet(registry, toolCtx)

  const model = createLanguageModel(providerConfig)
  const instructions = buildOriginAgentSystemPrompt(origin)

  const agent = new ToolLoopAgent({
    model,
    instructions,
    tools: browserTools,
    stopWhen: [stepCountIs(AGENT_LIMITS.MAX_TURNS)],
  })

  const userMessage = context
    ? `${task}\n\nContext from previous steps:\n${context}`
    : task

  logger.info('Origin agent starting', { origin, task })

  try {
    const result = await agent.generate({
      prompt: userMessage,
      abortSignal: config.abortSignal,
    })

    const summary =
      result.text?.trim() || 'Task completed (no summary returned).'
    logger.info('Origin agent completed', {
      origin,
      summary: summary.slice(0, 120),
    })

    return { summary, success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Origin agent failed', { origin, error: message })
    return {
      summary: `Agent for ${origin} failed: ${message}`,
      success: false,
    }
  } finally {
    if (agentOriginScopeToken) {
      await browser.revokeAgentOriginScope(agentOriginScopeToken)
    }
  }
}
