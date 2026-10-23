"""
VehicleGPT — Automotive Common Data Model (CDM) Package
Provides standardized schemas, loader, and 24/7 Digital Twin reasoning engine.
"""

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
from .loader import CDMLoader
from .twin_reasoner import VehicleDigitalTwinReasoner

__all__ = [
    "VehicleMasterCDM",
    "ComponentCDM",
    "DailyObservationCDM",
    "TripTelemetryCDM",
    "HighResTelemetryCDM",
    "MaintenanceRecordCDM",
    "PartReplacementCDM",
    "DiagnosticEventCDM",
    "CausalDiagnosisCDM",
    "CDMLoader",
    "VehicleDigitalTwinReasoner",
]
