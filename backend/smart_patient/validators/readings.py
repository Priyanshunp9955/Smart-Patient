"""Existing validation rules for patient health readings."""
from datetime import datetime
from decimal import Decimal, InvalidOperation


def validate_health_reading(data):
    if not isinstance(data, dict):
        raise ValueError("Invalid request data.")

    try:
        heart_rate = int(data["heart_rate"])
        spo2 = Decimal(str(data["spo2"]))
        systolic = int(data["systolic"])
        diastolic = int(data["diastolic"])
        temperature = Decimal(str(data["temperature"]))

        measured_at = datetime.strptime(
            data["measured_at"],
            "%Y-%m-%dT%H:%M"
        )

    except (KeyError, TypeError, ValueError, InvalidOperation, OverflowError):
        raise ValueError(
            "Please enter valid health measurements and date/time."
        )

    # Academic input validation only.
    # These are not clinical alert thresholds.
    if not 20 <= heart_rate <= 250:
        raise ValueError("Heart rate is outside the accepted input range.")

    if not spo2.is_finite() or not Decimal("0") <= spo2 <= Decimal("100"):
        raise ValueError("SpO2 must be between 0 and 100.")

    if not 40 <= systolic <= 300:
        raise ValueError("Invalid systolic blood pressure.")

    if not 20 <= diastolic <= 200:
        raise ValueError("Invalid diastolic blood pressure.")

    if not temperature.is_finite() or not Decimal("25") <= temperature <= Decimal("45"):
        raise ValueError("Invalid temperature.")

    if measured_at > datetime.now():
        raise ValueError("Measurement date cannot be in the future.")

    return {
        "heart_rate": heart_rate,
        "spo2": spo2,
        "systolic": systolic,
        "diastolic": diastolic,
        "temperature": temperature,
        "measured_at": measured_at
    }
