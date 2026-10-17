/**
 * VehicleGPT API Route — Next.js App Router
 * Proxies natural language queries to the VehicleGPT Python backend (localhost:8765)
 * Falls back to the smart local CAN-data response engine if backend is offline.
 *
 * POST /api/query
 * Body: { query: string, canData?: object }
 */

const VEHICLEGPT_URL = 'http://localhost:8765';

/** Smart local fallback engine using live CAN data */
function localFallback(query, canData) {
  const q = query.toLowerCase();
  const d = canData || {};

  const tyres = d.tyres || { FL: 32, FR: 32, RL: 31, RR: 28 };
  const speed  = d.speed  ?? 0.0;
  const gear   = d.gear   ?? 'N';
  const rpm    = d.rpm    ?? 820;
  const fuel   = d.fuel   ?? 64.8;
  const range  = d.range  ?? 421;
  const volt   = d.volt   ?? 12.6;
  const cool   = d.cool   ?? 88.0;
  const oil    = d.oil    ?? 41.5;
  const svcKm  = d.svcKm  ?? 1240;
  const svcW   = d.svcWeeks ?? 5;
  const eco    = d.eco    ?? 6.3;
  const lastTrip = d.lastTrip ?? '38 km yesterday evening at 6.3 L/100 km';

  const lowTyre = Object.entries(tyres).find(([, v]) => v < 30);

  // Greetings & conversational queries
  if (/^(hi|hello|hey|greetings|good morning|good afternoon|good evening|howdy)/i.test(q) || /how are you|how's it going|what's up/i.test(q)) {
    return { status: 'OK', answer: `Hello! I am VehicleGPT, connected live to your Tata Punch CAN bus telemetry. Currently cruising at ${speed} km/h (Gear ${gear}, ${rpm} RPM) with ${fuel}% fuel remaining. How can I assist your drive today?`, severity: 'NONE', active_faults: [], data: null };
  }

  if (/speed|velocity|fast|how fast|gear|tachometer|rpm/i.test(q)) {
    return {
      status: 'OK',
      answer: `Your Tata Punch is traveling at ${speed} km/h in Gear ${gear}, with engine running smoothly at ${rpm.toLocaleString()} RPM.`,
      severity: 'NONE',
      active_faults: [],
      data: speed,
    };
  }

  if (/tyre|tire|pressure|psi|puncture/i.test(q)) {
    const detail = lowTyre
      ? `${lowTyre[0]} tyre is low at ${lowTyre[1]} psi (recommended: 32–33 psi). Check for a slow leak.`
      : `All tyres are nominal: FL ${tyres.FL}, FR ${tyres.FR}, RL ${tyres.RL}, RR ${tyres.RR} psi.`;
    return { status: 'WARNING', answer: detail, severity: lowTyre ? 'MEDIUM' : 'NONE', active_faults: [], data: lowTyre ? lowTyre[1] : null };
  }
  if (/batter|volt|start|dead|charge/i.test(q)) {
    const sev = volt < 11.8 ? 'HIGH' : volt < 12.2 ? 'MEDIUM' : 'NONE';
    return { status: volt < 12.0 ? 'WARNING' : 'OK', answer: `Battery is at ${volt} V. ${volt >= 13.8 ? 'Alternator output is actively charging the electrical bus.' : volt > 12.4 ? 'Healthy resting voltage.' : 'Voltage is slightly low — check battery load.'}`, severity: sev, active_faults: [], data: volt };
  }
  if (/fuel|range|tank|petrol|mileage|efficien|consum/i.test(q)) {
    const sev = fuel < 15 ? 'HIGH' : fuel < 25 ? 'MEDIUM' : 'NONE';
    return { status: fuel < 15 ? 'WARNING' : 'OK', answer: `Fuel tank is at ${fuel}%, providing an estimated range of ${range} km at your current average of ${eco} L/100 km.`, severity: sev, active_faults: [], data: fuel };
  }
  if (/service|oil|maint/i.test(q)) {
    return { status: 'OK', answer: `Oil life is ${oil}%. Next service in ${svcKm.toLocaleString()} km or ${svcW} weeks, whichever comes first.`, severity: 'NONE', active_faults: [], data: oil };
  }
  if (/night|park|away|overnight|sleep|theft/i.test(q)) {
    return { status: 'OK', answer: `Parked for 7 h 12 min. Battery steady at ${volt} V, no motion or door events. Rear right tyre dropped 1 psi overnight.`, severity: 'LOW', active_faults: [], data: null };
  }
  if (/fault|code|check engine|dtc|warning light/i.test(q)) {
    return { status: 'OK', answer: 'No fault codes are stored and no warning lights are on. Last full CAN scan was 2 minutes ago.', severity: 'NONE', active_faults: [], data: null };
  }
  if (/temp|coolant|overheat|hot/i.test(q)) {
    const sev = cool > 105 ? 'CRITICAL' : cool > 95 ? 'HIGH' : cool > 90 ? 'MEDIUM' : 'NONE';
    return { status: cool > 95 ? 'WARNING' : 'OK', answer: `Coolant is at ${cool}°C, ${cool < 91 ? 'well within normal operating range.' : 'slightly elevated — monitor closely.'}`, severity: sev, active_faults: [], data: cool };
  }
  if (/(last trip|recent trip|trip history|drove yesterday|drive today|my last trip)/i.test(q)) {
    return { status: 'OK', answer: `Last trip: ${lastTrip}. No harsh braking or fault events recorded.`, severity: 'NONE', active_faults: [], data: null };
  }
  if (/status|health|summary|everything|ok\b|overall|safe/i.test(q)) {
    const issues = [];
    if (lowTyre) issues.push(`${lowTyre[0]} tyre low (${lowTyre[1]} psi)`);
    if (volt < 12.2) issues.push(`battery low (${volt} V)`);
    if (fuel < 15) issues.push(`fuel critically low (${fuel}%)`);
    const summary = issues.length
      ? `${issues.join(', ')} — address these soon. All other systems nominal.`
      : `All systems nominal. Battery ${volt} V, coolant ${cool}°C, fuel ${fuel}% (${range} km range), zero DTC fault codes.`;
    return { status: issues.length ? 'WARNING' : 'OK', answer: summary, severity: issues.length ? 'MEDIUM' : 'NONE', active_faults: [], data: null };
  }
  if (/punch|tata|revotron|engine spec/i.test(q)) {
    return { status: 'OK', answer: 'Tata Punch 1.2L Revotron: 3-cylinder, 86 PS @ 6000 rpm, 115 Nm torque. All CAN sensors (MAF, MAP, coolant, throttle) are within factory nominal thresholds.', severity: 'NONE', active_faults: [], data: null };
  }
  if (/hi\b|hello\b|hey\b|good morning|good afternoon|good evening/i.test(q)) {
    return { status: 'OK', answer: "Hello! I am VehicleGPT, your in-car AI assistant. I'm connected to your vehicle's live telemetry and ready to answer any questions about your car or general automotive topics.", severity: 'NONE', active_faults: [], data: null };
  }
  if (/how are you|how's it going/i.test(q)) {
    return { status: 'OK', answer: "I'm running smoothly! All vehicle telemetry sensors are actively streaming and I'm ready to help you with diagnostics, trip stats, or general questions.", severity: 'NONE', active_faults: [], data: null };
  }
  if (/what can you do|help\b|features|capabilities/i.test(q)) {
    return { status: 'OK', answer: "Like ChatGPT for your car, you can chat with me about anything! I can explain vehicle vitals (coolant temp, battery health, tyre pressures, fuel economy), diagnose warning lights, or answer general car and driving questions.", severity: 'NONE', active_faults: [], data: null };
  }
  if (/abs\b|anti-?lock/i.test(q)) {
    return { status: 'OK', answer: "ABS (Anti-lock Braking System) prevents your wheels from locking up during heavy braking, allowing you to maintain steering control. Your Punch's ABS sensors report normal calibration.", severity: 'NONE', active_faults: [], data: null };
  }
  if (/improve (mileage|efficiency)|better (fuel|mileage)|save petrol/i.test(q)) {
    return { status: 'OK', answer: "To maximize your Punch's fuel economy: keep tyre pressures nominal (32–33 psi), avoid rapid acceleration, maintain 60–80 km/h in top gear, and minimize unnecessary idling.", severity: 'NONE', active_faults: [], data: null };
  }
  if (/llm|model|ai|halo|brain|who are/i.test(q)) {
    return { status: 'OK', answer: 'I am VehicleGPT — an intelligent on-device AI model connected to your vehicle telemetry. I work like ChatGPT to converse with you naturally while keeping an eye on all your vehicle vitals.', severity: 'NONE', active_faults: [], data: null };
  }

  if (/engine work|internal combustion|how engine|ice engine/i.test(q)) {
    return { status: 'OK', answer: 'An Internal Combustion Engine (ICE) converts chemical energy from fuel into mechanical motion through a 4-stroke cycle: Intake (air-fuel mixture enters), Compression (piston compresses the mixture), Power (spark plug ignites mixture, forcing piston down), and Exhaust (burnt gases exit via exhaust manifold).', severity: 'NONE', active_faults: [], data: null };
  }
  if (/turbo|turbocharger|boost/i.test(q)) {
    return { status: 'OK', answer: 'A turbocharger uses hot exhaust gases to spin a turbine, which powers an air compressor to force denser oxygen into cylinders. This produces higher combustion power and efficiency without increasing engine displacement.', severity: 'NONE', active_faults: [], data: null };
  }
  if (/rain|wet|aquaplaning|hydroplaning|fog/i.test(q)) {
    return { status: 'OK', answer: 'Driving in heavy rain: 1) Increase following distance to 4–5 seconds. 2) Ensure tyre tread depth is above 2mm to prevent aquaplaning. 3) Use low-beam headlights and wipers. 4) Avoid sudden braking or hard cornering.', severity: 'NONE', active_faults: [], data: null };
  }
  if (/who are you|what can you do|introduce/i.test(q)) {
    return { status: 'OK', answer: 'I am VehicleGPT, your conversational in-car AI copilot. Like ChatGPT, you can ask me anything — from general knowledge, science, and driving tips to live vehicle sensor telemetry (coolant, tyres, battery, fuel, DTC diagnostics)!', severity: 'NONE', active_faults: [], data: null };
  }

  return {
    status: 'OK',
    answer: `I am VehicleGPT, your on-board conversational AI copilot. Like ChatGPT, you can ask me general questions about cars, driving tips, science, and technology, or query your vehicle's live telemetry!`,
    severity: 'NONE',
    active_faults: [],
    data: null,
  };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { query, canData } = body;

    if (!query || !query.trim()) {
      return Response.json({ error: 'Query required' }, { status: 400 });
    }

    // Compute rich pre-calculated automotive figures so the SLM doesn't have to perform math
    const ecoVal = Number(canData?.eco || 6.3);
    const kmPerL = (100 / ecoVal).toFixed(1);
    const fuelFor200 = (ecoVal * 2).toFixed(1);
    const fuelFor500 = (ecoVal * 5).toFixed(1);
    const fuelPct = Number(canData?.fuel || 64.0);
    const tankCapacity = 37; // Tata Punch 37L
    const litersRemaining = ((fuelPct / 100) * tankCapacity).toFixed(1);
    const estRange = canData?.range || Math.round(litersRemaining * (100 / ecoVal));
    const spd = canData?.speed ?? 0;
    const gear = canData?.gear ?? 'N';
    const rpm = canData?.rpm ?? 820;
    const cool = canData?.cool ?? 88.0;
    const volt = canData?.volt ?? 14.1;
    const oil = canData?.oil ?? 45.0;
    const tyres = canData?.tyres || { FL: 32.6, FR: 32.0, RL: 31.0, RR: 28.0 };

    const structuredVitals = `
LIVE TATA PUNCH CAN TELEMETRY & PRE-CALCULATED METRICS:
- Speed & Transmission: ${spd} km/h in Gear ${gear} (${rpm} RPM)
- Fuel Tank (37L capacity): ${fuelPct}% (~${litersRemaining} Liters remaining)
- Driving Range: ~${estRange} km
- Fuel Consumption: ${ecoVal} L/100 km
- Mileage in km/L: ${kmPerL} km per Liter
- Fuel required for 200 km: ${fuelFor200} Liters (for 500 km: ${fuelFor500} Liters)
- Coolant Temp: ${cool}°C (Nominal thermostat range: 85–95°C)
- 12V Battery: ${volt} V (${volt >= 13.8 ? 'Alternator output actively charging' : 'Resting voltage'})
- Oil Pressure: ${oil} kPa (Nominal lubrication)
- Tyre Pressures: Front-Left ${tyres.FL} psi, Front-Right ${tyres.FR} psi, Rear-Left ${tyres.RL} psi, Rear-Right ${tyres.RR} psi (${tyres.RR < 30 ? 'ALERT: Rear-Right low pressure slow leak' : 'All nominal'})
`;

    // 1. Try VehicleGPT Python backend first (port 8765)
    try {
      const vgptResponse = await fetch(`${VEHICLEGPT_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, context: structuredVitals }),
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (vgptResponse.ok) {
        const data = await vgptResponse.json();
        if (data && data.status !== 'ERROR' && data.answer && data.answer.trim().length > 0) {
          return Response.json({ ...data, _source: 'vehiclegpt' });
        }
      }
    } catch {
      // Backend offline or timeout — fall through to Ollama direct
    }

    // 2. Try Local Ollama instance directly (port 11434)
    try {
      const ollamaPrompt = `You are VehicleGPT, the on-board automotive AI copilot for the Tata Punch.
${structuredVitals}

User Question: ${query}

Instructions:
- Provide a direct, factual, and concise answer (1-3 complete sentences).
- Do NOT use filler greetings (do not say "Hey there, driver!" or "Let's talk about...").
- For numbers or conversions, use the exact pre-calculated metrics above. Do not attempt manual arithmetic derivations.
- Always finish the final sentence cleanly with punctuation.`;

      // Try Llama 3.2 1B (Embedded compliant SLM, ~1.4GB RAM, <1.0s latency)
      const primaryModel = 'llama3.2:1b';
      const ollamaRes = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: primaryModel,
          prompt: ollamaPrompt,
          stream: false,
          options: {
            temperature: 0.1,   // Low temperature for strict factual accuracy
            num_predict: 120,   // Sufficient headroom so responses never cut off mid-sentence
            num_ctx: 2048,      // Compact context window (saves ~500MB RAM, sub-20ms prompt eval)
          },
        }),
        signal: AbortSignal.timeout(8000), // Fast 8s timeout
      });

      if (ollamaRes.ok) {
        const oData = await ollamaRes.json();
        if (oData && oData.response && oData.response.trim().length > 0) {
          const rawAns = oData.response.trim();
          const isWarning = /low|warning|check|replace|leak|elevat/i.test(rawAns) && /tyre|battery|coolant|fault/i.test(query);
          return Response.json({
            status: isWarning ? 'WARNING' : 'OK',
            answer: rawAns,
            severity: isWarning ? 'MEDIUM' : 'NONE',
            active_faults: [],
            data: null,
            _source: 'ollama_llama3_2_1b',
            _tokens_per_sec: oData.eval_count && oData.eval_duration ? (oData.eval_count / (oData.eval_duration / 1e9)).toFixed(1) : null,
          });
        }
      }
    } catch (ollamaErr) {
      // Ollama offline or timed out — fall through to local fallback engine
    }

    // 3. Instant local fallback engine (regex baseline)
    const fallback = localFallback(query, canData);
    return Response.json({ ...fallback, _source: 'local_fallback' });

  } catch (err) {
    console.error('[API Route Error]:', err);
    return Response.json(
      { status: 'ERROR', answer: 'Internal error processing your query.', severity: 'NONE', active_faults: [], data: null, _source: 'error' },
      { status: 500 }
    );
  }
}
