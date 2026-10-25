"use strict";

(() => {
    const form = document.getElementById("profileForm");
    const fields = document.getElementById("profileFields");
    const details = document.getElementById("profileDetails");
    const editButton = document.getElementById("editProfile");
    const saveButton = document.getElementById("saveProfile");
    const retryButton = document.getElementById("retryProfile");
    const status = document.getElementById("profileStatus");
    const birthday = document.getElementById("dateOfBirth");
    let savedProfile;
    let csrfToken;
    let saving = false;
    window.SmartHealth.profile = { getDetails: () => ({ patient: savedProfile, csrfToken }) };

    const today = new Date();
    birthday.max = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");

    function feedback(message, type = "") {
        status.textContent = message;
        status.className = "profile-status " + type;
        if (type) window.SmartHealth.notify(message, type);
    }

    async function request(options = {}) {
        const response = await fetch("/api/profile", { credentials: "same-origin", cache: "no-store", ...options });
        if (response.status === 401) {
            window.SmartHealth.flash("Your session has ended. Please sign in again.", "info");
            window.location.replace("/login.html");
            const error = new Error("Please sign in again.");
            error.status = 401;
            throw error;
        }
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.status !== "success") {
            throw new Error(result.message || "Unable to reach your profile. Please try again.");
        }
        return result;
    }

    function render() {
        document.getElementById("summaryName").textContent = savedProfile.full_name;
        document.getElementById("summaryEmail").textContent = savedProfile.email;
        document.querySelectorAll("[data-profile-field]").forEach(element => {
            element.textContent = savedProfile[element.dataset.profileField] || "Not specified";
        });
        for (const control of form.querySelectorAll("[name]")) {
            control.value = savedProfile[control.name] || "";
        }
        document.getElementById("profileEmail").value = savedProfile.email;
    }

    function setEditing(editing) {
        form.hidden = !editing;
        fields.disabled = !editing;
        details.hidden = editing;
        editButton.hidden = editing;
        document.getElementById("profileHeading").textContent = editing ? "Edit Profile" : "Personal Information";
        document.getElementById("profileHint").textContent = editing ? "Fields marked with * are required. Other details are optional." : "Your saved patient details.";
    }

    async function load() {
        retryButton.hidden = true;
        document.getElementById("profileContent").hidden = true;
        feedback("Loading your profile...");
        try {
            const result = await request();
            savedProfile = result.patient;
            csrfToken = result.csrf_token;
            render();
            setEditing(false);
            document.getElementById("profileContent").hidden = false;
            window.dispatchEvent(new CustomEvent("smarthealth:profile-loaded", { detail: { patient: savedProfile, csrfToken } }));
            feedback("");
        } catch (error) {
            if (error.status !== 401) {
                feedback(error.message || "Unable to load your profile. Please try again.", "error");
                retryButton.hidden = false;
            }
        }
    }

    editButton.addEventListener("click", () => {
        render();
        feedback("");
        setEditing(true);
        document.getElementById("fullName").focus();
    });
    document.getElementById("cancelProfile").addEventListener("click", () => {
        if (saving) return;
        render();
        setEditing(false);
        feedback("");
        editButton.focus();
    });
    retryButton.addEventListener("click", load);
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (saving || !form.reportValidity()) return;
        const profile = Object.fromEntries(new FormData(form));
        profile.full_name = profile.full_name.trim();
        profile.phone = profile.phone.trim();
        if (!profile.full_name) {
            feedback("Enter your full name.", "error");
            document.getElementById("fullName").focus();
            return;
        }
        if (profile.phone && (!/^\+?[0-9 ().-]+$/.test(profile.phone) || !/^\d{7,15}$/.test(profile.phone.replace(/\D/g, "")))) {
            feedback("Enter a valid phone number with 7 to 15 digits.", "error");
            document.getElementById("profilePhone").focus();
            return;
        }
        saving = true;
        fields.disabled = true;
        form.setAttribute("aria-busy", "true");
        saveButton.textContent = "Saving...";
        feedback("Saving your profile...");
        try {
            const result = await request({
                method: "PUT",
                headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
                body: JSON.stringify(profile)
            });
            savedProfile = result.patient;
            csrfToken = result.csrf_token;
            render();
            setEditing(false);
            window.dispatchEvent(new Event("smarthealth:profile-changed"));
            feedback(result.message, "success");
            editButton.focus();
        } catch (error) {
            if (error.status !== 401) feedback(error.message || "Unable to save your profile. Please try again.", "error");
        } finally {
            saving = false;
            fields.disabled = form.hidden;
            form.removeAttribute("aria-busy");
            saveButton.textContent = "Save Changes";
        }
    });
    window.addEventListener("pageshow", event => {
        if (event.persisted && form.hidden && !saving) load();
    });
    load();
})();
