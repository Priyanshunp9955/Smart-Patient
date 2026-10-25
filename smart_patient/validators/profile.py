"""Validation for the patient's editable profile fields."""
import re
import unicodedata
from datetime import date

GENDERS = {"Female", "Male", "Non-binary", "Prefer not to say"}
BLOOD_GROUPS = {"A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"}
EDITABLE_FIELDS = {"full_name", "phone", "date_of_birth", "gender", "blood_group"}


def validate_profile(data):
    if not isinstance(data, dict) or set(data) != EDITABLE_FIELDS:
        raise ValueError("Submit only name, phone, date of birth, gender, and blood group.")

    profile = {}
    for field in EDITABLE_FIELDS:
        value = data[field]
        if value is not None and not isinstance(value, str):
            raise ValueError("Profile fields must be text or empty.")
        profile[field] = value.strip() if value else ""

    name = profile["full_name"]
    if not name or len(name) > 100 or any(unicodedata.category(char).startswith("C") for char in name):
        raise ValueError("Enter a name between 1 and 100 characters without control characters.")

    phone = profile["phone"]
    if phone and (len(phone) > 32 or not re.fullmatch(r"\+?[0-9 ()\.\-]+", phone)
                  or not 7 <= len(re.sub(r"[^0-9]", "", phone)) <= 15):
        raise ValueError("Enter a valid phone number with 7 to 15 digits; an initial +, spaces, (), dots, and hyphens are allowed.")

    birthday = profile["date_of_birth"]
    if birthday:
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", birthday):
                raise ValueError
            birthday = date.fromisoformat(birthday)
            if not date(1900, 1, 1) <= birthday <= date.today():
                raise ValueError
        except ValueError:
            raise ValueError("Enter a valid date of birth between January 1, 1900 and today.") from None
        profile["date_of_birth"] = birthday

    if profile["gender"] and profile["gender"] not in GENDERS:
        raise ValueError("Select a valid gender option.")
    if profile["blood_group"] and profile["blood_group"] not in BLOOD_GROUPS:
        raise ValueError("Select a valid blood group.")

    return {key: value or None for key, value in profile.items()}
