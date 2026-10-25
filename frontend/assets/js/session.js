"use strict";

// Shared account controls for the signed-in patient pages.
(() => {
    const names = document.querySelectorAll("[data-patient-name]");
    const avatars = document.querySelectorAll("[data-patient-initials]");
    const logoutButtons = document.querySelectorAll("[data-logout]");
    const status = document.querySelector("[data-account-status]");
    let loggingOut = false;
    let requestId = 0;
    let channel;
    try {
        channel = new BroadcastChannel("smarthealth-profile");
    } catch (error) {
        // Navigation and focus also refresh the shared session's account name.
    }

    function showStatus(message) {
        if (status) status.textContent = message;
        if (message) window.SmartHealth.notify(message, "error");
    }

    function renderAvatar(avatar, fullName, photoUrl) {
        const parts = String(fullName || "?").trim().split(/\s+/);
        const initials = [parts[0], ...(parts.length > 1 ? [parts[parts.length - 1]] : [])]
            .map(part => Array.from(part)[0]).join("").toLocaleUpperCase();
        avatar.dataset.initials = initials;
        if (avatar.dataset.photoPreview === "true") return;
        avatar.textContent = initials;
        if (typeof photoUrl === "string" && photoUrl.startsWith("/api/profile/photo?")) {
            const photo = document.createElement("img");
            photo.alt = "";
            photo.addEventListener("error", () => photo.remove(), { once: true });
            photo.src = photoUrl;
            avatar.appendChild(photo);
        }
    }
    window.SmartHealth = { ...window.SmartHealth, account: { renderAvatar } };

    async function loadCurrentPatient() {
        if (loggingOut) return;
        const currentRequest = ++requestId;
        showStatus("");

        try {
            const response = await fetch("/api/me", {
                credentials: "same-origin",
                cache: "no-store"
            });

            if (loggingOut || currentRequest !== requestId) return;
            if (response.status === 401) {
                window.SmartHealth.flash("Your session has ended. Please sign in again.", "info", { title: "Sign in required" });
                window.location.replace("/login.html");
                return;
            }
            if (!response.ok) throw new Error("Unable to load account.");

            const result = await response.json();
            if (loggingOut || currentRequest !== requestId) return;
            const fullName = result.patient?.full_name;
            if (typeof fullName !== "string" || !fullName.trim()) {
                throw new Error("Account name is unavailable.");
            }

            names.forEach(name => { name.textContent = fullName; });
            avatars.forEach(avatar => { renderAvatar(avatar, fullName, result.patient.photo_url); });
        } catch (error) {
            if (loggingOut || currentRequest !== requestId) return;
            names.forEach(name => { name.textContent = "Patient Account"; });
            avatars.forEach(avatar => { avatar.textContent = "?"; });
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
    window.addEventListener("focus", loadCurrentPatient);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") loadCurrentPatient();
    });
    window.addEventListener("smarthealth:profile-changed", () => {
        loadCurrentPatient();
        try {
            // Send only a refresh signal; patient information stays out of storage.
            channel?.postMessage("updated");
        } catch (error) {
            // Saving remains successful when tab messaging is unavailable.
        }
    });
    channel?.addEventListener("message", event => {
        if (event.data === "updated") loadCurrentPatient();
    });

    loadCurrentPatient();
})();
