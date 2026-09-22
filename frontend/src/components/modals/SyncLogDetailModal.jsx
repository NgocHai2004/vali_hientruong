import React from "react";
import { useI18n } from "../../i18n";

export function SyncLogDetailModal({ log, onClose }) {
  const { t, formatDateTime } = useI18n();
  const d = log?.data || {};
  const officer = log?.officer || {};
  const items = {
    added: Array.isArray(d.added_items) ? d.added_items : [],
    updated: Array.isArray(d.updated_items) ? d.updated_items : [],
    duplicated: Array.isArray(d.duplicate_items) ? d.duplicate_items : [],
    failed: Array.isArray(d.failed_items) ? d.failed_items : [],
  };
  const counts = {
    added: Number(d.added || 0),
    updated: Number(d.updated || 0),
    duplicated: Number(d.duplicated || 0),
    failed: Number(d.failed || 0),
  };

  const List = ({ title, tone, list }) => (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span
          className={`status-badge ${tone}`}
          style={{ minWidth: 26, textAlign: "center" }}
        >{list.length}</span>
        <strong style={{ fontSize: 13 }}>{title}</strong>
      </div>
      {list.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 12, paddingLeft: 8 }}>—</div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
          {list.map((x, i) => (
            <li key={i} style={{
              display: "grid",
              gridTemplateColumns: "92px 1fr 168px",
              gap: 10,
              alignItems: "baseline",
            }}>
              <span className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.code || "—"}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.full_name || ""}</span>
              <span className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.cccd_number ? `CCCD ${x.cccd_number}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h3>{t("logs.sync.title")}</h3>
          <button onClick={onClose}>×</button>
        </div>
        <div className="form" style={{ paddingTop: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 13 }}>
            <div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{t("logs.col.time")}</div>
              <div>{formatDateTime(log?.at)}</div>
            </div>
            <div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{t("logs.col.officer")}</div>
              <div><strong>{officer.full_name || log?.actor}</strong> {officer.full_name ? <small style={{ color: "var(--muted)" }}>@{log?.actor}</small> : null}</div>
            </div>
            <div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{t("logs.col.case")}</div>
              <div className="mono">{log?.case?.code || log?.ref || "—"}</div>
            </div>
          </div>

          <div style={{
            marginTop: 14,
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10,
          }}>
            <div className="report-stat blue" style={{ padding: 12 }}>
              <div className="report-stat-body">
                <span className="report-stat-label">{t("logs.sync.added")}</span>
                <strong className="report-stat-value">{counts.added}</strong>
              </div>
            </div>
            <div className="report-stat orange" style={{ padding: 12 }}>
              <div className="report-stat-body">
                <span className="report-stat-label">{t("logs.sync.updated")}</span>
                <strong className="report-stat-value">{counts.updated}</strong>
              </div>
            </div>
            <div className="report-stat purple" style={{ padding: 12 }}>
              <div className="report-stat-body">
                <span className="report-stat-label">{t("logs.sync.duplicated")}</span>
                <strong className="report-stat-value">{counts.duplicated}</strong>
              </div>
            </div>
            <div className="report-stat green" style={{ padding: 12 }}>
              <div className="report-stat-body">
                <span className="report-stat-label">{t("logs.sync.failed")}</span>
                <strong className="report-stat-value">{counts.failed}</strong>
              </div>
            </div>
          </div>

          {d.error && (
            <div className="error-box" style={{ marginTop: 12 }}>
              {t("logs.sync.error_prefix")} {d.error}
            </div>
          )}

          <List title={t("logs.sync.added_list")} tone="create" list={items.added} />
          <List title={t("logs.sync.updated_list")} tone="update" list={items.updated} />
          <List title={t("logs.sync.duplicated_list")} tone="delete" list={items.duplicated} />
          {items.failed.length > 0 && (
            <List title={t("logs.sync.failed_list")} tone="delete" list={items.failed} />
          )}

          <div className="modal-actions" style={{ marginTop: 14 }}>
            <button type="button" className="button primary" onClick={onClose}>{t("common.close")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SyncLogDetailModal;
