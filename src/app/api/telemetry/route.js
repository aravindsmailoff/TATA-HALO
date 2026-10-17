import fs from 'fs';
import path from 'path';

let cachedFrames = null;
let currentFrameIndex = 0;
let isPlaying = true;
let lastTickTime = Date.now();

function loadFrames() {
  if (cachedFrames && cachedFrames.length > 0) return cachedFrames;

  try {
    const csvPath = path.join(process.cwd(), 'vehiclegpt', 'data', 'datasets', 'raw', 'sample_drive.csv');
    if (!fs.existsSync(csvPath)) return [];

    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n');
    const frameMap = new Map();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const [ts, signal, valStr] = line.split(',');
      if (!ts || !signal || !valStr) continue;

      const numVal = parseFloat(valStr);
      if (isNaN(numVal)) continue;

      if (!frameMap.has(ts)) {
        frameMap.set(ts, {
          timestamp_us: ts,
          speed: 0.0,
          rpm: 820,
          fuel: 64.8,
          volt: 12.6,
          cool: 85.0,
          oil: 40.0,
          tyreFL: 32.0,
        });
      }

      const frame = frameMap.get(ts);
      if (signal === 'PERF_VEHICLE_SPEED') frame.speed = +(numVal.toFixed(1));
      if (signal === 'ENGINE_RPM') frame.rpm = Math.round(numVal);
      if (signal === 'FUEL_LEVEL') frame.fuel = +(numVal.toFixed(2));
      if (signal === 'BATTERY_VOLTAGE') frame.volt = +(numVal.toFixed(2));
      if (signal === 'ENGINE_COOLANT_TEMP') frame.cool = +(numVal.toFixed(1));
      if (signal === 'OIL_PRESSURE') frame.oil = +(numVal.toFixed(1));
      if (signal === 'TIRE_PRESSURE_FL') frame.tyreFL = +(numVal.toFixed(1));
    }

    cachedFrames = Array.from(frameMap.values());
    return cachedFrames;
  } catch (err) {
    console.error('[Telemetry Loader Error]:', err);
    return [];
  }
}

function computeGear(speed, rpm) {
  if (speed < 1.0) return 'N';
  if (speed < 20.0) return '1';
  if (speed < 38.0) return '2';
  if (speed < 60.0) return '3';
  if (speed < 82.0) return '4';
  return '5';
}

function advanceClock() {
  const frames = loadFrames();
  if (!frames || frames.length === 0) return;

  const now = Date.now();
  if (isPlaying) {
    const elapsed = now - lastTickTime;
    // Step 1 frame per 1000ms
    if (elapsed >= 1000) {
      const steps = Math.floor(elapsed / 1000);
      currentFrameIndex = (currentFrameIndex + steps) % frames.length;
      lastTickTime = now;
    }
  } else {
    lastTickTime = now;
  }
}

function formatFrameResponse() {
  const frames = loadFrames();
  if (!frames || frames.length === 0) {
    return {
      frameIndex: 0,
      totalFrames: 1000,
      speed: 0,
      rpm: 820,
      gear: 'N',
      fuel: 64.8,
      range: 421,
      volt: 12.6,
      cool: 88,
      oil: 40,
      tyres: { FL: 32.0, FR: 32.0, RL: 31.0, RR: 28.0 },
      isPlaying: isPlaying,
      timestamp_us: '1791830000000000',
      source: 'sample_drive.csv',
    };
  }

  const f = frames[currentFrameIndex] || frames[0];
  const gear = computeGear(f.speed, f.rpm);
  const calculatedRange = Math.round((f.fuel / 100) * 650); // Tata Punch approx full range 650km

  return {
    frameIndex: currentFrameIndex,
    totalFrames: frames.length,
    speed: f.speed,
    rpm: f.rpm,
    gear,
    fuel: f.fuel,
    range: calculatedRange,
    volt: f.volt,
    cool: f.cool,
    oil: f.oil,
    tyres: {
      FL: f.tyreFL || 32.0,
      FR: 32.0,
      RL: 31.0,
      RR: 28.0,
    },
    isPlaying,
    timestamp_us: f.timestamp_us,
    source: 'sample_drive.csv',
  };
}

export async function GET() {
  advanceClock();
  return Response.json(formatFrameResponse());
}

export async function POST(request) {
  try {
    const body = await request.json();
    const frames = loadFrames();
    const total = frames.length || 1000;

    if (body.action === 'play') {
      isPlaying = true;
      lastTickTime = Date.now();
    } else if (body.action === 'pause') {
      isPlaying = false;
      lastTickTime = Date.now();
    } else if (body.action === 'toggle') {
      isPlaying = !isPlaying;
      lastTickTime = Date.now();
    } else if (body.action === 'seek' && typeof body.frame === 'number') {
      currentFrameIndex = Math.max(0, Math.min(total - 1, Math.round(body.frame)));
      lastTickTime = Date.now();
    } else if (body.action === 'step' && typeof body.delta === 'number') {
      currentFrameIndex = (currentFrameIndex + body.delta + total) % total;
      lastTickTime = Date.now();
    }

    return Response.json(formatFrameResponse());
  } catch (err) {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
}
