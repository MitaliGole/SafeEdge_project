"""
SafeEdge — FastAPI Backend
Run with: uvicorn app:app --reload --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import joblib
import numpy as np
import os
import time
import random
from simulator import (
    generate_obd_sample,
    generate_can_frames,
    obd_to_feature_vector,
    can_frame_to_feature_vector,
)
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI(title="SafeEdge API")

# ── CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Serve frontend files directly from FastAPI
app.mount("/app", StaticFiles(directory="../frontend", html=True), name="frontend")

# ── Load ML models
MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
print("Loading models...")
rf_model = joblib.load(os.path.join(MODELS_DIR, "obd_model.pkl"))
if_model = joblib.load(os.path.join(MODELS_DIR, "can_model.pkl"))
print("Models loaded!")

# ── State
state = {
    "scenario":      "normal",
    "phase":         0,
    "session_start": time.time(),
    "alert_count":   0,
    "anom_frames":   0,
    "total_frames":  0,
}

# ════════════════════════════════════════
# ROUTES
# ════════════════════════════════════════

@app.get("/")
def root():
    return {"status": "SafeEdge API running", "dashboard": " https://safeedge-project-1.onrender.com"}


@app.post("/api/scenario/{mode}")
def set_scenario(mode: str):
    if mode not in ("normal", "attack"):
        return {"error": "Invalid scenario"}
    state["scenario"] = mode
    state["phase"]    = 0
    return {"scenario": mode}


@app.get("/api/stream")
def stream():
    scenario = state["scenario"]
    if scenario == "attack":
        state["phase"] = min(state["phase"] + 1, 100)
    else:
        state["phase"] = 0
    phase = state["phase"]

    obd    = generate_obd_sample(scenario, phase)
    frames = generate_can_frames(scenario, phase, count=5)

    obd_features = np.array([obd_to_feature_vector(obd)])
    fault_prob   = float(rf_model.predict_proba(obd_features)[0][1]) * 100

    for frame in frames:
        vec       = np.array([can_frame_to_feature_vector(frame)])
        score     = if_model.decision_function(vec)[0]
        anom_prob = float(np.clip((0.5 - score) * 100, 0, 100))
        frame["anom_score"] = round(anom_prob, 1)
        frame["anom"]       = anom_prob > 60

    anom_pct  = float(np.mean([f["anom_score"] for f in frames]))
    composite = round(fault_prob * 0.5 + anom_pct * 0.5, 1)

    state["total_frames"] += len(frames)
    state["anom_frames"]  += sum(1 for f in frames if f["anom"])
    frames_per_sec = random.randint(78, 95) if scenario == "normal" else random.randint(140, 200)
    elapsed = int(time.time() - state["session_start"])

    if composite < 35:   threat = "safe"
    elif composite < 65: threat = "warn"
    else:                threat = "crit"

    return {
        "obd":        obd,
        "fault_pct":  round(fault_prob, 1),
        "can_frames": frames,
        "anom_pct":   round(anom_pct, 1),
        "composite":  composite,
        "threat":     threat,
        "phase":      phase,
        "scenario":   scenario,
        "session": {
            "elapsed":      elapsed,
            "alerts":       state["alert_count"],
            "frames_per_s": frames_per_sec,
            "anom_frames":  state["anom_frames"],
        }
    }


@app.get("/api/explain")
def explain():
    feature_names = ["RPM", "Coolant", "O2 Volt", "Throttle", "Battery", "Load"]
    importances   = rf_model.feature_importances_.tolist()
    ranked = sorted(zip(feature_names, importances), key=lambda x: x[1], reverse=True)
    return {
        "features":   [{"name": r[0], "importance": round(r[1]*100, 1)} for r in ranked],
        "top_sensor": ranked[0][0],
    }


@app.get("/api/predict-eta")
def predict_eta():
    scenario = state["scenario"]
    phase    = state["phase"]

    if scenario == "normal":
        predictions = [
            {"system": "Coolant System",   "eta_hrs": 999,  "status": "ok", "trend": "stable",   "current": 85,   "threshold": 110},
            {"system": "Engine Load",      "eta_hrs": 999,  "status": "ok", "trend": "stable",   "current": 32,   "threshold": 90},
            {"system": "Battery System",   "eta_hrs": 999,  "status": "ok", "trend": "stable",   "current": 398,  "threshold": 340},
            {"system": "O2 / Fuel System", "eta_hrs": 999,  "status": "ok", "trend": "stable",   "current": 0.44, "threshold": 0.9},
        ]
    else:
        coolant_now = 82 + phase * 1.1
        load_now    = 30 + phase * 0.6
        battery_now = 398 - phase * 0.4
        o2_now      = 0.42 + phase * 0.005

        def eta_hours(current, threshold, rate):
            if rate <= 0: return 999
            return round(max(0, (threshold - current) / (rate * 6000)), 2)

        def status(e): return "crit" if e < 0.5 else "warn" if e < 2.0 else "ok"
        def trend(e):  return "critical" if e < 0.5 else "rising" if e < 2.0 else "stable"

        cool_eta = eta_hours(coolant_now, 110, 1.1)
        load_eta = eta_hours(load_now,    90,  0.6)
        o2_eta   = eta_hours(o2_now,      0.9, 0.005)

        predictions = [
            {"system": "Coolant System",   "eta_hrs": cool_eta, "status": status(cool_eta), "trend": trend(cool_eta), "current": round(coolant_now,1), "threshold": 110},
            {"system": "Engine Load",      "eta_hrs": load_eta, "status": status(load_eta), "trend": trend(load_eta), "current": round(load_now,1),    "threshold": 90},
            {"system": "Battery System",   "eta_hrs": 999,      "status": "ok",             "trend": "declining",     "current": round(battery_now,1), "threshold": 340},
            {"system": "O2 / Fuel System", "eta_hrs": o2_eta,   "status": status(o2_eta),   "trend": trend(o2_eta),   "current": round(o2_now,3),      "threshold": 0.9},
        ]

    return {"predictions": predictions, "scenario": scenario, "phase": phase}
@app.post("/api/reset")
def reset_session():
    state["scenario"]      = "normal"
    state["phase"]         = 0
    state["session_start"] = time.time()
    state["alert_count"]   = 0
    state["anom_frames"]   = 0
    state["total_frames"]  = 0
    return {"status": "reset"}