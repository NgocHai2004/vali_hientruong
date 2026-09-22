import os
from typing import Optional

def _env_str_from_dotenv(name: str) -> str:
    """Doc gia tri tu .env khi env var chua set."""
    val = os.getenv(name, "").strip()
    if val:
        return val
    root_env = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
    try:
        with open(root_env, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() == name:
                    return v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return ""


def _env_bool(name: str, default: bool = True) -> bool:
    raw = _env_str_from_dotenv(name).strip().lower()
    if not raw:
        return default
    return raw not in ("0", "false", "no", "off")


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        root_env = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
        try:
            with open(root_env, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    if k.strip() == name:
                        raw = v.strip().strip('"').strip("'")
                        break
        except FileNotFoundError:
            raw = None
    try:
        return float(raw) if raw not in (None, "") else default
    except ValueError:
        return default


FEATURE_USB_DONGLE = _env_bool("FEATURE_USB_DONGLE", default=False)
MONGO_URL = _env_str_from_dotenv("MONGO_URL") or "mongodb://localhost:27018"
DB_NAME = _env_str_from_dotenv("DB_NAME") or os.getenv("DB_NAME", "app_cccd")
JWT_SECRET = _env_str_from_dotenv("JWT_SECRET") or "change-me-in-production-please-abc123xyz"
JWT_ALGO = "HS256"
TOKEN_TTL_MINUTES = 60 * 8

FP_FINGER_CODES = [
    "left_thumb", "left_index", "left_middle", "left_ring", "left_little",
    "right_thumb", "right_index", "right_middle", "right_ring", "right_little",
]
FP_KEY_BY_CODE = {
    "left_thumb": "fp_l1", "left_index": "fp_l2", "left_middle": "fp_l3",
    "left_ring": "fp_l4", "left_little": "fp_l5",
    "right_thumb": "fp_r1", "right_index": "fp_r2", "right_middle": "fp_r3",
    "right_ring": "fp_r4", "right_little": "fp_r5",
}
FP_MIN_QUALITY_DEFAULT = int(_env_float("morfin_min_quality", 50))
FP_MIN_QUALITY_MAX = 100
FP_SERVICE_URL = _env_str_from_dotenv("FP_SERVICE_URL") or "http://127.0.0.1:8767"
FP_LEFT_THUMB_THRESHOLD = int(os.getenv("FP_LEFT_THUMB_THRESHOLD", "80"))
FP_SINGLE_THRESHOLD = int(os.getenv("FP_SINGLE_THRESHOLD", "80"))
FP_REQUIRED_FINGER_COUNT = int(os.getenv("FP_REQUIRED_FINGER_COUNT", "10"))
FP_MATCH_FINGER = os.getenv("FP_MATCH_FINGER", "left_thumb")

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin123"

BASE_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.path.join(BASE_BACKEND_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
REPORTS_DIR = os.path.join(UPLOAD_DIR, "reports")
os.makedirs(REPORTS_DIR, exist_ok=True)
SCENE_UPLOAD_DIR = os.path.join(UPLOAD_DIR, "scene")
os.makedirs(SCENE_UPLOAD_DIR, exist_ok=True)
SCENE_REPORTS_DIR = os.path.join(BASE_BACKEND_DIR, "private_reports")
os.makedirs(SCENE_REPORTS_DIR, exist_ok=True)

SCENE_API_KEY = os.getenv("SCENE_API_KEY", "")
SCENE_ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp"}
SCENE_MAX_BYTES = 10 * 1024 * 1024

SYNC_REMOTE = os.getenv("SYNC_REMOTE_URL", "http://192.168.22.65:3000")
