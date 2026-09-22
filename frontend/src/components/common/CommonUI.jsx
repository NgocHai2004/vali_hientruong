import { useI18n } from "../../i18n";

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="page-header-actions">{children}</div>}
    </div>
  );
}

export function StateBox({ type = "", children }) {
  return (
    <div className={`state-box ${type ? `state-box-${type}` : ""}`}>
      {children}
    </div>
  );
}

export function InfoTile({ icon, label, value, action }) {
  return (
    <div className="info-tile">
      <span className="info-tile-icon">{icon}</span>
      <div className="info-tile-content">
        <span className="info-tile-label">{label}</span>
        <strong className="info-tile-value">{value}</strong>
      </div>
      {action && <div className="info-tile-action">{action}</div>}
    </div>
  );
}

export function FieldRow({ label, children }) {
  return (
    <label className="field-row">
      <span>{label}</span>
      {children}
    </label>
  );
}
