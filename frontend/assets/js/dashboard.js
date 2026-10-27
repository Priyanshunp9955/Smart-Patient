
// Shared view controller for Dashboard, Health Records, Health Trends and Alerts.
// Each page renders only the components it contains from one patient API snapshot.

const metricSettings = {
    heart_rate: {
        label: "Heart Rate",
        unit: "BPM"
    },
    spo2: {
        label: "Blood Oxygen",
        unit: "%"
    },
    systolic: {
        label: "Systolic Blood Pressure",
        unit: "mmHg"
    },
    diastolic: {
        label: "Diastolic Blood Pressure",
        unit: "mmHg"
    },
    temperature: {
        label: "Body Temperature",
        unit: "°C"
    }
};

// Update the four health overview cards.

function updateHealthCards(readings) {
    if (!document.getElementById("latestHeartRate")) return;
    if (readings.length === 0) {
        for (const id of ["latestHeartRate", "latestSpo2", "latestBloodPressure", "latestTemperature"]) {
            document.getElementById(id).textContent = "--";
        }
        return;
    }

    const latest = readings[0];

    document.getElementById("latestHeartRate").textContent =
        latest.heart_rate ?? "--";

    document.getElementById("latestSpo2").textContent =
        latest.spo2 ?? "--";

    document.getElementById("latestBloodPressure").textContent =
        `${latest.systolic ?? "--"}/${latest.diastolic ?? "--"}`;

    document.getElementById("latestTemperature").textContent =
        latest.temperature ?? "--";
}

// Create safe table cells.

function addTableCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = String(value);
    row.appendChild(cell);
}

// Display recent health records.

function renderHealthHistory(readings) {
    const tableBody = document.getElementById("readingsTableBody");
    const emptyMessage = document.getElementById("dashboardEmptyMessage");

    if (!tableBody) return;
    tableBody.replaceChildren();

    if (emptyMessage) {
        emptyMessage.hidden = readings.length > 0;
        emptyMessage.textContent = "No health readings saved yet.";
    }

    const limit = tableBody.dataset.limit === "all" ? readings.length : Number(tableBody.dataset.limit || 10);
    const recentReadings = readings.slice(0, limit);

    recentReadings.forEach(reading => {
        const row = document.createElement("tr");

        addTableCell(row, reading.measured_at?.replace("T", " ") || "--");
        addTableCell(row, `${reading.heart_rate ?? "--"} BPM`);
        addTableCell(row, `${reading.spo2 ?? "--"}%`);
        addTableCell(
            row,
            `${reading.systolic ?? "--"}/${reading.diastolic ?? "--"} mmHg`
        );
        addTableCell(row, `${reading.temperature ?? "--"} °C`);

        const actions = document.createElement("td");
        actions.className = "reading-actions";
        actions.appendChild(window.SmartHealth.readings.createEditButton(reading));
        actions.appendChild(window.SmartHealth.readings.createDeleteButton(reading));
        row.appendChild(actions);

        tableBody.appendChild(row);
    });
}

// Display health trend graph.

