"use strict";

const $ = id => document.getElementById(id);

// ── State
let scenario = "normal";
let tick = 0, attackPhase = 0;
let sessionStart = Date.now();
let alertCount = 0, anomFrameCount = 0, logThrottle = 0;
let intrusionShown = false, audioCtx = null;

// ── Chart history (rolling 30 points)
const HISTORY = 30;
const rpmHist   = new Array(HISTORY).fill(1800);
const coolHist  = new Array(HISTORY).fill(82);
const anomHist  = new Array(HISTORY).fill(3);
const frameHist = new Array(HISTORY).fill(85);

// ── CAN data pools
const CAN_IDS_NORMAL = ["0x1A4","0x2B3","0x3C1","0x4D0","0x18F","0x0E2","0x3A0","0x1B2"];
const CAN_DATA_NORMAL = [
  "01 00 00 00 00 00 00 00","FF A1 00 3C 00 00 00 00",
  "44 3B 00 00 A2 00 00 00","22 00 00 00 00 1F 00 00",
  "80 00 FF 00 00 00 12 34","C0 DE 00 00 01 00 00 00",
];
const CAN_IDS_FUZZ = ["0xF3A","0x???","0x000","0xFFE","0xABC","0x7FF","0xDEA"];
const CAN_DATA_FUZZ = [
  "FF FF FF FF FF FF FF FF","00 00 00 00 00 00 00 00",
  "AA BB CC DD EE FF 00 11","?? ?? ?? ?? ?? ?? ?? ??",
  "DE AD BE EF CA FE BA BE",
];

// ── Helpers
const rand    = (a,b) => a + Math.random()*(b-a);
const randInt = (a,b) => Math.round(rand(a,b));
const clamp   = (v,lo,hi) => Math.min(hi, Math.max(lo,v));
const fmt2    = n => String(Math.floor(n)).padStart(2,"0");
const nowStr  = () => { const d=new Date(); return `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}:${fmt2(d.getSeconds())}`; };
const nowMs   = () => nowStr()+"."+String(randInt(0,999)).padStart(3,"0");

// ── Audio alert
function playAlertPing() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    [880,660,880].forEach((freq,i) => {
      const osc=audioCtx.createOscillator(), gain=audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.frequency.value = freq;
      const s = audioCtx.currentTime + i*0.18;
      gain.gain.setValueAtTime(0.12,s);
      gain.gain.exponentialRampToValueAtTime(0.001, s+0.15);
      osc.start(s); osc.stop(s+0.16);
    });
  } catch(_) {}
}

// ── Arc gauge
function updateArc(pct) {
  pct = clamp(Math.round(pct),0,100);
  const offset = 219.9 - (219.9*pct/100);
  const arc=$("arc-fill"), num=$("arc-num");
  arc.style.strokeDashoffset = offset;
  arc.style.transition = "stroke-dashoffset 0.8s ease, stroke 0.5s ease";
  const color = pct<30?"#00e87a":pct<65?"#f0a500":"#ff3b3b";
  arc.style.stroke = color;
  num.style.fill = color;
  num.textContent = pct;
}

// ── Sensor DOM update
function setSensor(id, html, warnT, critT, raw) {
  const el=$(id);
  el.innerHTML = html;
  el.className = "sensor-val";
  if (raw>=critT) el.classList.add("crit");
  else if (raw>=warnT) el.classList.add("warn");
}

// ── Gauge bar
function setGauge(fillId, spanId, pct) {
  pct = clamp(Math.round(pct),0,100);
  const fill=$(fillId);
  fill.style.width = pct+"%";
  fill.style.background = pct>65?"#ff3b3b":pct>35?"#f0a500":"#00e87a";
  $(spanId).textContent = pct;
}

// ── Threat level
function setThreatLevel(level) {
  const badge=$("risk-level"), dot=$("risk-dot"), desc=$("risk-desc");
  badge.className = "risk-level-badge"+(level==="warn"?" warn":level==="crit"?" crit":"");
  dot.className   = "status-dot"+(level==="warn"?" warn":level==="crit"?" crit":"");
  if (level==="safe") {
    badge.textContent = "SAFE";
    desc.textContent  = "All systems nominal. No anomalies detected on OBD-II or CAN bus.";
  } else if (level==="warn") {
    badge.textContent = "WARNING";
    desc.textContent  = "Elevated coolant temp. Fault probability rising. Increased CAN anomaly rate.";
  } else {
    badge.textContent = "CRITICAL";
    desc.textContent  = "CAN bus fuzzing confirmed. Engine fault imminent. ECU isolation triggered.";
  }
}

// ── Event log
function addLog(type, msg) {
  const el=$("event-log");
  const row=document.createElement("div");
  row.className="log-row "+type;
  row.innerHTML=`<span class="log-ts">${nowStr()}</span><span class="log-msg">${msg}</span>`;
  el.appendChild(row);
  while(el.children.length>25) el.removeChild(el.children[0]);
  el.scrollTop=el.scrollHeight;
  if(type!=="info"){ alertCount++; $("ss-alerts").textContent=alertCount; }
}

