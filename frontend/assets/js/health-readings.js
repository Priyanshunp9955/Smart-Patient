"use strict";

// Both reading pages use the signed-in patient's API data without a local cache.
(() => {
    let channel;
    try {
        channel = new BroadcastChannel("smarthealth-readings");
    } catch (error) {
        // Navigation and focus refreshes also work without BroadcastChannel.
    }

    async function request(options = {}) {
        const response = await fetch("/api/readings", {
            credentials: "same-origin",
            cache: "no-store",
            ...options
        });
        if (response.status === 401) {
            window.SmartHealth.flash("Your session has ended. Please sign in again.", "info", { title: "Sign in required" });
            window.location.replace("/login.html");
            const error = new Error("Please sign in to view your health records.");
            error.status = 401;
            throw error;
        }

        const result = await response.json();
        if (!response.ok || result.status === "error") {
            throw new Error(result.message || "Unable to load health records. Please try again.");
        }
        return result;
    }

    async function list() {
        const result = await request();
        if (!Array.isArray(result.readings)) {
            throw new Error("Unable to load health records. Please try again.");
        }
        // Keep the same newest-first order on the dashboard and reading history.
        return result.readings.slice().sort((left, right) =>
            right.measured_at.localeCompare(left.measured_at) || right.id - left.id
        );
    }

    async function save(reading) {
        const result = await request({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reading)
        });
        // Publish only an invalidation signal, never patient records.
        try {
            channel?.postMessage("updated");
        } catch (error) {
            // A successful save must not fail if cross-tab messaging is unavailable.
        }
        return result;
    }

    function onChange(refresh) {
        let timer;
        const schedule = () => {
            clearTimeout(timer);
            timer = setTimeout(refresh, 50);
        };
        window.addEventListener("focus", schedule);
        window.addEventListener("pageshow", event => {
            if (event.persisted) schedule();
        });
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") schedule();
        });
        channel?.addEventListener("message", event => {
            if (event.data === "updated") schedule();
        });
    }

    window.SmartHealth = {
        ...window.SmartHealth,
        readings: { list, save, onChange }
    };
})();
