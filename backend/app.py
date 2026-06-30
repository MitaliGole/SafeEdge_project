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

app = FastAPI(title="SafeEdge API")

# ── CORS (allow frontend to call backend) ────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Load ML models ───────────────────────────────────────
MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

print("Loading models...")
rf_model = joblib.load(os.path.join(MODELS_DIR, "obd_model.pkl"))
if_model = joblib.load(os.path.join(MODELS_DIR, "can_model.pkl"))
print("Models loaded!")

# ── State ────────────────────────────────────────────────
state = {
    "scenario":    "normal",
    "phase":       0,
    "session_start": time.time(),
    "alert_count": 0,
    "anom_frames": 0,
    "total_frames": 0,
}


# ── Routes ───────────────────────────────────────────────

@app.get("/api/status")
def status():
    return {"status": "SafeEdge API running"}


@app.post("/api/scenario/{mode}")
def set_scenario(mode: str):
    """Switch between normal and attack scenario."""
    if mode not in ("normal", "attack"):
        return {"error": "Invalid scenario"}
    state["scenario"] = mode
    state["phase"]    = 0
    return {"scenario": mode}


@app.get("/api/stream")
def stream():
    """
    Main data endpoint — called by frontend every 600ms.
    Returns real ML model predictions on live sensor data.
    """
    scenario = state["scenario"]

    # Increment attack phase (0 → 100)
    if scenario == "attack":
        state["phase"] = min(state["phase"] + 1, 100)
    else:
        state["phase"] = 0

    phase = state["phase"]

    # ── Generate sensor data ─────────────────────────────
    obd    = generate_obd_sample(scenario, phase)
    frames = generate_can_frames(scenario, phase, count=5)

    # ── Run Random Forest on OBD data ────────────────────
    obd_features = np.array([obd_to_feature_vector(obd)])
    fault_prob = float(rf_model.predict_proba(obd_features)[0][1]) * 100

    # Isolation Forest
    for frame in frames:
        vec   = np.array([can_frame_to_feature_vector(frame)])
        score = if_model.decision_function(vec)[0]
        # Convert: negative score = more anomalous
        # Map to 0-100 probability (lower score = higher anomaly)
        anom_prob = float(np.clip((0.5 - score) * 100, 0, 100))
        frame["anom_score"] = round(anom_prob, 1)
        # Override anom flag with model output
        frame["anom"] = anom_prob > 60

    # Overall CAN anomaly score = average of all frame scores
    anom_pct = float(np.mean([f["anom_score"] for f in frames]))

    # ── Composite risk score ──────────────────────────────
    composite = round(fault_prob * 0.5 + anom_pct * 0.5, 1)

    # ── Update session stats ──────────────────────────────
    anom_frame_count = sum(1 for f in frames if f["anom"])
    state["total_frames"] += len(frames)
    state["anom_frames"]  += anom_frame_count

    frames_per_sec = random.randint(78, 95) if scenario == "normal" else random.randint(140, 200)

    elapsed = int(time.time() - state["session_start"])

    # ── Threat level ──────────────────────────────────────
    if composite < 35:
        threat = "safe"
    elif composite < 65:
        threat = "warn"
    else:
        threat = "crit"
    
    if threat == "crit":
        state["alert_count"] += 1

    return {
        "obd":         obd,
        "fault_pct":   round(fault_prob, 1),
        "can_frames":  frames,
        "anom_pct":    round(anom_pct, 1),
        "composite":   composite,
        "threat":      threat,
        "phase":       phase,
        "scenario":    scenario,
        "session": {
            "elapsed":     elapsed,
            "alerts":      state["alert_count"],
            "frames_per_s": frames_per_sec,
            "anom_frames": state["anom_frames"],
        }
    }


@app.get("/api/explain")
def explain():
    """
    Returns Random Forest feature importances +
    which sensor is currently most at risk.
    """
    feature_names = ["RPM", "Coolant", "O2 Volt", "Throttle", "Battery", "Load"]
    importances   = rf_model.feature_importances_.tolist()

    # Zip and sort by importance descending
    ranked = sorted(
        zip(feature_names, importances),
        key=lambda x: x[1],
        reverse=True
    )

    return {
        "features": [{"name": r[0], "importance": round(r[1] * 100, 1)} for r in ranked],
        "top_sensor": ranked[0][0],
    }


# ── Serve Frontend ──────────────────────────────────────
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
