"use strict";

// One atomic localStorage snapshot. Web Locks serialize writes across tabs.
(() => {
    const KEY = "smarthealth_data_v1";
    const names = ["accounts", "readings", "photos", "appointments", "sessions", "metadata"];
    const clone = value => value === undefined ? undefined : structuredClone(value);
    function describe(error) {
        if (error?.status || error?.domain) return error;
        const messages = {
            QuotaExceededError: "localStorage is full. Export your data and free browser space before retrying. Your previous save is unchanged.",
            ConstraintError: "This email or record already exists.",
            SecurityError: "localStorage is blocked. Allow site storage for this localhost address.",
            AbortError: "The local save was cancelled. Your previous data is unchanged."
        };
        return Object.assign(new Error(messages[error?.name] || error.message || "Unable to access localStorage."), {cause: error});
    }
    function read() {
        const raw = localStorage.getItem(KEY);
        if (raw === null) return {version: 1, stores: Object.fromEntries(names.map(name => [name, []])), counters: {readings: 0, appointments: 0}};
        let data;
        try { data = JSON.parse(raw); }
        catch { throw new Error("Saved localStorage data is damaged. Keep a copy of smarthealth_data_v1 before restoring a backup; it has not been cleared."); }
        if (data?.version !== 1 || !data.stores || !data.counters || names.some(name => !Array.isArray(data.stores[name]))) {
            throw new Error("This saved localStorage format is unsupported. Do not clear it; use a compatible backup or application version.");
        }
        for (const name of names) {
            const keys = data.stores[name].map(record => record?.[name === "photos" ? "owner" : "id"]);
            if (keys.some(key => key === undefined || key === null) || new Set(keys).size !== keys.length) throw new Error("Saved localStorage records are inconsistent. Restore a verified backup; existing data has not changed.");
        }
        for (const name of ["readings", "appointments"]) {
            if (!Number.isSafeInteger(data.counters[name]) || data.counters[name] < 0 || data.stores[name].some(row => !Number.isSafeInteger(row.id) || row.id < 1 || row.id > data.counters[name])) throw new Error("Saved record counters are invalid. Existing data has not changed.");
        }
        return data;
    }
    async function open() {
        try {
            const probe = `smarthealth_probe_${crypto.randomUUID()}`;
            localStorage.setItem(probe, "1"); localStorage.removeItem(probe);
            read();
        } catch (error) { throw describe(error); }
    }
    async function run(selected, mode, action) {
        const writable = mode === "readwrite";
        const execute = async () => {
            const snapshot = read();
            let aborted = false;
            const stores = {};
            for (const name of [...new Set(selected)]) {
                if (!names.includes(name)) throw new Error(`Unknown local collection: ${name}`);
                const rows = snapshot.stores[name];
                const keyField = name === "photos" ? "owner" : "id";
                const write = (value, addOnly) => {
                    if (!writable || aborted) throw new Error("This local operation cannot write records.");
                    const record = clone(value);
                    if (record[keyField] === undefined && ["readings", "appointments"].includes(name)) record[keyField] = snapshot.counters[name] + 1;
                    const key = record[keyField];
                    if (key === undefined || key === null) throw new Error("Record identifier is required.");
                    if (["readings", "appointments"].includes(name) && (!Number.isSafeInteger(key) || key < 1 || key >= Number.MAX_SAFE_INTEGER)) throw new Error("Record identifier is outside the supported range.");
                    const index = rows.findIndex(row => row[keyField] === key);
                    if ((addOnly && index !== -1) || (name === "accounts" && rows.some(row => row.email === record.email && row.id !== key))) throw new DOMException("Duplicate key", "ConstraintError");
                    if (index === -1) rows.push(record); else rows[index] = record;
                    if (["readings", "appointments"].includes(name)) snapshot.counters[name] = Math.max(snapshot.counters[name], key);
                    return key;
                };
                stores[name] = {
                    get: key => clone(rows.find(row => row[keyField] === key)),
                    getAll: () => clone(rows),
                    add: value => write(value, true),
                    put: value => write(value, false),
                    delete: key => {
                        if (!writable || aborted) throw new Error("This local operation cannot delete records.");
                        const index = rows.findIndex(row => row[keyField] === key);
                        if (index !== -1) rows.splice(index, 1);
                    },
                    index: field => ({get: value => clone(rows.find(row => row[field] === value)), getAll: value => clone(rows.filter(row => row[field] === value))})
                };
            }
            const result = await action(stores, value => Promise.resolve(value), {abort: () => {aborted = true;}});
            if (aborted) throw new DOMException("Cancelled", "AbortError");
            // setItem is the only commit. A failure never writes a partial snapshot.
            if (writable) localStorage.setItem(KEY, JSON.stringify(snapshot));
            return result;
        };
        try {
            if (writable) {
                if (!navigator.locks) throw new Error("Use a current browser on localhost. Web Locks are needed to safely save localStorage data across tabs.");
                return await navigator.locks.request("smarthealth-localstorage-write", execute);
            }
            return await execute();
        } catch (error) { throw describe(error); }
    }
    window.SmartHealth = {...window.SmartHealth, store: {open, run, key: KEY}};
})();


