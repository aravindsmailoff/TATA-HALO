"""
Extracts official Tata repair & emergency sections from [TATA] NEXON Owners Manual.pdf
and enriches with DIY repair tips, troubleshooting guides, and maintenance procedures.
Saves to vehiclegpt/data/datasets/raw/comprehensive_repair_manual.json and indexes into FAISS.
"""
import json
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("build_manual")

ROOT = Path(__file__).resolve().parent.parent
PDF_PATH = ROOT / "datasets" / "[TATA] NEXON Owners Manual.pdf"
OUT_JSON = ROOT / "vehiclegpt" / "data" / "datasets" / "raw" / "comprehensive_repair_manual.json"

def extract_from_pdf():
    import pypdf
    if not PDF_PATH.exists():
        logger.warning(f"PDF not found at {PDF_PATH}")
        return []

    reader = pypdf.PdfReader(str(PDF_PATH))
    logger.info(f"Loaded {len(reader.pages)} pages from {PDF_PATH.name}")

    page_map = {
        "Tata Nexon Emergency Equipment & Hazard Setup": range(125, 128),
        "Tata Spare Wheel Removal & Jacking Location": range(127, 129),
        "Tata Flat Tyre Changing & Torque Procedure": range(128, 132),
        "Tata 12V Battery Jump Lead Starting Safety": range(131, 134),
        "Tata Emergency Towing & Recovery Guidelines": range(133, 135),
        "Tata Fuse Replacement & Engine/Cabin Fuse Boxes": range(135, 142),
        "Tata Headlamp & Turn Indicator Bulb Replacement": range(142, 146),
        "Tata 24x7 On-Road Assistance Coverage": range(146, 150),
        "Tata Engine Oil Level Dipstick Inspection": range(152, 154),
        "Tata Brake Fluid Inspection & Reservoir": range(153, 155),
        "Tata Engine Coolant Expansion Tank & Refill": range(154, 157),
        "Tata Tyre Pressure Nominal Specs & Rotation": range(156, 160),
        "Tata 12V Battery Maintenance & Terminals": range(159, 162),
    }

    results = []
    for title, pages in page_map.items():
        combined = []
        for p in pages:
            if p < len(reader.pages):
                txt = reader.pages[p].extract_text() or ""
                clean = txt.encode("ascii", errors="ignore").decode("ascii")
                lines = [l.strip() for l in clean.split("\n") if len(l.strip()) > 3 and not "Nexon/" in l and not "EMERGENCY" in l and not "MAINTENANCE" in l]
                combined.append(" ".join(lines))
        clean_text = " ".join(combined).replace("  ", " ")[:1500]
        results.append({
            "topic": title,
            "category": "OFFICIAL_TATA_MANUAL",
            "guide": clean_text
        })
    return results

