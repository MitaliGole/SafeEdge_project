# SafeEdge — On-Device Vehicle Health & Threat Monitor

> **Edge AI system for real-time OBD-II fault detection and CAN bus intrusion detection using on-device machine learning.**

---

## Overview

SafeEdge is an edge-deployed vehicle security and health monitoring system that runs two ML models directly on the vehicle unit — no cloud required. It continuously reads OBD-II sensor data and CAN bus frames, detects engine faults and cyber attacks in real time, and presents everything on a live dashboard.

Built for the scenario where a heavy-duty EV truck (or any connected vehicle) needs to detect both mechanical faults and cybersecurity intrusions simultaneously, with zero latency and no internet dependency.

---

## Features

- **Real-time OBD-II Monitoring** — RPM, coolant temp, O2 voltage, throttle, battery voltage, engine load
- **CAN Bus Stream Analysis** — Live frame-by-frame anomaly detection with per-frame flagging
- **Dual ML Models running on-device:**
  - 🌲 **Random Forest** — Supervised classifier for OBD fault probability
  - 🌲 **Isolation Forest** — Unsupervised anomaly detector for CAN bus fuzzing attacks
- **Composite Risk Score** — Weighted blend of both model outputs (0–100)
- **Attack Simulation Mode** — Toggle between normal drive and live attack + fault scenario
- **Intrusion Alert Banner** — Audio + visual alert on confirmed CAN fuzzing
- **Live Event Log** — Timestamped log of all model-triggered warnings
- **Session Statistics** — Uptime, alert count, frame rate, anomalous frame count

---

## Architecture

```
┌─────────────────────────────────────┐
│           Browser Dashboard         │
│  (index.html + app.js + style.css)  │
│  Chart.js · Tabler Icons · WebAudio │
└──────────────┬──────────────────────┘
               │ HTTP polling (600ms)
               ▼
┌─────────────────────────────────────┐
│        FastAPI Backend (app.py)     │
│  /api/stream  /api/scenario/{mode}  │
└──────┬─────────────┬────────────────┘
       │             │
       ▼             ▼
┌────────────┐  ┌──────────────────┐
│  simulator │  │   ML Models      │
│  .py       │  │  obd_model.pkl   │
│            │  │  (Random Forest) │
│ OBD + CAN  │  │  can_model.pkl   │
│ data gen   │  │  (Isolation      │
│            │  │   Forest)        │
└────────────┘  └──────────────────┘
```

---

## Project Structure

```
safeEdge/
├── app.py                  # FastAPI backend — ML inference + API routes
├── simulator.py            # OBD-II & CAN bus data simulator
├── train.py                # Train and save both ML models
├── requirements.txt        # Python dependencies
├── models/
│   ├── obd_model.pkl       # Trained Random Forest (OBD fault detection)
│   └── can_model.pkl       # Trained Isolation Forest (CAN anomaly detection)
├── index.html              # Dashboard UI
├── style.css               # Dark-theme cyberpunk styles
└── app.js                  # Frontend polling loop + Chart.js + WebAudio
```

---

## ML Models

### Random Forest — OBD Fault Detection
- **Type:** Supervised binary classifier
- **Input:** 6 OBD-II sensor readings (RPM, coolant, O2, throttle, battery, engine load)
- **Output:** Fault probability (0–100%)
- **Training:** 2000 normal samples + 2000 fault samples, 100 estimators, max depth 8
- **Trigger threshold:** > 55% → warning log, > 65% → critical state

### Isolation Forest — CAN Bus Anomaly Detection
- **Type:** Unsupervised anomaly detector
- **Input:** 6 features per CAN frame (frame ID, DLC, byte sum, max byte, min byte, unique byte count)
- **Output:** Anomaly score per frame (0–100%)
- **Training:** 3000 normal CAN frames only, contamination = 5%
- **Trigger threshold:** > 60% per frame → flagged as anomaly

### Composite Risk Score
```
composite = (fault_prob × 0.5) + (avg_can_anomaly × 0.5)
```
| Score | Threat Level |
|-------|-------------|
| 0–34  | SAFE ✅     |
| 35–64 | WARNING ⚠️  |
| 65+   | CRITICAL 🔴 |

---

## Attack Simulation

Toggle **ATTACK + FAULT** mode to simulate a progressive vehicle cyber-attack:

- **Phase 0–30:** Normal operation
- **Phase 30+:** CAN fuzzing begins (60% of frames become malicious)
  - Fuzzing types: all-`0xFF`, all-`0x00`, or random garbage payloads
  - Anomalous frame IDs from a separate "attack" ID pool
- **OBD sensors** simultaneously reflect fault conditions (high coolant, elevated RPM, low battery)
- The Isolation Forest detects frame-level anomalies; the Random Forest detects the OBD fault signature independently

---

## Setup & Running

### Prerequisites
- Python 3.8+
- Node.js (not required — frontend is plain HTML/JS)

### 1. Install Python dependencies
```bash
pip install -r requirements.txt
```

### 2. Train the ML models (run once)
```bash
python train.py
```
This creates `models/obd_model.pkl` and `models/can_model.pkl`.

### 3. Start the backend
```bash
uvicorn app:app --reload --port 8000
```

### 4. Open the dashboard
Open `index.html` in your browser, or serve it with any static file server:
```bash
python -m http.server 3000
# then visit http://localhost:3000
```

The frontend polls `http://127.0.0.1:8000/api/stream` every 600ms automatically.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Health check |
| `GET` | `/api/stream` | Main data stream — returns sensor data + ML predictions |
| `POST` | `/api/scenario/normal` | Switch to normal drive mode |
| `POST` | `/api/scenario/attack` | Switch to attack + fault simulation mode |

### Sample `/api/stream` Response
```json
{
  "obd": { "rpm": 1923.4, "coolant": 82.1, "o2": 0.441, "throttle": 22.3, "battery": 398.0, "load": 31.5 },
  "fault_pct": 12.4,
  "can_frames": [
    { "id": "0x1a4", "dlc": 8, "data": "3A 12 FF 00 C2 87 11 44", "anom": false, "anom_score": 18.2 }
  ],
  "anom_pct": 21.3,
  "composite": 16.9,
  "threat": "safe",
  "phase": 0,
  "scenario": "normal",
  "session": { "elapsed": 45, "alerts": 0, "frames_per_s": 83, "anom_frames": 2 }
}
```

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `fastapi` | Backend REST API |
| `uvicorn` | ASGI server |
| `scikit-learn` | Random Forest + Isolation Forest |
| `numpy` | Numerical ops + feature vectors |
| `pandas` | Data handling during training |
| `joblib` | Model serialization |
| `Chart.js 4.4.1` | Real-time line charts (CDN) |
| `Tabler Icons` | Dashboard icons (CDN) |
| `Share Tech Mono` + `Rajdhani` | Fonts (Google Fonts CDN) |

---

## Team

Built at [Pandas] · [Date]: 29-06-2026
Team Members:
Mitali Gole (Leader) (Role: Frontend UI/UX developer)
Anshika Raghuwanshi (Integration Testing and Documentations)
Chetan Parmar (ML engineer and Backend lead)

