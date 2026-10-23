# 1-Year Monitored Vehicle Case Study (SYNTHETIC)

Vehicle: compact-SUV 1.5 L CRDi diesel, 6MT (modelled on a Creta-class car). Window: 2025-10-24 .. 2026-10-23 (365 days; last day = engine failure morning).
Case-study question: "My car ran very smoothly last month and today I got an engine failure. What exactly caused it?"

## Files
| file | grain | purpose |
|---|---|---|
| vehicle_master.json | 1 | A-Z identity, engine/chassis specs, OEM fluid specs, ECU alert thresholds, ECU/bus list, insurance/statutory |
| components.csv | 123 components | full inventory: spec, install date/odo, intervals, next-due, overdue flag, notes |
| daily_telemetry.csv | 365 days | 45 daily fields: coolant temp/level, oil level/pressure, DPF, battery, TPMS, fuel, driving style, weather, active-DTC count |
| trips.csv | 604 trips | per-trip summary of 40+ signals |
| trips_highres_10s.csv | 4 key trips | 10 s samples: healthy baseline, 3-Sep overheat, 22-Oct outbound, 22-Oct return jam |
| failure_trip_1hz.csv | 350 s | 1 Hz record of the failure morning (23-Oct 07:42:10) incl. misfire counters |
| service_history.csv | 30 events | services, repairs, accessory fits, washes, DIY actions: what was billed vs what the vehicle data evidences |
| parts_replaced.csv | 20 lines | part, grade, why replaced, trigger, removed-part condition, spec conformance |
| dtc_events.csv / warning_lamps.csv | 13 / 14 | codes with freeze frames, clears, dashboard lamps |
| fuel_log.csv | 24 fills | pump litres, price, station, full-to-full km/l |
| events_timeline.csv | unified | chronological feed of everything (best retrieval corpus for the SLM) |
| accessories.csv, signal_catalog.csv | | aftermarket fits; signal -> bus/CAN ID/VHAL property/rate/ASIL map |
| vehicle_case_study.db | SQLite | every table above, indexed |
| ground_truth/ | | root-cause chain, ruled-out hypotheses, simulated teardown, 30 Q&A with gold answers. DO NOT feed to the model under test |

## How to use for VehicleGPT
1. Index events_timeline.csv + service_history + parts_replaced + dtc_events as text chunks (one row = one chunk); keep daily/trips in SQLite for numeric tool-calls (the SLM emits SQL, not arithmetic).
2. Ask the case question; score against ground_truth/qa_eval.jsonl (30 questions: lookup, aggregation, trend, causal, timeline).
3. A good answer must connect: Apr-4 service defects -> coolant-level decline -> ignored lamp/water top-ups -> overheats -> oil-level rise + pressure drop -> failure. A keyword-only retriever will not.

## Honest limits
- Synthetic: physics are simple first-order models; weather, prices, part numbers, VIN and plate are invented. It tests reasoning/retrieval, not real-engine fidelity.
- coolant_level_pct and oil_level_pct are modelled as continuous sensor signals; most production cars only expose a switch/dipstick, so the real project needs a telematics unit or a sensor-poor fallback.
- Replace with real CAN/OBD logs (python-can / ELM327 / VHAL dumps) before claiming any accuracy number.
