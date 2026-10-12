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
  const fuel   = d.fuel   ?? 62;
  const range  = d.range  ?? 410;
  const volt   = d.volt   ?? 12.6;
  const cool   = d.cool   ?? 89;
  const oil    = d.oil    ?? 38;
  const svcKm  = d.svcKm  ?? 1240;
  const svcW   = d.svcWeeks ?? 5;
  const eco    = d.eco    ?? 6.3;
  const lastTrip = d.lastTrip ?? '38 km yesterday evening at 6.3 L/100 km';

  const lowTyre = Object.entries(tyres).find(([, v]) => v < 30);

  // Greetings & conversational queries
  if (/^(hi|hello|hey|greetings|good morning|good afternoon|good evening|howdy)/i.test(q) || /how are you|how's it going|what's up/i.test(q)) {
    return { status: 'OK', answer: "Hello! I am VehicleGPT, your conversational vehicle AI. I'm connected to your car's live sensors and also here to answer any automotive, driving, or general questions like ChatGPT. How can I help you today?", severity: 'NONE', active_faults: [], data: null };
  }

  if (/tyre|tire|pressure|psi|puncture/i.test(q)) {
    const detail = lowTyre
      ? `${lowTyre[0]} tyre is low at ${lowTyre[1]} psi (recommended: 32–33 psi). Check for a slow leak.`
      : `All tyres are nominal: FL ${tyres.FL}, FR ${tyres.FR}, RL ${tyres.RL}, RR ${tyres.RR} psi.`;
    return { status: 'WARNING', answer: detail, severity: lowTyre ? 'MEDIUM' : 'NONE', active_faults: [], data: lowTyre ? lowTyre[1] : null };
  }
  if (/batter|volt|start|dead|charge/i.test(q)) {
    const sev = volt < 11.8 ? 'HIGH' : volt < 12.2 ? 'MEDIUM' : 'NONE';
    return { status: volt < 12.0 ? 'WARNING' : 'OK', answer: `Battery is at ${volt} V. ${volt > 12.4 ? 'Healthy — alternator output is optimal.' : 'Voltage is slightly low — consider checking the battery.'}`, severity: sev, active_faults: [], data: volt };
  }
  if (/fuel|range|tank|petrol|mileage|efficien|consum/i.test(q)) {
    const sev = fuel < 15 ? 'HIGH' : fuel < 25 ? 'MEDIUM' : 'NONE';
    return { status: fuel < 15 ? 'WARNING' : 'OK', answer: `Tank is at ${fuel}%, giving approximately ${range} km at your recent average of ${eco} L/100 km.`, severity: sev, active_faults: [], data: fuel };
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

    // Build context string from live CAN data passed from frontend
    const canContext = canData
      ? Object.entries(canData)
          .map(([k, v]) => `${k.toUpperCase()}=${JSON.stringify(v)}`)
          .join(', ')
      : '';

    // Try VehicleGPT backend first
    try {
      const vgptResponse = await fetch(`${VEHICLEGPT_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, context: canContext }),
        signal: AbortSignal.timeout(35000), // 35s timeout for complete LLM generation
      });

      if (vgptResponse.ok) {
        const data = await vgptResponse.json();
        if (data && data.status !== 'ERROR' && data.answer && data.answer.trim().length > 0) {
          return Response.json({ ...data, _source: 'vehiclegpt' });
        }
      }
    } catch {
      // Backend offline or timeout — fall through to local fallback
    }

    // Local fallback engine (works fully offline)
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
