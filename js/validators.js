"use strict";

(() => {
    function fail(message) { throw Object.assign(new Error(message), { domain: true }); }
    const count = value => Array.from(value).length;
    const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
    function fields(data, names) {
        if (!plain(data) || Object.keys(data).sort().join("|") !== names.slice().sort().join("|")) fail("Submit only the expected fields, without account identifiers.");
    }
    function text(value, label, max, min = 0) {
        if (typeof value !== "string" || !value.isWellFormed()) fail(`${label} must contain valid text.`);
        const result = value.trim();
        if (count(result) < min || count(result) > max || /\p{C}/u.test(result)) fail(`${label} must contain ${min}–${max} characters without control characters.`);
        return result;
    }
    function email(value) {
        const result = text(value, "Email", 255, 3).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+$/.test(result)) fail("Enter a valid email address.");
        return result;
    }
    function password(value) {
        if (typeof value !== "string" || !value.isWellFormed() || count(value) < 8 || count(value) > 1024) fail("Passwords must contain 8–1024 valid characters. Spaces are preserved.");
        return value;
    }
    function localDate(now = new Date()) {
        return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
    }
    function calendar(value, time = false) {
        const pattern = time ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})$/;
        const match = typeof value === "string" && pattern.exec(value);
        if (!match) fail("Enter a valid calendar date and time.");
        const [year, month, day, hour = 0, minute = 0] = match.slice(1).map(Number);
        const date = new Date(year, month - 1, day, hour, minute);
        if (year < 1900 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) fail("Enter a real calendar date and time.");
        return date;
    }
    const readingFields = ["heart_rate", "spo2", "systolic", "diastolic", "temperature", "measured_at"];
    function reading(data) {
        fields(data, readingFields);
        const result = {};
        for (const [field, min, max, integer] of [["heart_rate",20,250,true],["spo2",0,100,false],["systolic",40,300,true],["diastolic",20,200,true],["temperature",25,45,false]]) {
            const raw = data[field];
            if (!(["string", "number"].includes(typeof raw)) || (typeof raw === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim()))) fail(`Enter a valid ${field.replaceAll("_", " ")} measurement.`);
            const number = Number(raw);
            if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) fail(`${field.replaceAll("_", " ")} must be ${integer ? "a whole number " : ""}between ${min} and ${max}.`);
            result[field] = number;
        }
        if (result.systolic <= result.diastolic) fail("Systolic blood pressure must be greater than diastolic.");
        if (calendar(data.measured_at, true).getTime() > Date.now()) fail("Measurement date cannot be in the future.");
        result.measured_at = data.measured_at;
        return result;
    }
    const profileFields = ["full_name", "phone", "date_of_birth", "gender", "blood_group"];
    function profile(data) {
        fields(data, profileFields);
        const result = {};
        for (const field of profileFields) {
            if (data[field] !== null && typeof data[field] !== "string") fail("Profile fields must be text or empty.");
            result[field] = data[field]?.trim() || null;
        }
        result.full_name = text(data.full_name, "Name", 100, 1);
        if (result.phone && (result.phone.length > 32 || !/^\+?[0-9 ().-]+$/.test(result.phone) || !/^[0-9]{7,15}$/.test(result.phone.replace(/[^0-9]/g, "")))) fail("Enter a valid phone number with 7–15 digits.");
        if (result.date_of_birth && (calendar(result.date_of_birth) > calendar(localDate()))) fail("Date of birth must be between January 1, 1900 and today.");
        if (result.gender && !["Female","Male","Non-binary","Prefer not to say"].includes(result.gender)) fail("Select a valid gender option.");
        if (result.blood_group && !["A+","A-","B+","B-","AB+","AB-","O+","O-"].includes(result.blood_group)) fail("Select a valid blood group.");
        return result;
    }
    function appointment(data, historic = false) {
        fields(data, ["doctorId","patientName","patientEmail","mode","date","time","reason"]);
        if (!["doctor-1","doctor-2","doctor-3"].includes(data.doctorId) || !["Audio","Video"].includes(data.mode)) fail("Select a valid doctor and consultation mode.");
        const result = { ...data, patientName: text(data.patientName,"Patient name",80,1), patientEmail: email(data.patientEmail), reason: text(data.reason,"Reason",500,1) };
        const date = calendar(`${data.date}T${data.time}`, true);
        if (!historic && date.getTime() <= Date.now()) fail("Please choose a future appointment date and time.");
        return result;
    }
    window.SmartHealth = { ...window.SmartHealth, validate: { fail, plain, fields, text, email, password, calendar, localDate, reading, readingFields, profile, profileFields, appointment } };
})();
