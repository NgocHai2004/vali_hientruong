import React, { useState, useEffect } from "react";
import { api } from "../../api";
import { useI18n } from "../../i18n";

export function CrossCaseCompareModal({
  open = true,
  onClose,
  currentCaseId,
  currentCaseCode,
  initialSelectedCaseIds = [],
  onConfirm,
}) {
  const { t, formatDateTime } = useI18n();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set(initialSelectedCaseIds));

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set(initialSelectedCaseIds));
    setLoading(true);
    setError("");
    api.listCases({ limit: 200 })
      .then((res) => {
        const all = res?.items || [];
        const others = all.filter((c) => String(c.id) !== String(currentCaseId) && String(c._id) !== String(currentCaseId));
        setCases(others);
      })
      .catch((err) => {
        setError(err.message || "Không thể tải danh sách vụ án");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, currentCaseId, initialSelectedCaseIds]);

  if (!open) return null;

  const filteredCases = cases.filter((c) => {
    if (!search.trim()) return true;
    const kw = search.trim().toLowerCase();
    return (
      (c.code || "").toLowerCase().includes(kw) ||
      (c.name || "").toLowerCase().includes(kw) ||
      (c.location || "").toLowerCase().includes(kw) ||
      (c.officer_name || "").toLowerCase().includes(kw)
    );
  });

  const toggleCase = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    const allSelected = filteredCases.every((c) => selectedIds.has(c.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredCases.forEach((c) => {
        if (allSelected) {
          next.delete(c.id);
        } else {
          next.add(c.id);
        }
      });
      return next;
    });
  };

  const handleConfirm = () => {
    const ids = Array.from(selectedIds);
    const chosenCases = cases.filter((c) => selectedIds.has(c.id));
    onConfirm(ids, chosenCases);
  };

  const selectedCount = selectedIds.size;
  const totalDetaineesChosen = cases
    .filter((c) => selectedIds.has(c.id))
    .reduce((sum, c) => sum + (c.detainee_count || 0), 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cross-case-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="modal-header">
          <div>
            <h3>{t("smp.cross_case.title") || "Thêm vụ án đối sánh mở rộng"}</h3>
            <small style={{ color: "var(--muted)", display: "block", marginTop: 2 }}>
              {t("smp.cross_case.current_case") || "Vụ án đang xử lý"}: <strong>{currentCaseCode || currentCaseId}</strong>
            </small>
          </div>
          <button type="button" className="close-x" onClick={onClose} aria-label={t("common.close")}>×</button>
        </div>

        <div className="form" style={{ paddingTop: 6, gap: 12 }}>
          <div className="info-box" style={{ margin: 0, padding: "8px 12px", fontSize: 13, background: "rgba(53, 216, 255, 0.08)", border: "1px solid rgba(53, 216, 255, 0.22)", borderRadius: 8 }}>
            {t("smp.cross_case.hint") || "Dữ liệu nghi phạm từ các vụ án được chọn chỉ dùng để so khớp tạm thời, KHÔNG chuyển đối tượng vào vụ án này."}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type="text"
              className="control"
              placeholder={t("smp.cross_case.search_ph") || "Tìm theo mã vụ án, tên vụ, địa điểm..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1 }}
            />
            {filteredCases.length > 0 && (
              <button type="button" className="button secondary" onClick={selectAllFiltered} style={{ whiteSpace: "nowrap" }}>
                {filteredCases.every((c) => selectedIds.has(c.id))
                  ? (t("common.uncheck_all") || "Bỏ chọn tất cả")
                  : (t("common.select_all") || "Chọn tất cả")}
              </button>
            )}
          </div>

          {error && <div className="error-box">{error}</div>}

          <div style={{
            maxHeight: 340,
            overflowY: "auto",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "4px 8px",
            background: "var(--bg-deep, rgba(4, 14, 30, 0.6))",
          }}>
            {loading ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                {t("common.loading") || "Đang tải danh sách vụ án..."}
              </div>
            ) : filteredCases.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                {cases.length === 0
                  ? (t("smp.cross_case.no_other_cases") || "Không có vụ án nào khác trong hệ thống.")
                  : (t("smp.cross_case.not_found") || "Không tìm thấy vụ án phù hợp với từ khóa.")}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filteredCases.map((c) => {
                  const isChecked = selectedIds.has(c.id);
                  const isClosed = c.status === "closed";
                  return (
                    <label
                      key={c.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 12px",
                        borderRadius: 6,
                        cursor: "pointer",
                        border: isChecked ? "1px solid var(--primary-2, #35D8FF)" : "1px solid rgba(255,255,255,0.06)",
                        background: isChecked ? "rgba(22, 139, 255, 0.12)" : "rgba(255,255,255,0.02)",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleCase(c.id)}
                        style={{ width: 16, height: 16 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                          <strong className="mono" style={{ color: "var(--text)" }}>{c.code}</strong>
                          <span style={{ fontWeight: 600 }}>{c.name || t("case.no_name")}</span>
                          <span className={`sync-badge ${isClosed ? "closed" : "open"}`} style={{ fontSize: 11, padding: "2px 6px" }}>
                            {t(isClosed ? "case.status.closed" : "case.status.investigating")}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 12 }}>
                          {c.location && <span>{c.location}</span>}
                          {c.occurred_at && <span>{formatDateTime(c.occurred_at)}</span>}
                          <span>{t("dashboard.case.record_count", { n: c.detainee_count || 0 })}</span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            <div style={{ fontSize: 13, color: selectedCount > 0 ? "var(--primary-2)" : "var(--muted)" }}>
              {selectedCount > 0 ? (
                <strong>
                  {t("smp.cross_case.selected_summary", { cases: selectedCount, detainees: totalDetaineesChosen }) ||
                    `Đã chọn: ${selectedCount} vụ án (${totalDetaineesChosen} hồ sơ đối tượng liên vụ)`}
                </strong>
              ) : (
                <span>{t("smp.cross_case.none_selected") || "Chưa chọn vụ án mở rộng nào."}</span>
              )}
            </div>
            <div className="modal-actions" style={{ margin: 0 }}>
              <button type="button" className="button secondary" onClick={onClose}>
                {t("common.cancel") || "Hủy"}
              </button>
              <button
                type="button"
                className="button primary"
                onClick={handleConfirm}
              >
                {selectedCount > 0
                  ? (t("smp.cross_case.add_btn") || `Thêm đối sánh (${selectedCount} vụ)`)
                  : (t("smp.cross_case.match_current_only") || "Chỉ đối sánh vụ hiện tại")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CrossCaseCompareModal;
