import React, { useState, useEffect } from "react";
import { api } from "../../api";
import { notify } from "../../notifications";
import { useI18n } from "../../i18n";
import { PageHeader, StateBox } from "../../components/common/CommonUI";
import DetaineeForm from "../../DetaineeForm";
import DetailModal from "../../components/modals/DetailModal";

export function DetaineesPage({ onEdit }) {
  const { t, formatDate } = useI18n();
  const [items, setItems] = useState([]);
  const [cells, setCells] = useState([]);
  const [cases, setCases] = useState([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const [q, setQ] = useState("");
  const [gender, setGender] = useState("");
  const [caseId, setCaseId] = useState("");

  const limit = 10;

  const load = async (override = {}) => {
    setLoading(true);
    setError("");

    try {
      const currentSkip = override.skip !== undefined ? override.skip : skip;
      const currentQ = override.q !== undefined ? override.q : q;
      const currentGender = override.gender !== undefined ? override.gender : gender;
      const currentCaseId = override.caseId !== undefined ? override.caseId : caseId;

      const params = new URLSearchParams({
        skip: String(currentSkip),
        limit: String(limit),
      });
      if (currentQ.trim()) params.set("q", currentQ.trim());
      if (currentGender) params.set("gender", currentGender);
      if (currentCaseId) params.set("case_id", currentCaseId);

      const result = await api.request(`/api/detainees?${params}`);
      setItems(result.items || []);
      setTotal(result.total || 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api.listCells().then(setCells).catch(() => {});
    api.listCases({ limit: 200 }).then((r) => setCases(r.items || [])).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [skip, gender, caseId]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (skip !== 0) {
      setSkip(0);
    } else {
      load({ skip: 0 });
    }
  };

  const deleteItem = async (item) => {
    if (!window.confirm(t("detainee.confirm.delete", { code: item.code, name: item.full_name }))) return;
    try {
      await api.deleteDetainee(item.id);
      notify.add();
      load();
    } catch (e) {
      window.alert(t("common.error_prefix", { message: e.message }));
    }
  };

  const pages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(skip / limit) + 1;

  return (
    <div className="page">
      <PageHeader title={t("detainee.list.title")} subtitle={t("detainee.list.total", { n: total })} />

      <form className="filter-bar" onSubmit={handleSearchSubmit}>
        <input
          className="control search-control"
          placeholder={t("search.ph.text")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="control"
          value={caseId}
          onChange={(e) => {
            setCaseId(e.target.value);
            setSkip(0);
          }}
        >
          <option value="">{t("detainee.filter.case_all")}</option>
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || c.code || c.id}
            </option>
          ))}
        </select>
        <select
          className="control"
          value={gender}
          onChange={(e) => {
            setGender(e.target.value);
            setSkip(0);
          }}
        >
          <option value="">{t("search.gender.all")}</option>
          <option value="male">{t("search.gender.male")}</option>
          <option value="female">{t("search.gender.female")}</option>
        </select>
        <button className="button primary" type="submit" disabled={loading}>
          {loading ? t("common.loading") : t("search.submit")}
        </button>
      </form>

      <div className="detainees-table-wrap">
        <div className="detainees-table-scroll">
          {loading ? (
            <StateBox>{t("common.loading")}</StateBox>
          ) : error ? (
            <StateBox type="error">{error}</StateBox>
          ) : !items.length ? (
            <StateBox>{t("detainee.empty")}</StateBox>
          ) : (
            <table className="detainees-table detainees-table--even">
              <thead>
                <tr>
                  <th>{t("detainee.col.photo")}</th>
                  <th>{t("detainee.col.code")}</th>
                  <th>{t("detainee.col.charge")}</th>
                  <th>{t("detainee.col.name")}</th>
                  <th>{t("detainee.col.gender")}</th>
                  <th>{t("detainee.col.dob")}</th>
                  <th>{t("detainee.col.cccd")}</th>
                  <th style={{ textAlign: "center" }}>{t("detainee.col.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="table-avatar">
                        {item.photo_url ? (
                          <img src={item.photo_url} alt="" />
                        ) : (
                          (item.full_name || "?").slice(0, 1).toUpperCase()
                        )}
                      </div>
                    </td>
                    <td><strong>{item.personal_id || item.code}</strong></td>
                    <td>{item.charge || "-"}</td>
                    <td>{item.full_name}</td>
                    <td>{item.gender === "female" ? t("common.female") : t("common.male")}</td>
                    <td>{item.dob ? formatDate(item.dob) : "-"}</td>
                    <td>{item.cccd_number || "-"}</td>
                    <td>
                      <div className="row-actions" style={{ justifyContent: "center" }}>
                        <button onClick={() => setViewing(item)}>{t("detainee.action.view")}</button>
                        <button
                          onClick={async () => {
                            try {
                              const full = await api.getDetainee(item.id);
                              onEdit?.(full);
                            } catch {
                              onEdit?.(item);
                            }
                          }}
                        >{t("detainee.action.edit")}</button>
                        <button className="danger-text" onClick={() => deleteItem(item)}>{t("detainee.action.delete")}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="session-list-toolbar">
          <div className="session-list-total">{t("common.total", { n: total })}</div>
          <div className="pagination">
            <button disabled={!skip || loading} onClick={() => setSkip(Math.max(0, skip - limit))}>{t("common.prev")}</button>
            <span>{t("common.page_of", { page: currentPage, total: pages })}</span>
            <button disabled={currentPage >= pages || loading} onClick={() => setSkip(skip + limit)}>{t("common.next")}</button>
          </div>
        </div>
      </div>

      {showForm && (
        <DetaineeForm
          initial={editing}
          cells={cells}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            load();
          }}
        />
      )}

      {viewing && <DetailModal detainee={viewing} onClose={() => setViewing(null)} onEdit={onEdit} />}
    </div>
  );
}

export default DetaineesPage;
