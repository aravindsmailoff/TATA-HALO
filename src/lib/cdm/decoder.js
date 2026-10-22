/**
 * @fileoverview Constrained Decoding Model (CDM) — Decoder & Ollama Adapter
 *
 * This module owns the entire LLM call lifecycle:
 *   1. buildConstrainedPayload()  — assembles the Ollama request body with
 *      `format: RESPONSE_SCHEMA` so token sampling is grammar-constrained.
 *   2. decodeConstrainedResponse() — parses + validates the guaranteed-valid JSON.
 *   3. synthesizeFallback()        — produces a schema-conformant object when
 *      the model is offline, using the existing local heuristic engine result.
 *
 * Why this beats the old indexOf('{') hack:
 *   Old code: model outputs free text → grep for '{…}' → hope it parses → brittle.
 *   CDM:      sampler physically CANNOT emit invalid tokens → parse always succeeds.
 *
 * @see schema.js for RESPONSE_SCHEMA and normalizeTelemetryFrame
 */

import { RESPONSE_SCHEMA, validateResponse } from './schema.js';

const OLLAMA_BASE = 'http://localhost:11434';

// ─────────────────────────────────────────────────────────────
// 1. SYSTEM PROMPT — Tells the model its role in the schema context
// ─────────────────────────────────────────────────────────────

/**
 * Builds the constrained-decoding system + user prompt pair for Ollama.
 *
 * The system prompt is intentionally terse — the schema itself encodes
 * most of the output contract, so we only need to set persona and tone.
 *
 * @param {string} telemetryContext  - Output of cdmToLLMContext(frame)
 * @param {string} userQuery
 * @returns {string}  Single combined prompt string for Ollama /api/generate
 */
function buildPrompt(telemetryContext, userQuery) {
  return `You are VehicleGPT, the on-board edge AI diagnostic copilot for the Tata Punch 1.2L Revotron.

${telemetryContext}

POWERTRAIN FACTS:
- Engine: 1.2L Revotron 3-cyl Turbo-Petrol (110 PS / 170 Nm)
- Oil capacity: 3.5L 5W-30 | Fuel tank: 37L | TPMS nominal: 32 psi all wheels
- Thermostat target: 89–91°C | Battery nominal: 12.4–14.4V | Oil pressure nominal: 35–65 kPa

RESPONSE RULES (non-negotiable — you output JSON, the schema enforces this):
- answer: 1–3 complete factual sentences. Use the exact live metrics above. No greetings.
- severity: NONE for routine, LOW for advisory, MEDIUM for prompt attention, HIGH for stop-soon, CRITICAL for stop-immediately.
- active_faults: Only list codes if a real fault is present from the telemetry. Usually [].
- metric_value / metric_unit: Extract the primary number being discussed. null if not applicable.
- recommendation: One concrete driver action. null if no action needed.

USER QUERY: ${userQuery}`;
}

// ─────────────────────────────────────────────────────────────
// 2. CONSTRAINED PAYLOAD BUILDER
// ─────────────────────────────────────────────────────────────

/**
 * Builds the full Ollama /api/generate request body with CDM format constraint.
 *
 * Key parameter: `format: RESPONSE_SCHEMA`
 * This passes the JSON Schema to Ollama's constrained sampler (llama.cpp grammar
 * layer). Every token emitted is checked against the schema grammar — invalid
 * tokens are assigned probability 0 before softmax normalization.
 *
 * @param {string} telemetryContext
 * @param {string} userQuery
 * @param {string} [model='vehiclegpt']
 * @returns {object}  Body to JSON.stringify() into the fetch call
 */
