from typing import Optional
from pydantic import BaseModel, Field

class SceneTracePatch(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)
    trace_type: Optional[str] = Field(default=None, max_length=100)
    collection_source: Optional[str] = Field(default=None, max_length=200)


class SceneReportGenerateRequest(BaseModel):
    case_id: Optional[str] = None
    scope: Optional[str] = "all"
    match_id: Optional[str] = None


class HbieConfigIn(BaseModel):
    match_threshold: int
    keep_score: int


class FingerprintConfigIn(BaseModel):
    by_finger: dict
