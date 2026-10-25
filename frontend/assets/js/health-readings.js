"use strict";

// All patient reading views use the signed-in API without a local cache.
(() => {
    const pendingDeletes = new Set();
    let channel;
    try {
        channel = new BroadcastChannel("smarthealth-readings");
    } catch (error) {
        // Navigation and focus refreshes also work without BroadcastChannel.
    }

    async function request(options = {}, path = "/api/readings") {
        const response = await fetch(path, {
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
            (right.measured_at || "").localeCompare(left.measured_at || "") || right.id - left.id
        );
    }

    async function save(reading) {
        const result = await request({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reading)
        });
        publishChange();
        return result;
    }

    function publishChange() {
        // Publish only an invalidation signal, never patient records.
        window.dispatchEvent(new Event("smarthealth:readings-changed"));
        try {
            channel?.postMessage("updated");
        } catch (error) {
            // A successful mutation must not fail if messaging is unavailable.
        }
    }

    async function remove(reading) {
        const id = Number(reading.id);
        if (!Number.isSafeInteger(id) || id < 1) {
            throw new Error("This health reading has an invalid record ID. Refresh and try again.");
        }
        if (pendingDeletes.has(id)) return false;
        const date = reading.measured_at?.replace("T", " ") || "unknown date";
        if (!window.confirm(`Delete health reading #${id} recorded on ${date}? This cannot be undone.`)) {
            return false;
        }
        pendingDeletes.add(id);
        try {
            await request({
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    "X-SmartHealth-Action": "delete-reading"
                },
                body: JSON.stringify({ confirmed: true })
            }, `/api/readings/${id}`);
            publishChange();
            return true;
        } finally {
            pendingDeletes.delete(id);
        }
    }

    function createDeleteButton(reading) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "delete-reading-button";
        button.textContent = "Delete";
        button.dataset.deleteReading = reading.id;
        button.setAttribute("aria-label", `Delete health reading #${reading.id}`);
        button.disabled = pendingDeletes.has(Number(reading.id));
        button.addEventListener("click", async () => {
            if (button.disabled) return;
            button.disabled = true;
            try {
                if (await remove(reading)) {
                    window.SmartHealth.notify("Health reading deleted successfully.", "success");
                }
            } catch (error) {
                if (error.status !== 401) {
                    window.SmartHealth.notify(error.message || "Unable to delete health reading. Please try again.", "error");
                }
            } finally {
                // A focus refresh can replace this row while DELETE is pending.
                document.querySelectorAll("[data-delete-reading]").forEach(control => {
                    control.disabled = pendingDeletes.has(Number(control.dataset.deleteReading));
                });
            }
        });
        return button;
    }

    function onChange(refresh) {
        let timer;
        const schedule = () => {
            clearTimeout(timer);
            timer = setTimeout(refresh, 50);
        };
        window.addEventListener("focus", schedule);
        window.addEventListener("smarthealth:readings-changed", schedule);
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
        readings: { list, save, remove, createDeleteButton, onChange }
    };
})();