export function buildConstrainedPayload(telemetryContext, userQuery, model = 'vehiclegpt') {
  return {
    model,
    prompt: buildPrompt(telemetryContext, userQuery),
    stream: false,
    think: false,
    format: RESPONSE_SCHEMA,          // ← THE CONSTRAINED DECODING CONSTRAINT
    options: {
      temperature: 0.05,              // Near-deterministic — schema already constrains variety
      num_predict: 180,               // Sufficient for full JSON payload + all fields
      num_ctx: 900,                   // Context window: telemetry + facts + query
      num_thread: 8,
      repeat_penalty: 1.1,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// 3. RESPONSE DECODER
// ─────────────────────────────────────────────────────────────

/**
 * Decodes the Ollama constrained-decoding response.
 *
 * Because the sampler enforces the schema, JSON.parse() MUST succeed.
 * We still validate to guard against Ollama version mismatches or
 * model weights that partially bypass the grammar constraint.
 *
 * @param {object} ollamaRaw  - Parsed JSON from Ollama /api/generate response
 * @returns {{ decoded: import('./schema.js').VehicleGPTResponse|null; error: string|null; tokens_per_sec: string|null }}
 */
export function decodeConstrainedResponse(ollamaRaw) {
  const tokensPerSec =
    ollamaRaw.eval_count && ollamaRaw.eval_duration
      ? (ollamaRaw.eval_count / (ollamaRaw.eval_duration / 1e9)).toFixed(1)
      : null;

  const rawText = (ollamaRaw.response || '').trim();
  if (!rawText) {
    return { decoded: null, error: 'Empty response from model', tokens_per_sec: tokensPerSec };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    // Should never happen with constrained decoding — log for monitoring
    console.error('[CDM] JSON.parse failed despite constrained decoding:', e.message, '\nRaw:', rawText.slice(0, 200));
    return { decoded: null, error: `JSON parse failed: ${e.message}`, tokens_per_sec: tokensPerSec };
  }

  const { valid, errors } = validateResponse(parsed);
  if (!valid) {
    console.warn('[CDM] Schema validation warnings:', errors);
    // Still return the parsed object — it's usable even with minor drift
  }

  return { decoded: parsed, error: null, tokens_per_sec: tokensPerSec };
}

// ─────────────────────────────────────────────────────────────
// 4. FALLBACK SYNTHESIZER
// ─────────────────────────────────────────────────────────────

/**
 * Converts an output from the legacy localFallback() heuristic engine
 * into a schema-conformant VehicleGPTResponse so all code paths produce
 * the same shape — callers never need to branch on source.
 *
 * @param {object} fallbackResult  - Object returned by localFallback()
 * @returns {import('./schema.js').VehicleGPTResponse}
 */
export function synthesizeFallback(fallbackResult) {
  const fb = fallbackResult || {};
  const status   = VALID_STATUSES_SET.has(fb.status)   ? fb.status   : 'OK';
  const severity = VALID_SEVER_SET.has(fb.severity)    ? fb.severity : 'NONE';

  return {
    status,
    answer:         typeof fb.answer === 'string' ? fb.answer.trim() : 'Query processed by local engine.',
    severity,
    active_faults:  Array.isArray(fb.active_faults) ? fb.active_faults : [],
    metric_value:   typeof fb.data === 'number' ? fb.data : null,
    metric_unit:    null,
    recommendation: null,
  };
}

const VALID_STATUSES_SET = new Set(['OK', 'WARNING', 'CRITICAL', 'ERROR']);
const VALID_SEVER_SET    = new Set(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

// ─────────────────────────────────────────────────────────────
// 5. FULL CONSTRAINED CALL — convenience wrapper
// ─────────────────────────────────────────────────────────────

/**
 * Makes a constrained-decoding Ollama call and returns a decoded response.
 * Handles timeout, network errors, and decode errors internally.
 *
 * @param {string} telemetryContext
 * @param {string} userQuery
 * @param {{ model?: string; timeoutMs?: number }} [opts]
 * @returns {Promise<{ response: import('./schema.js').VehicleGPTResponse|null; tokens_per_sec: string|null; error: string|null }>}
 */
export async function callConstrainedDecoding(telemetryContext, userQuery, opts = {}) {
  const model     = opts.model     ?? 'vehiclegpt';
  const timeoutMs = opts.timeoutMs ?? 8000;

  const payload = buildConstrainedPayload(telemetryContext, userQuery, model);

  let raw;
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      return { response: null, tokens_per_sec: null, error: `Ollama HTTP ${res.status}: ${errText}` };
    }

    raw = await res.json();
  } catch (fetchErr) {
    return { response: null, tokens_per_sec: null, error: `Fetch failed: ${fetchErr.message}` };
  }

  const { decoded, error, tokens_per_sec } = decodeConstrainedResponse(raw);
  return { response: decoded, tokens_per_sec, error };
}
