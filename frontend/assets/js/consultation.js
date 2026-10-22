
// SmartHealth - Doctor Consultation Demo
// Fictional doctor profiles and browser-only appointments.

const APPOINTMENT_STORAGE_KEY = "smarthealth_demo_appointments";

const doctors = {
    "doctor-1": "Dr. Ananya Sharma",
    "doctor-2": "Dr. Rahul Mehta",
    "doctor-3": "Dr. Sneha Patel"
};

const appointmentForm = document.getElementById("appointmentForm");
const doctorSelect = document.getElementById("doctorSelect");
const appointmentDate = document.getElementById("appointmentDate");
const appointmentTime = document.getElementById("appointmentTime");
const appointmentMessage = document.getElementById("appointmentMessage");
const appointmentsTableBody = document.getElementById("appointmentsTableBody");
const emptyAppointments = document.getElementById("emptyAppointments");

// Return today's date in local time.

function getLocalDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

appointmentDate.min = getLocalDate();

// Load saved demo appointment requests.

function getAppointments() {
    try {
        const stored = localStorage.getItem(APPOINTMENT_STORAGE_KEY);
        const appointments = stored ? JSON.parse(stored) : [];

        return Array.isArray(appointments) ? appointments : [];
    } catch (error) {
        window.SmartHealth.notify("Unable to load saved appointment requests.", "error");
        return [];
    }
}

// Show form feedback.

function showAppointmentMessage(message, type) {
    appointmentMessage.textContent = message;
    appointmentMessage.className = `form-message ${type}`;
    window.SmartHealth.notify(message, type);
}

// Create a safe table cell.

function appendCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = String(value);
    row.appendChild(cell);
}

// Display appointment requests.

function displayAppointments() {
    const appointments = getAppointments();

    appointmentsTableBody.replaceChildren();
    emptyAppointments.hidden = appointments.length > 0;

    appointments.slice().reverse().forEach(appointment => {
        const row = document.createElement("tr");

        appendCell(row, doctors[appointment.doctorId] || "Unknown Doctor");
        appendCell(row, appointment.date);
        appendCell(row, appointment.time);
        appendCell(row, appointment.mode);

        appendCell(row, "Saved locally");
        appointmentsTableBody.appendChild(row);
    });
}

// Select a doctor from the listing.

document.querySelectorAll(".doctor-select-btn").forEach(button => {
    button.addEventListener("click", () => {
        doctorSelect.value = button.dataset.doctor;

        document.getElementById("appointment-form")
            .scrollIntoView({ behavior: "smooth" });

        doctorSelect.focus({ preventScroll: true });
    });
});

// Save a new demonstration request.

appointmentForm.addEventListener("submit", event => {
    event.preventDefault();

    const request = {
        doctorId: doctorSelect.value,
        patientName: document.getElementById("patientName").value.trim(),
        patientEmail: document.getElementById("patientEmail").value.trim(),
        mode: document.getElementById("consultationMode").value,
        date: appointmentDate.value,
        time: appointmentTime.value,
        reason: document.getElementById("consultationReason").value.trim()
    };

    if (!appointmentForm.checkValidity()) {
        appointmentForm.reportValidity();
        return;
    }

    if (!doctors[request.doctorId]) {
        showAppointmentMessage("Please select a valid doctor.", "error");
        return;
    }

    if (!request.patientName || !request.reason) {
        showAppointmentMessage("Please complete all required fields.", "error");
        return;
    }

    const requestedDateTime = new Date(
        `${request.date}T${request.time}`
    );

    if (!Number.isFinite(requestedDateTime.getTime()) ||
        requestedDateTime.getTime() <= Date.now()) {

        showAppointmentMessage(
            "Please choose a future appointment date and time.",
            "error"
        );
        return;
    }

    const appointments = getAppointments();

    appointments.push({
        ...request,
        createdAt: new Date().toISOString()
    });

    try {
        localStorage.setItem(
            APPOINTMENT_STORAGE_KEY,
            JSON.stringify(appointments)
        );

        showAppointmentMessage(
            "Demo appointment request saved. " +
            "No real booking has been made.",
            "success"
        );

        appointmentForm.reset();
        displayAppointments();
    } catch (error) {
        showAppointmentMessage(
            "Unable to save the demo appointment request.",
            "error"
        );
    }
});

// Initialize the appointment table.

displayAppointments();
