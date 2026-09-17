"""
Script xuất toàn bộ dữ liệu MongoDB sang thư mục data_backup/ dạng JSON chuẩn BSON.
"""
import os
import sys
from pymongo import MongoClient
from bson import json_util

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27018")
DB_NAME = os.getenv("DB_NAME", "app_cccd")

def dump_database():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    dump_dir = os.path.join(root_dir, "data_backup")
    os.makedirs(dump_dir, exist_ok=True)

    print(f"[*] Đang xuất database '{DB_NAME}' từ {MONGO_URL} sang {dump_dir}...")
    for col_name in db.list_collection_names():
        if col_name.startswith("system."):
            continue
        docs = list(db[col_name].find())
        file_path = os.path.join(dump_dir, f"{col_name}.json")
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(json_util.dumps(docs, indent=2, ensure_ascii=False))
        print(f"  + {col_name}: {len(docs)} documents -> {col_name}.json")
    print("[✓] Hoàn thành xuất database!")

if __name__ == "__main__":
    dump_database()