function renderHealthChart(metric, readings) {
    const chartElement = document.getElementById("healthTrendChart");
    const chartNote = document.getElementById("chartNote");

    if (!chartElement) return;

    if (typeof Plotly === "undefined") {
        if (chartNote) {
            chartNote.textContent =
                "Chart library could not load. Check your internet connection.";
        }
        return;
    }

    if (readings.length === 0) {
        Plotly.purge(chartElement);

        chartElement.textContent =
            "No health readings available. Add a reading to view trends.";

        if (chartNote) {
            chartNote.textContent = "No health records saved yet.";
        }

        return;
    }

    const settings = metricSettings[metric];

    if (!settings) return;

    // Show records from the latest seven calendar days
    // represented by the most recent measurement.

    const latestDate = new Date(readings[0].measured_at);
    const startDate = new Date(latestDate);

    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);

    const allReadings = document.getElementById("healthRange")?.value === "all";
    const lastSevenDays = readings.slice().reverse().filter(reading => {
        const date = new Date(reading.measured_at);
        return Number.isFinite(date.getTime()) && (allReadings || (date >= startDate && date <= latestDate));
    });

    const chartData = [{
        x: lastSevenDays.map(reading => reading.measured_at),
        y: lastSevenDays.map(reading => reading[metric]),
        type: "scatter",
        mode: "lines+markers",
        line: {
            color: "#087f8c",
            width: 3
        },
        marker: {
            color: "#087f8c",
            size: 8
        },
        hovertemplate:
            `%{x}<br>%{y} ${settings.unit}<extra></extra>`
    }];

    const chartLayout = {
        height: Number(chartElement.dataset.height || 360),
        margin: { t: 20, r: 20, b: 55, l: 60 },
        paper_bgcolor: "#ffffff",
        plot_bgcolor: "#ffffff",
        font: {
            family: "Inter, sans-serif",
            color: "#526476"
        },
        xaxis: {
            title: { text: "Measurement Date" },
            type: "date",
            tickformat: "%d %b",
            showgrid: false
        },
        yaxis: {
            title: { text: settings.unit },
            gridcolor: "#eaf0f3",
            zeroline: false
        },
        showlegend: false,
        autosize: true
    };

    const rendered = Plotly.react(chartElement, chartData, chartLayout, {
        responsive: true,
        displaylogo: false
    });

    if (chartNote) {
        chartNote.textContent =
            `Showing ${lastSevenDays.length} saved reading(s) ` +
            (allReadings ? "across your full measurement history." : "from the latest seven-day measurement window.");
    }
    // A chart failure must not stop the other patient views from updating.
    rendered?.catch(() => {
        if (chartNote) chartNote.textContent = "Health trends could not be rendered. Please refresh the page.";
    });
}

// Refresh every dashboard section from the same snapshot of patient records.

function initializeDashboard() {
    const metricSelect = document.getElementById("healthMetric");
    const rangeSelect = document.getElementById("healthRange");
    const status = document.getElementById("dashboardReadingsStatus");
    let readings = [];
    let requestId = 0;

    function render(errorMessage = "") {
        updateHealthCards(readings);
        renderHealthHistory(readings);
        // MySQL's auto-increment ID identifies the latest saved record, even
        // when a patient enters a backdated measurement. Keep history/trends
        // in their existing measurement-date order.
        const latestSaved = readings.reduce((latest, reading) =>
            !latest || Number(reading.id) > Number(latest.id) ? reading : latest,
            null
        );
        if (typeof displayHealthAlerts === "function") displayHealthAlerts(latestSaved, errorMessage);
        if (metricSelect) renderHealthChart(metricSelect.value, readings);
    }

    async function refresh() {
        const currentRequest = ++requestId;
        status.textContent = "Updating health records...";
        try {
            const latest = await window.SmartHealth.readings.list();
            if (currentRequest !== requestId) return;
            readings = latest;
            render();
            status.textContent = "";
        } catch (error) {
            if (currentRequest !== requestId) return;
            readings = [];
            const message = error.message || "Unable to load your health records. Please try again.";
            render(message);
            if (error.status === 401) return;
            status.textContent = message;
            const emptyMessage = document.getElementById("dashboardEmptyMessage");
            const chartNote = document.getElementById("chartNote");
            if (emptyMessage) emptyMessage.textContent = "Health records could not be loaded.";
            if (chartNote) chartNote.textContent = "Health trends could not be loaded.";
            window.SmartHealth.notify(message, "error");
        }
    }

    if (metricSelect) {
        metricSelect.addEventListener("change", () => renderHealthChart(metricSelect.value, readings));
    }
    if (rangeSelect && metricSelect) {
        rangeSelect.addEventListener("change", () => renderHealthChart(metricSelect.value, readings));
    }
    window.SmartHealth.readings.onChange(refresh);
    refresh();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeDashboard, { once: true });
} else {
    initializeDashboard();
}
