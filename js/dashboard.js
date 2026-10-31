
// Shared view controller for Dashboard, Health Records, Health Trends and Alerts.
// Each page renders only the components it contains from one current-account storage snapshot.

const metricSettings = {
    heart_rate: {
        label: "Heart Rate",
        unit: "BPM"
    },
    spo2: {
        label: "Blood Oxygen",
        unit: "%"
    },
    systolic: {
        label: "Systolic Blood Pressure",
        unit: "mmHg"
    },
    diastolic: {
        label: "Diastolic Blood Pressure",
        unit: "mmHg"
    },
    temperature: {
        label: "Body Temperature",
        unit: "°C"
    }
};

// Update the four health overview cards.

function updateHealthCards(readings) {
    if (!document.getElementById("latestHeartRate")) return;
    if (readings.length === 0) {
        for (const id of ["latestHeartRate", "latestSpo2", "latestBloodPressure", "latestTemperature"]) {
            document.getElementById(id).textContent = "--";
        }
        return;
    }

    const latest = readings[0];

    document.getElementById("latestHeartRate").textContent =
        latest.heart_rate ?? "--";

    document.getElementById("latestSpo2").textContent =
        latest.spo2 ?? "--";

    document.getElementById("latestBloodPressure").textContent =
        `${latest.systolic ?? "--"}/${latest.diastolic ?? "--"}`;

    document.getElementById("latestTemperature").textContent =
        latest.temperature ?? "--";
}

// Create safe table cells.

function addTableCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = String(value);
    row.appendChild(cell);
}

// Display recent health records.

function renderHealthHistory(readings) {
    const tableBody = document.getElementById("readingsTableBody");
    const emptyMessage = document.getElementById("dashboardEmptyMessage");

    if (!tableBody) return;
    tableBody.replaceChildren();

    if (emptyMessage) {
        emptyMessage.hidden = readings.length > 0;
        emptyMessage.textContent = "No health readings saved yet.";
    }

    const limit = tableBody.dataset.limit === "all" ? readings.length : Number(tableBody.dataset.limit || 10);
    const recentReadings = readings.slice(0, limit);

    recentReadings.forEach(reading => {
        const row = document.createElement("tr");

        addTableCell(row, reading.measured_at?.replace("T", " ") || "--");
        addTableCell(row, `${reading.heart_rate ?? "--"} BPM`);
        addTableCell(row, `${reading.spo2 ?? "--"}%`);
        addTableCell(
            row,
            `${reading.systolic ?? "--"}/${reading.diastolic ?? "--"} mmHg`
        );
        addTableCell(row, `${reading.temperature ?? "--"} °C`);

        const actions = document.createElement("td");
        actions.className = "reading-actions";
        actions.appendChild(window.SmartHealth.readings.createEditButton(reading));
        actions.appendChild(window.SmartHealth.readings.createDeleteButton(reading));
        row.appendChild(actions);

        tableBody.appendChild(row);
    });
}

// Display health trend graph.

