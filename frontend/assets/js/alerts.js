
// SmartHealth - Demonstration Alert Rules
// These values are for academic UI testing only.
// They are not medically validated clinical thresholds.

const DEMO_ALERT_RULES = [
    {
        field: "heart_rate",
        label: "Heart Rate",
        unit: "BPM",
        test: value => value > 100,
        status: "High",
        tone: "red",
        icon: "heart",
        threshold: "Greater than 100 BPM",
        message: "Your recorded heart rate is above the project's demonstration threshold.",
        action: "If you feel unwell or have concerns about your heart rate, contact a qualified healthcare professional."
    },
    {
        field: "spo2",
        label: "Blood Oxygen (SpO₂)",
        unit: "%",
        test: value => value < 95,
        status: "Low",
        tone: "blue",
        icon: "oxygen",
        threshold: "Less than 95%",
        message: "Your recorded blood oxygen is below the project's demonstration threshold.",
        action: "If you have concerns about your oxygen reading or breathing, seek advice from a qualified healthcare professional."
    },
    {
        field: "systolic",
        label: "Systolic Blood Pressure",
        unit: "mmHg",
        test: value => value > 140,
        status: "High",
        tone: "red",
        icon: "pressure",
        threshold: "Greater than 140 mmHg",
        message: "Your recorded systolic blood pressure is above the project's demonstration threshold.",
        action: "Discuss concerns about your blood pressure reading with a qualified healthcare professional."
    },
    {
        field: "diastolic",
        label: "Diastolic Blood Pressure",
        unit: "mmHg",
        test: value => value > 90,
        status: "High",
        tone: "red",
        icon: "pressure",
        threshold: "Greater than 90 mmHg",
        message: "Your recorded diastolic blood pressure is above the project's demonstration threshold.",
        action: "Discuss concerns about your blood pressure reading with a qualified healthcare professional."
    },
    {
        field: "temperature",
        label: "Body Temperature",
        unit: "°C",
        test: value => value > 38,
        status: "High",
        tone: "orange",
        icon: "temperature",
        threshold: "Greater than 38°C",
        message: "Your recorded temperature is above the project's demonstration threshold.",
        action: "If you feel unwell or have concerns, contact a qualified healthcare professional."
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
                ...rule,
                value: value
            });
        }
    });

    return alerts;
}

// Create a single alert card.

function createAlertCard(alert) {
    const card = document.createElement("article");
    card.className = `health-alert-card alert-tone-${alert.tone}`;
    card.dataset.alertField = alert.field;
    const header = document.createElement("div");
    header.className = "alert-card-header";
    const icon = document.createElement("span");
    icon.className = "alert-parameter-icon";
    icon.appendChild(createAlertIcon(alert.icon));
    const badge = document.createElement("span");
    badge.className = "alert-status-badge";
    badge.textContent = alert.status;
    header.append(icon, badge);

    const heading = document.createElement("h3");
    heading.textContent = alert.label;
    heading.id = `alert-${alert.field}-heading`;
    card.setAttribute("aria-labelledby", heading.id);

    const measurements = document.createElement("dl");
    measurements.className = "alert-measurements";
    const valueLabel = document.createElement("dt");
    valueLabel.textContent = "Recorded Value";
    const reading = document.createElement("dd");
    reading.className = "alert-recorded-value";
    const value = document.createElement("strong");
    value.textContent = alert.value;
    const unit = document.createElement("span");
    unit.textContent = alert.unit;
    reading.append(value, " ", unit);
    const thresholdLabel = document.createElement("dt");
    thresholdLabel.textContent = "Demonstration Threshold";
    const threshold = document.createElement("dd");
    threshold.className = "alert-threshold";
    threshold.textContent = alert.threshold;
    measurements.append(valueLabel, reading, thresholdLabel, threshold);

    const description = document.createElement("p");
    description.className = "alert-explanation";
    description.textContent = alert.message;

    const action = document.createElement("div");
    action.className = "alert-suggested-action";
    const actionHeading = document.createElement("h4");
    actionHeading.textContent = "Suggested Action";
    const advice = document.createElement("p");
    advice.textContent = alert.action;
    action.append(actionHeading, advice);
    card.append(header, heading, measurements, description, action);

    return card;
}

