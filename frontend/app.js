"use strict";

const API = "http://127.0.0.1:8000";
const $   = id => document.getElementById(id);

// ── State
let intrusionShown = false;
let alertCount     = 0;
let alarmPlaying   = false;

// ── Real alarm audio (put alarm.mp3 in frontend folder)
const alarmAudio = new Audio("alarm.mp3");
alarmAudio.loop   = true;
alarmAudio.volume = 1.0;

function playAlertPing() {
  if (alarmPlaying) return;
  try {
    alarmAudio.currentTime = 0;
    alarmAudio.play().catch(e => console.warn("Audio blocked:", e));
    alarmPlaying = true;
  } catch(e) {
    console.warn("Audio error:", e);
  }
}

function stopAlertPing() {
  try {
    alarmAudio.pause();
    alarmAudio.currentTime = 0;
    alarmPlaying = false;
  } catch(e) {}
}

// ── Chart history
const HISTORY   = 30;
const rpmHist   = new Array(HISTORY).fill(0);
const coolHist  = new Array(HISTORY).fill(0);
const anomHist  = new Array(HISTORY).fill(0);
const frameHist = new Array(HISTORY).fill(0);
const labels    = Array.from({length: HISTORY}, (_, i) => i);

// ── Helpers
const fmt2   = n => String(Math.floor(n)).padStart(2, "0");
const nowStr = () => { const d = new Date(); return `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}:${fmt2(d.getSeconds())}`; };
const nowMs  = () => nowStr() + "." + String(Math.floor(Math.random()*999)).padStart(3,"0");
const clamp  = (v,lo,hi) => Math.min(hi, Math.max(lo, v));

// ── Unlock audio on first click (browser requirement)
document.addEventListener("click", () => {
  alarmAudio.load();
}, { once: true });

// ── Arc gauge
function updateArc(pct) {
  pct = clamp(Math.round(pct), 0, 100);
  const arc = $("arc-fill"), num = $("arc-num");
  arc.style.strokeDashoffset = 219.9 - (219.9 * pct / 100);
  arc.style.transition = "stroke-dashoffset 0.8s ease, stroke 0.5s ease";
  const color = pct < 30 ? "#00e87a" : pct < 65 ? "#f0a500" : "#ff3b3b";
  arc.style.stroke = color;
  num.style.fill   = color;
  num.textContent  = pct;
}

// ── Sensor card
function setSensor(id, value, unit, warnT, critT) {
  const el = $(id);
  el.innerHTML = `${value} <span class="sensor-unit">${unit}</span>`;
  el.className = "sensor-val";
  if (value >= critT)      el.classList.add("crit");
  else if (value >= warnT) el.classList.add("warn");
}

// ── Gauge bar
function setGauge(fillId, spanId, pct) {
  pct = clamp(Math.round(pct), 0, 100);
  const fill = $(fillId);
  fill.style.width      = pct + "%";
  fill.style.background = pct > 65 ? "#ff3b3b" : pct > 35 ? "#f0a500" : "#00e87a";
  $(spanId).textContent = pct;
}

// ── Threat level
function setThreatLevel(level) {
  const badge = $("risk-level"), dot = $("risk-dot"), desc = $("risk-desc");
  badge.className = "risk-level-badge" + (level === "warn" ? " warn" : level === "crit" ? " crit" : "");
  dot.className   = "status-dot"       + (level === "warn" ? " warn" : level === "crit" ? " crit" : "");
  if      (level === "safe") { badge.textContent = "SAFE";     desc.textContent = "All systems nominal. ML models report no anomalies."; }
  else if (level === "warn") { badge.textContent = "WARNING";  desc.textContent = "Elevated fault probability. Random Forest detecting engine stress. Monitoring."; }
  else                       { badge.textContent = "CRITICAL"; desc.textContent = "Isolation Forest confirmed CAN fuzzing. Random Forest: engine fault imminent. ECU isolation triggered."; }
}

