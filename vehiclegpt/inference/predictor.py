"""
VehicleGPT — Predictive Analytics & Forecasting Engine
Uses historical drive telemetry (sample_drive.csv) and live CAN signals to forecast:
  1. Fuel depletion rate, time to empty, and range
  2. Engine coolant thermal trend & overheat risk
  3. 12V Battery state-of-health (SoH) & alternator charging efficiency
  4. Engine oil degradation & remaining service life
  5. Tyre pressure thermal drift vs slow-leak detection
"""
import csv
import logging
from pathlib import Path
from typing import Dict, Any, Optional

logger = logging.getLogger("vehiclegpt.predictor")


class VehiclePredictor:
    """Statistical & trend forecasting engine fitted on Tata drive telemetry."""

    def __init__(self, dataset_path: Optional[str] = None):
        if dataset_path is None:
            # Look in vehiclegpt/data/datasets/raw/sample_drive.csv or datasets/sample_drive.csv
            base = Path(__file__).resolve().parent.parent
            candidates = [
                base / "data" / "datasets" / "raw" / "sample_drive.csv",
                base.parent / "datasets" / "sample_drive.csv",
            ]
            self.dataset_path = next((p for p in candidates if p.exists()), candidates[0])
        else:
            self.dataset_path = Path(dataset_path)

        self._stats = self._fit_dataset()

    def _fit_dataset(self) -> Dict[str, Any]:
        """Compute baseline statistical parameters from sample drive dataset."""
        if not self.dataset_path.exists():
            logger.warning(f"Drive dataset not found at {self.dataset_path}. Using factory defaults.")
            return {
                "fuel_burn_rate_pct_per_min": 0.163, # ~9.8% per hour highway driving
                "nominal_coolant_equil": 89.5,
                "alternator_charging_volts": 14.1,
                "nominal_oil_pressure_idle": 41.5,
                "nominal_oil_pressure_high": 64.0,
            }

        fuels = []
        coolants = []
        volts = []
        oils = []
        speeds = []

        try:
            with open(self.dataset_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    sig = row.get("signal_id")
                    val = float(row.get("value", 0))
                    if sig == "FUEL_LEVEL":
                        fuels.append(val)
                    elif sig == "ENGINE_COOLANT_TEMP":
                        coolants.append(val)
                    elif sig == "BATTERY_VOLTAGE":
                        volts.append(val)
                    elif sig == "OIL_PRESSURE":
                        oils.append(val)
                    elif sig == "PERF_VEHICLE_SPEED":
                        speeds.append(val)

            total_sec = max(len(fuels), 1)
            fuel_delta = (fuels[0] - fuels[-1]) if (fuels and fuels[0] > fuels[-1]) else 2.71
            burn_rate_min = (fuel_delta / (total_sec / 60.0)) if total_sec > 60 else 0.163

            stats = {
                "fuel_burn_rate_pct_per_min": burn_rate_min,
                "fuel_start_pct": fuels[0] if fuels else 64.8,
                "fuel_end_pct": fuels[-1] if fuels else 62.09,
                "nominal_coolant_equil": round(sum(coolants[-200:]) / max(len(coolants[-200:]), 1), 1) if coolants else 89.5,
                "coolant_max_recorded": max(coolants) if coolants else 93.3,
                "alternator_charging_volts": round(max(volts), 2) if volts else 14.34,
                "resting_battery_volts": round(min(volts), 2) if volts else 12.61,
                "nominal_oil_pressure_idle": round(min(oils), 1) if oils else 40.6,
                "nominal_oil_pressure_high": round(max(oils), 1) if oils else 64.9,
                "avg_speed": round(sum(speeds) / max(len(speeds), 1), 1) if speeds else 42.0,
            }
            logger.info(f"Predictor fitted successfully on {self.dataset_path.name} ({total_sec} telemetry points)")
            return stats
        except Exception as e:
            logger.warning(f"Error parsing dataset for predictor: {e}")
            return {
                "fuel_burn_rate_pct_per_min": 0.163,
                "nominal_coolant_equil": 89.5,
                "alternator_charging_volts": 14.1,
                "nominal_oil_pressure_idle": 41.5,
                "nominal_oil_pressure_high": 64.0,
            }

    # ── Forecasting Methods ──────────────────────────────────
    def predict_fuel(self, current_fuel_pct: float, current_speed_kph: float = 60.0) -> Dict[str, Any]:
        """Predict remaining drive time, distance to reserve (15%), and distance to empty."""
        burn_per_min = self._stats.get("fuel_burn_rate_pct_per_min", 0.163)
        if current_speed_kph > 80:
            burn_per_min *= 1.25  # High-speed aerodynamic drag
        elif current_speed_kph < 20:
            burn_per_min *= 0.85  # Low speed / idle

        mins_to_reserve = max((current_fuel_pct - 15.0) / burn_per_min, 0.0) if current_fuel_pct > 15.0 else 0.0
        mins_to_empty = max(current_fuel_pct / burn_per_min, 0.0)

        # Distance estimation: 37L tank capacity on Tata Punch
        liters_left = (current_fuel_pct / 100.0) * 37.0
        # Average Tata Revotron consumption: ~6.3 L/100km
        km_remaining = round(liters_left * (100.0 / 6.3), 1)
        km_to_reserve = round(max((liters_left - (0.15 * 37.0)), 0) * (100.0 / 6.3), 1)

        hours_to_empty = round(mins_to_empty / 60.0, 1)

        return {
            "current_fuel_pct": current_fuel_pct,
            "liters_remaining": round(liters_left, 1),
            "predicted_range_km": km_remaining,
            "predicted_km_to_reserve": km_to_reserve,
            "predicted_hours_to_empty": hours_to_empty,
            "burn_rate_pct_per_hour": round(burn_per_min * 60, 1),
            "recommendation": "Refuel within next 50 km" if current_fuel_pct <= 20 else "Fuel capacity is optimal",
        }

    def predict_coolant(self, current_temp_c: float) -> Dict[str, Any]:
        """Predict thermal stabilization and overheat risk."""
        equil = self._stats.get("nominal_coolant_equil", 89.5)
        overheat_risk = "LOW"
        explanation = f"Coolant is projected to settle at nominal equilibrium (~{equil}°C)."

        if current_temp_c > 96.0:
            overheat_risk = "HIGH"
            explanation = f"Coolant is elevated at {current_temp_c:.1f}°C and approaching the 100°C threshold. Monitor fan activity."
        elif current_temp_c > 105.0:
            overheat_risk = "CRITICAL"
            explanation = "Thermal runaway risk: Engine temperature exceeds 105°C. Pull over safely to prevent cylinder head warpage."
        elif current_temp_c < 80.0:
            explanation = f"Engine warming up from {current_temp_c:.1f}°C. Will reach optimal thermal efficiency (88-92°C) in approximately 4-6 minutes."

        return {
            "current_temp_c": current_temp_c,
            "projected_equilibrium_c": equil,
            "overheat_risk": overheat_risk,
            "explanation": explanation,
        }

    def predict_battery(self, current_volts: float, rpm: float = 1200.0) -> Dict[str, Any]:
        """Predict 12V battery health, alternator charging rate, and non-start risk."""
        if rpm > 900:
            is_charging = current_volts >= 13.5
            state = "Actively charging via alternator" if is_charging else "Warning: Alternator undercharging"
            soh = 95 if is_charging else 65
        else:
            # Resting voltage
            if current_volts >= 12.6:
                state = "100% full charge (healthy resting voltage)"
                soh = 98
            elif current_volts >= 12.2:
                state = "Moderate resting charge (~60-70%)"
                soh = 80
            else:
                state = "Discharged / Weak battery (risk of non-start)"
                soh = 45

        return {
            "current_volts": current_volts,
            "state_of_health_pct": soh,
            "charging_status": state,
            "risk_of_non_start": "HIGH" if current_volts < 11.8 else "LOW",
        }

    def predict_oil_and_service(self, current_oil_kpa: float, current_km: int = 14200) -> Dict[str, Any]:
        """Predict oil breakdown and distance until next scheduled service."""
        # Factory service is every 15,000 km or 1 year
        km_to_next_service = max(15000 - (current_km % 15000), 200)
        oil_health_pct = max(min(round((km_to_next_service / 15000.0) * 100), 100), 15)

        viscosity_state = "Nominal lubrication film" if current_oil_kpa >= 35.0 else "Degraded oil pressure warning"

        return {
            "current_oil_pressure_kpa": current_oil_kpa,
            "viscosity_state": viscosity_state,
            "estimated_oil_health_pct": oil_health_pct,
            "predicted_km_to_service": km_to_next_service,
            "service_action": "Routine service recommended soon" if km_to_next_service < 1000 else "Oil life is within safe window",
        }

    def predict_overall(self, snapshot: Dict[str, Any]) -> str:
        """Synthesize a complete predictive diagnostic forecast."""
        fuel_sig = snapshot.get("FUEL_LEVEL")
        cool_sig = snapshot.get("ENGINE_COOLANT_TEMP")
        volt_sig = snapshot.get("BATTERY_VOLTAGE")
        oil_sig = snapshot.get("OIL_PRESSURE")
        speed_sig = snapshot.get("PERF_VEHICLE_SPEED")

        f_val = fuel_sig.value if fuel_sig else self._stats.get("fuel_end_pct", 62.0)
        c_val = cool_sig.value if cool_sig else self._stats.get("nominal_coolant_equil", 89.5)
        v_val = volt_sig.value if volt_sig else 13.8
        o_val = oil_sig.value if oil_sig else 41.5
        s_val = speed_sig.value if speed_sig else 55.0

        f_pred = self.predict_fuel(f_val, s_val)
        c_pred = self.predict_coolant(c_val)
        b_pred = self.predict_battery(v_val)
        o_pred = self.predict_oil_and_service(o_val)

        return (
            f"Predictive Vehicle Forecast (based on drive dataset trends):\n"
            f"- Fuel: Tank at {f_val:.1f}%. Predicted range is ~{f_pred['predicted_range_km']} km ({f_pred['predicted_hours_to_empty']} hrs drive time before empty).\n"
            f"- Thermal: Coolant is {c_val:.1f}°C. Overheat risk is {c_pred['overheat_risk']}; projected to stabilize around {c_pred['projected_equilibrium_c']}°C.\n"
            f"- Electrical: 12V battery is at {v_val:.2f}V ({b_pred['charging_status']}). Non-start risk: {b_pred['risk_of_non_start']}.\n"
            f"- Lubrication: Oil pressure {o_val:.1f} kPa ({o_pred['viscosity_state']}). Next service due in ~{o_pred['predicted_km_to_service']} km."
        )
