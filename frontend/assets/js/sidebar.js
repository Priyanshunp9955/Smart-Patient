"use strict";

// Keep page links and dashboard section links in sync with navigation.
(() => {
    const navigation = document.querySelector(".sidebar-nav");
    if (!navigation) return;

    const entries = [...navigation.querySelectorAll("a[href]")].map(link => ({
        link, url: new URL(link.href)
    }));
    const currentPage = entries.filter(entry => entry.url.pathname === window.location.pathname);
    const pageLink = currentPage.find(entry => !entry.url.hash);
    const sections = currentPage.filter(entry => entry.url.hash).map(entry => ({
        ...entry, section: document.getElementById(decodeURIComponent(entry.url.hash.slice(1)))
    })).filter(entry => entry.section);
    let activeLink;
    let navigationTimer;
    let navigatingToSection = false;

    function activate(entry) {
        if (!entry) return;
        for (const item of entries) {
            const selected = item === entry || item.link === entry.link;
            item.link.classList.toggle("active", selected);
            if (selected) item.link.setAttribute("aria-current", item.url.hash ? "location" : "page");
            else item.link.removeAttribute("aria-current");
        }
        if (activeLink === entry.link) return;
        activeLink = entry.link;

        // Reveal the selected mobile tab without scrolling the main content.
        if (navigation.scrollWidth > navigation.clientWidth) {
            const menu = navigation.getBoundingClientRect();
            const item = entry.link.getBoundingClientRect();
            if (item.left < menu.left) navigation.scrollLeft += item.left - menu.left;
            else if (item.right > menu.right) navigation.scrollLeft += item.right - menu.right;
        }
    }

    function followScroll() {
        if (navigatingToSection || !sections.length) return;
        const marker = Math.min(window.innerHeight * 0.25, 180);
        let selected = pageLink;
        let nearestTop = -Infinity;
        for (const entry of sections) {
            const top = entry.section.getBoundingClientRect().top;
            if (top <= marker && top > nearestTop) {
                nearestTop = top;
                selected = entry;
            }
        }
        activate(selected);
    }

    function selectDestination(entry) {
        clearTimeout(navigationTimer);
        navigatingToSection = Boolean(entry?.url.hash);
        activate(entry);
        if (navigatingToSection) {
            // Keep the clicked tab selected during smooth anchor scrolling.
            navigationTimer = setTimeout(() => {
                navigatingToSection = false;
                followScroll();
            }, 1200);
        }
    }

    function followLocation() {
        const section = sections.find(entry => entry.url.hash === window.location.hash);
        selectDestination(section || pageLink);
    }

    navigation.addEventListener("click", event => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest("a[href]");
        const entry = entries.find(item => item.link === link);
        if (entry) selectDestination(entry);
    });
    window.addEventListener("hashchange", followLocation);
    window.addEventListener("popstate", followLocation);
    window.addEventListener("pageshow", followLocation);
    window.addEventListener("scroll", followScroll, { passive: true });
    window.addEventListener("resize", followScroll);
    followLocation();
})();
