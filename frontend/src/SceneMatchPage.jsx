import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";
import { useI18n } from "./i18n";
import SceneTraceFull from "./SceneTraceFull";
import SceneMatchReportModal from "./SceneMatchReportModal";
import { FINGER_LABELS } from "./sceneMatchDemo";
import { SCORE_TOTAL, enrolledUrl } from "./sceneDemo";
import {
  IcAvatar, IcCaret, IcChevRight, IcChevUp, IcCheckCircle, IcClose, IcExport, IcFilter,
  IcEye, IcPageNext, IcPagePrev, IcPencil, IcPlus,
  IcTick, IcTrash, IcUpload,
} from "./sceneMatchIcons";

// Man "Phan tich doi sanh" — dung theo design D:\Downloads\Phan tich doi sanh.
// Vu an / ma phien / danh sach dau vet = data THAT tu API.
// Ket qua doi sanh + ho so doi tuong = data gia (chua co engine trich minutiae).
const PAGE_SIZE = 10;   // design: "Hien thi 1 - 10 cua 20"
const MATCH_POLL_MS = 2000;
const MATCH_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const MATCH_TERMINAL_STATUSES = new Set(["done", "error", "disabled"]);

// Ten file: backend KHONG luu ten goc luc upload (_save_scene_image doi ten thanh
// "<timestamp>_<ObjectId>.png"), nen ten hien thi lay tu duoi url. Bo query/hash
// cho chac vi url co the co "?v=..". ponytail: doi sang field ten goc that neu
// backend luu them, cho do sua o day 1 cho.
const fileName = (u) => (u || "").split(/[?#]/)[0].split("/").pop() || "—";

// time trong data gia la "DD/MM/YYYY HH:MM" -> so sanh chuoi se sai (03/09 vs 12/08).
// Doi sang YYYYMMDDHHMM de sort. Bo ham nay khi backend tra ISO timestamp.
// Thang diem 0..22 nhu design: cung thang voi so diem minutiae o cot "Diem
// tuong dong" va o trang chi tiet (SCORE_TOTAL trong sceneDemo).
const SCORE_MIN = 0;
const SCORE_MAX = SCORE_TOTAL;
const SCORE_MID = SCORE_TOTAL / 2;
const clampScore = (v) =>
  Math.max(SCORE_MIN, Math.min(SCORE_MAX, Number(v) || SCORE_MIN));

// Thu tu 4 o "Sắp xếp theo" dung nhu design.
// Design: 3 kieu sap xep cho panel dau vet.
const TRACE_SORTS = [
  ["newest", "smp.tsort.newest"],
  ["oldest", "smp.tsort.oldest"],
  ["code", "smp.tsort.code"],
];

const SORT_OPTS = [
  ["newest", "smp.sort.newest"],
  ["oldest", "smp.sort.oldest"],
  ["score_desc", "smp.sort.score_desc"],
  ["score_asc", "smp.sort.score_asc"],
];

const traceCode = (it) =>
  `DVHT-${String(it.captured_at || "").slice(0, 4)}-${String(it.seq).padStart(4, "0")}`;

function timeKey(r) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/.exec(r.time || "");
  return m ? Number(m[3] + m[2] + m[1] + m[4] + m[5]) : 0;
}

export default function SceneMatchPage({ sessionId, caseId, onBack, onAddSubject, onOpenDetainee }) {
  const currentCaseId = caseId || sessionId || "";
  const { t, formatDateTime } = useI18n();
  const [session, setSession] = useState(null);
  const [traces, setTraces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [advOpen, setAdvOpen] = useState(false);
  const [subjOpen, setSubjOpen] = useState(false);
  const [subjectSel, setSubjectSel] = useState(() => new Set());   // rong = tat ca
  const [fingerFilter, setFingerFilter] = useState("");
  const [minScore, setMinScore] = useState(SCORE_MIN);
  const [sortBy, setSortBy] = useState("score_desc");   // mac dinh "Điểm cao nhất"
  const [bestOnly, setBestOnly] = useState(true);        // mac dinh chi lay ket qua diem cao nhat moi dau vet
  const [traceQ, setTraceQ] = useState("");
  const [traceSort, setTraceSort] = useState("newest");
  const [editTrace, setEditTrace] = useState(null);   // != null => mo modal sua
  const [pendingDelete, setPendingDelete] = useState([]); // danh sach dau vet cho xac nhan xoa
  const [pendingDeleteSubject, setPendingDeleteSubject] = useState(null);
  const [deletingSubjectId, setDeletingSubjectId] = useState("");
  const [openSub, setOpenSub] = useState("");
  const [uploading, setUploading] = useState(false);
  const [realMatches, setRealMatches] = useState([]);
  const [detainees, setDetainees] = useState([]);
  const [exporting, setExporting] = useState(false);  // icon truot xuong roi ve cho khi bam "Xuat bao cao"
  const [showReport, setShowReport] = useState(false); // mo modal xuat bao cao
  // Dong da bam trong bang KET QUA DOI SANH: giu ca id dau vet + row de trang
  // chi tiet hien dung so lieu cua dong do (truoc day tu dung lai theo seq => lech).
  const [full, setFull] = useState(null);   // != null => mo trang chi tiet dau vet

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await api.listSceneTraces(currentCaseId);
      const caseData = r?.case || r?.session || null;
      const activeId = currentCaseId || caseData?.id || "";
      const [matchRes, detRes] = await Promise.all([
        activeId ? api.listSceneMatches({ caseId: activeId }).catch(() => null) : null,
        activeId ? api.listDetainees({ case_id: activeId }).catch(() => null) : api.listDetainees().catch(() => null),
      ]);
      setSession(caseData);
      setTraces(r?.items || []);
      if (matchRes?.items && matchRes.items.length > 0) {
        setRealMatches(matchRes.items);
      } else {
        setRealMatches([]);
      }
      if (detRes?.items && detRes.items.length > 0) {
        setDetainees(detRes.items);
      } else if (caseData?.detainees && caseData.detainees.length > 0) {
        setDetainees(caseData.detainees);
      } else {
        setDetainees([]);
      }
    } catch (ex) {
      setErr(ex.message || t("scene.err.load"));
    } finally {
      setLoading(false);
    }
  }, [currentCaseId, t]);

  useEffect(() => { load(); }, [load]);

  const subjectsList = useMemo(() => {
    if (detainees.length > 0) {
      return detainees.map((d, i) => {
        const photos = d.photos || {};
        const fingerprints = d.fingerprints || {};
        return {
          id: d.id || `sub-${i + 1}`,
          detainee: d,
          name: d.full_name || d.name,
          cccd: d.cccd_number || d.cccd || "—",
          dob: d.dob || d.birth_year || "—",
          sex: d.gender === "female" || d.gender === "Nữ" ? "Nữ" : "Nam",
          primary: i === 0,
          photoCount: d.fp_count != null ? d.fp_count : (photos.fp_count || (d.fp_images ? Object.keys(d.fp_images).length : 10)),
          photo: d.portrait || d.portrait_cropped_url || d.portrait_original_url || photos.portrait_front || "",
          right: FINGER_LABELS.map((label, k) => {
            const key = ["right_thumb", "right_index", "right_middle", "right_ring", "right_little"][k];
            const pKey = ["fp_r1", "fp_r2", "fp_r3", "fp_r4", "fp_r5"][k];
            return {
              label,
              url: fingerprints[key] || d.fp_images?.[key] || photos[pKey] || enrolledUrl(i * 10 + k + 1),
            };
          }),
          left: FINGER_LABELS.map((label, k) => {
            const key = ["left_thumb", "left_index", "left_middle", "left_ring", "left_little"][k];
            const pKey = ["fp_l1", "fp_l2", "fp_l3", "fp_l4", "fp_l5"][k];
            return {
              label,
              url: fingerprints[key] || d.fp_images?.[key] || photos[pKey] || enrolledUrl(i * 10 + k + 6),
            };
          }),
        };
      });
    }
    return [];
  }, [detainees]);

  const baseRows = useMemo(() => {
    const list = realMatches.map((m, idx) => {
      const fingerKey = m.finger_code || m.finger;
      const fingerI18n = fingerKey
        ? (String(fingerKey).startsWith("fp.") ? fingerKey : `fp.finger.${fingerKey}.long`)
        : "—";
      const trace = traces.find((item) => item.id === m.trace_id);
      const score = Number.isFinite(Number(m.score)) ? Math.round(Number(m.score)) : 0;
      const percent = m.percent != null ? Number(m.percent) : score / 10;
      return {
        id: m.id || m._id || `match-${idx + 1}`,
        stt: String(idx + 1).padStart(2, "0"),
        code: m.trace_code || (trace ? traceCode(trace) : `DVHT-${String(m.trace_seq || idx + 1).padStart(4, "0")}`),
        name: m.name || m.detainee_name || m.subject || "—",
        cccd: m.cccd || m.detainee_code || "—",
        finger: fingerI18n,
        score,
        pct: `(${percent.toFixed(1)}%)`,
        time: m.analyzed_at || m.time || m.created_at || "—",
        latent_landmarks: m.latent_landmarks,
        latent_dim: m.latent_dim,
        trace_url: m.trace_url || trace?.url || "",
        candidate_url: m.candidate_url || "",
        candidate_landmarks: m.candidate_landmarks,
        candidate_dim: m.candidate_dim,
        verdict: m.verdict,
        trace_id: m.trace_id,
        detainee_id: m.detainee_id || m.suspect_id || "",
        portrait_url: m.portrait || m.portrait_cropped_url || m.portrait_original_url || m.photos?.portrait_front || m.photos?.portrait_cropped || m.photo || "",
        raw: m,
      };
    });

    if (bestOnly) {
      const bestMap = new Map();
      for (const row of list) {
        const key = row.trace_id || row.code;
        const existing = bestMap.get(key);
        if (!existing || (row.score || 0) > (existing.score || 0)) {
          bestMap.set(key, row);
        }
      }
      return Array.from(bestMap.values());
    }

    return list;
  }, [realMatches, traces, bestOnly]);

  // ----- Ket qua doi sanh: chi co khi phien da co dau vet hien truong -----
  const rows = useMemo(() => {
    if (traces.length === 0) return [];
    const kw = q.trim().toLowerCase();
    const out = baseRows.filter((r) => {
      if (subjectSel.size && !subjectSel.has(r.name)) return false;
      if (fingerFilter && r.finger !== fingerFilter) return false;
      if (r.score < minScore) return false;
      if (!kw) return true;
      return `${r.code} ${r.name}`.toLowerCase().includes(kw);
    });
    // filter() tra array moi nen sort() tai cho khong thay doi du lieu API goc.
    const cmp = {
      newest:     (a, b) => timeKey(b) - timeKey(a),
      oldest:     (a, b) => timeKey(a) - timeKey(b),
      score_desc: (a, b) => b.score - a.score,
      score_asc:  (a, b) => a.score - b.score,
    }[sortBy];
    return cmp ? out.sort(cmp) : out;
  }, [traces.length, baseRows, q, subjectSel, fingerFilter, minScore, sortBy]);

  // Danh sach ngon tay lay tu chinh data -> khong can export thu tu tu sceneMatchDemo.
  const FINGER_OPTS = useMemo(
    () => [...new Set(baseRows.map((r) => r.finger))], [baseRows]);
  // Badge dem so dieu kien dang thu hep ket qua (sort chi doi thu tu -> khong dem).
  const filterCount = (fingerFilter ? 1 : 0) + (minScore > SCORE_MIN ? 1 : 0)
    + (subjectSel.size ? 1 : 0) + (!bestOnly ? 1 : 0);
  const resetFilter = () => {
    setFingerFilter("");
    setMinScore(SCORE_MIN);
    setSortBy("score_desc");
    setBestOnly(true);
    setSubjectSel(new Set());
  };
  const toggleSubj = (name) => setSubjectSel((prev) => {
    const n = new Set(prev);
    n.has(name) ? n.delete(name) : n.add(name);
    return n;
  });
  // Design: "Tất cả đối tượng" / "Đã chọn N đối tượng" — 1 nguoi thi hien ten.
  const subjLabel = subjectSel.size === 0
    ? t("smp.all_subjects")
    : subjectSel.size === 1
      ? [...subjectSel][0]
      : t("smp.subj.n_picked", { n: subjectSel.size });

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page]
  );
  useEffect(() => { setPage(1); }, [q, subjectSel, fingerFilter, minScore, sortBy, bestOnly]);
  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  // ----- Dau vet hien truong (that) -----
  const shownTraces = useMemo(() => {
    const kw = traceQ.trim().toLowerCase();
    const out = kw
      ? traces.filter((x) =>
          `${traceCode(x)} ${x.seq} ${x.collection_source || ""}`.toLowerCase().includes(kw))
      : traces.slice();
    const cmp = {
      newest: (a, b) => String(b.captured_at || "").localeCompare(String(a.captured_at || "")),
      oldest: (a, b) => String(a.captured_at || "").localeCompare(String(b.captured_at || "")),
      code: (a, b) => (a.seq || 0) - (b.seq || 0),
    }[traceSort];
    return cmp ? out.sort(cmp) : out;
  }, [traces, traceQ, traceSort]);

  // Import nhieu anh trong 1 request. Backend doi sanh nen; FE polling trang thai
  // cua dung cac trace vua tao, sau do moi tai lai bang ket qua.
  const addTraces = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setUploading(true);
    setErr("");
    try {
      const activeCaseId = currentCaseId || session?.id || session?._id || "";
      const batch = await api.createSceneTracesBatch(list, {
        caseId: activeCaseId,
        source: "upload",
      });
      const traceIds = new Set((batch?.items || []).map((it) => it.id).filter(Boolean));
      const deadline = Date.now() + MATCH_POLL_TIMEOUT_MS;

      while (traceIds.size > 0) {
        const traceRes = await api.listSceneTraces(activeCaseId);
        const caseData = traceRes?.case || traceRes?.session || null;
        if (caseData) setSession(caseData);
        setTraces(traceRes?.items || []);

        const tracked = (traceRes?.items || []).filter((it) => traceIds.has(it.id));
        const finished = tracked.length === traceIds.size
          && tracked.every((it) => MATCH_TERMINAL_STATUSES.has(it.match_status));
        if (finished) break;
        if (Date.now() >= deadline) {
          throw new Error(t("scene.err.match_timeout") || "Đối sánh đang mất nhiều thời gian. Kết quả sẽ tiếp tục được xử lý ở nền.");
        }
        await new Promise((resolve) => setTimeout(resolve, MATCH_POLL_MS));
      }

      if (traceIds.size > 0) {
        const matchRes = await api.listSceneMatches({ caseId: activeCaseId });
        setRealMatches(matchRes?.items || []);
      }

      if ((batch?.errors || []).length > 0) {
        const detail = batch.errors.map((x) => `${x.filename}: ${x.error}`).join("; ");
        setErr(`${batch.accepted}/${batch.total} ảnh được tải lên. ${detail}`);
      }
    } catch (ex) {
      setErr(ex.message || t("scene.err.upload"));
    } finally {
      setUploading(false);
    }
  };

  // Xoa / sua ghi chu: dung lai api co san, confirm+prompt native nhu DataCapturePage.
  const deleteTraces = async (items) => {
    if (!items.length) return;
    setPendingDelete([]);
    setUploading(true);
    setErr("");
    try {
      for (const it of items) await api.deleteSceneTrace(it.id);
      await load();
    } catch (ex) {
      setErr(ex.message || t("scene.err.delete"));
    } finally {
      setUploading(false);
    }
  };

  const deleteSubject = async (subject) => {
    const detainee = subject?.detainee || subject;
    if (!detainee?.id) return;
    setPendingDeleteSubject(null);
    setDeletingSubjectId(detainee.id);
    setErr("");
    try {
      await api.deleteDetainee(detainee.id);
      setOpenSub((current) => (current === subject.id ? "" : current));
      await load();
    } catch (ex) {
      setErr(ex.message || t("smp.sub.delete_error"));
    } finally {
      setDeletingSubjectId("");
    }
  };

  const saveTrace = async (it, patch) => {
    setErr("");
    try {
      await api.updateSceneTrace(it.id, patch);
      setTraces((prev) => prev.map((x) => (x.id === it.id ? { ...x, ...patch } : x)));
      setEditTrace(null);
    } catch (ex) {
      setErr(ex.message || t("scene.err.save_note"));
    }
  };

  const [closingCase, setClosingCase] = useState(false);
  const isCaseClosed = session?.status === "closed";

  const handleToggleCloseCase = async () => {
    const activeCaseId = currentCaseId || session?.id || session?._id || "";
    if (!activeCaseId) return;

    if (isCaseClosed) {
      if (!window.confirm(t("smp.confirm_reopen") || "Bạn có muốn mở lại vụ án này để tiếp tục điều tra không?")) return;
      setClosingCase(true);
      setErr("");
      try {
        await api.updateCase(activeCaseId, { status: "investigating" });
        setSession((prev) => prev ? { ...prev, status: "investigating" } : prev);
        await load();
      } catch (ex) {
        setErr(ex.message || t("case.err.update") || "Không cập nhật được vụ án");
      } finally {
        setClosingCase(false);
      }
    } else {
      if (!window.confirm(t("smp.confirm_close") || "Bạn có chắc chắn muốn kết thúc vụ án này không? Sau khi kết thúc, không thể thêm/sửa dấu vết và đối tượng.")) return;
      setClosingCase(true);
      setErr("");
      try {
        await api.closeCase(activeCaseId);
        setSession((prev) => prev ? { ...prev, status: "closed" } : prev);
        await load();
      } catch (ex) {
        setErr(ex.message || t("case.detail.err.close") || "Không kết thúc được vụ án");
      } finally {
        setClosingCase(false);
      }
    }
  };

  const from = rows.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, rows.length);

  // Chỉ liên kết bằng trace_id thật do backend trả về. Không ghép theo thứ tự,
  // vì cách đó khiến ảnh chưa có kết quả HBIE vẫn bị hiển thị như đã trùng khớp.
  const traceFor = (row) => row?.trace_id
    ? traces.find((trace) => trace.id === row.trace_id)
    : null;

  const fullItem = full ? traces.find((x) => x.id === full.id) : null;
  if (fullItem) {
    return (
        <SceneTraceFull
          item={fullItem}
          row={full.row}
          session={session}
          detainees={detainees}
          subjects={subjectsList}
          onBack={() => setFull(null)}
          onOpenDetainee={onOpenDetainee}
        />
    );
  }

  return (
    <div className="smp">
      {/* ---------- Header vu an ---------- */}
      <div className="smp-top">
        <div className="smp-top-left">
          {onBack && (
            <button type="button" className="smp-btn-ghost smp-back" onClick={onBack}>
              {t("common.back")}
            </button>
          )}
          <div>
            <div className="smp-top-line">
              <div className="smp-case-code">
                {t("smp.case")}: {session?.code || session?.case_code || "—"}
              </div>
              <span className={"smp-chip " + (!isCaseClosed ? "smp-chip-green" : "scp-chip-grey")}>
                {t(!isCaseClosed ? "session.status.open_dot" : "session.status.closed_dot")}
              </span>
            </div>
            <div className="smp-case-name">
              {session?.name || session?.case_name || (session?.code ? `Vụ án ${session.code}` : t("scene.no_case"))}
            </div>
          </div>
        </div>
        <div className="smp-top-actions">
          <button
            type="button"
            className="smp-btn-ghost"
            onClick={() => {
              setExporting(true);
              setShowReport(true);
            }}
          >
            <span className={"smp-ic" + (exporting ? " smp-ic-out" : "")} onAnimationEnd={() => setExporting(false)}>
              <IcExport />
            </span>
            {t("smp.export")}
          </button>
          <button
            type="button"
            className="smp-btn-ghost"
            disabled={closingCase}
            onClick={handleToggleCloseCase}
            title={isCaseClosed ? t("smp.reopen_case") : t("smp.close_case")}
          >
            <span className="smp-ic">
              <IcCheckCircle />
            </span>
            {closingCase
              ? (t("case.detail.closing") || "Đang xử lý...")
              : (isCaseClosed ? t("smp.reopen_case") : t("smp.close_case"))}
          </button>
        </div>
      </div>

      {err && <div className="lg-err" role="alert">{err}</div>}

      {/* ---------- 2 panel tren: dau vet (trai) + ho so doi tuong (phai) ---------- */}
      <div className="smp-top-panels">
        <SceneTracePanel
          t={t}
          traces={shownTraces}
          total={traces.length}
          q={traceQ}
          setQ={setTraceQ}
          traceCode={traceCode}
          formatDateTime={formatDateTime}
          onAddFiles={addTraces}
          uploading={uploading}
          onDelete={setPendingDelete}
          onEdit={setEditTrace}
          sort={traceSort}
          setSort={setTraceSort}
        />
        <SubjectPanel
          t={t}
          subjects={subjectsList}
          openSub={openSub || ""}
          setOpenSub={setOpenSub}
          onOpenDetainee={onOpenDetainee}
          onDelete={setPendingDeleteSubject}
          deletingId={deletingSubjectId}
          // ponytail: chi chan theo status (co trong payload san). Backend con chan
          // officer != user va role admin -> se bao 403 luc luu. Them officer vao
          onAdd={onAddSubject && (!session || session.status === "open" || session.status === "investigating" || session.status === "active" || session.status !== "closed")
            ? () => onAddSubject(session?.id || currentCaseId)
            : null}
          addDisabledHint={session && session.status === "closed"
            ? t("smp.sub.add_closed")
            : ""}
        />
      </div>

      {/* ---------- KET QUA DOI SANH ---------- */}
      <section className="smp-panel smp-panel-match">
        <div className="smp-panel-head">
          <div className="smp-panel-title">
            <span className="smp-h">{t("smp.match.title")}</span>
            <span className="smp-badge">{rows.length}</span>
            <span className="smp-sub">{t("smp.match.pairs")}</span>
          </div>
          <div className="smp-panel-tools">
            <input
              className="smp-search smp-search-wide"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("smp.match.search_ph")}
            />
            <PopMenu
              label={t("smp.all_subjects")}
              btnClassName="smp-trg smp-trg-subj"
              popClassName="smp-pop-subj"
              width={260}
              closeOnClick={false}
              onState={setSubjOpen}
              trigger={<>
                <span>{subjLabel}</span>
                <IcCaret s={15} open={subjOpen} />
              </>}
            >
              {/* Design: chon nhieu doi tuong; "Tất cả" = bo hết lựa chọn. */}
              <button
                type="button"
                className={"smp-opt" + (subjectSel.size === 0 ? " on" : "")}
                onClick={() => setSubjectSel(new Set())}
              >
                {t("smp.all_subjects")}
                {subjectSel.size === 0 && <IcTick />}
              </button>
              {subjectsList.map((sub) => (
                <button
                  type="button"
                  key={sub.id}
                  className={"smp-opt" + (subjectSel.has(sub.name) ? " on" : "")}
                  onClick={() => toggleSubj(sub.name)}
                >
                  {sub.name}
                  {subjectSel.has(sub.name) && <IcTick />}
                </button>
              ))}
            </PopMenu>
            <PopMenu
              label={t("smp.filter")}
              btnClassName="smp-trg smp-trg-filter"
              popClassName="smp-adv"
              width={420}
              closeOnClick={false}
              onState={setAdvOpen}
              trigger={<>
                <IcFilter />
                {t("smp.filter")}
                {filterCount > 0 && <span className="smp-trg-badge">{filterCount}</span>}
                <IcCaret open={advOpen} />
              </>}
              render={(close) => (
                <>
                  <div className="smp-adv-head">
                    <span className="smp-adv-title">{t("smp.filter.adv")}</span>
                    <button
                      type="button"
                      className="smp-adv-x"
                      aria-label={t("common.close")}
                      onClick={close}
                    ><IcClose /></button>
                  </div>

                  <div className="smp-adv-grid">
                    <div className="smp-adv-wide">
                      <div className="smp-adv-lb">{t("smp.sort")}</div>
                      <div className="smp-seg">
                        {SORT_OPTS.map(([key, k]) => (
                          <button
                            type="button"
                            key={key}
                            className={sortBy === key ? "on" : ""}
                            onClick={() => setSortBy(key)}
                          >{t(k)}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="smp-adv-lb">{t("smp.filter.finger")}</div>
                      <select
                        className="smp-adv-sel"
                        value={fingerFilter}
                        onChange={(e) => setFingerFilter(e.target.value)}
                      >
                        <option value="">{t("smp.filter.all_fingers")}</option>
                        {FINGER_OPTS.map((f) => <option key={f} value={f}>{t(f)}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="smp-adv-scorehd">
                      <span>{t("smp.filter.min_score")}</span>
                      <span className="smp-adv-scoreval">
                        <input
                          className="smp-adv-num"
                          type="number"
                          min={SCORE_MIN}
                          max={SCORE_MAX}
                          value={minScore}
                          onChange={(e) => setMinScore(clampScore(e.target.value))}
                        />
                        <span className="smp-adv-max">/ {SCORE_MAX}</span>
                      </span>
                    </div>
                    <input
                      className="smp-adv-range"
                      type="range"
                      min={SCORE_MIN}
                      max={SCORE_MAX}
                      value={minScore}
                      onChange={(e) => setMinScore(clampScore(e.target.value))}
                      aria-label={t("smp.filter.min_score")}
                      // CSS khong doc duoc value cua input range -> gan % fill inline.
                      style={{ "--smp-fill": `${(minScore / SCORE_MAX) * 100}%` }}
                    />
                    <div className="smp-adv-ticks">
                      <span>{SCORE_MIN}</span><span>{SCORE_MID}</span><span>{SCORE_MAX}</span>
                    </div>
                  </div>

                  <div style={{ marginTop: 10, padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 6 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "#d2e3fc" }}>
                      <input
                        type="checkbox"
                        checked={bestOnly}
                        onChange={(e) => setBestOnly(e.target.checked)}
                        style={{ accentColor: "#2272e8", width: 16, height: 16, cursor: "pointer" }}
                      />
                      <span>{t("smp.filter.best_only") || "Chỉ hiển thị kết quả cao nhất của mỗi dấu vết"}</span>
                    </label>
                  </div>

                  <div className="smp-adv-foot">
                    <button
                      type="button"
                      className="smp-adv-reset"
                      disabled={!filterCount && sortBy === "score_desc"}
                      onClick={resetFilter}
                    >{t("smp.filter.reset")}</button>
                    <button type="button" className="smp-adv-apply" onClick={close}>
                      {t("smp.filter.apply")}
                    </button>
                  </div>
                </>
              )}
            />
          </div>
        </div>

        {/* Design bo head+body trong 1 khung vien bo goc (kieu bang Excel). */}
        <div className="smp-mt-wrap">
        <div className="smp-mt-head">
          <div>{t("smp.col.stt")}</div>
          <div>{t("smp.col.code")}</div>
          <div>{t("smp.col.img")}</div>
          <div>{t("smp.col.subject")}</div>
          <div>{t("smp.col.cccd")}</div>
          <div>{t("smp.col.finger")}</div>
          <div>{t("smp.col.score")}</div>
          <div>{t("smp.col.result")}</div>
          <div>{t("smp.col.time")}</div>
          <div />
        </div>

        <div className="smp-mt-body">
          {loading && <div className="scene-empty smp-mt-status">{t("common.loading")}</div>}
          {!loading && pageRows.length === 0 && (
            <div className="scene-empty smp-mt-status">{t("smp.match.empty")}</div>
          )}
          {!loading && pageRows.map((r, i) => {
            const globalIdx = (page - 1) * PAGE_SIZE + i;
            const it = traceFor(r);
            const open = it ? () => setFull({ id: it.id, row: r }) : undefined;
            const sttNumber = String(globalIdx + 1).padStart(2, "0");
            const rowKey = r.id || r.raw?.id || r.raw?._id || `${r.code || "row"}-${r.finger || ""}-${globalIdx}`;
            return (
              <div
                className={"smp-mt-row" + (it ? " go" : "")}
                key={rowKey}
                role={it ? "button" : undefined}
                tabIndex={it ? 0 : undefined}
                aria-label={it ? t("smp.match.open", { code: r.code }) : undefined}
                onClick={open}
                onKeyDown={it ? (e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
                } : undefined}
              >
                <div className="smp-dim">{sttNumber}</div>
                <div className="smp-strong">{r.code}</div>
                <div>
                  <img className="smp-thumb-sm" src={it?.url || r.trace_url} alt={r.code} loading="lazy" />
                </div>
                <div className="smp-ellip">{r.name}</div>
                <div className="smp-dim">{r.cccd}</div>
                <div className="smp-dim smp-ellip">{t(r.finger)}</div>
                <div>
                  <span className="smp-score">{r.score}/{SCORE_TOTAL}</span>{" "}
                  <span className="smp-dim">{r.pct}</span>
                </div>
                <div>
                  <span className="smp-chip smp-chip-green">{t("smp.matched")}</span>
                </div>
                <div className="smp-dim">{r.time}</div>
                <div className="smp-mt-go" aria-hidden="true"><IcChevRight /></div>
              </div>
            );
          })}
        </div>
        </div>

        <div className="smp-pg">
          <div />
          <div className="smp-pg-mid">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label={t("common.prev")}
            ><IcPagePrev /></button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                type="button"
                key={p}
                className={p === page ? "on" : ""}
                onClick={() => setPage(p)}
              >{p}</button>
            ))}
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label={t("common.next")}
            ><IcPageNext /></button>
          </div>
          <div className="smp-pg-right">
            <span className="smp-dim">{t("smp.per_page", { n: PAGE_SIZE })}</span>
            <span className="smp-dim">
              {t("smp.showing", { from, to, total: rows.length })}
            </span>
          </div>
        </div>
      </section>

      {editTrace && (
        <TraceEditModal
          t={t}
          item={editTrace}
          code={traceCode(editTrace)}
          onClose={() => setEditTrace(null)}
          onSave={saveTrace}
        />
      )}

      {pendingDelete.length > 0 && (
        <div
          className="smp-modal-bd"
          onMouseDown={(e) => e.target === e.currentTarget && setPendingDelete([])}
        >
          <div className="smp-modal smp-modal-sm" role="dialog" aria-modal="true">
            <div className="smp-modal-head">
              <span className="smp-modal-title">
                {t(pendingDelete.length > 1 ? "scene.del.title_multi" : "scene.del.title")}
              </span>
              <button
                type="button"
                className="smp-adv-x"
                aria-label={t("common.close")}
                onClick={() => setPendingDelete([])}
              ><IcClose s={17} /></button>
            </div>
            <div className="smp-modal-msg">
              {pendingDelete.length === 1
                ? t("scene.del.body", { n: traceCode(pendingDelete[0]) })
                : t("scene.del.body_multi", { n: pendingDelete.length })}
            </div>
            <div className="smp-modal-foot">
              <button type="button" className="smp-modal-cancel" onClick={() => setPendingDelete([])}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="smp-modal-del"
                disabled={uploading}
                onClick={() => deleteTraces(pendingDelete)}
              >{t("common.delete")}</button>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteSubject && (
        <div
          className="smp-modal-bd"
          onMouseDown={(e) => e.target === e.currentTarget && setPendingDeleteSubject(null)}
        >
          <div className="smp-modal smp-modal-sm" role="dialog" aria-modal="true">
            <div className="smp-modal-head">
              <span className="smp-modal-title">{t("smp.sub.delete_title")}</span>
              <button
                type="button"
                className="smp-adv-x"
                aria-label={t("common.close")}
                onClick={() => setPendingDeleteSubject(null)}
              ><IcClose s={17} /></button>
            </div>
            <div className="smp-modal-msg">
              {t("smp.sub.del_confirm", { name: pendingDeleteSubject.name })}
            </div>
            <div className="smp-modal-foot">
              <button type="button" className="smp-modal-cancel" onClick={() => setPendingDeleteSubject(null)}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="smp-modal-del"
                disabled={Boolean(deletingSubjectId)}
                onClick={() => deleteSubject(pendingDeleteSubject)}
              >{t("common.delete")}</button>
            </div>
          </div>
        </div>
      )}

      {showReport && (
        <SceneMatchReportModal
          session={session}
          items={traces}
          rows={baseRows}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}

function PopMenu({
  label, trigger, children, render, onState,
  popClassName = "", width = 176, closeOnClick = true, btnClassName = "smp-menu-btn",
}) {
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const popId = useId();          // label la chuoi i18n dung chung -> id phai tu useId
  const [open, setOpen] = useState(false);

  // Menu nam trong .smp-tr-card-img (height 64px, overflow hidden) va .smp-tr-list
  // (overflow-y auto) -> position:absolute bi cat mat. Dung popover native: browser
  // dua element len top layer, khong ancestor overflow nao cat duoc.
  // Toa do phai tu tinh (CSS anchor positioning chua co tren Chromium cua Electron 33).
  const place = (h) => {
    const b = btnRef.current?.getBoundingClientRect();
    const pop = popRef.current;
    if (!b || !pop) return;
    const W = width, M = 8;                  // khop min-width 168 + padding trong CSS
    const left = Math.max(M, Math.min(b.right - W + 2, window.innerWidth - W - M));
    const below = b.bottom + 6;
    // Het cho ben duoi (the o hang cuoi) -> mo len tren.
    const top = below + h > window.innerHeight - M
      ? Math.max(M, b.top - 6 - h)
      : below;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  };

  return (
    <div className="smp-menu" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        className={btnClassName + (open ? " on" : "")}
        aria-label={label}
        title={label}
        popoverTarget={popId}
      >{trigger}</button>
      <div
        ref={popRef}
        id={popId}
        popover="auto"
        className={`smp-menu-pop ${popClassName}`}
        // ponytail: uoc luong chieu cao (44px/item) de dat cho dung ngay lan dau —
        // luc beforetoggle popover con display:none nen do that ra 0. onToggle do
        // lai chinh xac, chi lech neu uoc luong sai (item xuong 2 dong).
        onBeforeToggle={(e) => {
          if (e.newState === "open") place(44 * (popRef.current?.children.length || 2) + 14);
        }}
        onToggle={(e) => {
          if (e.newState === "open") place(popRef.current.offsetHeight);
          setOpen(e.newState === "open");
          onState && onState(e.newState === "open");
        }}
        onClick={closeOnClick ? () => popRef.current?.hidePopover() : undefined}
      >
        {render ? render(() => popRef.current?.hidePopover()) : children}
      </div>
    </div>
  );
}

/* ---------- Panel: DẤU VẾT HIỆN TRƯỜNG (data thật) ---------- */
function SceneTracePanel({
  t, traces, total, q, setQ, traceCode, formatDateTime,
  onAddFiles, uploading, onDelete, onEdit, sort, setSort,
}) {
  const [zoom, setZoom] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const selectedItems = traces.filter((it) => selectedIds.has(it.id));

  useEffect(() => {
    const visibleIds = new Set(traces.map((it) => it.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [traces]);

  const toggleOne = (id) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  // Xem / Chinh sua nam tren tung dong; xoa dung nut hang loat tren thanh cong cu.
  const actions = (it, grid) => (
    <div className={"smp-act" + (grid ? " smp-act-grid" : "")} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="smp-act-view"
        title={t("common.view")}
        aria-label={t("common.view")}
        onClick={() => setZoom(it)}
      ><IcEye s={grid ? 12 : 13} /></button>
      <button
        type="button"
        className="smp-act-edit"
        title={t("smp.tr.edit")}
        aria-label={t("smp.tr.edit")}
        onClick={() => onEdit(it)}
      ><IcPencil s={grid ? 12 : 13} /></button>
      <button
        type="button"
        className="smp-act-del"
        title={t("common.delete")}
        aria-label={t("common.delete")}
        disabled={uploading}
        onClick={() => onDelete([it])}
      ><IcTrash s={grid ? 12 : 13} /></button>
    </div>
  );
  const pick = (e) => {
    onAddFiles(e.target.files);
    e.target.value = "";     // chon lai cung file van chay onChange
  };
  return (
    <section className="smp-panel smp-panel-trace">
      <div className="smp-panel-head">
        <div className="smp-panel-title">
          <span className="smp-h">{t("smp.trace.title")}</span>
          <span className="smp-badge">{t("smp.trace.count", { n: total })}</span>
        </div>
        <div className="smp-panel-tools">
          <input
            className="smp-search smp-tr-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("smp.trace.search_ph")}
          />
          <PopMenu
            label={t("smp.filter")}
            btnClassName="smp-trg smp-trg-tsort"
            popClassName="smp-pop-tsort"
            width={200}
            closeOnClick={false}
            trigger={<>
              <IcFilter s={14} />
              {t("smp.filter")}
            </>}
          >
            <div className="smp-pop-cap">{t("smp.sort")}</div>
            {TRACE_SORTS.map(([key, k]) => (
              <button
                type="button"
                key={key}
                className={"smp-opt" + (sort === key ? " on" : "")}
                onClick={() => setSort(key)}
              >
                {t(k)}
                {sort === key && <IcTick />}
              </button>
            ))}
          </PopMenu>
          <button
            type="button"
            className="smp-bulk-del"
            disabled={uploading || selectedItems.length === 0}
            onClick={() => onDelete(selectedItems)}
            title={selectedItems.length > 0
              ? t("scene.del.selected", { n: selectedItems.length })
              : t("scene.del.select_first")}
            aria-label={selectedItems.length > 0
              ? t("scene.del.selected", { n: selectedItems.length })
              : t("scene.del.select_first")}
          >
            <IcTrash s={15} />
          </button>
          <label className="smp-btn-primary">
            <IcUpload />
            {uploading ? t("scene.uploading") : t("smp.trace.import")}
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              multiple
              hidden
              disabled={uploading}
              onChange={pick}
            />
          </label>
        </div>
      </div>

      {traces.length === 0 ? (
        <div className="scene-empty">{t("smp.trace.empty")}</div>
      ) : (
        <div className="smp-tr-list">
          {traces.map((it) => (
            <div
              key={it.id}
              className="smp-tr-row"
              role="button"
              tabIndex={0}
              aria-pressed={selectedIds.has(it.id)}
              aria-label={t("scene.select_trace", { code: traceCode(it) })}
              onClick={() => toggleOne(it.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleOne(it.id);
                }
              }}
            >
              <span
                className={"smp-tr-selected-mark" + (selectedIds.has(it.id) ? " visible" : "")}
                aria-hidden="true"
              >
                <IcTick s={16} />
              </span>
              <img
                className="smp-thumb-md"
                src={it.url}
                alt={traceCode(it)}
                title={t("common.view")}
                loading="lazy"
                onClick={(e) => { e.stopPropagation(); setZoom(it); }}
              />
              <div className="smp-tr-meta">
                <div className="smp-strong">{traceCode(it)}</div>
                <div className="smp-dim smp-ellip">{fileName(it.url)}</div>
              </div>
              <div className="smp-dim smp-ellip smp-tr-src">{it.collection_source || ""}</div>
              <div className="smp-dim smp-tr-time">{formatDateTime(it.captured_at)}</div>
              {actions(it, false)}
            </div>
          ))}
        </div>
      )}

      {/* Xem anh chi tiet: popup modal phong to */}
      {zoom && createPortal(
        <div className="scene-zoom-backdrop" onClick={() => setZoom(null)}>
          <div className="scene-zoom-modal" onClick={(e) => e.stopPropagation()}>
            <div className="scene-zoom-head">
              <span className="scene-zoom-title">
                {traceCode(zoom)}{zoom.collection_source ? ` • ${zoom.collection_source}` : ""}
              </span>
              <button
                type="button"
                className="scene-zoom-close"
                onClick={() => setZoom(null)}
                title={t("common.close") || "Đóng"}
                aria-label={t("common.close") || "Đóng"}
              >
                <IcClose s={18} />
              </button>
            </div>
            <div className="scene-zoom-body">
              <div className="stf-zoom-wrap">
                <img src={zoom.url} alt={traceCode(zoom)} />
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}

/* ---------- Modal: CHỈNH SỬA DẤU VẾT ---------- */
/* Ma dau vet sinh tu seq (traceCode) nen khong sua duoc; 3 truong con lai
   (loai dau vet, vi tri thu thap, ghi chu) PATCH len backend. */
function TraceEditModal({ t, item, code, onClose, onSave }) {
  const [form, setForm] = useState({
    trace_type: item.trace_type || "",
    collection_source: item.collection_source || "",
    note: item.note || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setSaving(true);
    await onSave(item, form);
    setSaving(false);
  };
  return (
    <div
      className="smp-modal-bd"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="smp-modal" role="dialog" aria-modal="true" aria-label={t("smp.tr.edit_title")}>
        <div className="smp-modal-head">
          <span className="smp-modal-title">{t("smp.tr.edit_title")}</span>
          <button
            type="button"
            className="smp-adv-x"
            aria-label={t("common.close")}
            onClick={onClose}
          ><IcClose s={17} /></button>
        </div>
        <div className="smp-modal-body">
          <div>
            <div className="smp-modal-lb">{t("smp.tr.f_code")}</div>
            {/* Ma sinh tu so thu tu anh trong phien -> khong cho sua. */}
            <input className="smp-modal-in" value={code} readOnly disabled />
          </div>
          <div>
            <div className="smp-modal-lb">{t("scene.col.type")}</div>
            <input
              className="smp-modal-in"
              value={form.trace_type}
              onChange={set("trace_type")}
              maxLength={100}
              placeholder={t("smp.tr.f_type_ph")}
            />
          </div>
          <div>
            <div className="smp-modal-lb">{t("smp.tr.f_place")}</div>
            <input
              className="smp-modal-in"
              value={form.collection_source}
              onChange={set("collection_source")}
              maxLength={200}
              placeholder={t("smp.tr.f_place_ph")}
            />
          </div>
          <div>
            <div className="smp-modal-lb">{t("smp.tr.f_note")}</div>
            <textarea
              className="smp-modal-in"
              rows="3"
              maxLength={500}
              value={form.note}
              onChange={set("note")}
              placeholder={t("smp.tr.f_note_ph")}
            />
          </div>
        </div>
        <div className="smp-modal-foot">
          <button type="button" className="smp-modal-cancel" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="smp-modal-save" disabled={saving} onClick={save}>
            {saving ? t("common.saving") : t("smp.tr.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Panel: HỒ SƠ ĐỐI TƯỢNG (data giả) ---------- */
function SubjectPanel({
  t, subjects, openSub, setOpenSub, onOpenDetainee, onDelete, deletingId, onAdd, addDisabledHint,
}) {
  const total = subjects.length;
  const photos = subjects.reduce((n, s) => n + s.photoCount, 0);

  return (
    <section className="smp-panel smp-panel-subject">
      <div className="smp-panel-head">
        <div className="smp-panel-title">
          <span className="smp-h">{t("smp.sub.title")}</span>
          <span className="smp-badge">
            {t("smp.sub.count", { n: String(total).padStart(2, "0") })} • {t("smp.sub.photos", { n: photos })}
          </span>
        </div>
        <div className="smp-panel-tools">
          <button
            type="button"
            className="smp-btn-primary"
            onClick={onAdd || undefined}
            disabled={!onAdd}
            title={addDisabledHint || undefined}
          ><IcPlus />{t("smp.sub.add")}</button>
        </div>
      </div>

      <div className="smp-sub-list">
        {subjects.length === 0 ? (
          <div className="scene-empty">{t("smp.sub.empty") || "Phiên này chưa có hồ sơ đối tượng."}</div>
        ) : (
          subjects.map((s) => {
            const open = s.id === openSub;
            return open ? (
              <div className="smp-sub-open" key={s.id}>
                <div className="smp-sub-photo">
                  {s.photo ? <img src={s.photo} alt={s.name} loading="lazy" /> : <IcAvatar />}
                </div>
                <div className="smp-sub-info">
                  <div className="smp-top-line">
                    <span className="smp-strong">{s.name}</span>
                    {s.primary && (
                      <span className="smp-chip smp-chip-blue">{t("smp.sub.primary")}</span>
                    )}
                  </div>
                  <div className="smp-sub-fields">
                    <div>CCCD: {s.cccd}</div>
                    <div>{t("smp.sub.dob")}: {s.dob}</div>
                    <div>{t("smp.sub.sex")}: {s.sex}</div>
                  </div>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => onOpenDetainee?.(s.detainee || s)}
                  >
                    {t("smp.sub.detail")}
                  </button>
                </div>
                <div className="smp-hands">
                  {[["right", t("smp.sub.right")], ["left", t("smp.sub.left")]].map(([key, label]) => (
                    <div key={key} className="smp-hand-row">
                      <div className="smp-hand-title">{label}</div>
                      <div className="smp-fingers">
                        {s[key].map((f) => (
                          <img
                            className="smp-finger"
                            key={f.label}
                            src={f.url}
                            alt={t(f.label)}
                            title={t(f.label)}
                            loading="lazy"
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="smp-sub-open-actions">
                  <button
                    type="button"
                    className="smp-sub-delete"
                    disabled={deletingId === s.id}
                    onClick={() => onDelete(s)}
                    aria-label={t("common.delete")}
                    title={t("common.delete")}
                  ><IcTrash s={15} /></button>
                  <button
                    type="button"
                    className="smp-sub-toggle"
                    onClick={() => setOpenSub("")}
                    aria-label={t("smp.sub.collapse")}
                  ><IcChevUp /></button>
                </div>
              </div>
            ) : (
              <div className="smp-sub-row" key={s.id} onClick={() => setOpenSub(s.id)}>
                <div className="smp-sub-row-left">
                  <div className="smp-sub-avatar">
                    {s.photo ? <img src={s.photo} alt={s.name} loading="lazy" /> : <IcAvatar />}
                  </div>
                  <div>
                    <div className="smp-strong">{s.name}</div>
                    <div className="smp-dim">CCCD: {s.cccd}</div>
                  </div>
                </div>
                <div className="smp-sub-row-right">
                  <span className="smp-dim2">{t("smp.sub.photos", { n: s.photoCount })}</span>
                  <button
                    type="button"
                    className="smp-sub-delete"
                    disabled={deletingId === s.id}
                    onClick={(e) => { e.stopPropagation(); onDelete(s); }}
                    aria-label={t("common.delete")}
                    title={t("common.delete")}
                  ><IcTrash s={15} /></button>
                  <IcChevRight />
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