function renderHealthChart(metric, readings) {
    const container = document.getElementById("healthTrendChart");
    const note = document.getElementById("chartNote");
    if (!container) return;
    container.replaceChildren();
    if (!readings.length) {
        container.textContent = "No health readings available. Add a reading to view trends.";
        if (note) note.textContent = "No health records saved yet.";
        return;
    }
    const settings = metricSettings[metric];
    if (!settings) return;
    const dated = readings.filter(row => Number.isFinite(new Date(row.measured_at).getTime()));
    const latest = dated.length ? new Date(dated[0].measured_at) : new Date();
    const start = new Date(latest); start.setDate(start.getDate() - 6); start.setHours(0,0,0,0);
    const all = document.getElementById("healthRange")?.value === "all";
    const points = dated.slice().reverse().filter(row => all || (new Date(row.measured_at) >= start && new Date(row.measured_at) <= latest))
        .map(row => ({time: new Date(row.measured_at).getTime(), value: row[metric] === null || row[metric] === "" ? null : Number(row[metric]), label: row.measured_at}));
    if (!points.some(point => Number.isFinite(point.value))) {
        container.textContent = "No measurements are available for this metric.";
        if (note) note.textContent = "Choose another measurement or add a complete reading.";
        return;
    }
    if (note) note.textContent = `Showing ${points.length} saved reading(s) ` + (all ? "across your full measurement history." : "from the latest seven-day measurement window.");
    const ns = "http://www.w3.org/2000/svg";
    const node = (name, attributes = {}, content) => {
        const element = document.createElementNS(ns, name);
        for (const [key,value] of Object.entries(attributes)) element.setAttribute(key, value);
        if (content !== undefined) element.textContent = content;
        return element;
    };
    const toolbar = document.createElement("div"); toolbar.className = "chart-toolbar";
    const svg = node("svg", {viewBox: "0 0 900 330", role: "img", tabindex: "0", "aria-label": `${settings.label} trend. Scroll to zoom, drag to pan; plus/minus to zoom and zero to reset.`, preserveAspectRatio: "none"});
    svg.classList.add("local-trend-chart");
    const tooltip = document.createElement("p"); tooltip.className = "chart-tooltip"; tooltip.hidden = true; tooltip.setAttribute("role", "status");
    container.append(toolbar, svg, tooltip);
    const original = [points[0].time, points.at(-1).time];
    if (original[0] === original[1]) { original[0] -= 3600000; original[1] += 3600000; }
    let domain = original.slice(), drag;
    const left = 75, right = 875, top = 20, bottom = 275;
    const bound = values => {
        const span = Math.min(original[1] - original[0], Math.max(60000, values[1] - values[0]));
        const first = Math.max(original[0], Math.min(values[0], original[1] - span));
        return [first, first + span];
    };
    function draw() {
        svg.replaceChildren();
        svg.append(node("title", {}, `${settings.label} (${settings.unit})`));
        const visible = points.filter(point => point.time >= domain[0] && point.time <= domain[1] && Number.isFinite(point.value));
        const values = (visible.length ? visible : points.filter(point => Number.isFinite(point.value))).map(point => point.value);
        let min = Math.min(...values), max = Math.max(...values);
        const pad = (max - min) * .12 || Math.max(1, Math.abs(max) * .03); min -= pad; max += pad;
        const x = time => left + (time - domain[0]) / (domain[1] - domain[0]) * (right-left);
        const y = value => bottom - (value-min)/(max-min)*(bottom-top);
        for (let i=0;i<=4;i++) {
            const py=top+i*(bottom-top)/4, value=max-i*(max-min)/4;
            svg.append(node("line", {x1:left,y1:py,x2:right,y2:py,stroke:"#e1edf0"}));
            svg.append(node("text", {x:left-10,y:py+4,"text-anchor":"end",class:"chart-axis"}, Number(value.toFixed(2))));
            const time=domain[0]+i*(domain[1]-domain[0])/4;
            svg.append(node("text", {x:x(time),y:bottom+25,"text-anchor":"middle",class:"chart-axis"}, new Date(time).toLocaleDateString(undefined,{day:"2-digit",month:"short"})));
        }
        svg.append(node("text",{x:16,y:16,class:"chart-axis"},settings.unit));
        svg.append(node("text",{x:475,y:325,"text-anchor":"middle",class:"chart-axis"},"Measurement Date"));
        let path="",connected=false;
        for (const point of points) {
            if (point.time<domain[0] || point.time>domain[1] || !Number.isFinite(point.value)) {connected=false;continue;}
            path += `${connected?'L':'M'}${x(point.time)},${y(point.value)} `; connected=true;
        }
        svg.append(node("path",{d:path,fill:"none",stroke:"#087f8c","stroke-width":3}));
        for (const point of visible) {
            const dot=node("circle",{cx:x(point.time),cy:y(point.value),r:5,fill:"#087f8c"});
            dot.append(node("title",{},`${point.label.replace('T',' ')}: ${point.value} ${settings.unit}`)); svg.append(dot);
        }
        svg.dataset.pointCount = String(visible.length);
        svg.dataset.rangeStart = String(domain[0]); svg.dataset.rangeEnd = String(domain[1]);
    }
    function zoom(factor, center=(domain[0]+domain[1])/2) {
        domain=bound([center+(domain[0]-center)*factor,center+(domain[1]-center)*factor]); draw();
    }
    for (const [label, action] of [["Zoom in",()=>zoom(.7)],["Zoom out",()=>zoom(1.4)],["Reset zoom",()=>{domain=original.slice();draw();}],["Save chart",()=>{
        const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:"image/svg+xml"}));
        const link=document.createElement("a");link.href=url;link.download=`${metric}-trend.svg`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }]]) {
        const button=document.createElement("button");button.type="button";button.textContent=label;button.addEventListener("click",action);toolbar.append(button);
    }
    svg.addEventListener("wheel",event=>{
        event.preventDefault();const rect=svg.getBoundingClientRect();const fraction=Math.max(0,Math.min(1,((event.clientX-rect.left)/rect.width*900-left)/(right-left)));
        zoom(event.deltaY<0?.8:1.25,domain[0]+fraction*(domain[1]-domain[0]));
    },{passive:false});
    svg.addEventListener("pointerdown",event=>{drag={x:event.clientX,domain:domain.slice()};svg.setPointerCapture(event.pointerId);});
    svg.addEventListener("pointerup",()=>{drag=null;});svg.addEventListener("pointercancel",()=>{drag=null;});
    svg.addEventListener("pointermove",event=>{
        const rect=svg.getBoundingClientRect();
        if (drag) {
            const delta=(event.clientX-drag.x)/rect.width*900/(right-left)*(drag.domain[1]-drag.domain[0]);
            domain=bound([drag.domain[0]-delta,drag.domain[1]-delta]);draw();return;
        }
        const fraction=Math.max(0,Math.min(1,((event.clientX-rect.left)/rect.width*900-left)/(right-left)));
        const time=domain[0]+fraction*(domain[1]-domain[0]);
        const nearest=points.filter(point=>Number.isFinite(point.value)&&point.time>=domain[0]&&point.time<=domain[1]).reduce((best,point)=>!best||Math.abs(point.time-time)<Math.abs(best.time-time)?point:best,null);
        tooltip.hidden=!nearest;if(nearest)tooltip.textContent=`${nearest.label.replace('T',' ')} ? ${nearest.value} ${settings.unit}`;
    });
    svg.addEventListener("pointerleave",()=>{tooltip.hidden=true;});
    svg.addEventListener("keydown",event=>{
        if (["+","=","-","0","ArrowLeft","ArrowRight"].includes(event.key)) event.preventDefault();
        if (event.key==="+"||event.key==="=") zoom(.7);
        else if(event.key==="-") zoom(1.4);
        else if(event.key==="0"){domain=original.slice();draw();}
        else if(event.key==="ArrowLeft"||event.key==="ArrowRight"){const delta=(domain[1]-domain[0])*.2*(event.key==="ArrowLeft"?-1:1);domain=bound(domain.map(value=>value+delta));draw();}
    });
    draw();
}

