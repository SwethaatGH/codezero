import type { AIStatus, ChatMessage } from "@code-zero/shared";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { env, type RuntimeSettings } from "../config";
import { ApiError } from "../errors";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

function modelName(s: RuntimeSettings) {
  return s.aiProvider === "gemini" ? s.geminiModel : s.ollamaModel;
}

let statusCache: { key: string; at: number; status: AIStatus } | null = null;
const STATUS_TTL = 60_000;

/**
 * Checks reachability, model presence, and (with `probe`) that the model can actually generate.
 * The probe catches failures such as exhausted cloud quotas that a model listing does not reveal.
 */
export async function checkAIStatus(s: RuntimeSettings, refresh: boolean, probe = true): Promise<AIStatus> {
  const key = JSON.stringify([s.aiProvider, s.ollamaBaseUrl, s.ollamaModel, s.geminiModel, probe]);
  if (!refresh && statusCache && statusCache.key === key && Date.now() - statusCache.at < STATUS_TTL) return statusCache.status;
  const status = s.aiProvider === "gemini" ? await geminiStatus(s, probe) : await ollamaStatus(s, probe);
  statusCache = { key, at: Date.now(), status };
  return status;
}

export function invalidateAIStatus() {
  statusCache = null;
}

async function ollamaStatus(s: RuntimeSettings, probe: boolean): Promise<AIStatus> {
  const base = { baseUrl: s.ollamaBaseUrl, model: s.ollamaModel };
  let models: string[];
  try {
    const res = await fetch(`${s.ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ...base, state: "error", availableModels: [], message: `Ollama responded with HTTP ${res.status}.` };
    const body = (await res.json()) as { models?: { name: string }[] };
    models = (body.models ?? []).map((m) => m.name);
  } catch {
    return { ...base, state: "unavailable", availableModels: [], message: `Cannot reach Ollama at ${s.ollamaBaseUrl}. Start it with \`ollama serve\`.` };
  }
  const installed = models.some((m) => m === s.ollamaModel || m === `${s.ollamaModel}:latest`);
  if (!installed) {
    const gemmas = models.filter((m) => /gemma/i.test(m));
    return {
      ...base,
      state: "model-missing",
      availableModels: models,
      message: `Model "${s.ollamaModel}" is not installed. Run \`ollama pull ${s.ollamaModel}\`${gemmas.length ? ` or set the model to one of: ${gemmas.join(", ")}` : ""}.`,
    };
  }
  if (probe) {
    try {
      await ollamaChat(s, [{ role: "user", content: "Reply with OK." }], { numPredict: 2, timeoutMs: 30_000 });
    } catch (err) {
      return { ...base, state: "error", availableModels: models, message: `Model "${s.ollamaModel}" is installed but generation failed: ${(err as Error).message}` };
    }
  }
  return { ...base, state: "connected", availableModels: models, message: `${s.ollamaModel} is ready via Ollama.` };
}

