import React, { useState, useEffect } from "react";
import { api } from "../../api";
import { notify } from "../../notifications";
import { useI18n } from "../../i18n";
import { PageHeader } from "../../components/common/CommonUI";
import SyncDiffModal, { buildSyncDiff } from "../../SyncDiffModal";

export function SyncPage() {
  const { t, formatDateTime } = useI18n();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [syncingIds, setSyncingIds] = useState(() => new Set());
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const r = await api.listCases(params);
      setCases(r.items || []);
    } catch (e) {
      setError(e.message);
      setCases([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);
  useEffect(() => { setPage(1); }, [statusFilter, q]);

  const filtered = cases.filter((c) => {
    if (!q.trim()) return true;
    const kw = q.trim().toLowerCase();
    return (
      (c.code || "").toLowerCase().includes(kw) ||
      (c.name || "").toLowerCase().includes(kw) ||
      (c.location || "").toLowerCase().includes(kw)
    );
  });
  const totalRows = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const pagedRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const allChecked = filtered.length > 0 && filtered.every((s) => selected.has(s.id));
  const toggleOne = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(filtered.map((s) => s.id)));
  };

  const [syncErrors, setSyncErrors] = useState({});
  const [syncSuccess, setSyncSuccess] = useState({});
  const [diffState, setDiffState] = useState(null); // { caseDoc, loading, diff }

  const REMOTE = "/api/proxy"; // proxy qua backend de tranh CORS

  const uploadPhoto = async (url) => {
    if (!url) return "";
    try {
      const absUrl = url.startsWith("http") ? url : url;
      const imgRes = await fetch(absUrl);
      if (!imgRes.ok) return "";
      const blob = await imgRes.blob();
      const ext = blob.type.includes("png") ? "png" : "jpg";
      const form = new FormData();
      form.append("file", blob, `photo.${ext}`);
      const j = await api.request(`${REMOTE}/upload-image`, { method: "POST", body: form });
      return j.url || "";
    } catch { return ""; }
  };

  const loadCaseDetainees = async (caseId) => {
    const detail = await api.getCase(caseId);
    return Promise.all(
      (detail.detainees || []).map((d) => api.getDetainee(d.id).catch(() => d))
    );
  };

  const mapOneToPayload = async (d) => {
    const p = d.photos || {};
    const keys = ["cccd_front", "cccd_back", "portrait_front", "portrait_left", "portrait_right",
      "fp_l1", "fp_l2", "fp_l3", "fp_l4", "fp_l5",
      "fp_r1", "fp_r2", "fp_r3", "fp_r4", "fp_r5",
      "iris_left", "iris_right"];
    const source = {
      cccd_front: p.cccd_front,
      cccd_back: p.cccd_back,
      portrait_front: p.portrait_front || d.photo_url,
      portrait_left: p.portrait_left,
      portrait_right: p.portrait_right,
      fp_l1: p.fp_l1, fp_l2: p.fp_l2, fp_l3: p.fp_l3, fp_l4: p.fp_l4, fp_l5: p.fp_l5,
      fp_r1: p.fp_r1, fp_r2: p.fp_r2, fp_r3: p.fp_r3, fp_r4: p.fp_r4, fp_r5: p.fp_r5,
      iris_left: p.iris_left, iris_right: p.iris_right,
    };
    const uploaded = {};
    await Promise.all(keys.map(async (k) => {
      const url = await uploadPhoto(source[k]);
      uploaded[k] = url || null;
    }));
    return {
      personal_id: d.personal_id || d.code || null,
      full_name: d.full_name || null,
      dob: d.dob || null,
      gender: d.gender || null,
      cccd_number: d.cccd_number || null,
      cmnd_old: d.cmnd_old || null,
      nationality: d.nationality || null,
      ethnicity: d.ethnicity || null,
      religion: d.religion || null,
      hometown: d.hometown || null,
      address: d.address || null,
      issued_date: d.issued_date || null,
      expiry_date: d.expiry_date || null,
      issued_place: d.issued_place || null,
      distinguishing_features: d.distinguishing_features || null,
      mrz: d.mrz || null,
      height_cm: d.height_cm || null,
      weight_kg: d.weight_kg || null,
      cell_code: d.cell_code || null,
      custody_type: d.custody_type || null,
      facility_code: d.facility_code || null,
      sub_camp_code: d.sub_camp_code || null,
      charge: d.charge || null,
      date_in: d.date_in || null,
      note: d.note || null,
      created_by: d.created_by || null,
      photos: uploaded,
    };
  };

  const prepareSync = async (caseDoc) => {
    setSyncErrors((prev) => { const n = { ...prev }; delete n[caseDoc.id]; return n; });
    setSyncSuccess((prev) => { const n = { ...prev }; delete n[caseDoc.id]; return n; });
    setDiffState({ caseDoc, loading: true, diff: null });
    try {
      const [localDetainees, remoteResp] = await Promise.all([
        loadCaseDetainees(caseDoc.id),
        api.request(`${REMOTE}/pham-nhan`),
      ]);
      const remoteList = Array.isArray(remoteResp?.data) ? remoteResp.data : [];
      const diff = buildSyncDiff(localDetainees, remoteList);
      setDiffState({ caseDoc, loading: false, diff });
    } catch (e) {
      setDiffState(null);
      setSyncErrors((prev) => ({ ...prev, [caseDoc.id]: e.message }));
    }
  };

  const doSync = async (selectedTargets) => {
    const caseDoc = diffState?.caseDoc;
    const diff = diffState?.diff;
    if (!caseDoc || !selectedTargets.length) {
      setDiffState(null);
      return;
    }
    setDiffState(null);
    setSyncingIds((prev) => new Set(prev).add(caseDoc.id));
    const pickEntry = (x) => ({
      code: x.code || "",
      full_name: x.full_name || "",
      cccd_number: x.cccd_number || "",
    });
    const addSel = selectedTargets.filter((x) => (diff?.toAdd || []).some((a) => a.id === x.id));
    const updSel = selectedTargets.filter((x) => (diff?.toUpdate || []).some((u) => u.id === x.id));
    try {
      const mappedDetainees = await Promise.all(selectedTargets.map((t) => mapOneToPayload(t.local)));
      const payload = {
        total: mappedDetainees.length,
        items: [{
          id: caseDoc.code || caseDoc.id || null,
          name: caseDoc.name || null,
          location: caseDoc.location || null,
          occurred_at: caseDoc.occurred_at || null,
          closed_at: caseDoc.closed_at || null,
          detainees: mappedDetainees,
        }],
      };
      await api.request(`${REMOTE}/sync-detainee`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setSyncSuccess((prev) => ({ ...prev, [caseDoc.id]: true }));
      notify.add();
      try {
        await api.logCaseSync(caseDoc.id, {
          added: addSel.length,
          updated: updSel.length,
          duplicated: (diff?.duplicates || []).length,
          failed: 0,
          added_items: addSel.map(pickEntry),
          updated_items: updSel.map(pickEntry),
          duplicate_items: (diff?.duplicates || []).map(pickEntry),
          failed_items: [],
        });
      } catch { /* log-only */ }
    } catch (e) {
      setSyncErrors((prev) => ({ ...prev, [caseDoc.id]: e.message }));
      try {
        await api.logCaseSync(caseDoc.id, {
          added: 0,
          updated: 0,
          duplicated: (diff?.duplicates || []).length,
          failed: addSel.length + updSel.length,
          added_items: [],
          updated_items: [],
          duplicate_items: (diff?.duplicates || []).map(pickEntry),
          failed_items: [...addSel, ...updSel].map(pickEntry),
          error: e.message,
        });
      } catch { /* noop */ }
    } finally {
      setSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(caseDoc.id);
        return next;
      });
    }
  };

  const syncSelected = async () => {
    const targets = filtered.filter((c) => selected.has(c.id));
    for (const c of targets) {
      await prepareSync(c);
      break;
    }
  };

  const fmtDT = (iso) => formatDateTime(iso);

  return (
    <div className="page">
      <PageHeader title={t("nav.sync")} subtitle={t("sync.subtitle")} />

      <div className="sync-toolbar">
        <input
          className="control sync-search"
          placeholder={t("sync.search_ph")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">{t("sync.status.all")}</option>
          <option value="investigating">{t("case.status.investigating")}</option>
          <option value="closed">{t("case.status.closed")}</option>
        </select>
        <button className="button" onClick={load} disabled={loading}>{loading ? t("sync.loading") : t("common.refresh")}</button>
        <div className="sync-toolbar-spacer" />
        <button
          className="button primary"
          disabled={selected.size === 0 || syncingIds.size > 0}
          onClick={syncSelected}
          title={selected.size === 0 ? t("sync.tip.select") : t("sync.tip.selected", { n: selected.size })}
        >
          {selected.size > 0 ? t("sync.action_count", { n: selected.size }) : t("sync.action")}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="sync-table-wrap">
        <div className="sync-table-scroll">
          <table className="sync-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label={t("sync.select_all_aria")} />
                </th>
                <th>{t("sync.col.code")}</th>
                <th>{t("sync.col.status")}</th>
                <th>{t("case.col.case")}</th>
                <th>{t("sync.col.location")}</th>
                <th>{t("case.col.occurred_at")}</th>
                <th>{t("sync.col.closed")}</th>
                <th style={{ textAlign: "center" }}>{t("sync.col.count")}</th>
                <th style={{ width: 140 }}>{t("sync.col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.length === 0 && !loading && (
                <tr><td colSpan={9} className="sync-empty">{t("sync.empty")}</td></tr>
              )}
              {pagedRows.map((c) => {
                const busy = syncingIds.has(c.id);
                const open = c.status === "investigating";
                return (
                  <tr key={c.id} className={selected.has(c.id) ? "row-selected" : ""}>
                    <td><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} /></td>
                    <td><strong>{c.code}</strong></td>
                    <td>
                      <span className={"sync-badge " + (open ? "open" : "closed")}>
                        {t(open ? "case.status.investigating" : "case.status.closed")}
                      </span>
                    </td>
                    <td>{c.name || t("case.no_name")}</td>
                    <td>{c.location || "—"}</td>
                    <td>{fmtDT(c.occurred_at)}</td>
                    <td>{fmtDT(c.closed_at)}</td>
                    <td style={{ textAlign: "center" }}>{c.detainee_count || 0}</td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <button className="button small" disabled={busy} onClick={() => prepareSync(c)}>
                          {busy ? t("sync.syncing") : t("sync.action")}
                        </button>
                        {syncErrors[c.id] && (
                          <span style={{ fontSize: 11, color: "#e53e3e" }}>{t("sync.err_prefix", { message: syncErrors[c.id] })}</span>
                        )}
                        {syncSuccess[c.id] && !syncErrors[c.id] && (
                          <span style={{ fontSize: 11, color: "#12af64" }}>{t("sync.success")}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
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

      {diffState && (
        <SyncDiffModal
          caseDoc={diffState.caseDoc}
          diff={diffState.diff}
          loading={diffState.loading}
          onConfirm={doSync}
          onCancel={() => setDiffState(null)}
        />
      )}
    </div>
  );
}

export default SyncPage;
