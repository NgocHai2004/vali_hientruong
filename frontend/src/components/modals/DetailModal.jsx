import React from "react";
import { useI18n } from "../../i18n";
import { InfoTile } from "../common/CommonUI";

export const DetailIcon = {
  cccd: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="12" r="2.2" /><path d="M14 10h5M14 14h5M6.5 16.2c.7-1.4 2-2 2.5-2s1.8.6 2.5 2" />
    </svg>
  ),
  dob: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" />
    </svg>
  ),
  gender: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="10" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  ),
  ethnic: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="3.2" /><circle cx="17" cy="10" r="2.6" /><path d="M3 20a6 6 0 0 1 12 0M14 20a5 5 0 0 1 8-1.3" />
    </svg>
  ),
  religion: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3c2 3 5 4 5 8a5 5 0 0 1-10 0c0-4 3-5 5-8z" /><path d="M9 21h6" />
    </svg>
  ),
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  flag: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" /><circle cx="12" cy="10" r="2.6" />
    </svg>
  ),
  door: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="18" rx="1" /><circle cx="15" cy="12" r="1" />
    </svg>
  ),
  scale: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18M4 21h16M6 8h12M6 8l-3 7a4 4 0 0 0 6 0zM18 8l-3 7a4 4 0 0 0 6 0z" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  ),
  note: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5M8 13h8M8 17h5" />
    </svg>
  ),
};

export function DetailModal({ detainee, onClose, onEdit }) {
  const { t, formatDate } = useI18n();
  const d = detainee;
  const dobText = formatDate(d.dob);
  const genderText = d.gender === "female" ? t("common.female") : t("common.male");
  const genderSymbol = d.gender === "female" ? "♀" : "♂";
  const avatar = d.photos?.cccd_front || d.photo_url || d.photos?.portrait_front;
  const editMissing = onEdit ? (
    <button className="info-tile-edit-btn" onClick={() => onEdit(d)} title={t("detainee.detail.edit_missing")}>
      {t("detainee.detail.edit_missing")}
    </button>
  ) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal detail-modal-v2" onClick={(e) => e.stopPropagation()}>
        <div className="detail-header">
          <div className="detail-header-left">
            <span className="detail-header-icon">{DetailIcon.cccd}</span>
            <div>
              <h3>{t("detainee.detail.title", { code: d.code || d.personal_id || "" })}</h3>
              <small>{t("detainee.detail.subtitle")}</small>
            </div>
          </div>
          <button className="detail-close" onClick={onClose} aria-label={t("detainee.detail.close_aria")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="detail-body">
          <aside className="detail-card detail-card-simple">
            <div className="detail-avatar">
              {avatar ? <img src={avatar} alt={d.full_name} /> : <span>{t("detainee.detail.no_photo")}</span>}
            </div>
            <div className="detail-name-row">
              <span className="detail-name">{d.full_name || "—"}</span>
            </div>
          </aside>

          {/* Hien thi 8 truong theo luoi 2 cot x 4 hang. */}
          <div className="detail-grid-v2 detail-grid-2x4">
            <InfoTile icon={DetailIcon.cccd} label={t("detainee.field.cccd")} value={d.cccd_number || "—"} />
            <InfoTile icon={DetailIcon.note} label={t("detainee.field.personal_id")} value={d.personal_id || "—"} />
            <InfoTile icon={DetailIcon.dob} label={t("detainee.field.dob")} value={dobText} />
            <InfoTile icon={DetailIcon.ethnic} label={t("detainee.field.ethnicity")} value={d.ethnicity || "Kinh"} action={!d.ethnicity ? editMissing : null} />
            <InfoTile icon={DetailIcon.gender} label={t("detainee.field.gender")} value={<span><b>{genderSymbol}</b> {genderText}</span>} />
            <InfoTile icon={DetailIcon.flag} label={t("detainee.field.nationality")} value={d.nationality || t("detainee.field.nationality_default")} action={!d.nationality ? editMissing : null} />
            <InfoTile icon={DetailIcon.pin} label={t("detainee.field.address")} value={d.address || "—"} />
            <InfoTile icon={DetailIcon.home} label={t("detainee.field.hometown")} value={d.hometown || "—"} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default DetailModal;
