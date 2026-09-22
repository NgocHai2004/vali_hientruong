import React, { useState, useEffect, useMemo } from "react";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { StateBox } from "../../components/common/CommonUI";
import DetailModal from "../../components/modals/DetailModal";
import SyncLogDetailModal from "../../components/modals/SyncLogDetailModal";

const Icon = {
  file: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></svg>
  ),
  sync: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6v5h-5M4 18v-5h5" /><path d="M6.1 9A7 7 0 0 1 18 6l2 5M4 13l2 5a7 7 0 0 0 11.9-3" /></svg>
  ),
  log: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  ),
  cloudUpload: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 18a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.34 8.05 4.5 4.5 0 0 0 7 18" /><path d="m8 14 4-4 4 4M12 10v9" /></svg>
  ),
};

function ReportStat({ tone, icon, label, value, note }) {
  return (
    <div className={`report-stat ${tone}`}>
      <div className="report-stat-icon">{icon}</div>
      <div className="report-stat-body">
        <span className="report-stat-label">{label}</span>
        <strong className="report-stat-value">{value}</strong>
        <small className="report-stat-note">{note}</small>
      </div>
    </div>
  );
}

export function DetaineeHistoryView({ onEdit }) {
  const { t, formatDateTime } = useI18n();
  const [logs, setLogs] = useState([]);
  const [counts, setCounts] = useState({ create: 0, update: 0, delete: 0, import: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [q, setQ] = useState("");
  const [viewing, setViewing] = useState(null);
  const [busyRef, setBusyRef] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeOk, setNoticeOk] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const load = async () => {
    setLoading(true);
    try {
      const params = { resource: "detainee" };
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (actionFilter) params.action = actionFilter;
      const res = await api.listLogs(params);
      setLogs(res.items || []);
      setCounts(res.counts || { create: 0, update: 0, delete: 0, import: 0 });
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { setPage(1); }, [q, dateFrom, dateTo, actionFilter, logs]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return logs;
    return logs.filter((l) => {
      const officer = l.officer || {};
      return (
        (l.ref || "").toLowerCase().includes(kw) ||
        (l.actor || "").toLowerCase().includes(kw) ||
        (officer.full_name || "").toLowerCase().includes(kw) ||
        (l.case && (l.case.code || "").toLowerCase().includes(kw))
      );
    });
  }, [logs, q]);
  const totalRows = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const pagedLogs = filtered.slice((page - 1) * pageSize, page * pageSize);

  const labels = {
    create: t("history.action.create"),
    update: t("history.action.update"),
    delete: t("history.action.delete"),
    import: t("history.action.import"),
  };

  const resolveDetainee = async (log) => {
    if (log.ref_id) {
      try { return await api.getDetainee(log.ref_id); } catch { /* fallback */ }
    }
    if (log.ref) return await api.getDetaineeByPersonalId(log.ref);
    throw new Error(t("logs.err.no_ref"));
  };

  const onView = async (log) => {
    setBusyRef(log.id);
    setNotice("");
    try {
      const d = await resolveDetainee(log);
      setViewing(d);
    } catch (e) {
      setNotice(t("logs.err.open", { message: e.message }));
      setNoticeOk(false);
    } finally {
      setBusyRef("");
    }
  };

  const onEditLog = async (log) => {
    setBusyRef(log.id);
    setNotice("");
    try {
      const d = await resolveDetainee(log);
      if (onEdit) onEdit(d);
    } catch (e) {
      setNotice(t("logs.err.open", { message: e.message }));
      setNoticeOk(false);
    } finally {
      setBusyRef("");
    }
  };

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setActionFilter("");
    setQ("");
  };

  const isActable = (log) => (log.ref || log.ref_id) && log.action !== "delete";

  return (
    <>
      <div className="report-fixed" style={{ paddingTop: 0 }}>
        <div className="report-stat-grid">
          <ReportStat tone="blue" icon={Icon.file} label={t("history.action.create")} value={counts.create || 0} note={t("history.stat.note.create")} />
          <ReportStat tone="orange" icon={Icon.sync} label={t("logs.stat.update")} value={counts.update || 0} note={t("logs.stat.note.update")} />
          <ReportStat tone="purple" icon={Icon.log} label={t("logs.stat.delete")} value={counts.delete || 0} note={t("logs.stat.note.delete")} />
          <ReportStat tone="green" icon={Icon.cloudUpload} label={t("history.action.import")} value={counts.import || 0} note={t("logs.stat.note.import")} />
        </div>

        <form
          className="report-filter"
          onSubmit={(e) => { e.preventDefault(); load(); }}
        >
          <div className="report-filter-head">
            <span className="report-filter-title">{t("history.filter.title")}</span>
            <span className="report-filter-hint">{t("history.filter.desc")}</span>
          </div>
          <div className="report-filter-grid">
            <label className="report-field">
              <span>{t("common.from")}</span>
              <input className="control" type="datetime-local"
                value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="report-field">
              <span>{t("common.to")}</span>
              <input className="control" type="datetime-local"
                value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <label className="report-field">
              <span>{t("logs.field.action")}</span>
              <select className="control" value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}>
                <option value="">{t("common.all")}</option>
                <option value="create">{t("history.action.create")}</option>
                <option value="update">{t("history.action.update")}</option>
                <option value="delete">{t("history.action.delete")}</option>
                <option value="import">{t("history.action.import")}</option>
              </select>
            </label>
            <label className="report-field">
              <span>{t("common.keyword")}</span>
              <input
                className="control"
                type="text"
                placeholder={t("history.search_ph")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <div className="report-filter-actions report-filter-actions-inline">
              <button type="button" className="button secondary" onClick={clearFilters}>{t("common.clear_filter")}</button>
              <button type="submit" className="button primary" disabled={loading}>
                {loading ? t("common.applying") : t("common.apply")}
              </button>
            </div>
          </div>
        </form>

        {error && <StateBox type="error">{error}</StateBox>}
        {notice && <div className={noticeOk ? "success-box" : "error-box"}>{notice}</div>}
      </div>

      <div className="report-scroll">
        <div className="detainees-table-wrap">
          <div className="detainees-table-scroll">
            <table className="detainees-table">
              <thead>
                <tr>
                  <th style={{ width: "12%" }}>{t("logs.col.time")}</th>
                  <th style={{ width: "13%" }}>{t("logs.col.case")}</th>
                  <th style={{ width: "18%" }}>{t("logs.col.officer")}</th>
                  <th style={{ width: "11%" }}>{t("logs.col.action")}</th>
                  <th style={{ width: "12%" }}>{t("history.col.code")}</th>
                  <th style={{ width: "12%" }}>{t("logs.col.detainee_name")}</th>
                  <th style={{ width: "12%" }}>{t("logs.col.detainee_cccd")}</th>
                  <th style={{ width: "10%" }}>{t("logs.col.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {pagedLogs.map((log) => {
                  const busy = busyRef === log.id;
                  const officer = log.officer || {};
                  const initials = ((officer.full_name || officer.username || log.actor || "?").trim()[0] || "?").toUpperCase();
                  const canAct = isActable(log);
                  return (
                    <tr key={log.id}>
                      <td>{formatDateTime(log.at)}</td>
                      <td>
                        {log.case ? (
                          <span className="case-code-chip">
                            <span className={`badge ${log.case.status === "investigating" ? "badge-open" : "badge-closed"}`}>
                              {log.case.status === "investigating" ? "●" : "✓"}
                            </span>
                            <span className="mono">{log.case.code}</span>
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td>
                        <div className="officer-cell">
                          {officer.avatar_url ? (
                            <img className="officer-avatar" src={officer.avatar_url} alt="" />
                          ) : (
                            <span className="officer-avatar officer-avatar-fallback">{initials}</span>
                          )}
                          <div className="officer-name">
                            <strong>{officer.full_name || log.actor}</strong>
                            {officer.full_name ? <small>@{log.actor}</small> : null}
                          </div>
                        </div>
                      </td>
                      <td><span className={`status-badge ${log.action}`}>{labels[log.action] || log.action}</span></td>
                      <td>{log.ref || "—"}</td>
                      <td>{log.detainee?.full_name || log.data?.full_name || "—"}</td>
                      <td>{log.detainee?.cccd_number || "—"}</td>
                      <td>
                        {canAct ? (
                          <div className="row-actions">
                            <button disabled={busy} onClick={() => onView(log)}>{t("common.view")}</button>
                            {onEdit && (
                              <button disabled={busy} onClick={() => onEditLog(log)}>{t("history.open_edit")}</button>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!pagedLogs.length && (
                  <tr><td colSpan={8}><div className="empty">{t("common.empty")}</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="session-list-toolbar">
            <div className="session-list-total">{t("common.total", { n: totalRows })}</div>
            <div className="pagination">
              <button disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>{t("common.prev")}</button>
              <span>{t("common.page_of", { page, total: totalPages })}</span>
              <button disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>{t("common.next")}</button>
            </div>
          </div>
        </div>
      </div>

      {viewing && <DetailModal detainee={viewing} onClose={() => setViewing(null)} onEdit={onEdit} />}
    </>
  );
}

export function SyncHistoryView() {
  const { t, formatDateTime } = useI18n();
  const [logs, setLogs] = useState([]);
  const [counts, setCounts] = useState({ sync: 0 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [caseFilter, setCaseFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [users, setUsers] = useState([]);
  const [syncViewing, setSyncViewing] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = { action: "sync", resource: "case" };
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (caseFilter.trim()) params.case_code = caseFilter.trim();
      if (actorFilter) params.actor = actorFilter;
      const res = await api.listLogs(params);
      setLogs(res.items || []);
      setCounts(res.counts || { sync: 0 });
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    api.listUsers().then(setUsers).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setCaseFilter("");
    setActorFilter("");
  };

  return (
    <>
      <div className="report-fixed" style={{ paddingTop: 0 }}>
        <div className="report-stat-grid">
          <ReportStat tone="orange" icon={Icon.sync} label={t("logs.stat.sync_total")} value={counts.sync || 0} note={t("logs.stat.note.sync")} />
        </div>

        <form
          className="report-filter"
          onSubmit={(e) => { e.preventDefault(); load(); }}
        >
          <div className="report-filter-head">
            <span className="report-filter-title">{t("logs.filter.title")}</span>
            <span className="report-filter-hint">{t("logs.filter.desc")}</span>
          </div>
          <div className="report-filter-grid">
            <label className="report-field">
              <span>{t("common.from")}</span>
              <input
                className="control"
                type="datetime-local"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label className="report-field">
              <span>{t("common.to")}</span>
              <input
                className="control"
                type="datetime-local"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
            <label className="report-field">
              <span>{t("logs.field.case")}</span>
              <input
                className="control"
                type="text"
                placeholder={t("logs.field.case_ph")}
                value={caseFilter}
                onChange={(e) => setCaseFilter(e.target.value)}
              />
            </label>
            <label className="report-field">
              <span>{t("logs.field.officer")}</span>
              <select className="control" value={actorFilter} onChange={(e) => setActorFilter(e.target.value)}>
                <option value="">{t("logs.field.officer_all")}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.username}>
                    {u.full_name ? `${u.full_name} (@${u.username})` : u.username}
                  </option>
                ))}
              </select>
            </label>
            <div className="report-filter-actions report-filter-actions-inline">
              <button type="button" className="button secondary" onClick={clearFilters}>{t("common.clear_filter")}</button>
              <button type="submit" className="button primary" disabled={loading}>
                {loading ? t("common.applying") : t("common.apply")}
              </button>
            </div>
          </div>
        </form>

        {error && <StateBox type="error">{error}</StateBox>}
      </div>

      <div className="report-scroll">
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th style={{ width: "18%" }}>{t("logs.col.time")}</th>
                <th style={{ width: "16%" }}>{t("logs.col.case")}</th>
                <th style={{ width: "22%" }}>{t("logs.col.officer")}</th>
                <th style={{ width: "32%" }}>{t("logs.sync.result")}</th>
                <th style={{ width: "12%" }}>{t("logs.col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const officer = log.officer || {};
                const initials = ((officer.full_name || officer.username || log.actor || "?").trim()[0] || "?").toUpperCase();
                const d = log.data || {};
                return (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.at)}</td>
                    <td>
                      {log.case ? (
                        <span className="case-code-chip">
                          <span className={`badge ${log.case.status === "investigating" ? "badge-open" : "badge-closed"}`}>
                            {log.case.status === "investigating" ? "●" : "✓"}
                          </span>
                          <span className="mono">{log.case.code}</span>
                        </span>
                      ) : (
                        <span className="mono">{log.ref || "—"}</span>
                      )}
                    </td>
                    <td>
                      <div className="officer-cell">
                        {officer.avatar_url ? (
                          <img className="officer-avatar" src={officer.avatar_url} alt="" />
                        ) : (
                          <span className="officer-avatar officer-avatar-fallback">{initials}</span>
                        )}
                        <div className="officer-name">
                          <strong>{officer.full_name || log.actor}</strong>
                          {officer.full_name ? <small>@{log.actor}</small> : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12 }}>
                        <span className="status-badge create">{t("logs.sync.added")}: {d.added || 0}</span>
                        <span className="status-badge update">{t("logs.sync.updated")}: {d.updated || 0}</span>
                        <span className="status-badge delete">{t("logs.sync.duplicated")}: {d.duplicated || 0}</span>
                        {Number(d.failed || 0) > 0 && (
                          <span className="status-badge delete">{t("logs.sync.failed")}: {d.failed}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button onClick={() => setSyncViewing(log)}>{t("common.view")}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!logs.length && (
                <tr><td colSpan={5}><div className="empty">{t("common.empty")}</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {syncViewing && <SyncLogDetailModal log={syncViewing} onClose={() => setSyncViewing(null)} />}
    </>
  );
}

export function HistoryPage({ onEdit, initialTab = "detainee" }) {
  const { t } = useI18n();
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="page report-page">
      <div className="report-fixed">
        <div className="page-header" style={{ alignItems: "center", gap: 16 }}>
          <div>
            <h1>{t("history.title")}</h1>
            <p>{tab === "detainee" ? t("history.subtitle") : t("logs.subtitle_sync")}</p>
          </div>
          <div className="page-header-actions" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="scp-seg" role="tablist" aria-label={t("history.title")}>
              <button
                type="button"
                className={tab === "detainee" ? "active" : ""}
                onClick={() => setTab("detainee")}
                role="tab"
                aria-selected={tab === "detainee"}
              >
                {t("history.tab.detainee")}
              </button>
              <button
                type="button"
                className={tab === "sync" ? "active" : ""}
                onClick={() => setTab("sync")}
                role="tab"
                aria-selected={tab === "sync"}
              >
                {t("history.tab.sync")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {tab === "detainee" ? (
        <DetaineeHistoryView onEdit={onEdit} />
      ) : (
        <SyncHistoryView />
      )}
    </div>
  );
}

export default HistoryPage;