// ── CAN row
function addCanRow(isAnom) {
  const list=$("can-list"), row=document.createElement("div");
  row.className="can-row"+(isAnom?" anom":"");
  const id   = isAnom ? CAN_IDS_FUZZ[randInt(0,CAN_IDS_FUZZ.length-1)]   : CAN_IDS_NORMAL[randInt(0,CAN_IDS_NORMAL.length-1)];
  const data = isAnom ? CAN_DATA_FUZZ[randInt(0,CAN_DATA_FUZZ.length-1)] : CAN_DATA_NORMAL[randInt(0,CAN_DATA_NORMAL.length-1)];
  const dlc  = isAnom ? randInt(0,8) : 8;
  const tag  = isAnom ? `<span class="can-tag">ANOMALY</span>` : `<span class="can-ok-tag">OK</span>`;
  row.innerHTML=`<span class="can-ts">${nowMs()}</span><span class="can-id${isAnom?" anom":""}">${id}</span><span class="can-dlc">${dlc}</span><span class="can-data">${data}</span>${tag}`;
  list.insertBefore(row,list.firstChild);
  if(list.children.length>14) list.removeChild(list.lastChild);
  if(isAnom){ anomFrameCount++; $("ss-anom").textContent=anomFrameCount; }
}

// ── Exposed to HTML buttons
window.dismissBanner = () => $("intrusion-banner").classList.remove("show");
window.setScenario = (s) => {
  scenario=s; attackPhase=0; intrusionShown=false;
  $("btn-normal").classList.toggle("active",s==="normal");
  $("btn-attack").classList.toggle("active",s==="attack");
  if(s==="normal"){ $("intrusion-banner").classList.remove("show"); addLog("ok","Scenario: Normal drive mode"); setThreatLevel("safe"); }
  else { addLog("warn","Scenario: Attack + Fault simulation started"); }
};

/* ── Charts ─────────────────────────────────────────── */
const labels = Array.from({length:HISTORY},(_,i)=>i);
const SHARED = {
  responsive:true, maintainAspectRatio:false, animation:{duration:200},
  plugins:{legend:{display:false},tooltip:{enabled:false}},
  elements:{point:{radius:0}},
};

const obdChart = new Chart($("obd-chart").getContext("2d"), {
  type:"line",
  data:{ labels, datasets:[
    { data:[...rpmHist],  borderColor:"#00b4ff", borderWidth:1.5, fill:true, backgroundColor:"rgba(0,180,255,0.05)", yAxisID:"yRPM",  tension:0.3 },
    { data:[...coolHist], borderColor:"#f0a500", borderWidth:1.5, fill:true, backgroundColor:"rgba(240,165,0,0.05)",  yAxisID:"yCool", tension:0.3 },
  ]},
  options:{ ...SHARED, scales:{
    x:{display:false},
    yRPM:{ display:true, position:"left",  grid:{color:"rgba(30,45,61,0.7)"}, ticks:{color:"#3a5060",font:{size:9,family:"Share Tech Mono"},maxTicksLimit:4}, border:{display:false} },
    yCool:{ display:true, position:"right", min:70, max:130, grid:{drawOnChartArea:false}, ticks:{color:"#3a5060",font:{size:9,family:"Share Tech Mono"},maxTicksLimit:4}, border:{display:false} },
  }},
});

const canChart = new Chart($("can-chart").getContext("2d"), {
  type:"line",
  data:{ labels, datasets:[
    { data:[...anomHist],  borderColor:"#ff3b3b", borderWidth:1.5, fill:true, backgroundColor:"rgba(255,59,59,0.08)", yAxisID:"yAnom",   tension:0.3, borderDash:[4,2] },
    { data:[...frameHist], borderColor:"#00b4ff", borderWidth:1,   fill:false,                                         yAxisID:"yFrames", tension:0.3 },
  ]},
  options:{ ...SHARED, scales:{
    x:{display:false},
    yAnom:{   display:true, position:"left",  min:0, max:100, grid:{color:"rgba(30,45,61,0.7)"}, ticks:{color:"#3a5060",font:{size:9,family:"Share Tech Mono"},maxTicksLimit:4}, border:{display:false} },
    yFrames:{ display:true, position:"right", grid:{drawOnChartArea:false}, ticks:{color:"#3a5060",font:{size:9,family:"Share Tech Mono"},maxTicksLimit:4}, border:{display:false} },
  }},
});

