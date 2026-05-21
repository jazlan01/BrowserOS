import { z } from 'zod'
import { runOriginAgent } from '../agent/origin-agent-runner'
import { verifyAlignment } from '../agent/verify-alignment'
import { logger } from '../lib/logger'
import { defineTool } from './framework'

export const delegate_to_origin_agent = defineTool({
  name: 'delegate_to_origin_agent',
  approvalCategory: 'assistant',
  description:
    'Delegate a browser automation task to a sub-agent scoped exclusively to a given web origin (e.g. "https://mail.google.com"). The sub-agent can only read and interact with tabs from that origin. Results are verified against the original task before being returned.',
  input: z.object({
    origin: z
      .string()
      .describe(
        'The full web origin to scope the sub-agent to, e.g. "https://mail.google.com". Must include scheme and host.',
      ),
    task: z
      .string()
      .describe(
        'A self-contained description of what the sub-agent should do on that origin.',
      ),
    context: z
      .string()
      .optional()
      .describe(
        'Additional context from prior delegation steps that the sub-agent may need (plain-language summary only — never raw page content).',
      ),
  }),
  handler: async (args, ctx, response) => {
    if (!ctx.providerConfig || !ctx.registry) {
      response.error(
        'delegate_to_origin_agent is only available to coordinator agents (missing providerConfig or registry in context).',
      )
      return
    }

    // Validate origin format
    try {
      const parsed = new URL(args.origin)
      if (parsed.origin !== args.origin) {
        response.error(
          `Invalid origin "${args.origin}". Provide a full origin including scheme and host, e.g. "https://mail.google.com".`,
        )
        return
      }
    } catch {
      response.error(
        `Invalid origin "${args.origin}". Could not parse as a URL.`,
      )
      return
    }

    logger.info('Coordinator delegating to origin agent', {
      origin: args.origin,
      task: args.task.slice(0, 100),
    })

    const result = await runOriginAgent({
      origin: args.origin,
      task: args.task,
      context: args.context,
      providerConfig: ctx.providerConfig,
      browser: ctx.browser,
      registry: ctx.registry,
    })

    if (!result.success) {
      response.error(
        `Origin agent for ${args.origin} failed:\n${result.summary}`,
      )
      return
    }

    // Verify the result aligns with the original task
    const alignment = await verifyAlignment(
      args.task,
      result.summary,
      args.origin,
      ctx.providerConfig,
    )

    if (!alignment.aligned) {
      logger.warn('Origin agent result did not align with task', {
        origin: args.origin,
        reason: alignment.reason,
      })
      response.error(
        `Origin agent for ${args.origin} completed but the result did not satisfy the task.\nReason: ${alignment.reason ?? 'unknown'}\nAgent output: ${result.summary}`,
      )
      return
    }

    response.text(result.summary)
  },
})
