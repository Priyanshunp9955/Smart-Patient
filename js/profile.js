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
    let saving = false;
    window.SmartHealth.profile = { getDetails: () => ({ patient: savedProfile }) };

    const today = new Date();
    birthday.max = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");

    function feedback(message, type = "") {
        status.textContent = message;
        status.className = "profile-status " + type;
        if (type) window.SmartHealth.notify(message, type);
    }

    async function request(data) {
        try { return data ? await window.SmartHealth.patient.updateProfile(data) : await window.SmartHealth.patient.profile(); }
        catch (error) {
            if (error.status === 401) {
                window.SmartHealth.flash(error.message, "info");
                window.location.replace("login.html");
            }
            throw error;
        }
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
            render();
            setEditing(false);
            document.getElementById("profileContent").hidden = false;
            window.dispatchEvent(new CustomEvent("smarthealth:profile-loaded", { detail: { patient: savedProfile } }));
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
            const result = await request(profile);
            savedProfile = result.patient;
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

    const passwordForm = document.getElementById("changePasswordForm");
    const passwordFields = document.getElementById("changePasswordFields");
    const passwordButton = document.getElementById("updatePassword");
    const passwordStatus = document.getElementById("passwordStatus");
    const passwordInputs = [...passwordForm.querySelectorAll("input")];
    const passwordToggles = [...passwordForm.querySelectorAll("[data-change-password-toggle]")];
    let updatingPassword = false;

    function passwordFeedback(message, type = "") {
        passwordStatus.textContent = message;
        passwordStatus.className = "profile-status " + type;
        if (type) window.SmartHealth.notify(message, type);
    }
    function clearPasswords() {
        passwordForm.reset();
        passwordInputs.forEach(input => { input.value = ""; input.type = "password"; });
        passwordToggles.forEach(toggle => {
            toggle.setAttribute("aria-pressed", "false");
            toggle.setAttribute("aria-label", "Show " + toggle.dataset.passwordLabel);
        });
    }
    passwordToggles.forEach(toggle => {
        toggle.dataset.passwordLabel = toggle.getAttribute("aria-label").slice(5);
        toggle.addEventListener("click", () => {
            if (updatingPassword) return;
            const input = document.getElementById(toggle.dataset.changePasswordToggle);
            const showing = input.type === "password";
            input.type = showing ? "text" : "password";
            toggle.setAttribute("aria-pressed", String(showing));
            toggle.setAttribute("aria-label", (showing ? "Hide " : "Show ") + toggle.dataset.passwordLabel);
        });
    });
    passwordForm.addEventListener("submit", async event => {
        event.preventDefault();
        if (updatingPassword || !passwordForm.reportValidity()) return;
        const current = document.getElementById("currentPassword");
        const next = document.getElementById("newPassword");
        const confirmation = document.getElementById("confirmNewPassword");
        if (Array.from(next.value).length < 8) {
            passwordFeedback("New password must be at least 8 characters.", "error");
            next.focus();
            return;
        }
        if (next.value !== confirmation.value) {
            passwordFeedback("New passwords do not match.", "error");
            confirmation.focus();
            return;
        }
        if (next.value === current.value) {
            passwordFeedback("New password must differ from your current password.", "error");
            next.focus();
            return;
        }
        updatingPassword = true;
        passwordFields.disabled = true;
        passwordForm.setAttribute("aria-busy", "true");
        passwordButton.textContent = "Updating...";
        passwordFeedback("Updating your password...");
        try {
            const result = await window.SmartHealth.auth.changePassword({
                current_password: current.value, new_password: next.value, confirm_password: confirmation.value
            });
            passwordFeedback(result.message, "success");
        } catch (error) {
            if (error.status === 401) window.location.replace("login.html");
            passwordFeedback(error.message || "Unable to update your password. Please try again.", "error");
        } finally {
            clearPasswords();
            updatingPassword = false;
            passwordFields.disabled = false;
            passwordForm.removeAttribute("aria-busy");
            passwordButton.textContent = "Update Password";
        }
    });
    window.addEventListener("pagehide", clearPasswords);
    window.addEventListener("pageshow", event => {
        if (event.persisted) clearPasswords();
    });
    const refreshIfIdle = () => {
        if (form.hidden && !saving && !document.querySelector('[data-photo-preview="true"]') && !document.querySelector('.profile-photo-controls[aria-busy="true"]')) load();
    };
    window.addEventListener("smarthealth:profile-changed", refreshIfIdle);
    window.addEventListener("smarthealth:backup-imported", load);
    window.addEventListener("focus", refreshIfIdle);
    window.addEventListener("visibilitychange", () => { if (!document.hidden) refreshIfIdle(); });
    window.SmartHealth.transfer.mountBackup();
    load();
})();
