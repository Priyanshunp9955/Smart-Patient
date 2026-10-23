
"use strict";

// SmartHealth - Patient Health Readings
// Save and fetch patient readings using the shared Flask + MySQL API.

const readingForm = document.getElementById("healthReadingForm");
const savedReadingsBody = document.getElementById("savedReadingsBody");
const emptyMessage = document.getElementById("emptyReadingsMessage");
const readingMessage = document.getElementById("readingMessage");
const readingDateInput = document.getElementById("readingDate");

// Set current local date and time.
function setDefaultDateTime() {
    if (!readingDateInput) return;

    const now = new Date();
    const localTime = new Date(
        now.getTime() - now.getTimezoneOffset() * 60000
    );

    readingDateInput.value = localTime.toISOString().slice(0, 16);
    readingDateInput.max = readingDateInput.value;
}

// Display a message.
function showReadingMessage(message, type) {
    if (readingMessage) {
        readingMessage.textContent = message;
        readingMessage.className = `form-message ${type}`;
    }
    window.SmartHealth.notify(message, type);
}

// Create a table cell safely.
function createCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = String(value);
    row.appendChild(cell);
}

// Fetch readings from Flask + MySQL.
let readingsRequestId = 0;
async function displaySavedReadings() {
    if (!savedReadingsBody || !emptyMessage) return;
    const currentRequest = ++readingsRequestId;

    try {
        const readings = await window.SmartHealth.readings.list();
        if (currentRequest !== readingsRequestId) return;

        savedReadingsBody.replaceChildren();
        emptyMessage.hidden = readings.length > 0;
        emptyMessage.textContent = "No health readings saved yet.";

        readings.forEach(reading => {
            const row = document.createElement("tr");

            createCell(
                row,
                reading.measured_at.replace("T", " ")
            );
            createCell(row, `${reading.heart_rate} BPM`);
            createCell(row, `${reading.spo2}%`);
            createCell(
                row,
                `${reading.systolic}/${reading.diastolic} mmHg`
            );
            createCell(row, `${reading.temperature} °C`);

            const actions = document.createElement("td");
            actions.appendChild(window.SmartHealth.readings.createDeleteButton(reading));
            row.appendChild(actions);

            savedReadingsBody.appendChild(row);
        });

    } catch (error) {
        if (currentRequest !== readingsRequestId) return;
        savedReadingsBody.replaceChildren();
        emptyMessage.hidden = false;
        emptyMessage.textContent = "Health readings could not be loaded.";
        if (error.status === 401) return;

        showReadingMessage(
            error.message || "Unable to fetch health readings.",
            "error"
        );
    }
}

// Save reading to Flask + MySQL.
if (readingForm) {
    readingForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (!readingForm.checkValidity()) {
            readingForm.reportValidity();
            return;
        }

        const reading = {
            heart_rate: Number(
                document.getElementById("heartRate").value
            ),
            spo2: Number(
                document.getElementById("spo2").value
            ),
            systolic: Number(
                document.getElementById("systolic").value
            ),
            diastolic: Number(
                document.getElementById("diastolic").value
            ),
            temperature: Number(
                document.getElementById("temperature").value
            ),
            measured_at: readingDateInput.value
        };

        if (reading.systolic <= reading.diastolic) {
            showReadingMessage(
                "Systolic blood pressure must be greater than diastolic.",
                "error"
            );
            return;
        }

        if (new Date(reading.measured_at).getTime() > Date.now()) {
            showReadingMessage(
                "Measurement date cannot be in the future.",
                "error"
            );
            return;
        }

        const submitButton = readingForm.querySelector(
            'button[type="submit"]'
        );

        if (submitButton) submitButton.disabled = true;

        try {
            await window.SmartHealth.readings.save(reading);

            showReadingMessage(
                "Health reading saved successfully.",
                "success"
            );

            readingForm.reset();
            setDefaultDateTime();

            await displaySavedReadings();

        } catch (error) {
            if (error.status === 401) return;
            showReadingMessage(
                error.message || "Unable to save health reading.",
                "error"
            );
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    });

    readingForm.addEventListener("reset", () => {
        setTimeout(setDefaultDateTime, 0);
    });
}

// Initialize the page.
setDefaultDateTime();
window.SmartHealth.readings.onChange(displaySavedReadings);
displaySavedReadings();
