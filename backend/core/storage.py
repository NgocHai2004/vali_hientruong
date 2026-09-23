import os
import re
from typing import Optional, Tuple
from core.config import UPLOAD_DIR


def sanitize_folder_name(name: Optional[str]) -> str:
    if not name:
        return "temp"
    cleaned = re.sub(r'[^a-zA-Z0-9_\-]', '_', str(name).strip())
    return cleaned or "temp"


def normalize_category(cat: Optional[str]) -> str:
    c = (cat or "").lower().strip()
    if c in {"portrait", "portraits", "front", "left", "right", "portrait_front", "portrait_left", "portrait_right", "photo"}:
        return "portraits"
    if c in {"fingerprint", "fingerprints", "fp", "fp_r1", "fp_r2", "fp_r3", "fp_r4", "fp_r5", "fp_l1", "fp_l2", "fp_l3", "fp_l4", "fp_l5"}:
        return "fingerprints"
    if c in {"cccd", "cccd_card", "card", "id_card", "id_card_front", "id_card_back"}:
        return "cccd"
    if c in {"traces", "trace", "scene"}:
        return "traces"
    if c in {"crops", "crop", "scene_crop"}:
        return "crops"
    if c in {"reports", "report"}:
        return "reports"
    return sanitize_folder_name(c) or "general"


def get_case_upload_dir(case_id: Optional[str] = None, sub_folder: str = "traces") -> Tuple[str, str]:
    """
    Returns (filesystem_directory_path, url_prefix)
    e.g. (".../uploads/cases/65f1234.../traces", "/uploads/cases/65f1234.../traces")
    """
    cid = sanitize_folder_name(case_id) if case_id else "general"
    sub = normalize_category(sub_folder)
    rel_path = os.path.join("cases", cid, sub)
    fs_path = os.path.join(UPLOAD_DIR, rel_path)
    os.makedirs(fs_path, exist_ok=True)
    url_prefix = f"/uploads/cases/{cid}/{sub}"
    return fs_path, url_prefix


def get_detainee_upload_dir(detainee_id: Optional[str] = None, category: str = "portraits") -> Tuple[str, str]:
    """
    Returns (filesystem_directory_path, url_prefix)
    e.g. (".../uploads/detainees/65f1234.../portraits", "/uploads/detainees/65f1234.../portraits")
    """
    did = sanitize_folder_name(detainee_id) if detainee_id else "temp"
    cat = normalize_category(category)
    rel_path = os.path.join("detainees", did, cat)
    fs_path = os.path.join(UPLOAD_DIR, rel_path)
    os.makedirs(fs_path, exist_ok=True)
    url_prefix = f"/uploads/detainees/{did}/{cat}"
    return fs_path, url_prefix


def get_avatar_upload_dir(user_id: Optional[str] = None) -> Tuple[str, str]:
    """
    Returns (filesystem_directory_path, url_prefix)
    e.g. (".../uploads/avatars/admin", "/uploads/avatars/admin")
    """
    uid = sanitize_folder_name(user_id) if user_id else "general"
    rel_path = os.path.join("avatars", uid)
    fs_path = os.path.join(UPLOAD_DIR, rel_path)
    os.makedirs(fs_path, exist_ok=True)
    url_prefix = f"/uploads/avatars/{uid}"
    return fs_path, url_prefix


def resolve_upload_path(url: Optional[str]) -> Optional[str]:
    """
    Resolves an /uploads/... URL to an absolute filesystem path safely.
    """
    if not url or not isinstance(url, str):
        return None
    clean_url = url.split("?")[0].split("#")[0]
    if clean_url.startswith("/uploads/"):
        rel = clean_url[len("/uploads/"):]
    elif clean_url.startswith("uploads/"):
        rel = clean_url[len("uploads/"):]
    else:
        return None
    clean_rel = os.path.normpath(rel.replace("/", os.sep)).lstrip(os.sep)
    if clean_rel.startswith("..") or os.path.isabs(clean_rel):
        return None
    path = os.path.join(UPLOAD_DIR, clean_rel)
    return path if os.path.isfile(path) else None


def safe_delete_upload_file(url: Optional[str]) -> bool:
    """
    Deletes the file corresponding to the URL if it exists inside UPLOAD_DIR.
    """
    path = resolve_upload_path(url)
    if path and os.path.isfile(path):
        try:
            os.remove(path)
            return True
        except OSError:
            return False
    return False
