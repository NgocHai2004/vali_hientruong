from typing import Optional, List
from pydantic import BaseModel, Field

class CellIn(BaseModel):
    code: str = Field(default="", max_length=20)
    name: str = Field(min_length=1, max_length=100)
    capacity: int = Field(ge=0, le=500)
    note: str = ""
    level: str = Field(default="cell", pattern=r"^(facility|sub_camp|cell)$")
    parent: Optional[str] = None
    custody_type: Optional[str] = None


class DetaineeIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    alias: Optional[str] = Field(None, max_length=200)
    dob: Optional[str] = None
    gender: str = "male"
    cccd_number: Optional[str] = Field(None, pattern=r"^\d{12}$")
    personal_id: Optional[str] = Field(None, min_length=1, max_length=50)
    cmnd_old: Optional[str] = Field(None, max_length=20)
    nationality: Optional[str] = "Việt Nam"
    hometown: Optional[str] = None
    address: Optional[str] = None
    ethnicity: Optional[str] = None
    religion: Optional[str] = None
    temp_address: Optional[str] = None
    current_address: Optional[str] = None
    occupation: Optional[str] = None
    issued_date: Optional[str] = None
    expiry_date: Optional[str] = None
    issued_place: Optional[str] = None
    distinguishing_features: Optional[str] = None
    mrz: Optional[str] = None
    family: Optional[list[dict]] = None
    father_name: Optional[str] = None
    mother_name: Optional[str] = None
    case_about: Optional[str] = None
    charge_detail: Optional[str] = None
    arrest_date: Optional[str] = None
    arrest_agency: Optional[str] = None
    decision_no: Optional[str] = None
    scars: Optional[str] = None
    blood_type: Optional[str] = None
    face_shape: Optional[str] = None
    nose: Optional[str] = None
    ear_features: Optional[str] = None
    earlobe: Optional[str] = None
    physical_abnormalities: Optional[str] = None
    record_sheet_no: Optional[str] = None
    fp_sheet_no: Optional[str] = None
    record_times: Optional[str] = None
    record_date: Optional[str] = None
    ak_no: Optional[str] = None
    record_scope: Optional[str] = None
    height_cm: Optional[float] = Field(None, ge=50, le=250)
    weight_kg: Optional[float] = Field(None, ge=20, le=200)
    cell_code: Optional[str] = None
    custody_type: Optional[str] = None
    facility_code: Optional[str] = None
    sub_camp_code: Optional[str] = None
    charge: Optional[str] = None
    date_in: Optional[str] = None
    note: Optional[str] = None
    photo_url: Optional[str] = None
    photos: Optional[dict] = None
    case_id: Optional[str] = None


class TransferBody(BaseModel):
    cell_code: str


class MatchFingerprintReq(BaseModel):
    fingers: dict[str, str]


class MatchFingerprintSingleReq(BaseModel):
    template_b64: str
