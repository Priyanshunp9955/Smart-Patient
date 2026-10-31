"use strict";

(() => {
    const S=window.SmartHealth,V=S.validate,A=S.auth;
    const FORMAT="smarthealth-account", VERSION=1, MAX_BYTES=16*1024*1024;
    const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,"0")).join("");
    const plainProfile=account=>Object.fromEntries(["email",...V.profileFields].map(field=>[field,account[field]??null]));
    const photoData=blob=>new Promise((resolve,reject)=> {const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(",")[1]);reader.onerror=()=>reject(new Error("Unable to read the saved photo."));reader.readAsDataURL(blob);});
    function download(data,name) {
        const url=URL.createObjectURL(new Blob([typeof data==="string"?data:JSON.stringify(data,null,2)],{type:"application/json"}));
        const link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    async function exportAccount() {
        const snapshot=await A.scope(["readings","photos","appointments","metadata"],"readonly",async(stores,get,account)=>({
            account:plainProfile(account),
            readings:(await get(stores.readings.index("owner").getAll(account.id))).map(({owner,...row})=>row),
            appointments:(await get(stores.appointments.index("owner").getAll(account.id))).map(({owner,...row})=>row),
            photo:await get(stores.photos.get(account.id)),
            highWater:(await get(stores.metadata.get("reading-high-water")))?.value||0
        }));
        return {format:FORMAT,version:VERSION,exportedAt:new Date().toISOString(),account:snapshot.account,readings:snapshot.readings,appointments:snapshot.appointments,photo:snapshot.photo?{type:"image/webp",base64:snapshot.photo.base64}:null,highWater:snapshot.highWater};
    }
    function importedReading(raw) {
        V.fields(raw,["id",...V.readingFields]);
        if(!Number.isSafeInteger(raw.id)||raw.id<1) V.fail("Backup contains an invalid reading ID.");
        const result={id:raw.id};
        for(const [field,min,max,integer] of [["heart_rate",20,250,true],["spo2",0,100,false],["systolic",40,300,true],["diastolic",20,200,true],["temperature",25,45,false]]) {
            if(raw[field]===null) {result[field]=null;continue;}
            if(!["number","string"].includes(typeof raw[field]) || (typeof raw[field]==="string"&&!/^\d+(?:\.\d+)?$/.test(raw[field]))) V.fail("Backup contains invalid measurement values.");
            const value=Number(raw[field]);
            if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value))) V.fail(`Backup contains an out-of-range ${field}.`);
            result[field]=value;
        }
        if(result.systolic!==null && result.diastolic!==null && result.systolic<=result.diastolic) V.fail("Backup contains invalid blood pressure.");
        if(raw.measured_at!=="") {
            if(V.calendar(raw.measured_at,true).getTime()>Date.now()) V.fail("Backup contains a future measurement.");
        }
        result.measured_at=raw.measured_at;
        return result;
    }
    async function validateBackup(text) {
        if(typeof text!=="string" || new Blob([text]).size>MAX_BYTES) V.fail("Choose a backup smaller than 16 MB.");
        let data;
        try {data=JSON.parse(text);} catch {V.fail("This file is not valid JSON. The saved records have not changed.");}
        V.fields(data,["format","version","exportedAt","account","readings","appointments","photo","highWater"]);
        if(data.format!==FORMAT||data.version!==VERSION) V.fail("This backup format/version is not supported.");
        if(typeof data.exportedAt!=="string" || !Number.isFinite(Date.parse(data.exportedAt))) V.fail("Backup has an invalid export date.");
        V.fields(data.account,["email",...V.profileFields]);
        const email=V.email(data.account.email);
        const account={email,...V.profile(Object.fromEntries(V.profileFields.map(field=>[field,data.account[field]])))};
        if(!Array.isArray(data.readings)||!Array.isArray(data.appointments)||data.readings.length>20000||data.appointments.length>20000) V.fail("Backup contains too many or invalid records.");
        const readings=data.readings.map(importedReading);
        if(new Set(readings.map(row=>row.id)).size!==readings.length) V.fail("Backup contains duplicate reading IDs.");
        if(!Number.isSafeInteger(data.highWater)||data.highWater<0||data.highWater>=Number.MAX_SAFE_INTEGER||readings.some(row=>row.id>data.highWater)) V.fail("Backup reading counter is invalid.");
        const appointments=data.appointments.map(raw=>{
            V.fields(raw,["id","createdAt","doctorId","patientName","patientEmail","mode","date","time","reason"]);
            if(!Number.isSafeInteger(raw.id)||raw.id<1 || typeof raw.createdAt!=="string" || !Number.isFinite(Date.parse(raw.createdAt))) V.fail("Backup contains an invalid appointment.");
            const {id,createdAt,...values}=raw;
            return {...V.appointment(values,true),id,createdAt};
        });
        if(new Set(appointments.map(row=>row.id)).size!==appointments.length) V.fail("Backup contains duplicate appointment IDs.");
        let photo=null;
        if(data.photo!==null) {
            V.fields(data.photo,["type","base64"]);
            if(data.photo.type!=="image/webp" || typeof data.photo.base64!=="string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.photo.base64)) V.fail("Backup photo is invalid.");
            let bytes;try {bytes=Uint8Array.from(atob(data.photo.base64),char=>char.charCodeAt(0));} catch {V.fail("Backup photo encoding is invalid.");}
            const file=new File([bytes],"profile.webp",{type:"image/webp"});
            const meta=S.photos.inspect(bytes);
            const exactContainer=new DataView(bytes.buffer).getUint32(4,true)+8===bytes.length;
            if(meta.type==="image/webp"&&!meta.hasMetadata&&meta.width<=512&&meta.height<=512&&bytes.length<=2097152&&exactContainer) {
                // A normalized backup restores byte-for-byte, avoiding repeated lossy encoding.
                let decoded;
                try {decoded=await createImageBitmap(file);}
                catch {V.fail("Backup photo cannot be decoded.");}
                decoded.close();photo=file;
            } else photo=await S.photos.normalize(file);
        }
        if(photo) photo=await photoData(photo);
        return {account,readings,appointments,photo,highWater:data.highWater,importId:await digest(text)};
    }
    async function preview(text) {
        const started=A.token();
        const prepared=await validateBackup(text);
        const current=await A.current();
        if(A.token()!==started) throw A.unauthorized();
        if(current.email!==prepared.account.email) V.fail("Sign in to the local account with the same email address as this backup.");
        // Keep the validated snapshot private; callers receive a capability with an explicit commit.
        return {email:current.email,readings:prepared.readings.length,appointments:prepared.appointments.length,hasPhoto:!!prepared.photo,commit:()=>commit(prepared,started)};
    }
    async function commit(data,started) {
        const report=await A.scope(["readings","appointments","photos","metadata"],"readwrite",async(stores,get,account)=>{
            if(account.email!==data.account.email) V.fail("Backup account does not match the signed-in account.");
            const importKey=`import:${account.id}:${data.importId}`;
            if(await get(stores.metadata.get(importKey))) return {alreadyImported:true};
            const existing=await get(stores.readings.index("owner").getAll(account.id));
            const appointments=await get(stores.appointments.index("owner").getAll(account.id));
            if(existing.length||appointments.length) V.fail("Import requires an account with no readings or appointment requests. Export current data first; existing records will not be overwritten.");
            for(const row of data.readings) if(await get(stores.readings.get(row.id))) V.fail(`Reading ID ${row.id} belongs to existing browser data. Import into a separate browser profile to preserve both datasets.`);
            await get(stores.accounts.put({...account,...data.account}));
            for(const row of data.readings) await get(stores.readings.add({...row,owner:account.id}));
            for(const {id,...row} of data.appointments) await get(stores.appointments.add({...row,owner:account.id}));
            if(data.photo) await get(stores.photos.put({owner:account.id,base64:data.photo,version:crypto.randomUUID()}));
            else await get(stores.photos.delete(account.id));
            const highWater=Math.max(data.highWater,(await get(stores.metadata.get("reading-high-water")))?.value||0);
            // Preserve the saved counter even when the source's largest ID was deleted.
            if(highWater && !await get(stores.readings.get(highWater))) {
                await get(stores.readings.add({id:highWater,owner:account.id}));
                await get(stores.readings.delete(highWater));
            }
            await get(stores.metadata.put({id:"reading-high-water",value:highWater}));
            await get(stores.metadata.put({id:importKey}));
            return {alreadyImported:false};
        },started);
        for(const type of ["profile","readings","appointments"]) A.publish(type);
        return report;
    }
    async function legacyPreview(source) {
        const raw=source??localStorage.getItem("smarthealth_demo_appointments");
        if(raw===null) return [];
        if(typeof raw!=="string"||new Blob([raw]).size>MAX_BYTES) V.fail("Legacy appointment file must be smaller than 16 MB.");
        let rows;try {rows=JSON.parse(raw);} catch {V.fail("Legacy appointment JSON is invalid. The source is untouched; export it for recovery.");}
        if(!Array.isArray(rows)||rows.length>20000) V.fail("Legacy appointment source must contain an array of requests.");
        const prepared=[];
        for(let index=0;index<rows.length;index++) {
            const row=rows[index];
            try {
                if(!V.plain(row)||typeof row.createdAt!=="string"||!Number.isFinite(Date.parse(row.createdAt))) throw new Error("Invalid creation date.");
                const {createdAt,...values}=row;
                const clean=V.appointment(values,true);
                prepared.push({key:await digest(JSON.stringify(row)+":"+index),index,values:{...clean,createdAt}});
            } catch(error) {prepared.push({index,error:error.message});}
        }
        return A.scope(["metadata"],"readonly",async(stores,get)=> {
            for(const row of prepared) if(row.key) row.imported=!!await get(stores.metadata.get(`legacy:${row.key}`));
            return prepared;
        });
    }
    async function importLegacy(selection,source) {
        const started=A.token();
        const rows=await legacyPreview(source);
        if(!Array.isArray(selection)||!selection.length||new Set(selection).size!==selection.length) V.fail("Select the requests that belong to this account.");
        const selected=selection.map(key=>rows.find(row=>row.key===key && !row.error));
        if(selected.some(row=>!row)) V.fail("The legacy source changed. Preview it again.");
        await A.scope(["appointments","metadata"],"readwrite",async(stores,get,account)=>{
            for(const row of selected) {
                const id=`legacy:${row.key}`;
                if(await get(stores.metadata.get(id))) continue;
                await get(stores.appointments.add({...row.values,owner:account.id}));
                await get(stores.metadata.put({id}));
            }
        },started);
        A.publish("appointments");
    }
    function mountBackup() {
        if(!document.querySelector(".profile-page")) return;
        const section=document.createElement("section");section.className="reading-form-card";
        section.innerHTML='<h2>Local data backup and transfer</h2><p>Export this account before clearing browser data. Backups contain personal records; keep them private. Import restores into an empty account with the same email and keeps its local password.</p><button type="button" class="logout-button" data-export-account>Export account data</button><p><label for="accountBackup">Choose account backup (JSON, maximum 16 MB)</label><input id="accountBackup" type="file" accept=".json,application/json"></p><p data-import-preview role="status"></p><button type="button" class="logout-button" data-import-account hidden>Confirm import</button><button type="button" class="photo-text-button" data-cancel-import hidden>Cancel import</button>';
        document.querySelector(".dashboard-footer").before(section);
        const status=section.querySelector("[data-import-preview]"),file=section.querySelector("input"),confirm=section.querySelector("[data-import-account]"),cancel=section.querySelector("[data-cancel-import]");
        let pending,selection=0,busy=false;
        const feedback=error=>{status.textContent=error.message;S.notify(error.message,"error");};
        cancel.onclick=()=>{selection++;pending=null;file.value="";confirm.hidden=cancel.hidden=true;status.textContent="Import cancelled. Saved data is unchanged.";};
        file.onchange=async()=>{const version=++selection;pending=null;confirm.hidden=cancel.hidden=true;try {const chosen=file.files[0];if(!chosen) return;if(chosen.size>MAX_BYTES) V.fail("Choose a backup smaller than 16 MB.");const preview=await S.transfer.preview(await chosen.text());if(version!==selection)return;pending=preview;status.textContent=`${preview.email}: ${preview.readings} readings, ${preview.appointments} requests, ${preview.hasPhoto?"with":"without"} a photo. Confirm to restore profile details into this empty account.`;confirm.hidden=cancel.hidden=false;}catch(error){if(version===selection)feedback(error);}};
        confirm.onclick=async()=>{if(!pending||busy)return;busy=true;confirm.disabled=cancel.disabled=file.disabled=true;try {const report=await pending.commit();status.textContent=report.alreadyImported?"This backup has already been imported.":"Account data imported successfully. Reloading your profile...";S.notify(status.textContent,"success");confirm.hidden=cancel.hidden=true;pending=null;window.dispatchEvent(new Event("smarthealth:backup-imported"));}catch(error){feedback(error);}finally{busy=false;confirm.disabled=cancel.disabled=file.disabled=false;}};
        section.querySelector("[data-export-account]").onclick=async event=>{event.currentTarget.disabled=true;try{download(await exportAccount(),"smarthealth-account-backup.json");S.notify("Account backup downloaded. Keep it private.","success");}catch(error){feedback(error);}finally{section.querySelector("[data-export-account]").disabled=false;}};
    }
    S.transfer={exportAccount,preview,legacyPreview,importLegacy,download,mountBackup};
})();
