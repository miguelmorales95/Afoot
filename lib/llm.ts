// Provider-agnostic LLM completion layer.
//
// Two backends:
//   - "anthropic": Claude via the official SDK (best quality; costs money)
//   - "ollama":    a local Ollama model via its native API (free; great for
//                  leaving a discovery crawl running for hours)
//
// Set LLM_PROVIDER to pick the default. Discovery and extraction both go
// through complete(), so you can run the whole pipeline locally for free and
// only switch to Claude when you want higher accuracy.

import Anthropic from "@anthropic-ai/sdk";

export type LLMProvider = "anthropic" | "ollama";

export interface CompleteOpts {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Ask the backend to return strict JSON when supported. */
  json?: boolean;
  temperature?: number;
  /** Override the configured provider for a single call. */
  provider?: LLMProvider;
}

export function defaultProvider(): LLMProvider {
  return (process.env.LLM_PROVIDER as LLMProvider) || "anthropic";
}

let _anthropic: Anthropic | null = null;
function anthropicClient(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
  return _anthropic;
}

async function completeAnthropic(o: CompleteOpts): Promise<string> {
  const model = process.env.EXTRACTION_MODEL || "claude-haiku-5-5";
  const msg = await anthropicClient().messages.create({
    model,
    max_tokens: o.maxTokens ?? 4000,
    system: o.system,
    messages: [{ role: "user", content: o.prompt }],
  });
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

async function completeOllama(o: CompleteOpts): Promise<string> {
  const base = process.env.OLLAMA_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.1";
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: o.json ? "json" : undefined,
      options: { temperature: o.temperature ?? 0.2, num_predict: o.maxTokens ?? 4000 },
      messages: [
        { role: "system", content: o.system },
        { role: "user", content: o.prompt },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    throw new Error(`Ollama ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}

export async function complete(o: CompleteOpts): Promise<string> {
  const provider = o.provider ?? defaultProvider();
  return provider === "ollama" ? completeOllama(o) : completeAnthropic(o);
}

/** Pull the first JSON object/array out of a model response. */
export function extractJson(text: string): string {
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const firstObj = t.indexOf("{");
  const firstArr = t.indexOf("[");
  const start =
    firstArr === -1 ? firstObj : firstObj === -1 ? firstArr : Math.min(firstObj, firstArr);
  if (start === -1) return t;
  const open = t[start];
  const close = open === "{" ? "}" : "]";
  const end = t.lastIndexOf(close);
  return end > start ? t.slice(start, end + 1) : t.slice(start);
}
