"""
VehicleGPT — Automotive Common Data Model (CDM) Loader
Loads heterogeneous raw vehicle datasets (CSV, JSON, SQLite) into strongly-typed CDM instances
and provides fast in-memory query indexing.
"""

import os
import json
import csv
import sqlite3
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any

from .models import (
    VehicleMasterCDM,
    ComponentCDM,
    DailyObservationCDM,
    TripTelemetryCDM,
    HighResTelemetryCDM,
    MaintenanceRecordCDM,
    PartReplacementCDM,
    DiagnosticEventCDM,
    CausalDiagnosisCDM,
)

logger = logging.getLogger("vehiclegpt.cdm.loader")


class CDMLoader:
    """
    Ingests and normalizes the 1-year monitored vehicle dataset into the Common Data Model.
    Provides fast indexed lookups across all 24/7 digital twin domains.
    """

    def __init__(self, dataset_dir: Optional[str] = None):
        if dataset_dir:
            self.dataset_dir = Path(dataset_dir)
        else:
            # Default to d:/TATA/datasets or relative to project root
            base = Path(__file__).resolve().parent.parent.parent
            candidate = base / "datasets"
            if candidate.exists():
                self.dataset_dir = candidate
            else:
                self.dataset_dir = Path("d:/TATA/datasets")

        self.master: Optional[VehicleMasterCDM] = None
        self.components: List[ComponentCDM] = []
        self.components_by_id: Dict[str, ComponentCDM] = {}
        self.daily_observations: List[DailyObservationCDM] = []
        self.daily_by_date: Dict[str, DailyObservationCDM] = {}
        self.trips: List[TripTelemetryCDM] = []
        self.failure_stream: List[HighResTelemetryCDM] = []
        self.services: List[MaintenanceRecordCDM] = []
        self.services_by_id: Dict[str, MaintenanceRecordCDM] = {}
        self.parts_replaced: List[PartReplacementCDM] = []
        self.diagnostic_events: List[DiagnosticEventCDM] = []
        self.ground_truth_diagnosis: Optional[CausalDiagnosisCDM] = None
        self.qa_eval_set: List[Dict[str, Any]] = []

        self.load_all()

    def load_all(self):
        """Loads all CDM entities from disk."""
        logger.info(f"Loading vehicle dataset into CDM from {self.dataset_dir}...")
        self._load_master()
        self._load_components()
        self._load_daily_telemetry()
        self._load_trips()
        self._load_failure_stream()
        self._load_services()
        self._load_parts()
        self._load_diagnostic_events()
        self._load_ground_truth()
        self._load_qa_eval()
        logger.info(
            f"CDM Load complete: {len(self.components)} components, "
            f"{len(self.daily_observations)} daily observation cycles (24/7), "
            f"{len(self.trips)} trips, {len(self.services)} service records, "
            f"{len(self.diagnostic_events)} diagnostic timeline events."
        )

    def _load_master(self):
        master_file = self.dataset_dir / "vehicle_master.json"
        if not master_file.exists():
            logger.warning(f"vehicle_master.json not found at {master_file}")
            return
        with open(master_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        ident = data.get("identity", {})
        eng = data.get("engine", {})
        chassis = data.get("chassis", {})
        fluids = data.get("fluids_oem_spec", {})
        ecu = data.get("ecu_thresholds", {})
        svc = data.get("service_schedule", {})

        self.master = VehicleMasterCDM(
            vin=ident.get("vin", "UNKNOWN"),
            make=ident.get("make", "Hyundai (modelled)"),
            model=ident.get("model", "Creta-class compact SUV"),
            variant=ident.get("variant", "1.5 CRDi SX 6MT"),
            model_year=ident.get("model_year", 2023),
            registration=ident.get("registration", "TN 09 SY 4821"),
            colour=ident.get("colour", "Polar White"),
            engine_code=eng.get("code", "U2-class 1.5 CRDi"),
            displacement_cc=eng.get("displacement_cc", 1493),
            cylinders=eng.get("cylinders", "4 inline"),
            power_ps=eng.get("power", "113 PS @ 4000 rpm"),
            torque_nm=eng.get("torque", "250 Nm @ 1500-2750 rpm"),
            idle_rpm=eng.get("idle_rpm", 780),
            transmission_type=data.get("transmission", {}).get("type", "6-speed manual"),
            fuel_tank_l=float(chassis.get("fuel_tank_l", 50.0)),
            tyre_size=chassis.get("tyres", "215/60 R17"),
            tyre_psi_spec=33.0,
            kerb_weight_kg=float(chassis.get("kerb_weight_kg", 1300.0)),
            ground_clearance_mm=float(chassis.get("ground_clearance_mm", 190.0)),
            oem_engine_oil=fluids.get("engine_oil", "5W-30 ACEA C3 (low-SAPS, DPF-safe)"),
            oem_coolant=fluids.get("coolant", "OAT ethylene-glycol 50:50 premix, -37 C freeze"),
            oem_radiator_cap_bar=float(fluids.get("radiator_cap_bar", 1.1)),
            ecu_thresholds=ecu,
            service_interval_km=svc.get("interval_km", 10000),
            service_interval_months=svc.get("interval_months", 12),
            odometer_start_km=float(ident.get("odometer_window_start_km", 24310.4)),
            odometer_end_km=float(ident.get("odometer_at_failure_km", 37425.0)),
        )

    def _load_components(self):
        fpath = self.dataset_dir / "components.csv"
        if not fpath.exists():
            return
        with open(fpath, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for r in reader:
                c_id = r.get("component_id", "")
                interval = float(r["service_interval_km"]) if r.get("service_interval_km") else None
                next_due = float(r["next_due_km"]) if r.get("next_due_km") else None
                comp = ComponentCDM(
                    component_id=c_id,
                    name=r.get("component_name", ""),
                    subsystem=r.get("subsystem", ""),
                    installed_date=r.get("install_date", ""),
                    installed_odometer_km=float(r.get("install_odometer_km", 0.0) or 0.0),
                    service_interval_km=interval,
                    next_due_km=next_due,
                    is_overdue=str(r.get("is_overdue", "0")).lower() in ("1", "true", "yes"),
                    oem_spec=r.get("oem_spec", ""),
                    installed_spec=r.get("installed_spec", ""),
                    spec_conformance=str(r.get("spec_conformance", "1")).lower() in ("1", "true", "yes"),
                    notes=r.get("notes", ""),
                )
                self.components.append(comp)
                self.components_by_id[c_id] = comp

    def _load_daily_telemetry(self):
        fpath = self.dataset_dir / "daily_telemetry.csv"
        if not fpath.exists():
            return
        with open(fpath, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for r in reader:
                d_str = r.get("date", "")
                obs = DailyObservationCDM(
                    date=d_str,
                    weekday=r.get("weekday", ""),
                    odometer_start_km=float(r.get("odo_start", 0.0) or 0.0),
                    odometer_end_km=float(r.get("odo_end", 0.0) or 0.0),
                    distance_km=float(r.get("distance_km", 0.0) or 0.0),
                    trips_count=int(float(r.get("trips", 0.0) or 0)),
                    drive_minutes=float(r.get("drive_min", 0.0) or 0.0),
                    idle_minutes=float(r.get("idle_min", 0.0) or 0.0),
                    avg_speed_kmph=float(r.get("avg_speed_kmph", 0.0) or 0.0),
                    max_speed_kmph=float(r.get("max_speed_kmph", 0.0) or 0.0),
                    fuel_used_l=float(r.get("fuel_used_l", 0.0) or 0.0),
                    fuel_economy_kmpl=float(r.get("fuel_economy_kmpl", 0.0) or 0.0),
                    coolant_temp_avg_c=float(r.get("coolant_temp_avg_c", 0.0) or 0.0),
                    coolant_temp_max_c=float(r.get("coolant_temp_max_c", 0.0) or 0.0),
                    min_coolant_gt100c=float(r.get("min_coolant_gt100c", 0.0) or 0.0),
                    min_coolant_gt105c=float(r.get("min_coolant_gt105c", 0.0) or 0.0),
                    coolant_level_pct_am=float(r.get("coolant_level_pct_am", 0.0) or 0.0),
                    oil_level_pct_am=float(r.get("oil_level_pct_am", 0.0) or 0.0),
                    oil_pressure_cold_idle_kpa=float(r.get("oil_pressure_cold_idle_kpa", 0.0) or 0.0),
                    oil_pressure_hot_idle_kpa=float(r.get("oil_pressure_hot_idle_kpa", 0.0) or 0.0),
                    oil_pressure_3000rpm_kpa=float(r.get("oil_pressure_3000rpm_kpa", 0.0) or 0.0),
                    oil_temp_max_c=float(r.get("oil_temp_max_c", 0.0) or 0.0),
                    dpf_soot_end_pct=float(r.get("dpf_soot_end_pct", 0.0) or 0.0),
                    dpf_regens=int(float(r.get("dpf_regens", 0.0) or 0)),
                    battery_rest_v_am=float(r.get("battery_rest_v_am", 0.0) or 0.0),
                    battery_cranking_min_v=float(r.get("battery_cranking_min_v", 0.0) or 0.0),
                    alternator_v_avg=float(r.get("alternator_v_avg", 0.0) or 0.0),
                    tyre_psi_fl=float(r.get("tyre_psi_fl", 0.0) or 0.0),
                    tyre_psi_fr=float(r.get("tyre_psi_fr", 0.0) or 0.0),
                    tyre_psi_rl=float(r.get("tyre_psi_rl", 0.0) or 0.0),
                    tyre_psi_rr=float(r.get("tyre_psi_rr", 0.0) or 0.0),
                    hard_brakes=int(float(r.get("hard_brakes", 0.0) or 0)),
                    hard_accels=int(float(r.get("hard_accels", 0.0) or 0)),
                    harsh_corners=int(float(r.get("harsh_corners", 0.0) or 0)),
                    dtc_active_count=int(float(r.get("dtc_active_count_end", 0.0) or 0)),
                    warning_lamps_count=int(float(r.get("warning_lamps_count", 0.0) or 0)),
                    ambient_high_c=float(r.get("ambient_high_c", 0.0) or 0.0),
                    ambient_low_c=float(r.get("ambient_low_c", 0.0) or 0.0),
                    rain_mm=float(r.get("rain_mm", 0.0) or 0.0),
                )
                self.daily_observations.append(obs)
                self.daily_by_date[d_str] = obs

    def _load_trips(self):
        fpath = self.dataset_dir / "trips.csv"
        if not fpath.exists():
            return
        with open(fpath, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for r in reader:
                trip = TripTelemetryCDM(
                    trip_id=r.get("trip_id", ""),
                    start_time=r.get("start_time", ""),
                    end_time=r.get("end_time", ""),
                    distance_km=float(r.get("distance_km", 0.0) or 0.0),
                    duration_min=float(r.get("duration_min", 0.0) or 0.0),
                    coolant_max_c=float(r.get("coolant_max_c", 0.0) or 0.0),
                    oil_temp_max_c=float(r.get("oil_temp_max_c", 0.0) or 0.0),
                    coolant_level_end_pct=float(r.get("coolant_level_end_pct", 0.0) or 0.0),
                    oil_level_end_pct=float(r.get("oil_level_end_pct", 0.0) or 0.0),
                    hot_idle_oil_press_kpa=float(r.get("hot_idle_oil_press_kpa", 0.0) or 0.0),
                    dpf_regen=str(r.get("dpf_regen", "0")).lower() in ("1", "true", "yes"),
                    fuel_economy_kmpl=float(r.get("fuel_economy_kmpl", 0.0) or 0.0),
                    dtc_logged=[d.strip() for d in r.get("dtc_logged", "").split(";") if d.strip()],
                )
                self.trips.append(trip)

    def _load_failure_stream(self):
        fpath = self.dataset_dir / "failure_trip_1hz.csv"
        if not fpath.exists():
            return
        with open(fpath, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for r in reader:
                dtcs = [d.strip() for d in r.get("dtc_active", "").split(";") if d.strip()]
                sec = float(r.get("t_sec", 0.0) or 0.0)
                pt = HighResTelemetryCDM(
                    timestamp=r.get("timestamp", ""),
                    seconds_from_start=sec,
                    speed_kmph=float(r.get("speed_kmph", 0.0) or 0.0),
                    rpm=float(r.get("engine_rpm", 0.0) or 0.0),
                    coolant_temp_c=float(r.get("coolant_temp_c", 0.0) or 0.0),
                    oil_pressure_kpa=float(r.get("oil_pressure_kpa", 0.0) or 0.0),
                    oil_temp_c=float(r.get("oil_temp_c", 0.0) or 0.0),
                    coolant_level_pct=float(r.get("coolant_level_pct", 0.0) or 0.0),
                    oil_level_pct=float(r.get("oil_level_pct", 0.0) or 0.0),
                    misfires_cyl3=int(float(r.get("misfire_cyl3", 0.0) or 0)),
                    misfires_cyl4=int(float(r.get("misfire_cyl4", 0.0) or 0)),
                    knock_level=float(r.get("knock_sensor_v", 0.0) or 0.0),
                    dtc_active=dtcs,
                )
                self.failure_stream.append(pt)

    def _load_services(self):
        fpath = self.dataset_dir / "service_history.csv"
        if not fpath.exists():
            return
        with open(fpath, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for r in reader:
                sid = r.get("service_id", "")
                billed = [b.strip() for b in r.get("items_billed", "").split(";") if b.strip()]
                tot = float(r.get("total_inr", 0.0) or 0.0)
                in_win = str(r.get("in_window", "1")).lower() in ("1", "true", "yes")
                s = MaintenanceRecordCDM(
                    service_id=sid,
                    date=r.get("date", ""),
                    provider=r.get("provider", ""),
                    provider_type=r.get("provider_type", ""),
                    odometer_km=float(r.get("odometer_km", 0.0) or 0.0),
                    total_cost_inr=tot,
                    items_billed=billed,
                    evidence_in_vehicle_data=r.get("evidence_in_vehicle_data", ""),
                    quality_flag=r.get("quality_flag", ""),
                    findings=r.get("findings", ""),
                    in_window=in_win,
                )
                self.services.append(s)
                self.services_by_id[sid] = s

    def _load_parts(self):
        fpath = self.dataset_dir / "parts_replaced.csv"
        if not fpath.exists():
            return
        with open(fpath, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for r in reader:
                p = PartReplacementCDM(
                    part_id=r.get("part_id", ""),
                    service_id=r.get("service_id", ""),
                    date=r.get("date", ""),
                    odometer_km=float(r.get("odometer_km", 0.0) or 0.0),
                    part_name=r.get("part_name", ""),
                    system=r.get("system", ""),
                    part_grade=r.get("part_grade", ""),
                    spec_conformant=str(r.get("spec_conformant", "1")).lower() in ("1", "true", "yes"),
                    oem_spec=r.get("oem_spec", ""),
                    installed_spec=r.get("installed_spec", ""),
                    reason=r.get("reason_for_replacement", ""),
                    trigger_ref=r.get("trigger_ref", ""),
                    removed_part_condition=r.get("removed_part_condition", ""),
                )
                self.parts_replaced.append(p)

    def _load_diagnostic_events(self):
        fpath = self.dataset_dir / "events_timeline.csv"
        if not fpath.exists():
            return
        with open(fpath, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for r in reader:
                evt = DiagnosticEventCDM(
                    event_id=r.get("event_id", ""),
                    timestamp=r.get("timestamp", ""),
                    odometer_km=float(r.get("odometer_km", 0.0) or 0.0),
                    category=r.get("category", ""),
                    severity=r.get("severity", "INFO"),
                    code_or_lamp=r.get("title", ""),
                    description=r.get("detail", ""),
                )
                self.diagnostic_events.append(evt)

    def _load_ground_truth(self):
        fpath = self.dataset_dir / "ground_truth.json"
        if not fpath.exists():
            return
        with open(fpath, "r", encoding="utf-8") as f:
            gt = json.load(f)
        self.ground_truth_diagnosis = CausalDiagnosisCDM(
            verdict=gt.get("verdict", ""),
            primary_root_cause=gt.get("verdict", "").split("->")[0].strip(),
            confidence=0.95,
            chain=gt.get("root_cause_chain", []),
            contributing_factors=gt.get("contributing_factors", []),
            ruled_out_hypotheses=gt.get("ruled_out", []),
            prevention_measures=gt.get("what_would_have_prevented", []),
            evidence_citations=["daily_telemetry", "trips", "dtc_events", "service_history", "failure_trip_1hz"],
        )

    def _load_qa_eval(self):
        fpath = self.dataset_dir / "qa_eval.jsonl"
        if not fpath.exists():
            return
        with open(fpath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    self.qa_eval_set.append(json.loads(line))
