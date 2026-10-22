
"use strict";

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

// Send data to Flask backend
async function sendAuthRequest(endpoint, data) {
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        credentials: "same-origin",
        body: JSON.stringify(data)
    });

    const result = await response.json();

    return {
        ok: response.ok,
        result
    };
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
            const { ok, result } = await sendAuthRequest("/api/register", {
                full_name: fullName,
                email: email,
                password: password
            });

            if (ok && result.status === "success") {
                // Transfer only the email; passwords never go into browser storage.
                try {
                    sessionStorage.setItem(REGISTERED_EMAIL_KEY, email.toLowerCase());
                } catch (error) {
                    // Storage restrictions must not prevent opening the login page.
                }
                window.SmartHealth.flash(
                    result.message || "Your account is ready. Please sign in.",
                    "success",
                    { title: "Account created" }
                );

                registerForm.reset();
                window.location.replace("/login.html");
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
                "Unable to connect to server. Please try again.",
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
        const registeredEmail = sessionStorage.getItem(REGISTERED_EMAIL_KEY);
        sessionStorage.removeItem(REGISTERED_EMAIL_KEY);
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
            const { ok, result } = await sendAuthRequest("/api/login", {
                email: email,
                password: password
            });

            if (ok && result.status === "success") {
                window.SmartHealth.flash(
                    result.message || "Login successful!",
                    "success",
                    { title: "Signed in" }
                );

                window.location.href = "/dashboard.html";
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
                "Unable to connect to server. Please try again.",
                "error"
            );
        } finally {
            submitButton.disabled = false;
        }
    });
}
