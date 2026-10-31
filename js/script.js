
"use strict";

// Homepage navigation only; leave shared authentication behavior unchanged.
(() => {
    const header = document.querySelector(".home-page .site-header");
    if (!header) return;

    const toggle = header.querySelector(".nav-toggle");
    const panel = header.querySelector(".homepage-navigation");
    const links = Array.from(header.querySelectorAll('.nav-links a[href^="#"]'));
    const sections = links.map(link => document.getElementById(link.hash.slice(1)));
    const mobile = window.matchMedia("(max-width: 1100px)");

    function setExpanded(expanded, restoreFocus = false) {
        panel.hidden = mobile.matches && !expanded;
        toggle.setAttribute("aria-expanded", String(!panel.hidden));
        toggle.setAttribute("aria-label", panel.hidden ? "Open navigation menu" : "Close navigation menu");
        if (restoreFocus) toggle.focus({ preventScroll: true });
    }

    function syncLayout() {
        const focusInPanel = panel.contains(document.activeElement);
        const focusOnToggle = document.activeElement === toggle;
        setExpanded(!mobile.matches, mobile.matches && focusInPanel);
        if (!mobile.matches && focusOnToggle) {
            header.querySelector(".logo").focus({ preventScroll: true });
        }
    }

    toggle.addEventListener("click", () => setExpanded(panel.hidden));
    panel.addEventListener("click", event => {
        if (mobile.matches && event.target.closest("a")) setExpanded(false, true);
    });
    header.addEventListener("keydown", event => {
        if (event.key === "Escape" && mobile.matches && !panel.hidden) {
            event.preventDefault();
            setExpanded(false, true);
        }
    });
    document.addEventListener("click", event => {
        if (mobile.matches && !panel.hidden && !header.contains(event.target)) {
            setExpanded(false, panel.contains(document.activeElement));
        }
    });
    header.addEventListener("focusout", event => {
        if (mobile.matches && event.relatedTarget && !header.contains(event.relatedTarget)) {
            setExpanded(false);
        }
    });
    mobile.addEventListener("change", syncLayout);
    header.classList.add("is-enhanced");
    syncLayout();

    function updateActiveLink() {
        const activationLine = header.getBoundingClientRect().bottom + 24;
        let activeIndex = 0;
        sections.forEach((section, index) => {
            if (section && section.getBoundingClientRect().top <= activationLine) activeIndex = index;
        });
        // The final section may be too short to reach the activation line.
        if (window.scrollY > 0 && Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 2) {
            activeIndex = links.length - 1;
        }
        links.forEach((link, index) => {
            if (index === activeIndex) link.setAttribute("aria-current", "location");
            else link.removeAttribute("aria-current");
        });
    }

    let framePending = false;
    function scheduleActiveLinkUpdate() {
        if (framePending) return;
        framePending = true;
        window.requestAnimationFrame(() => {
            updateActiveLink();
            framePending = false;
        });
    }
    window.addEventListener("scroll", scheduleActiveLinkUpdate, { passive: true });
    window.addEventListener("resize", scheduleActiveLinkUpdate);
    window.addEventListener("hashchange", scheduleActiveLinkUpdate);
    window.addEventListener("pageshow", scheduleActiveLinkUpdate);
    updateActiveLink();
})();

const REGISTERED_EMAIL_KEY = "smarthealth_registered_email";

// Password visibility control
document.querySelectorAll(".password-toggle").forEach((button) => {
    button.addEventListener("click", () => {
        const input = document.getElementById(button.dataset.target);

        if (!input) return;

        const isHidden = input.type === "password";
        input.type = isHidden ? "text" : "password";

        button.textContent = isHidden ? "Hide" : "Show";
        button.setAttribute(
            "aria-label",
            isHidden ? "Hide password" : "Show password"
        );
    });
});

// Display form messages
function showFormMessage(elementId, message, type) {
    const element = document.getElementById(elementId);

    if (element) {
        element.textContent = message;
        element.className = `form-message ${type}`;
    }
    window.SmartHealth.notify(message, type);
}

// Verify and persist real local accounts through the shared service.
async function sendAuthRequest(operation, data) {
    return { ok: true, result: await window.SmartHealth.auth[operation](data) };
}

// Patient Registration
const registerForm = document.getElementById("registerForm");

if (registerForm) {
    registerForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const fullName = document.getElementById("fullName").value.trim();
        const email = document.getElementById("registerEmail").value.trim();
        const password = document.getElementById("registerPassword").value;
        const confirmPassword = document.getElementById("confirmPassword").value;

        if (password !== confirmPassword) {
            showFormMessage(
                "registerMessage",
                "Passwords do not match.",
                "error"
            );
            return;
        }

        const submitButton = registerForm.querySelector('[type="submit"]');
        submitButton.disabled = true;

        try {
            const { ok, result } = await sendAuthRequest("register", {
                full_name: fullName,
                email: email,
                password: password
            });

            if (ok && result.status === "success") {
                // Transfer only the email; passwords never go into browser storage.
                try {
                    localStorage.setItem(REGISTERED_EMAIL_KEY, email.toLowerCase());
                } catch (error) {
                    // Storage restrictions must not prevent opening the login page.
                }
                window.SmartHealth.flash(
                    result.message || "Your account is ready. Please sign in.",
                    "success",
                    { title: "Account created" }
                );

                registerForm.reset();
                window.location.replace("login.html");
            } else {
                showFormMessage(
                    "registerMessage",
                    result.message || "Registration failed.",
                    "error"
                );
            }
        } catch (error) {
            showFormMessage(
                "registerMessage",
                error.message || "Unable to create a local account. Please try again.",
                "error"
            );
        } finally {
            submitButton.disabled = false;
        }
    });
}

// Patient Login
const loginForm = document.getElementById("loginForm");

if (loginForm) {
    try {
        const registeredEmail = localStorage.getItem(REGISTERED_EMAIL_KEY);
        localStorage.removeItem(REGISTERED_EMAIL_KEY);
        if (registeredEmail) {
            document.getElementById("loginEmail").value = registeredEmail;
            document.getElementById("loginPassword").focus();
        }
    } catch (error) {
        // The login form remains usable when browser storage is unavailable.
    }

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = document.getElementById("loginEmail").value.trim();
        const password = document.getElementById("loginPassword").value;

        const submitButton = loginForm.querySelector('[type="submit"]');
        submitButton.disabled = true;

        try {
            const { ok, result } = await sendAuthRequest("login", {
                email: email,
                password: password
            });

            if (ok && result.status === "success") {
                window.SmartHealth.flash(
                    result.message || "Login successful!",
                    "success",
                    { title: "Signed in" }
                );

                window.location.href = "dashboard.html";
            } else {
                showFormMessage(
                    "loginMessage",
                    result.message || "Invalid login details.",
                    "error"
                );
            }
        } catch (error) {
            showFormMessage(
                "loginMessage",
                error.message || "Unable to sign in locally. Please try again.",
                "error"
            );
        } finally {
            submitButton.disabled = false;
        }
    });
}
