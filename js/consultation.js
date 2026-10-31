"use strict";

// Fictional doctors and durable, current-account demonstration requests.
(() => {
    const S=window.SmartHealth;
    const doctors={"doctor-1":"Dr. Ananya Sharma","doctor-2":"Dr. Rahul Mehta","doctor-3":"Dr. Sneha Patel"};
    const form=document.getElementById("appointmentForm"),doctorSelect=document.getElementById("doctorSelect");
    const date=document.getElementById("appointmentDate"),body=document.getElementById("appointmentsTableBody"),empty=document.getElementById("emptyAppointments");
    let busy=false,requestId=0;
    date.min=S.validate.localDate();
    document.querySelectorAll(".doctor-avatar img").forEach(image=>{
        image.addEventListener("error",()=>{image.hidden=true;},{once:true});
        if(image.complete&&!image.naturalWidth)image.hidden=true;
    });
    const feedback=(message,type)=>{
        const element=document.getElementById("appointmentMessage");
        element.textContent=message;element.className=`form-message ${type}`;S.notify(message,type);
    };
    async function displayAppointments() {
        const current=++requestId;
        try {
            const appointments=await S.patient.appointments.list();
            if(current!==requestId)return;
            body.replaceChildren();empty.hidden=!!appointments.length;empty.textContent="No appointment requests yet.";
            for(const appointment of appointments) {
                const row=document.createElement("tr");
                for(const value of [doctors[appointment.doctorId]||"Unknown Doctor",appointment.date,appointment.time,appointment.mode,"Saved locally"]) {
                    const cell=document.createElement("td");cell.textContent=value;row.appendChild(cell);
                }
                body.appendChild(row);
            }
        } catch(error) {
            if(current!==requestId)return;
            body.replaceChildren();empty.hidden=false;empty.textContent="Appointment requests could not be loaded.";
            if(error.status===401)location.replace("login.html");else feedback(error.message,"error");
        }
    }
    document.querySelectorAll(".doctor-select-btn").forEach(button=>button.addEventListener("click",()=>{
        doctorSelect.value=button.dataset.doctor;
        document.getElementById("appointment-form").scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});
        doctorSelect.focus({preventScroll:true});
    }));
    form.addEventListener("submit",async event=>{
        event.preventDefault();if(busy||!form.reportValidity())return;
        const values={doctorId:doctorSelect.value,patientName:document.getElementById("patientName").value,patientEmail:document.getElementById("patientEmail").value,mode:document.getElementById("consultationMode").value,date:date.value,time:document.getElementById("appointmentTime").value,reason:document.getElementById("consultationReason").value};
        const submit=form.querySelector('[type="submit"]');busy=true;submit.disabled=true;
        try {
            await S.patient.appointments.save(values);
            feedback("Demo appointment request saved. No real booking has been made.","success");form.reset();date.min=S.validate.localDate();await displayAppointments();
        } catch(error) {if(error.status===401)location.replace("login.html");else feedback(error.message,"error");}
        finally {busy=false;submit.disabled=false;}
    });
    for(const name of ["focus","smarthealth:appointments-changed"])window.addEventListener(name,displayAppointments);
    window.addEventListener("pageshow",event=>{if(event.persisted)displayAppointments();});
    document.addEventListener("visibilitychange",()=>{if(!document.hidden)displayAppointments();});

    // Old requests had no account owner. Only explicitly selected entries move.
    const panel=document.createElement("section");panel.className="reading-form-card";
    panel.innerHTML='<h2>Import earlier local requests</h2><p>Earlier requests had no account owner. Preview and select only the requests that belong to you. The original source is kept.</p><button type="button" class="logout-button" data-preview-legacy>Preview earlier browser requests</button><button type="button" class="photo-text-button" data-export-legacy>Export original browser requests</button><p><label for="legacyRequestsFile">Or choose a legacy requests JSON file from the old localhost address</label><input id="legacyRequestsFile" type="file" accept=".json,application/json"></p><p data-legacy-status role="status"></p><div class="legacy-request-list"></div><button type="button" class="logout-button" data-import-legacy hidden>Import selected requests</button>';
    document.querySelector(".dashboard-footer").before(panel);
    let source,selection=0,importing=false;
    const list=panel.querySelector(".legacy-request-list"),status=panel.querySelector("[data-legacy-status]"),confirm=panel.querySelector("[data-import-legacy]");
    async function preview() {
        const current=++selection;list.replaceChildren();confirm.hidden=true;
        try {
            const rows=await S.transfer.legacyPreview(source);
            if(current!==selection)return;
            status.textContent=rows.length?"Select requests to associate with your signed-in account. Imported entries are marked.":"No earlier requests found at this address. Choose an exported file if the old app used a different hostname or port.";
            for(const row of rows) {
                const label=document.createElement("label"),copy=document.createElement("span");
                if(row.error) {copy.textContent=`Entry ${row.index+1}: ${row.error} Source kept for recovery.`;label.append(copy);}
                else {
                    const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.value=row.key;checkbox.disabled=!!row.imported;
                    copy.textContent=`${row.values.patientName} (${row.values.patientEmail}) — ${doctors[row.values.doctorId]}, ${row.values.date} ${row.values.time}, ${row.values.mode}${row.imported?" — already imported":""}`;
                    label.append(checkbox,copy);
                }
                list.appendChild(label);
            }
            confirm.hidden=!rows.some(row=>row.key&&!row.imported);
        } catch(error) {if(current===selection){status.textContent=error.message;S.notify(error.message,"error");}}
    }
    panel.querySelector("[data-preview-legacy]").onclick=()=>{source=undefined;preview();};
    panel.querySelector("input[type=file]").onchange=async event=>{
        try {const file=event.target.files[0];if(!file)return;if(file.size>16*1024*1024)throw new Error("Choose a legacy file smaller than 16 MB.");source=await file.text();await preview();}
        catch(error){status.textContent=error.message;}
    };
    panel.querySelector("[data-export-legacy]").onclick=()=>{
        try {const raw=localStorage.getItem("smarthealth_demo_appointments");if(raw===null)throw new Error("No legacy requests are stored at this address.");S.transfer.download(raw,"smarthealth-legacy-appointments.json");}catch(error){status.textContent=error.message;}
    };
    confirm.onclick=async()=>{
        if(importing)return;importing=true;confirm.disabled=true;
        const selected=[...list.querySelectorAll("input:checked")].map(input=>input.value);
        try {await S.transfer.importLegacy(selected,source);await preview();await displayAppointments();S.notify("Selected requests imported. The original source is unchanged.","success");}
        catch(error){status.textContent=error.message;S.notify(error.message,"error");}
        finally{importing=false;confirm.disabled=false;}
    };
    displayAppointments();
})();