// Refresh every dashboard section from the same snapshot of patient records.

function initializeDashboard() {
    const metricSelect = document.getElementById("healthMetric");
    const rangeSelect = document.getElementById("healthRange");
    const status = document.getElementById("dashboardReadingsStatus");
    let readings = [];
    let requestId = 0;

    function render(errorMessage = "") {
        updateHealthCards(readings);
        renderHealthHistory(readings);
        // The persistent increasing ID identifies the latest saved record, even
        // when a patient enters a backdated measurement. Keep history/trends
        // in their existing measurement-date order.
        const latestSaved = readings.reduce((latest, reading) =>
            !latest || Number(reading.id) > Number(latest.id) ? reading : latest,
            null
        );
        if (typeof displayHealthAlerts === "function") displayHealthAlerts(latestSaved, errorMessage);
        if (metricSelect) renderHealthChart(metricSelect.value, readings);
    }

    async function refresh() {
        const currentRequest = ++requestId;
        status.textContent = "Updating health records...";
        try {
            const latest = await window.SmartHealth.readings.list();
            if (currentRequest !== requestId) return;
            readings = latest;
            render();
            status.textContent = "";
        } catch (error) {
            if (currentRequest !== requestId) return;
            readings = [];
            const message = error.message || "Unable to load your health records. Please try again.";
            render(message);
            if (error.status === 401) return;
            status.textContent = message;
            const emptyMessage = document.getElementById("dashboardEmptyMessage");
            const chartNote = document.getElementById("chartNote");
            if (emptyMessage) emptyMessage.textContent = "Health records could not be loaded.";
            if (chartNote) chartNote.textContent = "Health trends could not be loaded.";
            window.SmartHealth.notify(message, "error");
        }
    }

    if (metricSelect) {
        metricSelect.addEventListener("change", () => renderHealthChart(metricSelect.value, readings));
    }
    if (rangeSelect && metricSelect) {
        rangeSelect.addEventListener("change", () => renderHealthChart(metricSelect.value, readings));
    }
    window.SmartHealth.readings.onChange(refresh);
    refresh();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeDashboard, { once: true });
} else {
    initializeDashboard();
}
