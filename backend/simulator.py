import numpy as np
import random
import time

# Normal OBD-II sensor ranges
OBD_NORMAL = {
    "rpm":     (1600, 2200),
    "coolant": (78,   95),
    "o2":      (0.38, 0.55),
    "throttle":(18,   30),
    "battery": (393,  403),
    "load":    (25,   40),
}

# Attack OBD-II ranges (fault developing)
OBD_ATTACK = {
    "rpm":     (2000, 3200),
    "coolant": (100,  128),
    "o2":      (0.55, 0.95),
    "throttle":(30,   70),
    "battery": (370,  393),
    "load":    (55,   90),
}

# Normal CAN frame IDs
CAN_IDS_NORMAL = [0x1A4, 0x2B3, 0x3C1, 0x4D0, 0x18F, 0x0E2, 0x3A0, 0x1B2]

# Fuzzing CAN frame IDs (attack)
CAN_IDS_FUZZ   = [0xF3A, 0x000, 0xFFE, 0xABC, 0x7FF, 0xDEA, 0xFFF, 0x999]


def generate_obd_sample(scenario: str, phase: int) -> dict:
    """Generate one OBD-II sensor reading."""
    ranges = OBD_NORMAL if scenario == "normal" else OBD_ATTACK
    t = time.time()

    rpm      = random.uniform(*ranges["rpm"])
    coolant  = random.uniform(*ranges["coolant"])
    o2       = random.uniform(*ranges["o2"])
    throttle = random.uniform(*ranges["throttle"])
    battery  = random.uniform(*ranges["battery"])
    load     = random.uniform(*ranges["load"])

    # Add gentle sine wave noise for realism
    if scenario == "normal":
        rpm     += np.sin(t * 0.5) * 80
        coolant += np.sin(t * 0.3) * 2

    return {
        "rpm":      round(rpm, 1),
        "coolant":  round(coolant, 1),
        "o2":       round(o2, 3),
        "throttle": round(throttle, 1),
        "battery":  round(battery, 1),
        "load":     round(load, 1),
    }


def generate_can_frames(scenario: str, phase: int, count: int = 5) -> list:
    """Generate a batch of CAN bus frames."""
    frames = []
    is_attacking = scenario == "attack" and phase > 30

    for _ in range(count):
        is_anom = is_attacking and random.random() < 0.6

        if is_anom:
            frame_id = random.choice(CAN_IDS_FUZZ)
            # Fuzzing payloads — all 0xFF, all 0x00, random garbage
            payload_type = random.randint(0, 2)
            if payload_type == 0:
                data = [0xFF] * 8
            elif payload_type == 1:
                data = [0x00] * 8
            else:
                data = [random.randint(0, 255) for _ in range(8)]
            dlc = random.randint(0, 8)
        else:
            frame_id = random.choice(CAN_IDS_NORMAL)
            data = [random.randint(0, 200) for _ in range(8)]
            dlc = 8

        frames.append({
            "id":    hex(frame_id),
            "dlc":   dlc,
            "data":  " ".join(f"{b:02X}" for b in data),
            "anom":  is_anom,
        })

    return frames


def obd_to_feature_vector(obd: dict) -> list:
    """Convert OBD dict to ML feature vector."""
    return [
        obd["rpm"],
        obd["coolant"],
        obd["o2"],
        obd["throttle"],
        obd["battery"],
        obd["load"],
    ]


def can_frame_to_feature_vector(frame: dict) -> list:
    """Convert CAN frame to ML feature vector."""
    data_bytes = [int(b, 16) for b in frame["data"].split()]
    return [
        int(frame["id"], 16),   # frame ID as integer
        frame["dlc"],            # data length code
        sum(data_bytes),         # byte sum (fuzzing = very high or zero)
        max(data_bytes),         # max byte
        min(data_bytes),         # min byte
        len(set(data_bytes)),    # unique byte count (fuzzing = low variety)
    ]