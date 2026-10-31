"use strict";

(() => {
    const input = document.getElementById("profilePhotoFile");
    const avatar = document.getElementById("profilePhotoAvatar");
    const controls = document.querySelector(".profile-photo-controls");
    const previewActions = document.getElementById("photoPreviewActions");
    const saveButton = document.getElementById("saveProfilePhoto");
    const cancelButton = document.getElementById("cancelProfilePhoto");
    const removeButton = document.getElementById("removeProfilePhoto");
    const status = document.getElementById("photoStatus");
    let patient, pendingFile, previewUrl;
    let busy = false;
    let selectionId = 0;

    function feedback(message, type = "") {
        status.textContent = message;
        status.className = "profile-status " + type;
        if (type) window.SmartHealth.notify(message, type);
    }
    function discardPreview() {
        selectionId++;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = pendingFile = undefined;
        input.value = "";
        delete avatar.dataset.photoPreview;
        previewActions.hidden = true;
    }
    function renderSaved() {
        patient.full_name = window.SmartHealth.profile.getDetails().patient?.full_name || patient.full_name;
        window.SmartHealth.account.renderAvatar(avatar, patient.full_name, patient.photo_url);
        removeButton.hidden = !patient.photo_url;
        document.querySelector(".photo-upload-label").textContent = patient.photo_url ? "Change Profile Photo" : "Upload Profile Photo";
    }
    function initialize(details) {
        if (busy) return;
        patient = { ...details.patient };
        discardPreview();
        renderSaved();
    }
    window.addEventListener("smarthealth:profile-loaded", event => initialize(event.detail));
    input.addEventListener("change", () => {
        if (busy || !patient) return;
        const file = input.files[0];
        if (!file) return;
        discardPreview();
        renderSaved();
        feedback("");
        if (!/\.(jpe?g|png|webp)$/i.test(file.name) || (file.type && !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
            feedback("Choose a JPG, JPEG, PNG, or WebP image.", "error");
            return;
        }
        if (file.size === 0 || file.size > 2 * 1024 * 1024) {
            feedback("Choose a non-empty image of 2 MB or smaller.", "error");
            return;
        }
        pendingFile = file;
        previewUrl = URL.createObjectURL(file);
        const thisSelection = selectionId;
        const photo = document.createElement("img");
        photo.alt = "";
        photo.addEventListener("load", () => {
            if (thisSelection !== selectionId) return;
            avatar.dataset.photoPreview = "true";
            avatar.replaceChildren(photo);
            previewActions.hidden = false;
            feedback("Photo preview. Select Save Photo to upload it.");
        }, { once: true });
        photo.addEventListener("error", () => {
            if (thisSelection !== selectionId) return;
            discardPreview();
            renderSaved();
            feedback("This image cannot be previewed. Choose a valid photo.", "error");
        }, { once: true });
        photo.src = previewUrl;
    });
    cancelButton.addEventListener("click", () => {
        if (busy) return;
        discardPreview();
        renderSaved();
        feedback("");
        input.focus();
    });
    async function changePhoto(removing) {
        if (busy || !patient || (!removing && !pendingFile)) return;
        busy = true;
        input.disabled = saveButton.disabled = cancelButton.disabled = removeButton.disabled = true;
        controls.setAttribute("aria-busy", "true");
        feedback(removing ? "Removing your photo..." : "Uploading your photo...");
        try {
            const result = removing
                ? await window.SmartHealth.patient.removePhoto()
                : await window.SmartHealth.patient.savePhoto(pendingFile);
            patient.photo_url = result.photo_url;
            discardPreview();
            renderSaved();
            window.dispatchEvent(new Event("smarthealth:profile-changed"));
            feedback(result.message, "success");
            input.focus();
        } catch (error) {
            if (error.status === 401) window.location.replace("login.html");
            feedback(error.message || "Unable to update your photo. Please try again.", "error");
        } finally {
            busy = false;
            input.disabled = saveButton.disabled = cancelButton.disabled = removeButton.disabled = false;
            controls.removeAttribute("aria-busy");
        }
    }
    saveButton.addEventListener("click", () => changePhoto(false));
    removeButton.addEventListener("click", () => changePhoto(true));
    window.addEventListener("pagehide", () => {
        discardPreview();
        if (patient) renderSaved();
    });
    const initial = window.SmartHealth.profile.getDetails();
    if (initial.patient) initialize(initial);
})();
