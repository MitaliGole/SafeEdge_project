"use strict";

const API = "http://127.0.0.1:8000";
const $   = id => document.getElementById(id);

// ── State
let intrusionShown = false;
let alertCount     = 0;
let audioCtx       = null;

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

// ── Audio alert
function playAlertPing() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 660, 880].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.frequency.value = freq;
      const s = audioCtx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.12, s);
      gain.gain.exponentialRampToValueAtTime(0.001, s + 0.15);
      osc.start(s); osc.stop(s + 0.16);
    });
  } catch(_) {}
}

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

// ── CAN row
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

// ── Scenario switch — tells backend
window.setScenario = async (s) => {
  intrusionShown = false;
  $("btn-normal").classList.toggle("active", s === "normal");
  $("btn-attack").classList.toggle("active", s === "attack");
  if (s === "normal") {
    $("intrusion-banner").classList.remove("show");
    addLog("ok", "Scenario: Normal drive mode");
  } else {
    addLog("warn", "Scenario: Attack + Fault simulation started");
  }
  await fetch(`${API}/api/scenario/${s}`, { method: "POST" });
};

window.dismissBanner = () => $("intrusion-banner").classList.remove("show");

// ── Charts
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

// ── Main poll loop — calls real FastAPI backend
async function fetchAndUpdate() {
  try {
    const res  = await fetch(`${API}/api/stream`);
    const data = await res.json();

    const { obd, fault_pct, can_frames, anom_pct, composite, threat, session } = data;

    // API status
    $("api-status").textContent = "● API LIVE";
    $("api-status").style.color = "#00e87a";
    $("tick-time").textContent  = nowStr();

    // Sensor cards
    setSensor("val-rpm",  Math.round(obd.rpm),      "rpm", 2200, 2700);
    setSensor("val-cool", Math.round(obd.coolant),   "°C",  100,  110);
    setSensor("val-o2",   obd.o2.toFixed(3),         "V",   0.7,  0.9);
    setSensor("val-thr",  Math.round(obd.throttle),  "%",    80,   92);
    setSensor("val-bv",   Math.round(obd.battery),   "V",     0,  340);
    setSensor("val-load", Math.round(obd.load),      "%",    75,   90);

    // Gauges
    setGauge("fault-fill", "fault-pct", fault_pct);
    setGauge("anom-fill",  "anom-pct",  anom_pct);

    // Arc + threat
    updateArc(composite);
    setThreatLevel(threat);

    // Module scores
    $("ms-obd").textContent  = fault_pct.toFixed(1) + "%";
    $("ms-can").textContent  = anom_pct.toFixed(1)  + "%";
    $("ms-comp").textContent = composite.toFixed(1)  + "%";

    // Status dots
    $("obd-dot").className = "status-dot" + (fault_pct > 65 ? " crit" : fault_pct > 35 ? " warn" : "");
    $("can-dot").className = "status-dot" + (anom_pct  > 60 ? " crit" : anom_pct  > 25 ? " warn" : "");

    // CAN stream
    addCanRows(can_frames);

    // Session bar
    const e = session.elapsed;
    $("ss-time").textContent   = `${Math.floor(e/60)}:${fmt2(e%60)}`;
    $("ss-frames").textContent = session.frames_per_s;
    $("ss-anom").textContent   = session.anom_frames;

    // Logs
    if (fault_pct > 55) addLog("warn", `Random Forest: fault prob ${fault_pct.toFixed(1)}% — engine stress detected`);
    if (anom_pct  > 60) addLog("crit", `Isolation Forest: anomaly burst — CAN frame score ${anom_pct.toFixed(1)}%`);

    // Intrusion banner
    if (anom_pct > 60 && !intrusionShown) {
      intrusionShown = true;
      $("intrusion-banner").classList.add("show");
      playAlertPing();
      addLog("crit", "INTRUSION ALERT — CAN fuzzing attack confirmed by Isolation Forest");
    }

    // Charts
    rpmHist.push(obd.rpm);     rpmHist.shift();
    coolHist.push(obd.coolant); coolHist.shift();
    anomHist.push(anom_pct);   anomHist.shift();
    frameHist.push(session.frames_per_s); frameHist.shift();

    obdChart.data.datasets[0].data = [...rpmHist];
    obdChart.data.datasets[1].data = [...coolHist];
    obdChart.update("none");
    canChart.data.datasets[0].data = [...anomHist];
    canChart.data.datasets[1].data = [...frameHist];
    canChart.update("none");

  } catch (err) {
    $("api-status").textContent = "● API OFFLINE";
    $("api-status").style.color = "#ff3b3b";
  }
}

// ── Boot
addLog("info", "SafeEdge frontend initialised — connecting to backend...");
addLog("info", "Models: Random Forest (OBD) + Isolation Forest (CAN)");
setInterval(fetchAndUpdate, 600);
fetchAndUpdate();