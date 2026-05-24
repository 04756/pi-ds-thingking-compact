// pi-ds-thinking-compact
//
// Before each LLM call, scan past assistant messages for thinking blocks.
// Use a cheap model to summarize each one into a short text block,
// replacing the verbose reasoning the model would otherwise re-read.
//
// Model for summarization (cheapest thinking-capable model):
//   defaults to "deepseek/deepseek-v4-flash"
//   override with PI_COMPACT_THINKING_MODEL env var
//
// Config:
//   PI_COMPACT_THINKING_MODEL - model to use for summarization
//   PI_COMPACT_THINKING_MIN_CHARS - skip blocks shorter than this (default 200)
//
import type { ExtensionAPI, ExtensionContext, ContextEvent } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai";
import type { Model, Api } from "@earendil-works/pi-ai";

// ---- config ---------------------------------------------------------------

const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const MIN_CHARS = Number(process.env.PI_COMPACT_THINKING_MIN_CHARS) || 200;

const SUMMARY_PROMPT =
  "Summarize the following internal reasoning in 1-2 sentences. " +
  "Output only the summary, no preamble, no explanation.\n\n" +
  "--- REASONING ---\n";

function getModelId(): string {
  return process.env.PI_COMPACT_THINKING_MODEL || DEFAULT_MODEL;
}

// ---- helpers --------------------------------------------------------------

function parseModelId(id: string): { provider: string; modelId: string } {
  const sep = id.indexOf("/");
  if (sep === -1) throw new Error(`Invalid model id: ${id}`);
  return { provider: id.slice(0, sep), modelId: id.slice(sep + 1) };
}

// ---- summarization cache ---------------------------------------------------
// Avoid re-summarizing the same thinking text every turn.
const summaryCache = new Map<string, string>();

async function summarize(
  thinkingText: string,
  model: Model<Api>,
  apiKey: string,
): Promise<string | undefined> {
  // Return cached summary if we've seen this text before
  const cached = summaryCache.get(thinkingText);
  if (cached !== undefined) return cached;

  try {
    const result = await completeSimple(
      model,
      {
        messages: [
          { role: "user", content: [{ type: "text", text: SUMMARY_PROMPT + thinkingText }] },
        ],
      },
      {
        apiKey,
        maxTokens: 200,
        temperature: 0,
      },
    );

    // Extract text from result
    const texts = result.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text);
    const summary = texts.join("").trim() || undefined;
    if (summary) summaryCache.set(thinkingText, summary);
    return summary;
  } catch {
    return undefined;
  }
}

// ---- core handler ---------------------------------------------------------

async function contextHandler(
  event: ContextEvent,
  ctx: ExtensionContext,
): Promise<{ messages: typeof event.messages } | void> {
  const modelId = getModelId();
  const { provider, modelId: modelName } = parseModelId(modelId);
  const compactModel = ctx.modelRegistry.find(provider, modelName);

  if (!compactModel) {
    // Summarization model not available; skip silently
    return;
  }

  const apiKey = await ctx.modelRegistry.getApiKeyForProvider(provider);
  if (!apiKey) return;

  // Collect thinking blocks that need summarization
  interface PendingBlock {
    msgIndex: number;
    blockIndex: number;
    text: string;
  }
  const pending: PendingBlock[] = [];
  let changed = false;

  const messages = event.messages.map((msg, msgIndex: number) => {
    if (msg.role !== "assistant") return msg;

    const newContent = msg.content.map((block: any, blockIndex: number) => {
      if (block.type !== "thinking") return block;

      const thinkingBlock = block as unknown as { type: "thinking"; thinking: string };
      if (thinkingBlock.thinking.length < MIN_CHARS) return block;

      pending.push({ msgIndex, blockIndex, text: thinkingBlock.thinking });
      changed = true;
      // Placeholder — will be replaced after summarization
      return {
        type: "text" as const,
        text: `[thinking: summarizing...]`,
      };
    });

    if (newContent === msg.content) return msg;
    return { ...msg, content: newContent };
  });

  if (!changed) return;

  // Summarize all pending blocks in parallel
  const replacements = new Map<string, string>();

  await Promise.all(
    pending.map(async (b) => {
      const summary = await summarize(b.text, compactModel, apiKey);
      replacements.set(`${b.msgIndex}-${b.blockIndex}`, summary || `reasoning truncated to ${MIN_CHARS} chars: ${b.text.slice(0, MIN_CHARS)}…`);
    }),
  );

  // Apply summaries to replaced messages
  const finalized = messages.map((msg: any, msgIndex: number) => {
    if (msg.role !== "assistant") return msg;

    const newContent = msg.content.map((block: any, blockIndex: number) => {
      const key = `${msgIndex}-${blockIndex}`;
      const replacement = replacements.get(key);
      if (!replacement) return block;

      return {
        type: "text" as const,
        text: `[Previous reasoning: ${replacement}]`,
      };
    });

    if (newContent === msg.content) return msg;
    return { ...msg, content: newContent };
  });

  return { messages: finalized };
}

// ---- export ---------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.on("context", contextHandler);
}
