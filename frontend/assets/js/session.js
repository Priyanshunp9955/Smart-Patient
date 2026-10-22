"use strict";

// Shared account controls for the signed-in patient pages.
(() => {
    const names = document.querySelectorAll("[data-patient-name]");
    const avatars = document.querySelectorAll("[data-patient-initials]");
    const logoutButtons = document.querySelectorAll("[data-logout]");
    const status = document.querySelector("[data-account-status]");
    let loggingOut = false;

    function showStatus(message) {
        if (status) status.textContent = message;
        if (message) window.SmartHealth.notify(message, "error");
    }

    async function loadCurrentPatient() {
        names.forEach(name => { name.textContent = "Loading account..."; });
        avatars.forEach(avatar => { avatar.textContent = "?"; });
        showStatus("");

        try {
            const response = await fetch("/api/me", {
                credentials: "same-origin",
                cache: "no-store"
            });

            if (loggingOut) return;
            if (response.status === 401) {
                window.SmartHealth.flash("Your session has ended. Please sign in again.", "info", { title: "Sign in required" });
                window.location.replace("/login.html");
                return;
            }
            if (!response.ok) throw new Error("Unable to load account.");

            const result = await response.json();
            if (loggingOut) return;
            const fullName = result.patient?.full_name;
            if (typeof fullName !== "string" || !fullName.trim()) {
                throw new Error("Account name is unavailable.");
            }

            const parts = fullName.trim().split(/\s+/);
            const initials = [parts[0], ...(parts.length > 1 ? [parts[parts.length - 1]] : [])]
                .map(part => Array.from(part)[0]).join("").toLocaleUpperCase();

            names.forEach(name => { name.textContent = fullName; });
            avatars.forEach(avatar => { avatar.textContent = initials; });
        } catch (error) {
            if (loggingOut) return;
            names.forEach(name => { name.textContent = "Patient Account"; });
            showStatus("Unable to load your name. Please refresh the page.");
        }
    }

    logoutButtons.forEach(button => {
        button.addEventListener("click", async () => {
            if (loggingOut) return;
            loggingOut = true;
            showStatus("");
            logoutButtons.forEach(control => {
                control.disabled = true;
                control.textContent = "Logging out...";
            });

            try {
                const response = await fetch("/api/logout", {
                    method: "POST",
                    credentials: "same-origin"
                });
                if (!response.ok) throw new Error("Logout failed.");

                names.forEach(name => { name.textContent = "Patient Account"; });
                avatars.forEach(avatar => { avatar.textContent = "?"; });
                window.SmartHealth.flash("You have been logged out successfully.", "success", { title: "Signed out" });
                window.location.replace("/login.html");
            } catch (error) {
                loggingOut = false;
                logoutButtons.forEach(control => {
                    control.disabled = false;
                    control.textContent = "Log out";
                });
                showStatus("Unable to log out. Please try again.");
            }
        });
    });

    // Refresh the session when a browser restores a page from its back/forward cache.
    window.addEventListener("pageshow", event => {
        if (event.persisted) loadCurrentPatient();
    });

    loadCurrentPatient();
})();
