
// SmartHealth - Demonstration Alert Rules
// These values are for academic UI testing only.
// They are not medically validated clinical thresholds.

const DEMO_ALERT_RULES = [
    {
        field: "heart_rate",
        label: "Heart Rate",
        unit: "BPM",
        test: value => value > 100,
        message: "Matches the demonstration high heart rate rule."
    },
    {
        field: "spo2",
        label: "Blood Oxygen (SpO₂)",
        unit: "%",
        test: value => value < 95,
        message: "Matches the demonstration low oxygen rule."
    },
    {
        field: "systolic",
        label: "Systolic Blood Pressure",
        unit: "mmHg",
        test: value => value > 140,
        message: "Matches the demonstration systolic pressure rule."
    },
    {
        field: "diastolic",
        label: "Diastolic Blood Pressure",
        unit: "mmHg",
        test: value => value > 90,
        message: "Matches the demonstration diastolic pressure rule."
    },
    {
        field: "temperature",
        label: "Body Temperature",
        unit: "°C",
        test: value => value > 38,
        message: "Matches the demonstration temperature rule."
    }
];

// Check one health reading against all demo rules.

function alertNumericValue(value) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function analyzeHealthReading(reading) {
    const alerts = [];

    DEMO_ALERT_RULES.forEach(rule => {
        const value = alertNumericValue(reading?.[rule.field]);

        if (value !== null && rule.test(value)) {

            alerts.push({
                label: rule.label,
                value: value,
                unit: rule.unit,
                message: rule.message
            });
        }
    });

    return alerts;
}

// Create a single alert card.

function createAlertCard(alert) {
    const card = document.createElement("article");
    card.className = "health-alert-card";

    const heading = document.createElement("h3");
    heading.textContent = alert.label;

    const reading = document.createElement("p");
    reading.textContent =
        `Recorded value: ${alert.value} ${alert.unit}`;

    const description = document.createElement("p");
    description.textContent = alert.message;

    card.append(heading, reading, description);

    return card;
}

// Display the alert analysis on the dedicated Health Alerts page.

function displayHealthAlerts(reading, errorMessage = "") {
    const container = document.getElementById("alertsContainer");
    const summary = document.getElementById("alertSummary");

    if (!container || !summary) return;

    container.replaceChildren();

    if (errorMessage) {
        summary.textContent = "Health alerts could not be loaded.";
        const message = document.createElement("p");
        message.className = "no-alert-message";
        message.textContent = errorMessage;
        container.appendChild(message);
        return;
    }

    if (!reading) {
        summary.textContent = "No health readings available.";

        const message = document.createElement("p");
        message.textContent =
            "Add a health reading to view the demonstration analysis.";

        container.appendChild(message);
        return;
    }

    const alerts = analyzeHealthReading(reading);
    const missingFields = DEMO_ALERT_RULES.filter(rule =>
        alertNumericValue(reading[rule.field]) === null
    );

    if (missingFields.length > 0) {
        summary.textContent = alerts.length > 0
            ? `${alerts.length} demonstration alert(s) matched; some measurements are unavailable.`
            : "Alert analysis incomplete: measurements are unavailable.";
        alerts.forEach(alert => container.appendChild(createAlertCard(alert)));
        const message = document.createElement("p");
        message.className = "no-alert-message";
        message.textContent = "Missing or invalid measurements: " +
            missingFields.map(rule => rule.label).join(", ") +
            ". Add a complete reading to check all demonstration rules.";
        container.appendChild(message);
        return;
    }

    if (alerts.length === 0) {
        summary.textContent = "No demo rules matched.";

        const message = document.createElement("p");
        message.className = "no-alert-message";
        message.textContent =
            "The latest reading did not match any configured " +
            "demonstration alert rule. This does not establish " +
            "that the reading is medically safe.";

        container.appendChild(message);
        return;
    }

    summary.textContent =
        `${alerts.length} demonstration alert(s) matched.`;

    alerts.forEach(alert => {
        container.appendChild(createAlertCard(alert));
    });
}
