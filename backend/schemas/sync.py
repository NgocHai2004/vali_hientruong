from typing import Optional, List
from pydantic import BaseModel, Field

class SyncLogEntry(BaseModel):
    code: str = ""
    full_name: str = ""
    cccd_number: str = ""


class SyncLogBody(BaseModel):
    added: int = 0
    updated: int = 0
    duplicated: int = 0
    failed: int = 0
    added_items: List[SyncLogEntry] = Field(default_factory=list)
    updated_items: List[SyncLogEntry] = Field(default_factory=list)
    duplicate_items: List[SyncLogEntry] = Field(default_factory=list)
    failed_items: List[SyncLogEntry] = Field(default_factory=list)
    error: Optional[str] = None
    remote: Optional[str] = None
