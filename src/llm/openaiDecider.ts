import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { Decision } from '../types.js';
import { buildDecisionSchema } from './schema.js';
import { logger } from '../utils/logger.js';

export interface OpenAIDeciderConfig {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
  curatorLabels: string[];
}

export async function decideWithOpenAI(
  cfg: OpenAIDeciderConfig,
  prompt: string,
): Promise<{ decision: Decision; responseId?: string }> {
  const client = new OpenAI({ apiKey: cfg.apiKey, timeout: cfg.timeoutMs, maxRetries: cfg.maxRetries });
  const schema = buildDecisionSchema(cfg.curatorLabels);
  const schemaFormat = zodTextFormat(schema, 'comfort_decision');
  const startedAt = Date.now();

  if (
    process.env.OPENAI_SCHEMA_DEBUG === '1' ||
    process.env.OPENAI_SCHEMA_DEBUG?.toLowerCase() === 'true'
  ) {
    logger.debug({ schema: schemaFormat.schema }, 'OpenAI comfort_decision schema');
  }

  // Use the SDK's structured-output parsing. This enforces the Zod schema.
  let response;
  try {
    response = await client.responses.parse({
      model: cfg.model,
      reasoning: { effort: 'high' },
      input: [
        {
          role: 'system',
          content: 'Return ONLY JSON that matches the provided schema.',
        },
        { role: 'user', content: prompt },
      ],
      text: {
        format: schemaFormat,
      },
      store: false,
    });
  } catch (err: any) {
    const elapsed_ms = Date.now() - startedAt;
    const hint = `Hints: check OPENAI_API_KEY, consider a faster model via OPENAI_DECISION_MODEL (current: ${cfg.model}), or increase OPENAI_TIMEOUT_MS (current: ${cfg.timeoutMs ?? 'sdk default'}) / OPENAI_MAX_RETRIES (current: ${cfg.maxRetries ?? 'sdk default'})`;
    throw new Error(`${err?.message ?? String(err)} (after ${elapsed_ms}ms). ${hint}`);
  }

  const parsed = (response as any).output_parsed as unknown;
  if (!parsed) {
    // When the model refuses, some SDKs surface a 'refusal' field.
    const refusal = (response as any).refusal ?? (response as any).output_text;
    throw new Error(
      `OpenAI did not return a parsed decision. Refusal/output: ${String(refusal ?? '')}`,
    );
  }

  const elapsed_ms = Date.now() - startedAt;
  logger.info({ model: cfg.model, elapsed_ms }, 'OpenAI decision complete');

  return {
    decision: parsed as Decision,
    responseId: (response as any).id as string | undefined,
  };
}
