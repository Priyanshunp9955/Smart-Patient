"use strict";

// All patient reading views share the signed-in localStorage service.
(() => {
    const pendingDeletes = new Set();
    let channel;
    try {
        channel = new BroadcastChannel("smarthealth-readings");
    } catch (error) {
        // Navigation and focus refreshes also work without BroadcastChannel.
    }

    async function local(operation) {
        try { return await operation(); }
        catch (error) {
          if (error.status === 401) {
            window.SmartHealth.flash("Your session has ended. Please sign in again.", "info", { title: "Sign in required" });
            window.location.replace("login.html");
          }
          throw error;
        }
    }

    async function list() {
        const readings = await local(() => window.SmartHealth.patient.readings.list());
        // Keep the same newest-first order on the dashboard and reading history.
        return readings.slice().sort((left, right) =>
            (right.measured_at || "").localeCompare(left.measured_at || "") || right.id - left.id
        );
    }

    async function save(reading) {
        const result = await local(() => window.SmartHealth.patient.readings.save(reading));
        publishChange();
        return result;
    }

    async function update(id, reading) {
        if (!Number.isSafeInteger(id) || id < 1) {
            throw new Error("This health reading has an invalid record ID. Refresh and try again.");
        }
        const result = await local(() => window.SmartHealth.patient.readings.update(id, reading));
        publishChange();
        return result;
    }

    function createEditButton(reading) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "edit-reading-button";
        button.textContent = "Edit";
        button.dataset.editReading = reading.id;
        button.setAttribute("aria-label", `Edit health reading #${reading.id}`);
        button.addEventListener("click", () => openEditor(reading));
        return button;
    }

    function openEditor(reading) {
        if (document.querySelector("#editReadingDialog")) return;
        const id = Number(reading.id);
        const dialog = document.createElement("dialog");
        dialog.id = "editReadingDialog";
        dialog.className = "reading-edit-dialog";
        dialog.setAttribute("aria-labelledby", "editReadingTitle");
        dialog.setAttribute("aria-describedby", "editReadingDescription");
        // This markup is static. Patient values are assigned only through value/textContent.
        dialog.innerHTML = `
            <form id="editReadingForm">
                <h2 id="editReadingTitle">Edit Health Reading</h2>
                <p id="editReadingDescription"></p>
                <fieldset class="reading-edit-fields">
                    <div class="reading-form-grid"></div>
                    <p class="form-message error" data-edit-error role="alert"></p>
                    <div class="reading-form-actions">
                        <button type="button" class="secondary-button" data-edit-cancel>Cancel</button>
                        <button type="submit" class="auth-submit">Save Changes</button>
                    </div>
                </fieldset>
            </form>`;
        dialog.querySelector("#editReadingDescription").textContent =
            `Update the measurements for record #${id}. Fields marked with * are required.`;
        const grid = dialog.querySelector(".reading-form-grid");
        const fields = [
            ["heart_rate", "Heart Rate (BPM)", 20, 250, "1"],
            ["spo2", "Blood Oxygen - SpO2 (%)", 0, 100, "any"],
            ["systolic", "Systolic Blood Pressure (mmHg)", 40, 300, "1"],
            ["diastolic", "Diastolic Blood Pressure (mmHg)", 20, 200, "1"],
            ["temperature", "Body Temperature (°C)", 25, 45, "any"],
            ["measured_at", "Measurement Date & Time"]
        ];
        const inputs = {};
        for (const [name, title, min, max, step] of fields) {
            const group = document.createElement("div");
            group.className = "form-group";
            const label = document.createElement("label");
            label.htmlFor = `editReading-${name}`;
            label.textContent = `${title} *`;
            const input = document.createElement("input");
            input.id = label.htmlFor;
            input.name = name;
            input.required = true;
            input.type = name === "measured_at" ? "datetime-local" : "number";
            if (min !== undefined) {
                input.min = min;
                input.max = max;
                input.step = step;
            } else {
                const now = new Date();
                input.max = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
            }
            input.value = reading[name] ?? "";
            inputs[name] = input;
            group.append(label, input);
            grid.appendChild(group);
        }
        let saving = false;
        const form = dialog.querySelector("form");
        const fieldset = dialog.querySelector("fieldset");
        const submit = dialog.querySelector('[type="submit"]');
        const errorMessage = dialog.querySelector("[data-edit-error]");
        dialog.querySelector("[data-edit-cancel]").addEventListener("click", () => dialog.close());
        dialog.addEventListener("cancel", event => {
            if (saving) event.preventDefault();
        });
        dialog.addEventListener("close", () => {
            dialog.remove();
            document.querySelector(`[data-edit-reading="${id}"]`)?.focus();
        }, { once: true });
        form.addEventListener("submit", async event => {
            event.preventDefault();
            if (saving || !form.reportValidity()) return;
            errorMessage.textContent = "";
            const values = Object.fromEntries(fields.map(([name]) => [
                name, name === "measured_at" ? inputs[name].value : Number(inputs[name].value)
            ]));
            if (values.systolic <= values.diastolic) {
                errorMessage.textContent = "Systolic blood pressure must be greater than diastolic.";
                inputs.systolic.focus();
                return;
            }
            if (new Date(values.measured_at).getTime() > Date.now()) {
                errorMessage.textContent = "Measurement date cannot be in the future.";
                inputs.measured_at.focus();
                return;
            }
            saving = true;
            fieldset.disabled = true;
            form.setAttribute("aria-busy", "true");
            submit.textContent = "Saving...";
            try {
                await update(id, values);
                dialog.close();
                window.SmartHealth.notify("Health reading updated successfully.", "success");
            } catch (error) {
                if (error.status !== 401) {
                    errorMessage.textContent = error.message || "Unable to update health reading. Please try again.";
                }
            } finally {
                saving = false;
                fieldset.disabled = false;
                form.removeAttribute("aria-busy");
                submit.textContent = "Save Changes";
            }
        });
        document.body.appendChild(dialog);
        dialog.showModal();
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
            await local(() => window.SmartHealth.patient.readings.remove(id));
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
        readings: { list, save, update, remove, createEditButton, createDeleteButton, onChange }
    };
})();