async function geminiStatus(s: RuntimeSettings, probe: boolean): Promise<AIStatus> {
  const base = { baseUrl: GEMINI_BASE, model: s.geminiModel };
  if (!env.geminiApiKey) return { ...base, state: "unavailable", availableModels: [], message: "GEMINI_API_KEY is not set in the server environment." };
  let models: string[];
  try {
    const res = await fetch(`${GEMINI_BASE}/models?pageSize=1000`, { headers: { "x-goog-api-key": env.geminiApiKey }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ...base, state: "error", availableModels: [], message: `Gemini API responded with HTTP ${res.status}. Check GEMINI_API_KEY.` };
    const body = (await res.json()) as { models?: { name: string }[] };
    models = (body.models ?? []).map((m) => m.name.replace(/^models\//, ""));
  } catch {
    return { ...base, state: "unavailable", availableModels: [], message: "Cannot reach the Gemini API." };
  }
  if (!models.includes(s.geminiModel)) {
    const gemmas = models.filter((m) => /gemma/i.test(m));
    return { ...base, state: "model-missing", availableModels: models, message: `Model "${s.geminiModel}" is not available to this key${gemmas.length ? `. Gemma models available: ${gemmas.join(", ")}` : ""}.` };
  }
  if (probe) {
    try {
      await geminiGenerate(s, [{ role: "user", content: "Reply with OK." }], { maxTokens: 2, timeoutMs: 30_000 });
    } catch (err) {
      return { ...base, state: "error", availableModels: models, message: `Generation failed: ${(err as Error).message}` };
    }
  }
  return { ...base, state: "connected", availableModels: models, message: `${s.geminiModel} is ready via the Gemini API.` };
}

// ─── Ollama ──────────────────────────────────────────────────────────

interface OllamaOpts {
  format?: unknown;
  numPredict?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

async function ollamaChat(s: RuntimeSettings, messages: ChatMessage[], o: OllamaOpts = {}): Promise<string> {
  const signal = AbortSignal.any([AbortSignal.timeout(o.timeoutMs ?? env.aiTimeoutMs), ...(o.signal ? [o.signal] : [])]);
  const body = (think: boolean | undefined) =>
    JSON.stringify({
      model: s.ollamaModel,
      stream: false,
      messages,
      ...(think === undefined ? {} : { think }),
      ...(o.format ? { format: o.format } : {}),
      options: { temperature: 0.2, ...(o.numPredict ? { num_predict: o.numPredict } : {}) },
    });
  let res = await fetch(`${s.ollamaBaseUrl}/api/chat`, { method: "POST", body: body(false), signal });
  if (res.status === 400) {
    const text = await res.text();
    if (/think/i.test(text)) res = await fetch(`${s.ollamaBaseUrl}/api/chat`, { method: "POST", body: body(undefined), signal });
    else throw new Error(ollamaError(text, 400));
  }
  if (!res.ok) throw new Error(ollamaError(await res.text(), res.status));
  const data = (await res.json()) as { message?: { content?: string }; error?: string };
  if (data.error) throw new Error(data.error);
  return data.message?.content ?? "";
}

function ollamaError(text: string, status: number): string {
  try {
    const j = JSON.parse(text) as { error?: string };
    if (j.error) return j.error;
  } catch {
    /* plain text body */
  }
  return `HTTP ${status}: ${text.slice(0, 300)}`;
}

async function* ollamaStream(s: RuntimeSettings, messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<string> {
  const res = await fetch(`${s.ollamaBaseUrl}/api/chat`, {
    method: "POST",
    body: JSON.stringify({ model: s.ollamaModel, stream: true, think: false, messages, options: { temperature: 0.3 } }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(ollamaError(await res.text(), res.status));
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line) as { message?: { content?: string }; error?: string; done?: boolean };
      if (j.error) throw new Error(j.error);
      if (j.message?.content) yield j.message.content;
    }
  }
}

// ─── Gemini API (Gemma models) ───────────────────────────────────────

function toGeminiContents(messages: ChatMessage[]) {
  // Gemma models on the Gemini API do not accept system instructions; fold them into the first user turn.
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  return rest.map((m, i) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: i === 0 && system ? `${system}\n\n${m.content}` : m.content }],
  }));
}

interface GeminiPart {
  text?: string;
  /** Gemma 4 returns its reasoning as separate parts flagged `thought: true`; they are not part of the answer. */
  thought?: boolean;
}

const answerText = (parts: GeminiPart[] | undefined) => (parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");

class GeminiHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** One retry for transient server errors (the Gemini API occasionally returns 500/503). */
async function geminiGenerate(s: RuntimeSettings, messages: ChatMessage[], o: { maxTokens?: number; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<string> {
  try {
    return await geminiGenerateOnce(s, messages, o);
  } catch (err) {
    if (err instanceof GeminiHttpError && err.status >= 500 && !o.signal?.aborted) {
      await new Promise((r) => setTimeout(r, 1500));
      return geminiGenerateOnce(s, messages, o);
    }
    throw err;
  }
}

async function geminiGenerateOnce(s: RuntimeSettings, messages: ChatMessage[], o: { maxTokens?: number; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<string> {
  const signal = AbortSignal.any([AbortSignal.timeout(o.timeoutMs ?? env.aiTimeoutMs), ...(o.signal ? [o.signal] : [])]);
  const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(s.geminiModel)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.geminiApiKey ?? "" },
    body: JSON.stringify({ contents: toGeminiContents(messages), generationConfig: { temperature: 0.2, ...(o.maxTokens ? { maxOutputTokens: o.maxTokens } : {}) } }),
    signal,
  });
  const data = (await res.json()) as { candidates?: { content?: { parts?: GeminiPart[] } }[]; error?: { message?: string } };
  if (!res.ok || data.error) throw new GeminiHttpError(res.status, data.error?.message ?? `HTTP ${res.status}`);
  return answerText(data.candidates?.[0]?.content?.parts);
}

async function* geminiStream(s: RuntimeSettings, messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<string> {
  const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(s.geminiModel)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.geminiApiKey ?? "" },
    body: JSON.stringify({ contents: toGeminiContents(messages), generationConfig: { temperature: 0.3 } }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Gemini API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const j = JSON.parse(line.slice(5)) as { candidates?: { content?: { parts?: GeminiPart[] } }[] };
      const text = answerText(j.candidates?.[0]?.content?.parts);
      if (text) yield text;
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────

/** Extracts the first JSON object from model output (tolerates code fences and prose). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object found in model output");
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Generates JSON, validates it with Zod, and retries once with the validation error if needed. */
export async function generateStructured<S extends z.ZodTypeAny>(
  s: RuntimeSettings,
  schema: S,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<{ data: z.infer<S>; model: string }> {
  const jsonSchema = zodToJsonSchema(schema, { target: "openApi3", $refStrategy: "none" });
  let convo = [...messages];
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      text = s.aiProvider === "gemini" ? await geminiGenerate(s, convo, { signal }) : await ollamaChat(s, convo, { format: jsonSchema, signal });
    } catch (err) {
      if (signal?.aborted) throw new ApiError(499, "CANCELLED", "Generation stopped");
      throw new ApiError(503, "AI_UNAVAILABLE", `Gemma inference failed (${modelName(s)}): ${(err as Error).message}`);
    }
    try {
      const parsed = schema.safeParse(extractJson(text));
      if (parsed.success) return { data: parsed.data, model: modelName(s) };
      lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch (err) {
      lastError = (err as Error).message;
    }
    convo = [...convo, { role: "assistant", content: text }, { role: "user", content: `Your previous output was invalid (${lastError}). Respond again with ONLY a JSON object matching the schema.` }];
  }
  throw new ApiError(502, "AI_INVALID_OUTPUT", `Gemma returned output that failed schema validation: ${lastError}`);
}

export function streamChat(s: RuntimeSettings, messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<string> {
  return s.aiProvider === "gemini" ? geminiStream(s, messages, signal) : ollamaStream(s, messages, signal);
}