// Inline SVG keeps the medical icons available without a font or image service.
function createAlertIcon(kind) {
    const paths = {
        heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z M3 12h4l2-4 4 8 2-4h6",
        oxygen: "M12 3s-7 8-7 12a7 7 0 0 0 14 0c0-4-7-12-7-12Z M8 15a4 4 0 0 0 4 4",
        pressure: "M4 18a9 9 0 1 1 16 0H4Z M12 14l4-5 M7 10l-1-1 M12 7V5 M17 10l1-1",
        temperature: "M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0Z M12 7v11 M17 6h3 M17 10h2",
        info: "M12 11v6 M12 7v1 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
    };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) {
        svg.setAttribute(name, value);
    }
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", paths[kind] || paths.info);
    svg.appendChild(path);
    return svg;
}

function createAlertState(title, description, linkToReading = false) {
    const message = document.createElement("div");
    message.className = "no-alert-message alert-state-message";
    message.appendChild(createAlertIcon("info"));
    const copy = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = title;
    const text = document.createElement("p");
    text.textContent = description;
    copy.append(heading, text);
    if (linkToReading) {
        const link = document.createElement("a");
        link.href = "add-reading.html";
        link.className = "feature-page-link";
        link.textContent = "Add Health Reading →";
        copy.appendChild(link);
    }
    message.appendChild(copy);
    return message;
}

// Display the alert analysis on the dedicated Health Alerts page.

function displayHealthAlerts(reading, errorMessage = "") {
    const container = document.getElementById("alertsContainer");
    const summary = document.getElementById("alertSummary");

    if (!container || !summary) return;

    container.replaceChildren();
    const count = document.getElementById("alertMatchCount");
    const context = document.getElementById("alertReadingContext");
    if (count) {
        count.hidden = true;
        count.textContent = "";
    }
    if (context) {
        context.hidden = true;
        context.replaceChildren();
    }

    if (errorMessage) {
        summary.textContent = "Health alerts could not be loaded.";
        const message = createAlertState("Unable to analyze your reading", errorMessage);
        message.classList.add("alert-load-error");
        container.appendChild(message);
        return;
    }

    if (!reading) {
        summary.textContent = "No health readings available.";

        const message = createAlertState("No saved readings yet", "Add a health reading to view the demonstration analysis.", true);

        container.appendChild(message);
        return;
    }

    const alerts = analyzeHealthReading(reading);
    const missingFields = DEMO_ALERT_RULES.filter(rule =>
        alertNumericValue(reading[rule.field]) === null
    );
    if (count) {
        count.hidden = false;
        count.textContent = `${alerts.length} ${alerts.length === 1 ? "alert" : "alerts"} matched`;
    }
    if (context) {
        context.hidden = false;
        context.append("Measured: ");
        if (reading.measured_at) {
            const time = document.createElement("time");
            time.dateTime = reading.measured_at;
            time.textContent = reading.measured_at.replace("T", " ");
            context.appendChild(time);
        } else {
            context.append("Date unavailable");
        }
    }

    if (missingFields.length > 0) {
        summary.textContent = alerts.length > 0
            ? `${alerts.length} demonstration ${alerts.length === 1 ? "alert" : "alerts"} matched; some measurements are unavailable.`
            : "Alert analysis incomplete: measurements are unavailable.";
        alerts.forEach(alert => container.appendChild(createAlertCard(alert)));
        const message = createAlertState("Some measurements are unavailable", "Missing or invalid measurements: " +
            missingFields.map(rule => rule.label).join(", ") +
            ". Add a complete reading to check all demonstration rules.", true);
        container.appendChild(message);
        return;
    }

    if (alerts.length === 0) {
        summary.textContent = "No demo rules matched.";

        const message = createAlertState(
            "No demonstration alert thresholds matched your latest reading.",
            "This does not confirm that you are medically safe. If you feel unwell or have concerns, seek advice from a qualified healthcare professional."
        );

        container.appendChild(message);
        return;
    }

    summary.textContent =
        `${alerts.length} demonstration ${alerts.length === 1 ? "alert" : "alerts"} matched.`;

    alerts.forEach(alert => {
        container.appendChild(createAlertCard(alert));
    });
}