"use strict";

(() => {
    const S = window.SmartHealth;
    const KEY = "smarthealth_local_session";
    const LIFETIME = 8 * 60 * 60 * 1000;
    const token = () => localStorage.getItem(KEY);
    const unauthorized = () => Object.assign(new Error("Your local session has ended. Please sign in again."), { status: 401 });
    let channel;
    try { channel = new BroadcastChannel("smarthealth-local-changes"); } catch {}
    function receive(type) {
        if (!["session","profile","readings","appointments"].includes(type)) return;
        window.dispatchEvent(new Event(`smarthealth:${type}-changed`));
    }
    function publish(type) {
        receive(type);
        try { channel?.postMessage(type); } catch {}
        try { localStorage.setItem("smarthealth_refresh", JSON.stringify({ type, nonce: crypto.randomUUID() })); } catch {}
    }
    channel?.addEventListener("message", event => receive(event.data));
    window.addEventListener("storage", event => {
        if (event.key === KEY) receive("session");
        if (event.key === "smarthealth_refresh") { try { receive(JSON.parse(event.newValue).type); } catch {} }
    });
    async function scope(names, mode, action, expected = token()) {
        if (!expected) throw unauthorized();
        const result = await S.store.run(["sessions","accounts",...names], mode, async (stores, get) => {
            const session = await get(stores.sessions.get(expected));
            if (!session || session.expires <= Date.now() || token() !== expected) throw unauthorized();
            const account = await get(stores.accounts.get(session.accountId));
            if (!account) throw unauthorized();
            const result = await action(stores, get, account, session);
            if (token() !== expected || session.expires <= Date.now()) throw unauthorized();
            return result;
        });
        if (token() !== expected) throw unauthorized();
        return result;
    }
    const bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
    const base64 = value => btoa(String.fromCharCode(...new Uint8Array(value)));
    async function derive(password, record) {
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
        return new Uint8Array(await crypto.subtle.deriveBits({ name:"PBKDF2", hash:"SHA-256", salt:bytes(record.salt), iterations:record.iterations }, key, 256));
    }
    async function credential(password) {
        S.validate.password(password);
        const record = { algorithm:"PBKDF2-SHA256", version:1, iterations:600000, salt:base64(crypto.getRandomValues(new Uint8Array(16))) };
        return { ...record, hash:base64(await derive(password, record)) };
    }
    async function verify(password, record) {
        if (typeof password !== "string" || !password.isWellFormed() || Array.from(password).length > 1024) return false;
        if (record?.algorithm !== "PBKDF2-SHA256" || record.version !== 1) throw new Error("This account uses an unsupported credential version. Restore the correct application version.");
        const actual = await derive(password, record), expected = bytes(record.hash);
        let mismatch = actual.length ^ expected.length;
        for (let i = 0; i < actual.length; i++) mismatch |= actual[i] ^ expected[i];
        return mismatch === 0;
    }
    const safe = account => Object.fromEntries(["id","email",...S.validate.profileFields].map(field => [field, account[field] ?? null]));
    async function register(data) {
        S.validate.fields(data, ["full_name","email","password"]);
        const full_name = S.validate.text(data.full_name,"Name",100,2), email = S.validate.email(data.email);
        const password = await credential(data.password);
        const account = { id:crypto.randomUUID(), full_name, email, phone:null, date_of_birth:null, gender:null, blood_group:null, credential:password, revision:1 };
        try { await S.store.run(["accounts"],"readwrite", (stores,get) => get(stores.accounts.add(account))); }
        catch(error) { if (error.cause?.name === "ConstraintError") throw new Error("Email already registered."); throw error; }
        return { status:"success", message:"Your local account is ready. Please sign in." };
    }
    async function login(data) {
        S.validate.fields(data, ["email","password"]);
        const email = S.validate.email(data.email);
        const account = await S.store.run(["accounts"],"readonly", (stores,get) => get(stores.accounts.index("email").get(email)));
        // A dummy derivation makes the unknown-email path follow the same expensive step.
        const dummy = { algorithm:"PBKDF2-SHA256", version:1, iterations:600000, salt:"AAAAAAAAAAAAAAAAAAAAAA==", hash:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
        const valid = await verify(data.password, account?.credential || dummy);
        if (!account || !valid) throw new Error("Invalid email or password.");
        const id = crypto.randomUUID();
        const previous = token();
        await S.store.run(["accounts","sessions"],"readwrite", async(stores,get) => {
            const latest = await get(stores.accounts.get(account.id));
            if (latest?.revision !== account.revision) throw new Error("Credentials changed while signing in. Please retry.");
            if (previous) await get(stores.sessions.delete(previous));
            await get(stores.sessions.add({ id, accountId:account.id, created:Date.now(), expires:Date.now()+LIFETIME }));
        });
        try { localStorage.setItem(KEY,id); }
        catch(error) { await S.store.run(["sessions"],"readwrite",(stores,get)=>get(stores.sessions.delete(id))); throw error; }
        publish("session");
        return { status:"success", message:"Login successful!", patient:safe(account) };
    }
    async function logout() {
        const id = token();
        if (id) await S.store.run(["sessions"],"readwrite",(stores,get)=>get(stores.sessions.delete(id)));
        if (token() === id) localStorage.removeItem(KEY);
        publish("session");
    }
    async function changePassword(data) {
        S.validate.fields(data,["current_password","new_password","confirm_password"]);
        S.validate.password(data.new_password);
        if (data.new_password !== data.confirm_password) S.validate.fail("New passwords do not match.");
        const started = token();
        const original = await scope([],"readonly",(stores,get,account)=>account, started);
        if (!await verify(data.current_password,original.credential)) S.validate.fail("Current password is incorrect.");
        if (data.new_password === data.current_password) S.validate.fail("New password must differ from your current password.");
        const replacement = await credential(data.new_password);
        await scope([],"readwrite",(stores,get,account)=> {
            if (account.revision !== original.revision) S.validate.fail("Your password changed in another tab. Please retry with the current password.");
            return get(stores.accounts.put({ ...account, credential:replacement, revision:account.revision+1 }));
        }, started);
        return { status:"success", message:"Password updated successfully. Use your new password the next time you sign in." };
    }
    S.auth = { register,login,logout,changePassword,token,scope,safe,unauthorized,publish,current:()=>scope([],"readonly",(stores,get,account)=>safe(account)) };
})();


"use strict";

(() => {
    const S=window.SmartHealth, A=S.auth, V=S.validate;
    const urls=new Map();
    function revokePhotos() { for(const value of urls.values()) URL.revokeObjectURL(value.url); urls.clear(); }
    window.addEventListener("smarthealth:session-changed",revokePhotos);
    function photoURL(photo,owner=photo?.owner) {
        if(!photo) {
            const cached=urls.get(owner);
            if(cached) { URL.revokeObjectURL(cached.url); urls.delete(owner); }
            return null;
        }
        const cached=urls.get(photo.owner);
        if(cached?.version===photo.version) return cached.url;
        if(cached) URL.revokeObjectURL(cached.url);
        const bytes=Uint8Array.from(atob(photo.base64),char=>char.charCodeAt(0));
        const url=URL.createObjectURL(new Blob([bytes],{type:"image/webp"}));
        urls.set(photo.owner,{version:photo.version,url});
        return url;
    }
    async function profile(expected=A.token()) {
        return A.scope(["photos"],"readonly",async(stores,get,account)=>({status:"success",patient:{...A.safe(account),photo_url:photoURL(await get(stores.photos.get(account.id)),account.id)} }),expected);
    }
    async function updateProfile(data) {
        const values=V.profile(data);
        const started=A.token();
        await A.scope([],"readwrite",(stores,get,account)=>get(stores.accounts.put({...account,...values})),started);
        A.publish("profile");
        return {...await profile(started),message:"Profile updated successfully."};
    }
    async function savePhoto(file) {
        const started=A.token();
        await A.current();
        const blob=await S.photos.normalize(file);
        const base64=await S.photos.toBase64(blob);
        await A.scope(["photos"],"readwrite",(stores,get,account)=>get(stores.photos.put({owner:account.id,base64,version:crypto.randomUUID()})),started);
        A.publish("profile");
        return {status:"success",photo_url:(await profile(started)).patient.photo_url,message:"Profile photo updated successfully."};
    }
    async function removePhoto() {
        await A.scope(["photos"],"readwrite",(stores,get,account)=>get(stores.photos.delete(account.id)));
        revokePhotos(); A.publish("profile");
        return {status:"success",photo_url:null,message:"Profile photo removed successfully."};
    }
    const owned=(record,account)=> {if(!record || record.owner!==account.id) V.fail("Health reading not found."); return record;};
    const safeReading=record=>Object.fromEntries(["id",...V.readingFields].map(field=>[field,record[field]??(field==="measured_at"?"":null)]));
    const validID=id=>{if(!Number.isSafeInteger(id)||id<1) V.fail("This record has an invalid ID. Refresh and try again.");};
    const readings={
        list:()=>A.scope(["readings"],"readonly",async(stores,get,account)=>(await get(stores.readings.index("owner").getAll(account.id))).map(safeReading).sort((a,b)=>b.measured_at.localeCompare(a.measured_at)||b.id-a.id)),
        async save(data) {
            const reading=V.reading(data);
            const id=await A.scope(["readings","metadata"],"readwrite",async(stores,get,account)=> {
                const id=await get(stores.readings.add({...reading,owner:account.id}));
                await get(stores.metadata.put({id:"reading-high-water",value:id})); return id;
            });
            A.publish("readings"); return {status:"success",reading_id:id};
        },
        async update(id,data) {
            validID(id); const reading=V.reading(data);
            await A.scope(["readings"],"readwrite",async(stores,get,account)=> { const existing=owned(await get(stores.readings.get(id)),account); return get(stores.readings.put({...existing,...reading})); });
            A.publish("readings"); return {status:"success",reading_id:id};
        },
        async remove(id) {
            validID(id);
            await A.scope(["readings"],"readwrite",async(stores,get,account)=> {owned(await get(stores.readings.get(id)),account); return get(stores.readings.delete(id));});
            A.publish("readings"); return {status:"success",reading_id:id};
        }
    };
    const appointments={
        list:()=>A.scope(["appointments"],"readonly",async(stores,get,account)=>(await get(stores.appointments.index("owner").getAll(account.id))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id-a.id).map(({owner,...item})=>item)),
        async save(data) {
            const values=V.appointment(data);
            await A.scope(["appointments"],"readwrite",(stores,get,account)=>get(stores.appointments.add({...values,createdAt:new Date().toISOString(),owner:account.id})));
            A.publish("appointments");
        }
    };
    S.patient={profile,updateProfile,savePhoto,removePhoto,readings,appointments,photoURL,revokePhotos};
})();


"use strict";

// Controllers are loaded only after the real database and session are ready.
(() => {
    const scriptBase = new URL(".", document.currentScript.src);
    const scripts=document.currentScript.dataset.scripts.split(",").filter(Boolean);
    const protectedPage=document.documentElement.hasAttribute("data-local-patient");
    let initialToken, checking=false;
    function failure(error) {
        if(error.status===401) {
            const layout=document.querySelector(".dashboard-layout");
            if(layout) { layout.hidden=true; layout.inert=true; }
            window.SmartHealth.flash(error.message,"info");
            location.replace("login.html");
            return;
        }
        document.documentElement.removeAttribute("data-local-patient");
        const panel=document.createElement("main"); panel.className="auth-card"; panel.style.margin="10vh auto";
        const title=document.createElement("h1"); title.textContent="Local storage needs attention";
        const text=document.createElement("p"); text.textContent=error.message;
        const button=document.createElement("button"); button.className="auth-submit"; button.textContent="Try again"; button.onclick=()=>location.reload();
        panel.append(title,text,button); document.body.replaceChildren(panel);
    }
    async function guard() {
        if(!protectedPage || checking) return;
        checking=true;
        try {
            await SmartHealth.auth.current();
            if(SmartHealth.auth.token()!==initialToken) {
                const layout=document.querySelector(".dashboard-layout");
                if(layout) { layout.hidden=true; layout.inert=true; }
                location.reload();
            }
        } catch(error) {failure(error);} finally {checking=false;}
    }
    window.SmartHealth.ready=(async()=> {
        if(!window.isSecureContext || !crypto.subtle || !String.prototype.isWellFormed || !window.createImageBitmap || !HTMLCanvasElement.prototype.toBlob) throw new Error("Use a current browser at http://localhost:5500. This app needs Web Crypto, image decoding, and localStorage support.");
        // Probe the small session-reference store too, before accepting any new account writes.
        localStorage.setItem("smarthealth_probe","1"); localStorage.removeItem("smarthealth_probe");
        await SmartHealth.store.open();
        initialToken=SmartHealth.auth.token();
        if(protectedPage) await SmartHealth.auth.current();
        for(const filename of scripts) await new Promise((resolve,reject)=> {
            const script=document.createElement("script"); script.src=new URL(filename,scriptBase).href; script.onload=resolve; script.onerror=()=>reject(new Error(`Unable to load ${filename}. Refresh the page.`)); document.body.appendChild(script);
        });
        document.documentElement.removeAttribute("data-local-patient");
        if(protectedPage) {
            window.addEventListener("smarthealth:session-changed",()=> {
                // Hide immediately while checking an account switch in another tab.
                if(SmartHealth.auth.token()!==initialToken) document.documentElement.setAttribute("data-local-patient","");
                guard();
            });
            window.addEventListener("focus",guard);
            window.addEventListener("pageshow",guard);
            document.addEventListener("visibilitychange",()=>{if(!document.hidden) guard();});
            setInterval(guard,30000);
        }
        return true;
    })();
    SmartHealth.ready.catch(failure);
})();
