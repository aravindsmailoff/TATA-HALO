"""
VehicleGPT — Automotive Common Data Model (CDM)
Standardized Unified Automotive Domain Entities for 24/7 Vehicle Digital Twin Observation,
Continuous Telemetry Ingestion, Causal Diagnostics, and Maintenance Audit.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
from datetime import datetime


@dataclass
class VehicleMasterCDM:
    """Standardized vehicle specification, identity, tolerances, and fluid OEM requirements."""
    vin: str
    make: str
    model: str
    variant: str
    model_year: int
    registration: str
    colour: str
    engine_code: str
    displacement_cc: int
    cylinders: str
    power_ps: str
    torque_nm: str
    idle_rpm: int
    transmission_type: str
    fuel_tank_l: float
    tyre_size: str
    tyre_psi_spec: float
    kerb_weight_kg: float
    ground_clearance_mm: float
    oem_engine_oil: str
    oem_coolant: str
    oem_radiator_cap_bar: float
    ecu_thresholds: Dict[str, Any] = field(default_factory=dict)
    service_interval_km: int = 10000
    service_interval_months: int = 12
    odometer_start_km: float = 0.0
    odometer_end_km: float = 0.0


@dataclass
class ComponentCDM:
    """Component inventory, condition, wear status, and OEM specification compliance."""
    component_id: str
    name: str
    subsystem: str
    installed_date: str
    installed_odometer_km: float
    service_interval_km: Optional[float]
    next_due_km: Optional[float]
    is_overdue: bool
    oem_spec: str
    installed_spec: str
    spec_conformance: bool
    notes: str = ""


@dataclass
class DailyObservationCDM:
    """24/7 Continuous Observation Record representing one full day in the Digital Twin."""
    date: str
    weekday: str
    odometer_start_km: float
    odometer_end_km: float
    distance_km: float
    trips_count: int
    drive_minutes: float
    idle_minutes: float
    avg_speed_kmph: float
    max_speed_kmph: float
    fuel_used_l: float
    fuel_economy_kmpl: float
    coolant_temp_avg_c: float
    coolant_temp_max_c: float
    min_coolant_gt100c: float
    min_coolant_gt105c: float
    coolant_level_pct_am: float
    oil_level_pct_am: float
    oil_pressure_cold_idle_kpa: float
    oil_pressure_hot_idle_kpa: float
    oil_pressure_3000rpm_kpa: float
    oil_temp_max_c: float
    dpf_soot_end_pct: float
    dpf_regens: int
    battery_rest_v_am: float
    battery_cranking_min_v: float
    alternator_v_avg: float
    tyre_psi_fl: float
    tyre_psi_fr: float
    tyre_psi_rl: float
    tyre_psi_rr: float
    hard_brakes: int
    hard_accels: int
    harsh_corners: int
    dtc_active_count: int
    warning_lamps_count: int
    ambient_high_c: float = 0.0
    ambient_low_c: float = 0.0
    rain_mm: float = 0.0


@dataclass
class TripTelemetryCDM:
    """Aggregated single-trip telemetry record."""
    trip_id: str
    start_time: str
    end_time: str
    distance_km: float
    duration_min: float
    coolant_max_c: float
    oil_temp_max_c: float
    coolant_level_end_pct: float
    oil_level_end_pct: float
    hot_idle_oil_press_kpa: float
    dpf_regen: bool
    fuel_economy_kmpl: float
    dtc_logged: List[str] = field(default_factory=list)


@dataclass
class HighResTelemetryCDM:
    """High-frequency (10s / 1Hz) terminal telemetry stream."""
    timestamp: str
    seconds_from_start: float
    speed_kmph: float
    rpm: float
    coolant_temp_c: float
    oil_pressure_kpa: float
    oil_temp_c: float
    coolant_level_pct: float
    oil_level_pct: float
    misfires_cyl3: int
    misfires_cyl4: int
    knock_level: float
    dtc_active: List[str] = field(default_factory=list)


@dataclass
class MaintenanceRecordCDM:
    """Workshop service event with evidence verification and quality audit."""
    service_id: str
    date: str
    provider: str
    provider_type: str  # OEM_AUTHORIZED | INDEPENDENT_WORKSHOP | DIY
    odometer_km: float
    total_cost_inr: float
    items_billed: List[str]
    evidence_in_vehicle_data: str
    quality_flag: str  # OEM_CONFORMANT | NON_CONFORMANT_PARTS | BILLED_NOT_PERFORMED | DIY_DEFECT
    findings: str = ""
    in_window: bool = True


@dataclass
class PartReplacementCDM:
    """Physical part replacement record with OEM spec validation."""
    part_id: str
    service_id: str
    date: str
    odometer_km: float
    part_name: str
    system: str
    part_grade: str
    spec_conformant: bool
    oem_spec: str
    installed_spec: str
    reason: str
    trigger_ref: str
    removed_part_condition: str


@dataclass
class DiagnosticEventCDM:
    """Standardized DTC or Warning Lamp notification in the Digital Twin timeline."""
    event_id: str
    timestamp: str
    odometer_km: float
    category: str  # DTC | WARNING_LAMP | INCIDENT | SERVICE
    severity: str  # INFO | LOW | MEDIUM | HIGH | CRITICAL
    code_or_lamp: str
    description: str
    driver_response: str = ""
    cleared_at: Optional[str] = None
    cleared_by: Optional[str] = None
    freeze_frame: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CausalDiagnosisCDM:
    """Root cause diagnosis, causal timeline chain, ruled-out hypotheses, and prevention steps."""
    verdict: str
    primary_root_cause: str
    confidence: float
    chain: List[Dict[str, Any]]
    contributing_factors: List[str]
    ruled_out_hypotheses: List[Dict[str, str]]
    prevention_measures: List[str]
    evidence_citations: List[str]
