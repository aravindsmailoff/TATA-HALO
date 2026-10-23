"""
VehicleGPT — Full Dataset Generator & Trainer
Generates comprehensive automotive Q&A dataset combining:
- [TATA] NEXON Owner's Manual (all 10 chapters + specs)
- Case Study 5 on-device SLM vehicle scenarios & evaluation criteria
- sample_drive.csv telemetry logs & anomaly detection
- Tata Punch vehicle architecture & DIY repair manuals
"""
import json
import csv
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

def build_dataset():
    records = []

    def add(instruction, inp, status, answer, severity="NONE", active_faults=None, data=None):
        if active_faults is None:
            active_faults = []
        out_dict = {
            "status": status,
            "answer": answer,
            "severity": severity,
            "timestamp": "",
            "active_faults": active_faults,
            "data": data
        }
        records.append({
            "instruction": instruction,
            "input": inp,
            "output": json.dumps(out_dict)
        })

    # =========================================================================
    # 1. CASE STUDY 5 EXPLICIT SCENARIOS
    # =========================================================================
    add(
        "Why has my driving range reduced over the last two weeks?",
        "TELEMETRY_LOGS: TIRE_PRESSURE_RR=28.0 psi (nominal 32-33 psi); AVG_RPM=2450 (elevated); RAPID_ACCEL_COUNT=42; AC_DUTY=95%",
        "WARNING",
        "Your driving range dropped primarily due to three factors: 1) Rear-Right tyre pressure dropped to 28 psi, increasing rolling resistance by ~4%. 2) Telemetry logs show 42 aggressive high-RPM acceleration events in lower gears. 3) Continuous 95% AC compressor duty cycle in stop-and-go traffic. Inflating all tyres to 32 psi and using ECO mode will restore ~45 km of range.",
        "MEDIUM",
        [],
        380.0
    )

    add(
        "Why has my driving range reduced suddenly?",
        "FUEL_LEVEL=38.5%, AVG_SPEED=24 km/h, ECO_VAL=8.6 L/100km",
        "WARNING",
        "Your range dropped because your average fuel consumption increased to 8.6 L/100 km due to prolonged low-speed urban driving and idling. At current consumption, your remaining 14.2 liters will yield approximately 165 km instead of the nominal 225 km.",
        "LOW",
        [],
        165.0
    )

    add(
        "When did fuel efficiency show the largest drop?",
        "DRIVE_CYCLE_LOGS: sample_drive.csv analysis over last 30 minutes",
        "WARNING",
        "The largest drop occurred at timestamp 1791830005, when fuel economy sharply dropped from 6.3 L/100 km down to 11.4 L/100 km. Telemetry shows this coincided with a rapid 0 to 98 km/h acceleration where engine RPM surged to 3,304 RPM in 2nd and 3rd gear under wide-open throttle.",
        "MEDIUM",
        [],
        11.4
    )

    add(
        "Show all ADAS disengagement events from yesterday.",
        "DIAGNOSTIC_LOG: CAMERA_STATUS=BLINDED_BY_HEAVY_RAIN, RADAR_STATUS=OK, TIME=16:42:10 IST",
        "WARNING",
        "Yesterday at 16:42:10 IST, Lane Keep Assist (LKA) and Adaptive Cruise Control (ACC) automatically disengaged. The forward vision camera behind the windshield detected optical blockage due to heavy monsoon spray. Lateral control was safely handed back to the driver with an instrument cluster chime.",
        "LOW",
        ["ADAS_CAM_BLIND_01"],
        None
    )

    add(
        "What happened before the battery overheating warning?",
        "PRE_EVENT_LOG: 12V_BUS_VOLTAGE=14.34V, ENGINE_COOLANT_TEMP=93.3C, ALTERNATOR_LOAD=88%, AMBIENT=41C",
        "FAULT",
        "Before the battery overheating warning, the engine compartment ambient reached 41°C while the cooling system ran at 93.3°C under high alternator load (88%) to supply headlights and cabin air conditioning. Continuous 14.34V high-rate float charging in stop-and-go traffic escalated battery core temperature past 58°C.",
        "HIGH",
        ["P0A7F"],
        58.0
    )

    add(
        "Compare energy consumption between city and highway driving.",
        "TELEMETRY_STATS: CITY_AVG=8.2 L/100 km (12.2 km/L) @ 26 km/h; HIGHWAY_AVG=5.8 L/100 km (17.2 km/L) @ 78 km/h",
        "OK",
        "In city driving, consumption averages 8.2 L/100 km (12.2 km/L) due to frequent braking cycles, signal idling, and lower gear operation. In contrast, steady highway cruising in 5th/6th gear achieves 5.8 L/100 km (17.2 km/L) — saving over 29% fuel through steady engine brake thermal efficiency.",
        "NONE",
        [],
        5.8
    )

    # =========================================================================
    # 2. VEHICLE SPECIFICATIONS (TATA NEXON & TATA PUNCH)
    # =========================================================================
    add(
        "Tell me about my car. What kind of car is this?",
        "",
        "OK",
        "You are driving a Tata vehicle (equipped with either the 1.2L Revotron turbocharged/naturally-aspirated petrol or 1.5L Revotorq diesel engine). Built with a certified 5-Star Global NCAP high-strength steel safety structure, it features multi-drive modes (Eco, City, Sport), electric power steering, and comprehensive on-board digital CAN bus diagnostics.",
        "NONE",
        [],
        None
    )

    add(
        "What are the engine specifications for the Tata Nexon?",
        "",
        "OK",
        "The Tata Nexon is available with two engines: 1) 1.2L Revotron Petrol (1198 cc, 3-cylinder, 110 PS @ 5000 rpm, 170 Nm torque @ 1750-4000 rpm). 2) 1.5L Revotorq Diesel (1497 cc, 4-cylinder, 110 PS @ 3750 rpm, 260 Nm torque @ 1500-2750 rpm). Both mate to a 6-speed manual or 6-speed AMT transaxle.",
        "NONE",
        [],
        110.0
    )

    add(
        "What are the engine specifications for the Tata Punch?",
        "",
        "OK",
        "The Tata Punch is powered by a 1.2L Revotron 3-cylinder petrol engine producing 86 PS @ 6000 rpm and 115 Nm torque @ 3250 rpm. It is built on the ALFA-ARC platform with a 5-Star Global NCAP safety rating, 187 mm ground clearance, 37-liter fuel tank, and 366 liters of boot space.",
        "NONE",
        [],
        86.0
    )

    add(
        "What is the fuel tank capacity of the Tata Nexon and Punch?",
        "",
        "OK",
        "The Tata Nexon has a 44-liter fuel tank capacity, while the Tata Punch has a 37-liter fuel tank capacity. Both use unleaded petrol with a minimum RON 91 or BS6 compliant diesel.",
        "NONE",
        [],
        44.0
    )

    add(
        "What are the vehicle dimensions and ground clearance of the Nexon?",
        "",
        "OK",
        "The Tata Nexon dimensions are: Length 3,994 mm, Width 1,811 mm, Height 1,607 mm, and Wheelbase 2,498 mm. Ground clearance is 165 mm laden with 195/60 R16 tyres, 184 mm laden with 215/60 R16 tyres, and 209 mm unladen.",
        "NONE",
        [],
        209.0
    )

    add(
        "What is the minimum turning circle radius for the Nexon?",
        "",
        "OK",
        "The minimum turning circle diameter for the Tata Nexon is 10.2 meters (turning clearance circle diameter is 10.8 meters), making it agile for tight urban u-turns and parking maneuvers.",
        "NONE",
        [],
        10.2
    )

    # =========================================================================
    # 3. TYRES, PRESSURES & WHEELS
    # =========================================================================
    add(
        "What is the recommended tyre pressure for the Tata Nexon?",
        "",
        "OK",
        "Recommended tyre pressure for the Tata Nexon is 30 to 32 psi for all four tyres under unladen / normal load. When fully loaded with 5 passengers and luggage, increase the rear tyres to 34–36 psi. Check tyre pressures cold before driving.",
        "NONE",
        [],
        32.0
    )

    add(
        "What tyre sizes are used on the Tata Nexon?",
        "",
        "OK",
        "The Tata Nexon uses either 195/60 R16 radial tubeless tyres mounted on 6J x 16 steel wheels, or 215/60 R16 radial tubeless tyres mounted on 6.5J x 16 diamond-cut alloy wheels.",
        "NONE",
        [],
        215.0
    )

    add(
        "How do I change a flat tyre and where are the jacking points?",
        "",
        "OK",
        "To change a flat tyre: 1) Park on level ground, apply handbrake, and put gear in 1st/Park. 2) Remove spare wheel, jack, and spanner from boot floor. 3) Loosen lug nuts 1/2 turn. 4) Place jack into the reinforced sill notch right behind front wheel or ahead of rear wheel. 5) Crank jack until flat tyre is 2-3 inches up. 6) Remove lug nuts, mount spare, hand-tighten nuts, lower car, and torque firmly in a star pattern.",
        "NONE",
        [],
        None
    )

    # =========================================================================
    # 4. ENGINE OIL, FLUIDS & CAPACITIES
    # =========================================================================
    add(
        "What engine oil should I use for the Tata Nexon and how much?",
        "",
        "OK",
        "For the 1.2L Revotron Petrol engine, use 3.5 Litres of 5W-30 ACEA A5/B5 synthetic oil (Castrol Magnatec Professional T 5W30 or Mobil Super 3000 TMGO 5W30). For the 1.5L Revotorq Diesel, use 5.0 Litres of 5W-30 synthetic oil (Petronas Tata Motors Genuine Oil).",
        "NONE",
        [],
        3.5
    )

    add(
        "How do I check the engine oil level with the dipstick?",
        "",
        "OK",
        "With engine switched off and cold (wait 10 mins on level ground): 1) Pull out yellow dipstick in engine bay. 2) Wipe oil clean with a cloth. 3) Push dipstick fully back into tube and pull out again. 4) The oil film must lie between MIN and MAX. If near MIN, top up with 0.5L of 5W-30 synthetic oil.",
        "NONE",
        [],
        None
    )

    add(
        "What coolant does the vehicle use and what is the mix ratio?",
        "",
        "OK",
        "The vehicle uses Class II / JIS K2234 pre-mixed ethylene glycol antifreeze coolant conforming to Tata SS7700S1 specifications in a 40:60 to 50:50 antifreeze-to-soft-water ratio. Total capacity is approximately 5.5 to 6.0 Litres.",
        "NONE",
        [],
        5.5
    )

    add(
        "What brake fluid does my car require?",
        "",
        "OK",
        "Your vehicle uses DOT 4 brake fluid conforming to SAE J 1703 or FMVSS 116. Ensure the reservoir level is maintained between MIN and MAX marks. Never allow brake fluid to drop below MIN.",
        "NONE",
        [],
        None
    )

    # =========================================================================
    # 5. ELECTRICAL SYSTEM, BATTERY & JUMP-START
    # =========================================================================
    add(
        "How do I jump-start my car if the 12V battery is dead?",
        "",
        "OK",
        "To jump-start: 1) Connect RED cable to POSITIVE (+) of both dead and helper batteries. 2) Connect BLACK cable to helper battery NEGATIVE (-). 3) Connect other end of BLACK cable to an unpainted metal engine bolt or frame of your dead car (never directly to dead battery negative). 4) Run helper car 3 mins, then crank your engine. 5) Disconnect in reverse order and drive 20-30 mins to recharge.",
        "NONE",
        [],
        None
    )

    add(
        "What battery does the Tata Nexon use?",
        "",
        "OK",
        "The Tata Nexon uses a 12V, 44Ah negative-earth battery (DIN 55) paired with a 110 Amp alternator. Nominal resting voltage is 12.4V to 12.7V, and charging voltage is 13.8V to 14.4V.",
        "NONE",
        [],
        12.6
    )

    add(
        "Where are the fuse boxes located and how do I replace a blown fuse?",
        "",
        "OK",
        "There are two fuse boxes: 1) Cabin Fuse Box located on the driver's side (RH) below the steering wheel behind the coin pocket/fuse flap. 2) Engine Compartment Fuse Box located adjacent to the 12V battery under the bonnet. Use the white plastic puller clip and replace blown fuses with an identical amperage fuse.",
        "NONE",
        [],
        None
    )

    add(
        "How do I replace the key fob battery (PEPS smart key)?",
        "",
        "OK",
        "For PEPS Smart Key: 1) Pull out emergency mechanical key blade. 2) Push the cover latch tab with a small flat blade tool to unclip battery cover. 3) Replace with a new CR 2032 3V coin cell battery with positive (+) facing upward. 4) Snap the cover firmly back in place until it clicks.",
        "NONE",
        [],
        None
    )

    # =========================================================================
    # 6. DRIVE MODES & DRIVING CONTROLS
    # =========================================================================
    add(
        "What are the Drive Modes (Eco, City, Sport) and how do they work?",
        "",
        "OK",
        "The Drive Mode selector adjusts engine throttle response and torque mapping: 1) ECO Mode: Optimizes fuel economy by softening accelerator response, ideal for open highway cruising. 2) CITY Mode: Default balanced mode providing smooth drivability and comfort for stop-and-go urban traffic. 3) SPORT Mode: Sharpens throttle response and unleashes peak torque (170 Nm petrol / 260 Nm diesel) for spirited overtaking.",
        "NONE",
        [],
        None
    )

    add(
        "How does the Automated Manual Transmission (AMT) kick-down feature work?",
        "",
        "OK",
        "When you rapidly press the accelerator pedal past the resistance point (kick-down) in an AMT vehicle, the transmission controller automatically shifts down one or two gears instantly to provide rapid engine acceleration and maximum torque for safe overtaking.",
        "NONE",
        [],
        None
    )

    add(
        "How does PEPS (Passive Entry Passive Start) push button start work?",
        "",
        "OK",
        "With PEPS smart key in your pocket/cabin: 1) Press clutch (manual) or brake pedal (AMT). 2) Press the START/STOP button on the dashboard once to crank the engine. To turn off, park vehicle, apply handbrake, and press the START/STOP button once.",
        "NONE",
        [],
        None
    )

    # =========================================================================
    # 7. SAFETY, BRAKING & INSTRUMENT CLUSTER
    # =========================================================================
    add(
        "What safety features does the vehicle have?",
        "",
        "OK",
        "The vehicle features a 5-Star Global NCAP certified body structure with high-strength steel roll cage, dual front airbags, ABS with Electronic Brakeforce Distribution (EBD), Corner Stability Control (CSC), ISOFIX child seat mounts, speed-sensing door locks, and engine immobilizer.",
        "NONE",
        [],
        5.0
    )

    add(
        "What does the ABS (Anti-lock Braking System) do and how does it feel?",
        "",
        "OK",
        "ABS prevents the wheels from locking up under emergency hard braking, allowing the driver to steer around obstacles. When ABS activates, you will feel a rapid pulsation in the brake pedal along with a clicking noise — this is normal operation; maintain firm, steady pedal pressure.",
        "NONE",
        [],
        None
    )

    add(
        "Why is my check engine light on (MIL)?",
        "DTC=P0130, EMISSION_SYSTEM=WARNING",
        "WARNING",
        "The Malfunction Indication Lamp (MIL / Check Engine Light) turned on because the powertrain controller detected an emission-related sensor issue (P0130 indicates oxygen sensor circuit anomaly). If the light is steady, ensure your fuel filler cap is clicked tightly and drive moderately to an authorized service centre. If flashing, stop driving immediately.",
        "MEDIUM",
        ["P0130"],
        None
    )

    add(
        "What does error code P0300 mean?",
        "DTC=P0300 (Random/Multiple Cylinder Misfire Detected)",
        "FAULT",
        "DTC P0300 indicates random or multiple cylinder misfires. Causes include worn spark plugs, faulty ignition coils, low fuel rail pressure, or vacuum leaks. The engine may shake at idle or lose acceleration power. Drive at low engine speeds and have the ignition system inspected.",
        "HIGH",
        ["P0300"],
        None
    )

    add(
        "What does error code P0217 mean?",
        "ENGINE_COOLANT_TEMP=108.5 C",
        "CRITICAL",
        "DTC P0217 indicates engine coolant over-temperature condition (>105°C). Stop the vehicle immediately in a safe location, idle for 1 minute, and turn off the engine. Do not open the radiator or expansion tank cap while hot. Check for coolant leaks or damaged radiator fan.",
        "CRITICAL",
        ["P0217"],
        108.5
    )

    add(
        "What does error code P0562 mean?",
        "BATTERY_VOLTAGE=11.2 V",
        "WARNING",
        "DTC P0562 indicates system low voltage (below 11.5V). The alternator may have a slipping drive belt, faulty voltage regulator, or the 12V battery is reaching end-of-life and unable to maintain charge.",
        "HIGH",
        ["P0562"],
        11.2
    )

    # =========================================================================
    # 8. SERVICE SCHEDULES & MAINTENANCE TIMELINES
    # =========================================================================
    add(
        "When is the routine service due for Tata vehicles?",
        "",
        "OK",
        "Periodic service intervals are scheduled every 15,000 km or 12 months (whichever occurs first). The 1st free service is at 1,000–1,500 km or 2 months, 2nd free service at 7,500 km or 6 months, and 3rd service (first major engine oil and filter change) at 15,000 km or 12 months.",
        "NONE",
        [],
        15000.0
    )

    add(
        "When should I replace spark plugs and air filters?",
        "",
        "OK",
        "The engine air filter should be inspected and cleaned every 15,000 km and replaced every 30,000 km. Spark plugs in Revotron petrol engines should be replaced every 45,000 km (or 3 years) for optimal combustion and fuel efficiency.",
        "NONE",
        [],
        45000.0
    )

    add(
        "How do I prepare my car if parking for long durations?",
        "",
        "OK",
        "For parking over 1 month: 1) Inflate tyres to 36 psi to prevent flat spots. 2) Disconnect negative terminal of 12V battery. 3) Leave handbrake released and place wheel chocks under tyres (prevents brake shoes sticking). 4) Park in shade with a car cover. 5) Keep fuel tank nearly full to prevent condensation rust.",
        "NONE",
        [],
        None
    )

    # =========================================================================
    # 9. CLIMATE CONTROL & INTERIOR CONVENIENCE
    # =========================================================================
    add(
        "How does FATC (Fully Automatic Temperature Control) work?",
        "",
        "OK",
        "With FATC, set your desired cabin temperature (e.g., 22°C) using the rotary dial and press the 'AUTO' switch. The system automatically regulates compressor engagement, blower speed, air intake (fresh/recirculation), and air distribution according to in-cabin and sunload sensors.",
        "NONE",
        [],
        22.0
    )

    add(
        "How do I defog the front and rear windshield quickly?",
        "",
        "OK",
        "To defog instantly: 1) Press the front defogger switch (turns on AC at max airflow directed to windshield and switches to fresh air mode). 2) Press the rear windshield defogger switch to activate the embedded electric heating element grid (auto shut-off after 15 minutes).",
        "NONE",
        [],
        None
    )

    # =========================================================================
    # 10. REAL-TIME TELEMETRY SENSOR SCENARIOS (From sample_drive.csv)
    # =========================================================================
    add(
        "What is my current vehicle speed and gear?",
        "PERF_VEHICLE_SPEED=61.8 km/h, GEAR=4, ENGINE_RPM=2060 rpm",
        "OK",
        "You are currently driving at 61.8 km/h in 4th gear with the engine turning smoothly at 2,060 RPM.",
        "NONE",
        [],
        61.8
    )

    add(
        "Is my engine coolant temperature normal right now?",
        "ENGINE_COOLANT_TEMP=88.5 celsius",
        "OK",
        "Yes, your engine coolant temperature is nominal at 88.5°C, well within the factory thermostat operating window of 85°C to 95°C.",
        "NONE",
        [],
        88.5
    )

    add(
        "How is my 12V battery health and alternator charging?",
        "BATTERY_VOLTAGE=14.1 V",
        "OK",
        "Your electrical system is operating in prime condition. The alternator is actively charging the 12V bus at 14.1V, confirming full generator output and healthy battery state of health.",
        "NONE",
        [],
        14.1
    )

    add(
        "How much fuel do I have and how far can I drive?",
        "FUEL_LEVEL=63.5%, TANK_CAPACITY=44L, ECO=6.3 L/100km",
        "OK",
        "You have 63.5% fuel (~27.9 Liters) remaining in your tank. Based on your current consumption of 6.3 L/100 km, your estimated driving range is approximately 443 km.",
        "NONE",
        [],
        443.0
    )

    add(
        "What is my oil pressure?",
        "OIL_PRESSURE=52.8 kPa",
        "OK",
        "Engine oil pressure is healthy at 52.8 kPa during cruising, ensuring excellent hydrodynamic lubrication across all engine bearings and valvetrain components.",
        "NONE",
        [],
        52.8
    )

    add(
        "How can I get the best fuel mileage from my car?",
        "",
        "OK",
        "To maximize fuel economy: 1) Keep all tyre pressures inflated to 32 psi. 2) Upshift between 2,000–2,200 RPM and cruise in the highest gear. 3) Select ECO driving mode on open roads. 4) Anticipate traffic stops to avoid harsh braking. 5) Keep windows rolled up at highway speeds (>70 km/h) to minimize aerodynamic drag.",
        "NONE",
        [],
        None
    )

    # Save to files
    out_json = BASE_DIR / "vehiclegpt" / "data" / "datasets" / "training" / "automotive_full_dataset.json"
    out_jsonl = BASE_DIR / "vehiclegpt" / "data" / "datasets" / "training" / "automotive_full_dataset.jsonl"
    out_json.parent.mkdir(parents=True, exist_ok=True)

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)

    with open(out_jsonl, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"Generated {len(records)} comprehensive training records:")
    print(f"  -> {out_json}")
    print(f"  -> {out_jsonl}")

if __name__ == "__main__":
    build_dataset()
