/**
 * @fileoverview Constrained Decoding Model (CDM) — Schema & Utilities
 *
 * Ollama supports a `format` parameter that accepts a full JSON Schema object.
 * When provided, the sampler restricts token selection at each step so the output
 * is ALWAYS a structurally valid JSON object matching this schema — no hallucinated
 * keys, no free-form prose leaking in, no broken JSON to regex-scrape.
 *
 * Architecture:
 *   schema.js   ← JSON Schema definitions + field validators  (this file)
 *   decoder.js  ← buildConstrainedPayload() + decodeResponse()
 *
 * @see https://ollama.com/blog/structured-outputs
 */

// ─────────────────────────────────────────────────────────────
// 1. RESPONSE SCHEMA  (what the LLM MUST output)
// ─────────────────────────────────────────────────────────────

/**
 * JSON Schema for the VehicleGPT diagnostic response.
 * Ollama's constrained sampler enforces this at token-generation time.
 *
 * @typedef {Object} VehicleGPTResponse
 * @property {'OK'|'WARNING'|'CRITICAL'|'ERROR'} status
 * @property {string}   answer         - Human-readable diagnostic text (1–3 sentences)
 * @property {'NONE'|'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'} severity
 * @property {string[]} active_faults  - OBD-II DTC codes (e.g. ["P0562"])
 * @property {number|null} metric_value - Primary numeric value being discussed
 * @property {string|null} metric_unit  - Unit of measure (km/h, °C, V, psi …)
 * @property {string|null} recommendation - One actionable sentence for the driver
 */
export const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['status', 'answer', 'severity', 'active_faults'],
  additionalProperties: false,
  properties: {
    status: {
      type: 'string',
      enum: ['OK', 'WARNING', 'CRITICAL', 'ERROR'],
      description: 'Overall health status of the queried vehicle system',
    },
    answer: {
      type: 'string',
      minLength: 10,
      maxLength: 400,
      description: 'Direct, factual diagnostic answer. 1–3 complete sentences. No filler greetings.',
    },
    severity: {
      type: 'string',
      enum: ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      description: 'Driver alert level. NONE for routine queries, CRITICAL for safety-stop situations.',
    },
    active_faults: {
      type: 'array',
      items: { type: 'string', pattern: '^[A-Z][0-9]{4}$' },
      maxItems: 6,
      description: 'OBD-II / CAN DTC fault codes currently active. Empty array if none.',
    },
    metric_value: {
      type: ['number', 'null'],
      description: 'Primary numeric value (speed, temp, voltage …) this answer refers to.',
    },
    metric_unit: {
      type: ['string', 'null'],
      maxLength: 12,
      description: "SI / automotive unit string (e.g. 'km/h', '°C', 'V', 'psi', 'RPM', 'kPa').",
    },
    recommendation: {
      type: ['string', 'null'],
      maxLength: 180,
      description: 'Single actionable sentence the driver should do next. Null if no action needed.',
    },
  },
};

// ─────────────────────────────────────────────────────────────
// 2. TELEMETRY FRAME SCHEMA  (what /api/telemetry MUST output)
// ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CDMFrame
 * @property {number} frameIndex
 * @property {number} totalFrames
 * @property {number} speed        - km/h
 * @property {number} rpm
 * @property {string} gear         - '1'–'5' | 'N' | 'R'
 * @property {number} fuel         - percent 0–100
 * @property {number} range        - estimated km remaining
 * @property {number} volt         - 12V battery voltage
 * @property {number} cool         - coolant temp °C
 * @property {number} oil          - oil pressure kPa
 * @property {{FL:number,FR:number,RL:number,RR:number}} tyres - tyre pressures psi
 * @property {boolean} isPlaying
 * @property {string} timestamp_us - microsecond epoch string
 * @property {string} source
 * @property {string} cdm_version  - always "1.0"
 */

/**
 * Normalizes a raw telemetry API response into a validated CDMFrame.
 * Provides type-safe defaults so downstream consumers never see undefined.
 *
 * @param {object} raw - Raw JSON from /api/telemetry GET
 * @returns {CDMFrame}
 */
