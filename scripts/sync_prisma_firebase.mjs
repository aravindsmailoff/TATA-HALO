/**
 * Automotive Lifecycle Synchronizer
 * Connects Prisma (SQLite) and Firebase Realtime Database
 * Aggregates parts replaced, monthly service visits, and breakdown events grouped by Month.
 *
 * Firebase RTDB URL:
 * https://ner-landslide-cd648-default-rtdb.asia-southeast1.firebasedatabase.app/
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATASETS_DIR = path.join(ROOT_DIR, 'datasets');

const FIREBASE_BASE_URL = 'https://ner-landslide-cd648-default-rtdb.asia-southeast1.firebasedatabase.app';

const prisma = new PrismaClient();

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    // CSV parser handling quoted fields containing commas
    const values = [];
    let cur = '';
    let inQuote = false;
    for (let c = 0; c < rawLine.length; c++) {
      const char = rawLine[c];
      if (char === '"') {
        inQuote = !inQuote;
      } else if (char === ',' && !inQuote) {
        values.push(cur.trim().replace(/^"|"$/g, ''));
        cur = '';
      } else {
        cur += char;
      }
    }
    values.push(cur.trim().replace(/^"|"$/g, ''));

    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] ?? '';
    });
    rows.push(obj);
  }
  return rows;
}

function getMonthKey(dateOrTimestampStr) {
  if (!dateOrTimestampStr) return 'UNKNOWN';
  // Extracts YYYY-MM
  const match = dateOrTimestampStr.match(/^(\d{4})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  return 'UNKNOWN';
}

async function syncAll() {
  console.log('🔄 Loading dataset files from:', DATASETS_DIR);
  const rawServices = parseCSV(path.join(DATASETS_DIR, 'service_history.csv'));
  const rawParts = parseCSV(path.join(DATASETS_DIR, 'parts_replaced.csv'));
  const rawEvents = parseCSV(path.join(DATASETS_DIR, 'events_timeline.csv'));

  console.log(`Parsed ${rawServices.length} services, ${rawParts.length} parts, ${rawEvents.length} timeline events.`);

  // Clean old Prisma records
  console.log('🧹 Clearing old Prisma tables...');
  await prisma.breakdownEvent.deleteMany({});
  await prisma.timelineEvent.deleteMany({});
  await prisma.partReplacement.deleteMany({});
  await prisma.serviceRecord.deleteMany({});
  await prisma.monthlyLog.deleteMany({});

  // 1. Group all records by Month
  const monthsMap = new Map();

  function getOrCreateMonth(mKey) {
    if (!monthsMap.has(mKey)) {
      const [yearStr, monthStr] = mKey.split('-');
      monthsMap.set(mKey, {
        month: mKey,
        year: parseInt(yearStr, 10) || 2026,
        monthNumber: parseInt(monthStr, 10) || 1,
        totalServices: 0,
        totalParts: 0,
        totalCostInr: 0,
        hasBreakdown: false,
        summaryParts: [],
        services: [],
        parts: [],
        events: [],
        breakdowns: [],
      });
    }
    return monthsMap.get(mKey);
  }

  // Group Services
  for (const s of rawServices) {
    const mKey = getMonthKey(s.date);
    const m = getOrCreateMonth(mKey);
    m.totalServices += 1;
    const cost = parseFloat(s.total_cost_inr) || 0;
    m.totalCostInr += cost;
    m.services.push({
      id: s.service_id,
      date: s.date,
      odometerKm: parseFloat(s.odometer_km) || 0,
      provider: s.provider || '',
      providerType: s.provider_type || '',
      totalCostInr: cost,
      itemsBilled: s.items_billed || '[]',
      qualityFlag: s.quality_flag || '',
      findings: s.findings || '',
    });
  }

  // Group Parts Replaced
  for (const p of rawParts) {
    const mKey = getMonthKey(p.date);
    const m = getOrCreateMonth(mKey);
    m.totalParts += 1;
    m.parts.push({
      id: p.part_id,
      partName: p.part_name || '',
      serviceId: p.service_id || '',
      date: p.date,
      odometerKm: parseFloat(p.odometer_km) || 0,
      system: p.system || '',
      specConformant: (p.spec_conformant || '').toLowerCase() === 'true',
      oemSpec: p.oem_spec || '',
      installedSpec: p.installed_spec || '',
      reason: p.reason || '',
    });
  }

  // Group Timeline Events & Detect Breakdowns
  for (const e of rawEvents) {
    const mKey = getMonthKey(e.timestamp);
    const m = getOrCreateMonth(mKey);
    const isBreakdown = (e.category || '').toLowerCase() === 'breakdown' || (e.title || '').toLowerCase().includes('breakdown');
    if (isBreakdown) {
      m.hasBreakdown = true;
      m.breakdowns.push({
        id: e.event_id,
        date: e.timestamp.split(' ')[0],
        odometerKm: parseFloat(e.odometer_km) || 37425.0,
        rootCause: 'Progressive cooling-system failure -> 0.9 bar aftermarket cap + skipped flush -> 118.6°C jam overheat -> head gasket rupture -> oil dilution (110.3%) -> rod bearing seizure on cyl 3/4',
        peakCoolantTempC: 118.6,
        finalOilLevelPct: 110.3,
        oilPressureKpa: 38.0,
        seizedCylinders: '3, 4',
        ruledOut: 'Floodwater, Low oil starvation, 12V battery, Fuel contamination',
      });
    }

    m.events.push({
      id: e.event_id,
      timestamp: e.timestamp,
      odometerKm: parseFloat(e.odometer_km) || 0,
      category: e.category || 'general',
      severity: e.severity || 'info',
      title: e.title || '',
      detail: e.detail || '',
    });
  }

  // Generate Summaries for each month
  for (const [mKey, m] of monthsMap.entries()) {
    const summaryItems = [];
    if (m.services.length > 0) {
      summaryItems.push(`${m.services.length} workshop service(s) (Rs ${m.totalCostInr.toLocaleString()})`);
    }
    if (m.parts.length > 0) {
      summaryItems.push(`parts replaced: ${m.parts.map(p => p.partName).join(', ')}`);
    }
    if (m.hasBreakdown) {
      summaryItems.push(`CRITICAL ENGINE BREAKDOWN on 2026-10-23 (rod bearing seizure on cyl 3/4)`);
    }
    if (m.events.length > 0) {
      summaryItems.push(`${m.events.length} timeline event(s)`);
    }
    m.summary = `Month ${mKey}: ${summaryItems.join('; ')}.`;
  }

  // 2. Persist to Prisma SQLite
  console.log(`💾 Persisting ${monthsMap.size} monthly timeline blocks to SQLite via Prisma...`);
  const sortedMonths = Array.from(monthsMap.keys()).sort();

  for (const mKey of sortedMonths) {
    const m = monthsMap.get(mKey);
    await prisma.monthlyLog.create({
      data: {
        month: m.month,
        year: m.year,
        monthNumber: m.monthNumber,
        totalServices: m.totalServices,
        totalParts: m.totalParts,
        totalCostInr: m.totalCostInr,
        hasBreakdown: m.hasBreakdown,
        summary: m.summary,
        services: {
          create: m.services,
        },
        partsReplaced: {
          create: m.parts,
        },
        events: {
          create: m.events,
        },
        breakdowns: {
          create: m.breakdowns,
        },
      },
    });
  }

  console.log('✅ SQLite persistence complete!');

  // 3. Sync to Firebase Realtime Database
  console.log('🔥 Synchronizing monthly grouped data to Firebase Realtime Database at:', FIREBASE_BASE_URL);

  const firebasePayload = {
    updated_at: new Date().toISOString(),
    total_months: sortedMonths.length,
    vehicle_vin: 'TATA-PUNCH-REVOTRON-2026',
    breakdown_incident: {
      occurred_month: '2026-10',
      date: '2026-10-23',
      odometer_km: 37425.0,
      root_cause: 'Cooling system degradation (0.9 bar universal cap & unperformed flush at SVC016) -> Acute 118.6°C overheat on 2026-10-22 -> Cylinder 3/4 head gasket breach -> Coolant flooded oil (110.3%) -> Rod bearing seizure and terminal stall.',
      seized_cylinders: [3, 4],
      peak_coolant_temp_c: 118.6,
      final_oil_level_pct: 110.3,
      oil_pressure_collapse_kpa: 38.0,
      ruled_out_hypotheses: [
        'Floodwater ingestion (Intake dry on 2025-11-08)',
        'Low oil starvation (Oil level rose to 110.3%)',
        '12V Battery failure (Replaced 2026-02-18, healthy 14.1V)',
        'Fuel contamination (Water drained 2026-08-18)'
      ]
    },
    monthly_timeline: {},
  };

  for (const mKey of sortedMonths) {
    const m = monthsMap.get(mKey);
    // Sanitize key for Firebase (no invalid chars)
    const cleanKey = mKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    firebasePayload.monthly_timeline[cleanKey] = {
      month: m.month,
      year: m.year,
      monthNumber: m.monthNumber,
      totalServices: m.totalServices,
      totalParts: m.totalParts,
      totalCostInr: m.totalCostInr,
      hasBreakdown: m.hasBreakdown,
      summary: m.summary,
      services: m.services,
      partsReplaced: m.parts,
      breakdowns: m.breakdowns,
      eventsCount: m.events.length,
    };
  }

  const putUrl = `${FIREBASE_BASE_URL}/vehicle_lifecycle.json`;
  const res = await fetch(putUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(firebasePayload),
  });

  if (res.ok) {
    console.log('✅ Successfully published vehicle lifecycle & monthly aggregated data to Firebase Realtime Database!');
    const respData = await res.json();
    console.log(`Firebase response updated_at: ${respData.updated_at}, months: ${respData.total_months}`);
  } else {
    console.error('❌ Failed to push to Firebase:', res.status, await res.text());
  }

  await prisma.$disconnect();
}

syncAll().catch(err => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});
