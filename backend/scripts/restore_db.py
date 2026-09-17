"""
Script nạp/khôi phục toàn bộ dữ liệu MongoDB từ thư mục data_backup/.
"""
import os
import sys
from pymongo import MongoClient
from bson import json_util

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27018")
DB_NAME = os.getenv("DB_NAME", "app_cccd")

def restore_database():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    dump_dir = os.path.join(root_dir, "data_backup")

    if not os.path.isdir(dump_dir):
        print(f"[!] Thư mục {dump_dir} không tồn tại!")
        return

    print(f"[*] Đang nạp dữ liệu từ {dump_dir} vào database '{DB_NAME}' ({MONGO_URL})...")
    for filename in os.listdir(dump_dir):
        if not filename.endswith(".json"):
            continue
        col_name = filename[:-5]
        file_path = os.path.join(dump_dir, filename)
        with open(file_path, "r", encoding="utf-8") as f:
            docs = json_util.loads(f.read())
        
        if not docs:
            print(f"  - {col_name}: rỗng (0 documents)")
            continue
            
        col = db[col_name]
        col.delete_many({})  # Xóa dữ liệu cũ của collection
        col.insert_many(docs)
        print(f"  + {col_name}: đã nạp {len(docs)} documents")
    print("[✓] Hoàn thành nạp dữ liệu database!")

if __name__ == "__main__":
    restore_database()