/* ── Main loop ─────────────────────────────────────── */
function update() {
  tick++; logThrottle++;
  const t = tick/10;
  let rpm,cool,o2,thr,bv,load,faultPct,anomPct,framesPerSec,composite;

  if (scenario==="normal") {
    rpm=randInt(1700,2100); cool=Math.round(82+Math.sin(t*0.3)*3+rand(-1,1));
    o2=+(0.42+Math.sin(t*0.5)*0.05+rand(-0.02,0.02)).toFixed(2);
    thr=randInt(18,28); bv=randInt(395,402); load=randInt(27,35);
    faultPct=randInt(5,12); anomPct=randInt(2,6); framesPerSec=randInt(78,95);
    composite=Math.round(faultPct*0.4+anomPct*0.6);
    $("obd-dot").className="status-dot"; $("can-dot").className="status-dot";
    setThreatLevel("safe"); addCanRow(false);

  } else {
    attackPhase=Math.min(attackPhase+1,100);
    const p=attackPhase;
    rpm=randInt(1800,2200)+Math.round(p*2.5);
    cool=Math.round(82+p*1.1+rand(-2,4));
    o2=+(0.42+p*0.005+rand(-0.03,0.06)).toFixed(2);
    thr=randInt(22,32)+Math.round(p*0.3);
    bv=randInt(390,400)-Math.round(p*0.4);
    load=randInt(28,36)+Math.round(p*0.6);
    faultPct=clamp(Math.round(8+p*0.82+rand(-4,6)),0,99);
    const isAttacking=p>30;
    anomPct=isAttacking?clamp(Math.round(6+(p-30)*2.4+rand(-4,9)),0,99):Math.round(3+p*0.12);
    framesPerSec=isAttacking?randInt(140,200):randInt(78,95);
    composite=clamp(Math.round(faultPct*0.5+anomPct*0.5),0,99);

    $("obd-dot").className="status-dot"+(faultPct>65?" crit":faultPct>35?" warn":"");
    $("can-dot").className="status-dot"+(anomPct>60?" crit":anomPct>25?" warn":"");

    addCanRow(isAttacking&&Math.random()<0.75);
    if(isAttacking&&Math.random()<0.4) addCanRow(true);

    if(composite<35) setThreatLevel("safe");
    else if(composite<65) setThreatLevel("warn");
    else setThreatLevel("crit");

    if(cool>100&&logThrottle%7===0) addLog("warn",`Coolant ${cool}°C — critical threshold 105°C`);
    if(faultPct>55&&logThrottle%9===0) addLog("warn",`Fault prob ${faultPct}% — engine load anomaly`);
    if(anomPct>60&&logThrottle%5===0) addLog("crit",`CAN burst — ${randInt(30,60)} malformed frames`);
    if(anomPct>60&&!intrusionShown){
      intrusionShown=true;
      $("intrusion-banner").classList.add("show");
      playAlertPing();
      addLog("crit","INTRUSION ALERT — CAN fuzzing attack confirmed");
    }
  }

  // Update DOM
  setSensor("val-rpm",  `${rpm} <span class="sensor-unit">rpm</span>`, 2200,2700,rpm);
  setSensor("val-cool", `${clamp(cool,60,128)} <span class="sensor-unit">°C</span>`, 100,110,cool);
  setSensor("val-o2",   `${o2} <span class="sensor-unit">V</span>`, 0.7,0.9,o2);
  setSensor("val-thr",  `${clamp(thr,0,100)} <span class="sensor-unit">%</span>`, 80,92,thr);
  setSensor("val-bv",   `${clamp(bv,350,450)} <span class="sensor-unit">V</span>`, 0,340,bv);
  setSensor("val-load", `${clamp(load,0,100)} <span class="sensor-unit">%</span>`, 75,90,load);
  setGauge("fault-fill","fault-pct",faultPct);
  setGauge("anom-fill","anom-pct",anomPct);
  updateArc(composite);
  $("ms-obd").textContent=faultPct+"%";
  $("ms-can").textContent=anomPct+"%";
  $("ms-comp").textContent=composite+"%";
  $("ss-frames").textContent=framesPerSec;
  const elapsed=Math.floor((Date.now()-sessionStart)/1000);
  $("ss-time").textContent=`${Math.floor(elapsed/60)}:${fmt2(elapsed%60)}`;
  $("tick-time").textContent=nowStr();

  // Update charts
  rpmHist.push(rpm);     rpmHist.shift();
  coolHist.push(clamp(cool,60,128)); coolHist.shift();
  anomHist.push(anomPct);  anomHist.shift();
  frameHist.push(framesPerSec); frameHist.shift();
  obdChart.data.datasets[0].data=[...rpmHist];
  obdChart.data.datasets[1].data=[...coolHist];
  obdChart.update("none");
  canChart.data.datasets[0].data=[...anomHist];
  canChart.data.datasets[1].data=[...frameHist];
  canChart.update("none");
}

// Boot
addLog("info","SafeEdge initialised — Random Forest + Isolation Forest models loaded");
addLog("ok","OBD-II interface connected — 6 sensors active");
addLog("ok","CAN bus monitor active — 500 kbps");
setInterval(update, 600);
update();