// ── Event log
function addLog(type, msg) {
  const el  = $("event-log");
  const row = document.createElement("div");
  row.className = "log-row " + type;
  row.innerHTML = `<span class="log-ts">${nowStr()}</span><span class="log-msg">${msg}</span>`;
  el.appendChild(row);
  while (el.children.length > 25) el.removeChild(el.children[0]);
  el.scrollTop = el.scrollHeight;
  if (type !== "info") { alertCount++; $("ss-alerts").textContent = alertCount; }
}

// ── CAN rows
function addCanRows(frames) {
  const list = $("can-list");
  [...frames].reverse().forEach(frame => {
    const row = document.createElement("div");
    row.className = "can-row" + (frame.anom ? " anom" : "");
    const tag = frame.anom
      ? `<span class="can-tag">ANOMALY</span>`
      : `<span class="can-ok-tag">OK</span>`;
    row.innerHTML = `
      <span class="can-ts">${nowMs()}</span>
      <span class="can-id${frame.anom ? " anom" : ""}">${frame.id}</span>
      <span class="can-dlc">${frame.dlc}</span>
      <span class="can-data">${frame.data}</span>
      ${tag}
    `;
    list.insertBefore(row, list.firstChild);
  });
  while (list.children.length > 14) list.removeChild(list.lastChild);
}

// ── Scenario switch
window.setScenario = async (s) => {
  intrusionShown = false;
  $("btn-normal").classList.toggle("active", s === "normal");
  $("btn-attack").classList.toggle("active", s === "attack");
  if (s === "normal") {
    $("intrusion-banner").classList.remove("show");
    stopAlertPing();
    addLog("ok", "Scenario: Normal drive mode");
  } else {
    addLog("warn", "Scenario: Attack + Fault simulation started");
  }
  await fetch(`${API}/api/scenario/${s}`, { method: "POST" });
};

window.dismissBanner = () => {
  $("intrusion-banner").classList.remove("show");
  stopAlertPing();
};

// ════════════════════════════════════════
// CHARTS
// ════════════════════════════════════════
const SHARED = {
  responsive: true, maintainAspectRatio: false,
  animation: { duration: 200 },
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  elements: { point: { radius: 0 } },
};

const obdChart = new Chart($("obd-chart").getContext("2d"), {
  type: "line",
  data: { labels, datasets: [
    { data: [...rpmHist],  borderColor: "#00b4ff", borderWidth: 1.5, fill: true, backgroundColor: "rgba(0,180,255,0.05)", yAxisID: "yRPM",  tension: 0.3 },
    { data: [...coolHist], borderColor: "#f0a500", borderWidth: 1.5, fill: true, backgroundColor: "rgba(240,165,0,0.05)",  yAxisID: "yCool", tension: 0.3 },
  ]},
  options: { ...SHARED, scales: {
    x: { display: false },
    yRPM:  { display: true, position: "left",  grid: { color: "rgba(30,45,61,0.7)" }, ticks: { color: "#3a5060", font: { size: 9, family: "Share Tech Mono" }, maxTicksLimit: 4 }, border: { display: false } },
    yCool: { display: true, position: "right", min: 70, max: 130, grid: { drawOnChartArea: false }, ticks: { color: "#3a5060", font: { size: 9, family: "Share Tech Mono" }, maxTicksLimit: 4 }, border: { display: false } },
  }},
});

const canChart = new Chart($("can-chart").getContext("2d"), {
  type: "line",
  data: { labels, datasets: [
    { data: [...anomHist],  borderColor: "#ff3b3b", borderWidth: 1.5, fill: true,  backgroundColor: "rgba(255,59,59,0.08)", yAxisID: "yAnom",   tension: 0.3, borderDash: [4,2] },
    { data: [...frameHist], borderColor: "#00b4ff", borderWidth: 1,   fill: false,                                           yAxisID: "yFrames", tension: 0.3 },
  ]},
  options: { ...SHARED, scales: {
    x: { display: false },
    yAnom:   { display: true, position: "left",  min: 0, max: 100, grid: { color: "rgba(30,45,61,0.7)" }, ticks: { color: "#3a5060", font: { size: 9, family: "Share Tech Mono" }, maxTicksLimit: 4 }, border: { display: false } },
    yFrames: { display: true, position: "right", grid: { drawOnChartArea: false }, ticks: { color: "#3a5060", font: { size: 9, family: "Share Tech Mono" }, maxTicksLimit: 4 }, border: { display: false } },
  }},
});

