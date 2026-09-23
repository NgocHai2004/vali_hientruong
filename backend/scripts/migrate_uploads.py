"""Script di chuyen va clean toan bo du lieu cu trong backend/uploads/ sang cau truc moi.
Cau truc moi:
uploads/
  ├── cases/{case_id}/traces/
  ├── cases/{case_id}/crops/
  ├── cases/{case_id}/reports/
  ├── detainees/{detainee_id}/portraits/
  ├── detainees/{detainee_id}/fingerprints/
  ├── detainees/{detainee_id}/cccd/
  ├── avatars/{username}/
  └── temp/
"""
import os
import shutil
import sys
from pymongo import MongoClient

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from core.config import MONGO_URL, DB_NAME, UPLOAD_DIR
from core.storage import (
    get_case_upload_dir,
    get_detainee_upload_dir,
    get_avatar_upload_dir,
    resolve_upload_path,
)

def run_migration():
    client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
    db = client[DB_NAME]
    print(f"[*] Ket noi MongoDB: {MONGO_URL} | DB: {DB_NAME}")
    print(f"[*] Thu muc goc UPLOAD_DIR: {UPLOAD_DIR}")

    moved_files = 0
    updated_records = 0

    # 1. Migrate Scene Traces
    print("\n--- 1. Xu ly Dấu vết Hiện trường (scene_traces) ---")
    traces = list(db.scene_traces.find({}))
    print(f"Tim thay {len(traces)} dau vet")
    for tr in traces:
        old_url = tr.get("url") or ""
        if not old_url:
            continue
        case_id = str(tr.get("case_id") or "general")
        fs_dir, url_prefix = get_case_upload_dir(case_id, sub_folder="traces")
        
        old_path = resolve_upload_path(old_url)
        filename = os.path.basename(old_url.split("?")[0])
        new_path = os.path.join(fs_dir, filename)
        new_url = f"{url_prefix}/{filename}"

        if old_path and os.path.isfile(old_path) and os.path.abspath(old_path) != os.path.abspath(new_path):
            shutil.move(old_path, new_path)
            moved_files += 1

        if old_url != new_url:
            db.scene_traces.update_one({"_id": tr["_id"]}, {"$set": {"url": new_url}})
            db.scene_matches.update_many({"trace_id": str(tr["_id"])}, {"$set": {"trace_url": new_url}})
            db.scene_matches.update_many({"trace_url": old_url}, {"$set": {"trace_url": new_url}})
            updated_records += 1

    # 2. Migrate Detainees
    print("\n--- 2. Xu ly Ho so Doi tuong (detainees) ---")
    detainees = list(db.detainees.find({}))
    print(f"Tim thay {len(detainees)} doi tuong")
    for det in detainees:
        det_id = str(det["_id"])
        updates = {}

        def migrate_field(field_url, category):
            nonlocal moved_files
            if not field_url or not isinstance(field_url, str):
                return field_url
            if field_url.startswith("data:"):
                return field_url
            old_path = resolve_upload_path(field_url)
            filename = os.path.basename(field_url.split("?")[0])
            if not filename:
                return field_url
            fs_dir, url_prefix = get_detainee_upload_dir(det_id, category=category)
            new_path = os.path.join(fs_dir, filename)
            new_url = f"{url_prefix}/{filename}"

            if old_path and os.path.isfile(old_path) and os.path.abspath(old_path) != os.path.abspath(new_path):
                shutil.move(old_path, new_path)
                moved_files += 1

            if field_url != new_url:
                db.scene_matches.update_many({"candidate_url": field_url}, {"$set": {"candidate_url": new_url}})
                db.scene_matches.update_many({"portrait": field_url}, {"$set": {"portrait": new_url}})
            return new_url

        for k in ("portrait", "portrait_cropped_url", "portrait_original_url", "photo", "photo_url"):
            if det.get(k):
                new_v = migrate_field(det[k], "portraits")
                if new_v != det[k]:
                    updates[k] = new_v

        for k in ("cccd_front_url", "cccd_back_url"):
            if det.get(k):
                new_v = migrate_field(det[k], "cccd")
                if new_v != det[k]:
                    updates[k] = new_v

        photos = det.get("photos")
        if photos and isinstance(photos, dict):
            new_photos = dict(photos)
            for pk, pv in photos.items():
                if isinstance(pv, str) and ("/uploads/" in pv or "uploads/" in pv):
                    cat = "fingerprints" if pk.startswith("fp_") else "portraits"
                    new_photos[pk] = migrate_field(pv, cat)
            if new_photos != photos:
                updates["photos"] = new_photos

        fingerprints = det.get("fingerprints")
        if fingerprints and isinstance(fingerprints, dict):
            new_fp = dict(fingerprints)
            for fk, fv in fingerprints.items():
                if isinstance(fv, str) and ("/uploads/" in fv or "uploads/" in fv):
                    new_fp[fk] = migrate_field(fv, "fingerprints")
            if new_fp != fingerprints:
                updates["fingerprints"] = new_fp

        fp_images = det.get("fp_images")
        if fp_images and isinstance(fp_images, dict):
            new_fpi = dict(fp_images)
            for fik, fiv in fp_images.items():
                if isinstance(fiv, str) and ("/uploads/" in fiv or "uploads/" in fiv):
                    new_fpi[fik] = migrate_field(fiv, "fingerprints")
            if new_fpi != fp_images:
                updates["fp_images"] = new_fpi

        if updates:
            db.detainees.update_one({"_id": det["_id"]}, {"$set": updates})
            updated_records += 1

    # 3. Migrate Users Avatars
    print("\n--- 3. Xu ly Avatar nguoi dung (users) ---")
    users = list(db.users.find({"avatar_url": {"$exists": True, "$ne": None}}))
    for u in users:
        old_avatar = u.get("avatar_url") or ""
        if not old_avatar:
            continue
        old_path = resolve_upload_path(old_avatar)
        filename = os.path.basename(old_avatar.split("?")[0])
        fs_dir, url_prefix = get_avatar_upload_dir(u.get("username") or str(u["_id"]))
        new_path = os.path.join(fs_dir, filename)
        new_url = f"{url_prefix}/{filename}"

        if old_path and os.path.isfile(old_path) and os.path.abspath(old_path) != os.path.abspath(new_path):
            shutil.move(old_path, new_path)
            moved_files += 1

        if old_avatar != new_url:
            db.users.update_one({"_id": u["_id"]}, {"$set": {"avatar_url": new_url}})
            updated_records += 1

    # 4. Clean leftover loose files in root uploads/
    print("\n--- 4. Don dep cac file con sot o thu muc goc uploads/ ---")
    temp_dir = os.path.join(UPLOAD_DIR, "temp")
    os.makedirs(temp_dir, exist_ok=True)
    
    root_entries = os.listdir(UPLOAD_DIR)
    for entry in root_entries:
        full_entry_path = os.path.join(UPLOAD_DIR, entry)
        if os.path.isfile(full_entry_path):
            dest_temp_path = os.path.join(temp_dir, entry)
            print(f"Chuyen file le: {entry} -> temp/")
            shutil.move(full_entry_path, dest_temp_path)
            moved_files += 1

    # Clean empty old scene/ directory if all moved
    scene_legacy = os.path.join(UPLOAD_DIR, "scene")
    if os.path.isdir(scene_legacy) and not os.listdir(scene_legacy):
        try:
            os.rmdir(scene_legacy)
        except Exception:
            pass

    print(f"\n==========================================")
    print(f"[+] Hoan tat migration!")
    print(f"[+] So luong file da di chuyen: {moved_files}")
    print(f"[+] So luong ban ghi DB da cap nhat: {updated_records}")
    print(f"==========================================")

if __name__ == "__main__":
    run_migration()
