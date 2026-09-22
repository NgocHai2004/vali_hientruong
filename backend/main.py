from __future__ import annotations
import os
import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from core.config import UPLOAD_DIR
from db.mongo import (
    init_db,
    close_db,
    client,
    _ensure_admin,
    _ensure_default_cells,
    _ensure_indexes,
)
from services.fp_quality import _load_fp_config, _push_fp_quality_safe
from services.hbie_matcher import _load_hbie_config

from routers import (
    auth,
    users,
    cells,
    cases,
    detainees,
    scene,
    config,
    stats,
    upload,
    proxy,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try:
        await _ensure_admin()
        await _ensure_default_cells()
        await _ensure_indexes()
        await _load_fp_config()
        await _load_hbie_config()
    except Exception:
        pass
    asyncio.create_task(_push_fp_quality_safe())
    yield
    close_db()


app = FastAPI(
    title="Thiết bị thu thập & quản lý căn cước nghi phạm",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class UploadStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        if os.path.basename(path).startswith("Bao_cao_doi_sanh_"):
            raise HTTPException(404, "Not found")
        return await super().get_response(path, scope)


app.mount("/uploads", UploadStaticFiles(directory=UPLOAD_DIR), name="uploads")

# Include all modular routers
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(cells.router)
app.include_router(cases.router)
app.include_router(detainees.router)
app.include_router(scene.router)
app.include_router(config.router)
app.include_router(stats.router)
app.include_router(upload.router)
app.include_router(proxy.router)