export function normalizeTelemetryFrame(raw = {}) {
  const tyres = raw.tyres || {};
  return {
    frameIndex:   typeof raw.frameIndex   === 'number' ? raw.frameIndex   : 0,
    totalFrames:  typeof raw.totalFrames  === 'number' ? raw.totalFrames  : 1000,
    speed:        typeof raw.speed        === 'number' ? +raw.speed.toFixed(1)   : 0.0,
    rpm:          typeof raw.rpm          === 'number' ? Math.round(raw.rpm)     : 820,
    gear:         typeof raw.gear         === 'string' ? raw.gear               : 'N',
    fuel:         typeof raw.fuel         === 'number' ? +raw.fuel.toFixed(2)   : 64.8,
    range:        typeof raw.range        === 'number' ? Math.round(raw.range)  : 421,
    volt:         typeof raw.volt         === 'number' ? +raw.volt.toFixed(2)   : 12.6,
    cool:         typeof raw.cool         === 'number' ? +raw.cool.toFixed(1)   : 88.0,
    oil:          typeof raw.oil          === 'number' ? +raw.oil.toFixed(1)    : 40.0,
    tyres: {
      FL: typeof tyres.FL === 'number' ? +tyres.FL.toFixed(1) : 32.0,
      FR: typeof tyres.FR === 'number' ? +tyres.FR.toFixed(1) : 32.0,
      RL: typeof tyres.RL === 'number' ? +tyres.RL.toFixed(1) : 31.0,
      RR: typeof tyres.RR === 'number' ? +tyres.RR.toFixed(1) : 28.0,
    },
    isPlaying:    typeof raw.isPlaying    === 'boolean' ? raw.isPlaying          : true,
    timestamp_us: typeof raw.timestamp_us === 'string'  ? raw.timestamp_us       : '0',
    source:       typeof raw.source       === 'string'  ? raw.source             : 'can_replay',
    cdm_version:  '1.0',
  };
}

/**
 * Serializes a CDMFrame into the compact telemetry context string
 * that is injected into the constrained-decoding LLM prompt.
 *
 * Keeps it short — the CDM schema constrains output length, so the
 * context window can stay small (num_ctx: 768) for sub-1s latency.
 *
 * @param {CDMFrame} frame
 * @returns {string}
 */
export function cdmToLLMContext(frame) {
  const lowTyre = Object.entries(frame.tyres).find(([, v]) => v < 30);
  const tyreAlert = lowTyre
    ? `ALERT: ${lowTyre[0]} tyre at ${lowTyre[1]} psi (below 30 psi threshold)`
    : 'All tyres nominal';

  return [
    `LIVE CAN TELEMETRY [Frame ${frame.frameIndex}/${frame.totalFrames}]:`,
    `  Speed ${frame.speed} km/h | Gear ${frame.gear} | RPM ${frame.rpm}`,
    `  Fuel ${frame.fuel}% (~${frame.range} km range) | Coolant ${frame.cool}°C`,
    `  Battery ${frame.volt}V | Oil ${frame.oil} kPa`,
    `  TPMS FL=${frame.tyres.FL} FR=${frame.tyres.FR} RL=${frame.tyres.RL} RR=${frame.tyres.RR} psi — ${tyreAlert}`,
    `  Source: ${frame.source} | TS: ${frame.timestamp_us} µs`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────
// 3. RUNTIME VALIDATOR
// ─────────────────────────────────────────────────────────────

const VALID_STATUSES   = new Set(['OK', 'WARNING', 'CRITICAL', 'ERROR']);
const VALID_SEVERITIES = new Set(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const DTC_RE           = /^[A-Z][0-9]{4}$/;

/**
 * Validates a parsed VehicleGPTResponse object.
 * Called after JSON.parse() to catch schema drift even with constrained decoding.
 *
 * @param {unknown} obj
 * @returns {{ valid: boolean; errors: string[] }}
 */
export function validateResponse(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['Response is not an object'] };
  }

  if (!VALID_STATUSES.has(obj.status))
    errors.push(`Invalid status: "${obj.status}"`);

  if (typeof obj.answer !== 'string' || obj.answer.trim().length < 5)
    errors.push('answer is empty or too short');

  if (!VALID_SEVERITIES.has(obj.severity))
    errors.push(`Invalid severity: "${obj.severity}"`);

  if (!Array.isArray(obj.active_faults))
    errors.push('active_faults must be an array');
  else {
    obj.active_faults.forEach((code, i) => {
      if (typeof code !== 'string' || !DTC_RE.test(code))
        errors.push(`active_faults[${i}] "${code}" is not a valid DTC code`);
    });
  }

  return { valid: errors.length === 0, errors };
}
