"""
Train both ML models and save them to backend/models/
Run this once before starting the server:
    python backend/train.py
"""

import numpy as np
import joblib
import os
from sklearn.ensemble import RandomForestClassifier, IsolationForest
from simulator import generate_obd_sample, generate_can_frames
from simulator import obd_to_feature_vector, can_frame_to_feature_vector

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
os.makedirs(MODELS_DIR, exist_ok=True)


# ── 1. Random Forest — OBD Fault Detection ───────────────
print("Training Random Forest (OBD fault detection)...")

X_obd, y_obd = [], []

# Normal samples — label 0
for _ in range(2000):
    sample = generate_obd_sample("normal", 0)
    X_obd.append(obd_to_feature_vector(sample))
    y_obd.append(0)

# Fault samples — label 1
for _ in range(2000):
    sample = generate_obd_sample("attack", 80)
    X_obd.append(obd_to_feature_vector(sample))
    y_obd.append(1)

X_obd = np.array(X_obd)
y_obd = np.array(y_obd)

rf_model = RandomForestClassifier(
    n_estimators=100,
    max_depth=8,
    random_state=42,
    class_weight="balanced",
)
rf_model.fit(X_obd, y_obd)

obd_path = os.path.join(MODELS_DIR, "obd_model.pkl")
joblib.dump(rf_model, obd_path)
print(f"  Saved → {obd_path}")
print(f"  Training accuracy: {rf_model.score(X_obd, y_obd)*100:.1f}%")


# ── 2. Isolation Forest — CAN Bus Anomaly Detection ──────
print("\nTraining Isolation Forest (CAN bus anomaly detection)...")

X_can = []

# Normal CAN frames for training
for _ in range(3000):
    frames = generate_can_frames("normal", 0, count=1)
    X_can.append(can_frame_to_feature_vector(frames[0]))

X_can = np.array(X_can)

if_model = IsolationForest(
    n_estimators=100,
    contamination=0.05,   # expect ~5% anomalies in real traffic
    random_state=42,
)
if_model.fit(X_can)

can_path = os.path.join(MODELS_DIR, "can_model.pkl")
joblib.dump(if_model, can_path)
print(f"  Saved → {can_path}")
print("  Isolation Forest trained on normal CAN traffic.")

print("\nAll models trained and saved!")