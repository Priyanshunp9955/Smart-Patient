"use strict";

// Shared patient navigation, appearance, and accessible mobile disclosure.
(() => {
    const navigation = document.querySelector(".sidebar-nav");
    if (!navigation) return;

    const sidebar = navigation.closest(".dashboard-sidebar");
    const icons = {
        dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
        reading: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 12h8m-4-4v8"/>',
        records: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8m-8 4h6"/>',
        trends: '<path d="M3 3v18h18M6 15l5-5 4 3 6-8m-5 0h5v5"/>',
        alerts: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
        consultation: '<path d="M6 3v5a4 4 0 0 0 8 0V3M4 3h4m4 0h4M10 12v3a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="10" r="3"/>',
        patient: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
        home: '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8"/>',
        back: '<path d="M19 12H5m7-7-7 7 7 7"/>',
        menu: '<path d="M4 6h16M4 12h16M4 18h16"/>'
    };
    function icon(name) {
        return `<svg class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[name]}</svg>`;
    }

    // Enhance the existing shared markup; the original links remain usable without JS.
    for (const link of navigation.querySelectorAll("a[href]")) {
        const url = new URL(link.href);
        const name = url.pathname.endsWith("health-records.html") ? "records"
            : url.pathname.endsWith("health-trends.html") ? "trends"
            : url.pathname.endsWith("health-alerts.html") ? "alerts"
            : url.pathname.endsWith("add-reading.html") ? "reading"
            : url.pathname.endsWith("consultation.html") ? "consultation"
            : url.pathname.endsWith("profile.html") ? "patient" : "dashboard";
        const label = document.createElement("span");
        label.textContent = link.textContent.trim();
        link.replaceChildren(label);
        link.insertAdjacentHTML("afterbegin", icon(name));
    }

    const heading = sidebar.querySelector(".sidebar-heading");
    heading.innerHTML = `<span class="sidebar-patient-icon">${icon("patient")}</span>
        <span class="sidebar-portal-copy"><span>PATIENT PORTAL</span><strong>Patient Area</strong></span>
        <svg class="sidebar-ecg" viewBox="0 0 220 80" fill="none" aria-hidden="true" focusable="false"><path d="M0 48h55l10-12 12 24 15-47 17 61 13-26h98"/></svg>`;

    const footer = sidebar.querySelector(".sidebar-bottom");
    // One shared footer replaces each page's legacy fallback without duplicates.
    footer.innerHTML = `<p>SmartHealth Patient Portal</p>
        <a href="/index.html">${icon("home")}<span>Back to Home</span></a>
        <a href="/dashboard.html">${icon("back")}<span>Back to Dashboard</span></a>`;

    const content = document.createElement("div");
    content.className = "sidebar-content";
    content.id = "patient-sidebar-content";
    content.append(heading, navigation, footer);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "sidebar-toggle";
    toggle.setAttribute("aria-controls", content.id);
    toggle.innerHTML = `${icon("menu")}<span>Menu</span>`;
    sidebar.append(toggle, content);

    const mobile = window.matchMedia("(max-width: 900px)");
    function setExpanded(expanded, restoreFocus = false) {
        content.hidden = mobile.matches && !expanded;
        toggle.setAttribute("aria-expanded", String(!content.hidden));
        toggle.setAttribute("aria-label", content.hidden ? "Open patient navigation" : "Close patient navigation");
        toggle.querySelector("span").textContent = content.hidden ? "Menu" : "Close";
        if (restoreFocus) toggle.focus({ preventScroll: true });
    }
    function syncLayout() {
        const restoreFocus = mobile.matches && content.contains(document.activeElement);
        setExpanded(!mobile.matches, restoreFocus);
    }
    toggle.addEventListener("click", () => setExpanded(content.hidden));
    sidebar.addEventListener("keydown", event => {
        if (event.key === "Escape" && mobile.matches && !content.hidden) {
            event.preventDefault();
            setExpanded(false, true);
        }
    });
    document.addEventListener("click", event => {
        if (mobile.matches && !content.hidden && !sidebar.contains(event.target)) setExpanded(false);
    });
    content.addEventListener("click", event => {
        if (mobile.matches && event.target.closest("a[href]") && event.button === 0
            && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
            setExpanded(false, content.contains(document.activeElement));
        }
    });
    mobile.addEventListener("change", syncLayout);
    window.addEventListener("pageshow", syncLayout);
    syncLayout();

    function followLocation() {
        for (const link of navigation.querySelectorAll("a[href]")) {
            const selected = new URL(link.href).pathname === window.location.pathname;
            link.classList.toggle("active", selected);
            if (selected) link.setAttribute("aria-current", "page");
            else link.removeAttribute("aria-current");
        }
    }
    window.addEventListener("popstate", followLocation);
    window.addEventListener("pageshow", followLocation);
    followLocation();
})();
