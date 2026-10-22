"use strict";

// Shared, accessible popup cards. Load before the page's action scripts.
(() => {
    const FLASH_KEY = "smarthealth_notification";
    const styles = {
        success: { title: "Success", icon: "\u2713", duration: 6000 },
        error: { title: "Something went wrong", icon: "!", duration: 0 },
        warning: { title: "Please check", icon: "!", duration: 8000 },
        info: { title: "Information", icon: "i", duration: 8000 }
    };
    const active = new Map();
    let region;

    function notify(message, type = "info", options = {}) {
        if (!message) return;
        if (!Object.hasOwn(styles, type)) type = "info";
        const style = styles[type];
        const title = options.title || style.title;
        const key = JSON.stringify([type, title, String(message)]);
        if (active.has(key)) {
            active.get(key).restart();
            return;
        }

        if (!region) {
            region = document.createElement("section");
            region.className = "notification-region";
            region.setAttribute("aria-label", "Notifications");
            document.body.appendChild(region);
        }

        // Keep repeated failures from covering the screen.
        if (active.size >= 3) active.values().next().value.dismiss();

        const card = document.createElement("article");
        card.className = `notification-card notification-${type}`;
        card.setAttribute("role", type === "error" ? "alert" : "status");
        card.setAttribute("aria-atomic", "true");

        const icon = document.createElement("span");
        icon.className = "notification-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = style.icon;

        const content = document.createElement("div");
        content.className = "notification-content";
        const heading = document.createElement("h2");
        heading.className = "notification-title";
        heading.textContent = title;
        const text = document.createElement("p");
        text.className = "notification-message";
        text.textContent = String(message);
        content.append(heading, text);

        const close = document.createElement("button");
        close.type = "button";
        close.className = "notification-close";
        close.setAttribute("aria-label", "Dismiss notification");
        close.textContent = "\u00d7";

        const duration = options.duration ?? style.duration;
        let timer;
        let hovered = false;
        function pause() {
            clearTimeout(timer);
        }
        function restart() {
            pause();
            if (duration > 0 && !hovered && !card.contains(document.activeElement)) {
                timer = setTimeout(dismiss, duration);
            }
        }
        function dismiss() {
            pause();
            card.remove();
            active.delete(key);
        }

        close.addEventListener("click", dismiss);
        card.addEventListener("mouseenter", () => { hovered = true; pause(); });
        card.addEventListener("mouseleave", () => { hovered = false; restart(); });
        card.addEventListener("focusin", pause);
        card.addEventListener("focusout", () => setTimeout(restart, 0));
        card.addEventListener("keydown", event => {
            if (event.key === "Escape") dismiss();
        });

        card.append(icon, content, close);
        active.set(key, { dismiss, restart });
        region.appendChild(card);
        restart();
    }

    function flash(message, type = "info", options = {}) {
        try {
            sessionStorage.setItem(FLASH_KEY, JSON.stringify({
                message, type, options, createdAt: Date.now()
            }));
        } catch (error) {
            // Feedback remains available when browser storage is disabled.
            notify(message, type, options);
        }
    }

    window.SmartHealth = { ...window.SmartHealth, notify, flash };

    // Native required/email/range validation should also show a popup card.
    let reportingInvalid = false;
    document.addEventListener("invalid", event => {
        if (reportingInvalid || !event.target.validationMessage) return;
        reportingInvalid = true;
        notify(event.target.validationMessage, "error", { title: "Check your details" });
        setTimeout(() => { reportingInvalid = false; }, 0);
    }, true);

    try {
        const saved = sessionStorage.getItem(FLASH_KEY);
        sessionStorage.removeItem(FLASH_KEY);
        if (saved) {
            const pending = JSON.parse(saved);
            if (Date.now() - pending.createdAt < 30000) {
                notify(pending.message, pending.type, pending.options);
            }
        }
    } catch (error) {
        // A blocked or invalid saved notification must not interrupt the page.
    }
})();