// ── Pie chart for explainability
const PIE_COLORS = ["#00e87a","#00b4ff","#f0a500","#ff3b3b","#a855f7","#ec4899"];

const pieChart = new Chart($("pie-chart").getContext("2d"), {
  type: "doughnut",
  data: {
    labels: [],
    datasets: [{
      data: [],
      backgroundColor: PIE_COLORS,
      borderColor: "#0d1218",
      borderWidth: 2,
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: true,
    animation: { duration: 600 },
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed.toFixed(1)}%` }
      }
    },
    cutout: "65%",
  }
});

// ── Feature bar renderer
function renderFeatureBars(features) {
  const container = $("feature-bars");
  container.innerHTML = "";
  const max = features[0].importance;
  features.forEach(f => {
    const color = f.importance === max ? "#ff3b3b" : f.importance > 20 ? "#f0a500" : "#00b4ff";
    const row = document.createElement("div");
    row.className = "feat-row";
    row.innerHTML = `
      <span class="feat-name">${f.name.toUpperCase()}</span>
      <div class="feat-bar-wrap">
        <div class="feat-bar-fill" style="width:${f.importance}%;background:${color}"></div>
      </div>
      <span class="feat-pct">${f.importance}%</span>
    `;
    container.appendChild(row);
  });
}

// ── Callout updater
function updateCallout(topSensor, faultPct) {
  const card  = $("callout-card");
  const level = faultPct > 65 ? "crit" : faultPct > 35 ? "warn" : "";
  card.className = "callout-card " + level;
  $("callout-sensor").textContent = topSensor.toUpperCase();
  const descriptions = {
    "RPM":      "Engine speed anomaly detected.\nRapid RPM fluctuation suggests\nmechanical stress or load spike.",
    "Coolant":  "Thermal system under stress.\nCoolant temperature rising beyond\nnormal operating threshold.",
    "O2 Volt":  "Oxygen sensor voltage unstable.\nFuel mixture irregularity detected\nin combustion cycle.",
    "Throttle": "Throttle position irregular.\nUnexpected input pattern suggests\ncontrol system interference.",
    "Battery":  "Battery voltage dropping.\nPower supply instability detected\nin critical vehicle systems.",
    "Load":     "Engine load critically high.\nSustained overload detected across\nmultiple decision trees.",
  };
  $("callout-desc").textContent = descriptions[topSensor] || "Sensor anomaly detected.";
}

// ── Pie updater
function updatePie(features) {
  pieChart.data.labels                      = features.map(f => f.name);
  pieChart.data.datasets[0].data            = features.map(f => f.importance);
  pieChart.data.datasets[0].backgroundColor = PIE_COLORS.slice(0, features.length);
  pieChart.update();
  const legend = $("pie-legend");
  legend.innerHTML = "";
  features.forEach((f, i) => {
    const row = document.createElement("div");
    row.className = "pie-leg-row";
    row.innerHTML = `<span class="pie-leg-dot" style="background:${PIE_COLORS[i]}"></span><span>${f.name}: ${f.importance}%</span>`;
    legend.appendChild(row);
  });
}

// ── ETA chart history
const etaCoolHist = new Array(HISTORY).fill(0);
const etaLoadHist = new Array(HISTORY).fill(0);
const etaBattHist = new Array(HISTORY).fill(0);
const etaO2Hist   = new Array(HISTORY).fill(0);

const etaChart = new Chart($("eta-chart").getContext("2d"), {
  type: "line",
  data: { labels, datasets: [
    { data: [...etaCoolHist], borderColor: "#ff3b3b", borderWidth: 1.5, fill: false, tension: 0.3, yAxisID: "yEta" },
    { data: [...etaLoadHist], borderColor: "#f0a500", borderWidth: 1.5, fill: false, tension: 0.3, yAxisID: "yEta" },
    { data: [...etaBattHist], borderColor: "#a855f7", borderWidth: 1.5, fill: false, tension: 0.3, yAxisID: "yEta" },
    { data: [...etaO2Hist],   borderColor: "#00b4ff", borderWidth: 1.5, fill: false, tension: 0.3, yAxisID: "yEta" },
  ]},
  options: { ...SHARED, scales: {
    x: { display: false },
    yEta: {
      display: true, position: "left", min: 0, max: 10,
      grid: { color: "rgba(30,45,61,0.7)" },
      ticks: { color: "#3a5060", font: { size: 9, family: "Share Tech Mono" }, maxTicksLimit: 5, callback: v => v >= 10 ? "SAFE" : v + "h" },
      border: { display: false }
    }
  }},
});

// ── ETA card renderer
function renderEtaCards(predictions) {
  const container = $("eta-cards");
  container.innerHTML = "";
  predictions.forEach(p => {
    const isSafe = p.eta_hrs >= 999;
    const displayTime = isSafe ? "SAFE" : p.eta_hrs < 1
      ? `${Math.round(p.eta_hrs * 60)}m`
      : `${p.eta_hrs.toFixed(1)}h`;
    const progressPct = isSafe ? 5 : Math.min(99, Math.round((1 - p.eta_hrs / 10) * 100));
    const barColor = p.status === "crit" ? "#ff3b3b" : p.status === "warn" ? "#f0a500" : "#00e87a";
    const card = document.createElement("div");
    card.className = "eta-card " + (p.status !== "ok" ? p.status : "");
    card.innerHTML = `
      <div class="eta-system">${p.system.toUpperCase()}</div>
      <div class="eta-time ${p.status !== "ok" ? p.status : ""}">${displayTime}</div>
      <div class="eta-time-label">${isSafe ? "no fault predicted" : "estimated to failure"}</div>
      <div class="eta-progress-wrap">
        <div class="eta-progress-fill" style="width:${progressPct}%;background:${barColor}"></div>
      </div>
      <div class="eta-meta">
        <span class="eta-current">Now: ${p.current} / Limit: ${p.threshold}</span>
        <span class="eta-trend ${p.trend}">${p.trend.toUpperCase()}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

// ════════════════════════════════════════
// API FETCH FUNCTIONS
// ════════════════════════════════════════

async function fetchAndUpdate() {
  try {
    const res  = await fetch(`${API}/api/stream`);
    const data = await res.json();
    const { obd, fault_pct, can_frames, anom_pct, composite, threat, session } = data;

    $("api-status").textContent = "● API LIVE";
    $("api-status").style.color = "#00e87a";
    $("tick-time").textContent  = nowStr();

    setSensor("val-rpm",  Math.round(obd.rpm),     "rpm", 2200, 2700);
    setSensor("val-cool", Math.round(obd.coolant),  "°C",  100,  110);
    setSensor("val-o2",   obd.o2.toFixed(3),        "V",   0.7,  0.9);
    setSensor("val-thr",  Math.round(obd.throttle), "%",    80,   92);
    setSensor("val-bv",   Math.round(obd.battery),  "V",     0,  340);
    setSensor("val-load", Math.round(obd.load),     "%",    75,   90);

    setGauge("fault-fill", "fault-pct", fault_pct);
    setGauge("anom-fill",  "anom-pct",  anom_pct);

    updateArc(composite);
    setThreatLevel(threat);

    $("ms-obd").textContent  = fault_pct.toFixed(1) + "%";
    $("ms-can").textContent  = anom_pct.toFixed(1)  + "%";
    $("ms-comp").textContent = composite.toFixed(1)  + "%";

    $("obd-dot").className = "status-dot" + (fault_pct > 65 ? " crit" : fault_pct > 35 ? " warn" : "");
    $("can-dot").className = "status-dot" + (anom_pct  > 60 ? " crit" : anom_pct  > 25 ? " warn" : "");

    addCanRows(can_frames);

    const e = session.elapsed;
    $("ss-time").textContent   = `${Math.floor(e/60)}:${fmt2(e%60)}`;
    $("ss-frames").textContent = session.frames_per_s;
    $("ss-anom").textContent   = session.anom_frames;

    if (fault_pct > 55) addLog("warn", `Random Forest: fault prob ${fault_pct.toFixed(1)}% — engine stress`);
    if (anom_pct  > 60) addLog("crit", `Isolation Forest: anomaly burst — score ${anom_pct.toFixed(1)}%`);

    // Intrusion banner + REAL ALARM SOUND
    if (anom_pct > 60 && !intrusionShown) {
      intrusionShown = true;
      $("intrusion-banner").classList.add("show");
      playAlertPing();
      addLog("crit", "INTRUSION ALERT — CAN fuzzing attack confirmed by Isolation Forest");
    }

    rpmHist.push(obd.rpm);      rpmHist.shift();
    coolHist.push(obd.coolant); coolHist.shift();
    anomHist.push(anom_pct);    anomHist.shift();
    frameHist.push(session.frames_per_s); frameHist.shift();

    obdChart.data.datasets[0].data = [...rpmHist];
    obdChart.data.datasets[1].data = [...coolHist];
    obdChart.update("none");
    canChart.data.datasets[0].data = [...anomHist];
    canChart.data.datasets[1].data = [...frameHist];
    canChart.update("none");

  } catch(err) {
    $("api-status").textContent = "● API OFFLINE";
    $("api-status").style.color = "#ff3b3b";
  }
}

async function fetchExplain() {
  try {
    const res  = await fetch(`${API}/api/explain`);
    const data = await res.json();
    renderFeatureBars(data.features);
    updateCallout(data.top_sensor, parseFloat($("fault-pct").textContent));
    updatePie(data.features);
  } catch(_) {}
}

async function fetchEta() {
  try {
    const res   = await fetch(`${API}/api/predict-eta`);
    const data  = await res.json();
    const preds = data.predictions;
    renderEtaCards(preds);

    const cap = v => Math.min(v >= 999 ? 10 : v, 10);
    etaCoolHist.push(cap(preds[0].eta_hrs)); etaCoolHist.shift();
    etaLoadHist.push(cap(preds[1].eta_hrs)); etaLoadHist.shift();
    etaBattHist.push(cap(preds[2].eta_hrs)); etaBattHist.shift();
    etaO2Hist.push(cap(preds[3].eta_hrs));   etaO2Hist.shift();

    etaChart.data.datasets[0].data = [...etaCoolHist];
    etaChart.data.datasets[1].data = [...etaLoadHist];
    etaChart.data.datasets[2].data = [...etaBattHist];
    etaChart.data.datasets[3].data = [...etaO2Hist];
    etaChart.update("none");

    preds.forEach(p => {
      if (p.status === "crit" && p.eta_hrs < 0.5)
        addLog("crit", `${p.system}: FAILURE IN ${Math.round(p.eta_hrs*60)} MINUTES`);
      else if (p.status === "warn")
        addLog("warn", `${p.system}: ETA ${p.eta_hrs.toFixed(1)}h — maintenance advised`);
    });
  } catch(_) {}
}

// ════════════════════════════════════════
// BOOT
// ════════════════════════════════════════
addLog("info", "SafeEdge initialised — Random Forest + Isolation Forest models loaded");
addLog("ok",   "OBD-II interface connected — 6 sensors active");
addLog("ok",   "CAN bus monitor active — 500 kbps");

setInterval(fetchAndUpdate, 600);
setInterval(fetchExplain,   3000);
setInterval(fetchEta,       3000);
fetchAndUpdate();
fetchExplain();
fetchEta();
