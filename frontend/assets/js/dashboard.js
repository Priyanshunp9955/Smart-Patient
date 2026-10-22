
// Patient Dashboard
// Uses the same patient-scoped API as Add Health Reading.

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
    if (readings.length === 0) {
        for (const id of ["latestHeartRate", "latestSpo2", "latestBloodPressure", "latestTemperature"]) {
            document.getElementById(id).textContent = "--";
        }
        return;
    }

    const latest = readings[0];

    document.getElementById("latestHeartRate").textContent =
        latest.heart_rate;

    document.getElementById("latestSpo2").textContent =
        latest.spo2;

    document.getElementById("latestBloodPressure").textContent =
        `${latest.systolic}/${latest.diastolic}`;

    document.getElementById("latestTemperature").textContent =
        latest.temperature;
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

    tableBody.replaceChildren();

    if (emptyMessage) {
        emptyMessage.hidden = readings.length > 0;
        emptyMessage.textContent = "No health readings saved yet.";
    }

    const recentReadings = readings.slice(0, 10);

    recentReadings.forEach(reading => {
        const row = document.createElement("tr");

        addTableCell(row, reading.measured_at.replace("T", " "));
        addTableCell(row, `${reading.heart_rate} BPM`);
        addTableCell(row, `${reading.spo2}%`);
        addTableCell(
            row,
            `${reading.systolic}/${reading.diastolic} mmHg`
        );
        addTableCell(row, `${reading.temperature} °C`);

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

    const lastSevenDays = readings.slice().reverse().filter(reading => {
        const date = new Date(reading.measured_at);
        return date >= startDate && date <= latestDate;
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

    Plotly.react(chartElement, chartData, chartLayout, {
        responsive: true,
        displaylogo: false
    });

    if (chartNote) {
        chartNote.textContent =
            `Showing ${lastSevenDays.length} saved reading(s) ` +
            "from the latest seven-day measurement window.";
    }
}

// Refresh every dashboard section from the same snapshot of patient records.

function initializeDashboard() {
    const metricSelect = document.getElementById("healthMetric");
    const status = document.getElementById("dashboardReadingsStatus");
    let readings = [];
    let requestId = 0;

    function render() {
        updateHealthCards(readings);
        renderHealthHistory(readings);
        displayHealthAlerts(readings);
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
            render();
            if (error.status === 401) return;
            const message = error.message || "Unable to load your health records. Please try again.";
            status.textContent = message;
            document.getElementById("dashboardEmptyMessage").textContent = "Health records could not be loaded.";
            document.getElementById("alertSummary").textContent = "Health alerts could not be loaded.";
            document.getElementById("chartNote").textContent = "Health trends could not be loaded.";
            window.SmartHealth.notify(message, "error");
        }
    }

    if (metricSelect) {
        metricSelect.addEventListener("change", () => renderHealthChart(metricSelect.value, readings));
    }
    window.SmartHealth.readings.onChange(refresh);
    refresh();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeDashboard, { once: true });
} else {
    initializeDashboard();
}
