from typing import Optional
from pydantic import BaseModel, Field

class CaseIn(BaseModel):
    name: str = Field(default="", max_length=200)
    location: str = Field(default="", max_length=200)
    officer_name: Optional[str] = Field(default="", max_length=100)
    officer_rank: Optional[str] = Field(default="", max_length=50)
    note: str = Field(default="", max_length=500)
    occurred_at: Optional[str] = Field(default=None, max_length=40)


class CasePatch(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    location: Optional[str] = Field(default=None, max_length=200)
    officer_name: Optional[str] = Field(default=None, max_length=100)
    officer_rank: Optional[str] = Field(default=None, max_length=50)
    note: Optional[str] = Field(default=None, max_length=500)
    occurred_at: Optional[str] = Field(default=None, max_length=40)
    status: Optional[str] = Field(default=None, pattern=r"^(investigating|closed)$")