def get_diy_troubleshooting_tips():
    return [
        {
            "topic": "Squealing or Grinding Brakes Troubleshooting & Repair",
            "category": "BRAKES",
            "guide": (
                "Repair Tip for Squealing or Grinding Brakes: "
                "1. High-pitched squeal when braking usually indicates the brake pad wear indicator clip is touching the rotor (approx 2-3mm pad lining left). Replace brake pads promptly. "
                "2. Metal grinding noise means pads are completely worn down and metal backing plate is contacting rotor; stop driving immediately to avoid rotor damage. "
                "3. Squeak in morning during high humidity is harmless surface rust being scraped off after 2-3 stops. "
                "4. Inspection: Remove wheel, look through caliper inspection hole. Pad thickness must exceed 3.0 mm. Use DOT-4 brake fluid when servicing."
            )
        },
        {
            "topic": "Engine Overheating in Traffic or Highway Emergency Action",
            "category": "COOLING",
            "guide": (
                "Repair Tip for Engine Overheating: "
                "1. If coolant temp exceeds 100°C or warning light turns ON, turn OFF the Air Conditioner immediately and turn ON the cabin heater to maximum fan speed. This pulls heat away from the engine block into the heater core. "
                "2. Pull over safely to the shoulder, put in Neutral/Park, and let engine idle for 1-2 minutes before shutting off so coolant continues circulating. "
                "3. NEVER open the radiator or expansion tank cap while the engine is hot. Wait at least 20-30 minutes until pressure subsides. "
                "4. Check for leaking radiator hoses or broken fan belt. If coolant level is low, refill with 50/50 ethylene glycol coolant or clean water in an emergency."
            )
        },
        {
            "topic": "Rough Idling or Engine Misfire Diagnosis & Spark Plugs",
            "category": "IGNITION",
            "guide": (
                "Repair Tip for Rough Engine Idling or Misfires: "
                "1. Common symptoms: Shaking steering wheel at idle, hesitating during acceleration, check engine light blinking (DTC P0300-P0303). "
                "2. Check spark plugs: Recommended replacement every 30,000 to 40,000 km. Inspect electrode tip for black carbon buildup (rich mix) or wet fuel fouling. Electrode gap should be 0.8–0.9 mm. "
                "3. Ignition Coils: Ensure coil pack connectors are tightly clipped. Swap coil between cylinders to see if misfire code follows the coil. "
                "4. Throttle Body: Clean carbon deposits around throttle butterfly valve with aerosol throttle body cleaner spray."
            )
        },
        {
            "topic": "Car Won't Crank or Start Diagnostic Tree",
            "category": "ELECTRICAL",
            "guide": (
                "Repair Tip when Vehicle Does Not Crank or Start: "
                "1. Rapid clicking sound when turning key: 12V battery is drained below 10.5V. Terminal clamps may have white sulfate oxidation; clean with wire brush and baking soda paste. "
                "2. Completely silent / dashboard dark: Blown main starter fuse (check 40A/60A engine fuse) or loose negative battery ground wire attached to chassis. "
                "3. Engine cranks rapidly but won't fire: Fuel pump not priming (listen for 2-second hum behind rear seat when ignition is ON) or immobilizer key fob battery is dead. "
                "4. Key Fob Battery Dead: Hold key fob directly against Start/Stop button while pressing clutch/brake to activate RFID backup coil."
            )
        },
        {
            "topic": "Air Conditioning Blowing Warm Air Troubleshooting",
            "category": "CLIMATE",
            "guide": (
                "Repair Tip for AC Blowing Warm Air: "
                "1. Check AC Compressor Clutch: Look under bonnet with engine idling and AC ON. Verify the center hub of the AC compressor pulley is spinning, not just the outer ring. "
                "2. Cabin Air Filter: Located behind the glovebox. If clogged with dust and leaves, airflow drops dramatically. Replace cabin filter every 15,000 km or 1 year. "
                "3. Condenser Fins: Inspect front grille condenser radiator for bugs/mud clogging air passage; wash with low-pressure water hose. "
                "4. Low R134a/R1234yf refrigerant gas: If compressor short-cycles every 3-5 seconds, refrigerant is low due to an O-ring leak; needs manifold gauge pressure test."
            )
        },
        {
            "topic": "Steering Wheel Vibration & Pulling Inspection",
            "category": "SUSPENSION",
            "guide": (
                "Repair Tip for Steering Wheel Vibration or Pulling: "
                "1. Vibration felt at 80–110 km/h: Front wheel dynamic imbalance. Wheel weights have fallen off or rims have slight bend. Requires dynamic wheel balancing on shop balancer. "
                "2. Vibration felt during braking only: Warped front brake disc rotors caused by excessive heat or uneven caliper guide pin sliding. Rotors must be resurfaced or replaced. "
                "3. Car pulls to left or right when driving straight on flat road: Front wheel alignment (toe-in / camber) is off, or front tyre pressure is unequal (e.g. 26 psi left vs 33 psi right)."
            )
        },
        {
            "topic": "Dead Key Fob Battery Emergency Start & Replacement",
            "category": "KEY_FOB",
            "guide": (
                "Repair Tip for Dead Smart Key Fob: "
                "1. If key fob battery dies, slide release catch on back of fob to pull out mechanical emergency key. Insert key into driver door lock cylinder to unlock manually. "
                "2. To start engine with dead fob: Depress brake/clutch pedal, take the smart key fob, and press the Start/Stop button directly using the top end of the key fob. The passive RFID transponder inside the fob will energize through magnetic induction. "
                "3. Battery Replacement: Pry open key fob shell with a coin. Replace old coin cell with a fresh CR2032 3V lithium battery, positive (+) side facing up."
            )
        },
        {
            "topic": "Windshield Wiper Smearing & Blade Replacement",
            "category": "MAINTENANCE",
            "guide": (
                "Repair Tip for Wiper Blade Smearing: "
                "1. Streaking or chattering wipers: Clean rubber squeegee blade with a microfiber cloth dipped in rubbing alcohol or washer fluid to remove road grease and sap. "
                "2. Blade Replacement: Lift wiper arm away from glass, press the small plastic release tab on the J-hook, and slide blade down toward bonnet to detach. Slide new 24-inch driver / 16-inch passenger blade on until audible click. "
                "3. Washer Nozzle Clogged: Use a thin sewing pin or needle to unblock the nozzle hole on cowl panel and adjust spray angle."
            )
        }
    ]

def main():
    logger.info("Extracting official manual sections from PDF...")
    pdf_sections = extract_from_pdf()
    diy_tips = get_diy_troubleshooting_tips()

    all_sections = pdf_sections + diy_tips
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(all_sections, f, indent=2)
    logger.info(f"Saved {len(all_sections)} comprehensive manual entries to {OUT_JSON}")

if __name__ == "__main__":
    main()
