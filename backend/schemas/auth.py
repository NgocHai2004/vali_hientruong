from typing import Optional
from pydantic import BaseModel, Field

class LoginResp(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    role: str = "admin"
    full_name: str = ""


class UserIn(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=r"^[a-zA-Z0-9_.\-]+$")
    password: str = Field(min_length=6, max_length=100)
    role: str = Field(default="user", pattern=r"^(admin|user)$")
    full_name: str = Field(min_length=1, max_length=100)


class UserPatch(BaseModel):
    password: Optional[str] = Field(None, min_length=6, max_length=100)
    role: Optional[str] = Field(None, pattern=r"^(admin|user)$")
    full_name: Optional[str] = Field(None, min_length=1, max_length=100)


class MePatch(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=100)
    password: Optional[str] = Field(None, min_length=6, max_length=100)
    current_password: Optional[str] = Field(None, min_length=1, max_length=100)
