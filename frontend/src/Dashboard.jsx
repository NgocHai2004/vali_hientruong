import React, { useEffect, useLayoutEffect, useState } from "react";
import { api, fpApi } from "./api";
import CaseDetailPage from "./CaseDetailPage";
import CasesPage from "./CasesPage";
import Header from "./components/layout/Header";
import Sidebar from "./components/layout/Sidebar";
import ProfileEditModal from "./components/modals/ProfileEditModal";
import DataCapturePage from "./DataCapturePage";
import DashboardHome from "./features/dashboard/DashboardOverview";
import DetaineesPage from "./features/detainees/DetaineesPage";
import HistoryPage from "./features/history/HistoryPage";
import SettingsPage from "./features/settings/SettingsPage";
import SyncPage from "./features/sync/SyncPage";
import UsersPage from "./features/users/UsersPage";
import { useI18n } from "./i18n";
import { notify } from "./notifications";
import "./sceneMatch.css";
import SceneMatchPage from "./SceneMatchPage";
import "./theme.css";
import "./dashboard.css";

const APP_THEME_KEY = "vali-app-theme";
const LEGACY_DASHBOARD_THEME_KEY = "vali-dashboard-theme";
const SIDEBAR_EXPANDED_KEY = "vali-sidebar-expanded";

function useNotifState() {
  const [state, setState] = useState(() => ({
    items: notify.list(),
    unread: notify.unreadCount(),
  }));
  useEffect(() => {
    return notify.subscribe(() => {
      setState({ items: notify.list(), unread: notify.unreadCount() });
    });
  }, []);
  return state;
}

function useDeviceConnections() {
  const [status, setStatus] = useState({ camera: false, fp: false });

  useEffect(() => {
    let cancelled = false;

    const checkCamera = async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return false;
        const list = await navigator.mediaDevices.enumerateDevices();
        return list.some((d) => d.kind === "videoinput");
      } catch {
        return false;
      }
    };

    const checkFp = async () => {
      try {
        const r = await fpApi.health();
        return Boolean(r && (r.ok === true || r.status === "ok" || r.ready === true));
      } catch {
        return false;
      }
    };

    const runAll = async () => {
      const [camera, fp] = await Promise.all([
        checkCamera(),
        checkFp(),
      ]);
      if (cancelled) return;
      setStatus({ camera, fp });
    };

    runAll();
    const timer = setInterval(runAll, 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return status;
}

export default function Dashboard({ username = "admin", role = "user", fullName = "", onFullNameChange, onLogout }) {
  const [page, setPage] = useState("dashboard");
  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    try { return window.localStorage.getItem(SIDEBAR_EXPANDED_KEY) === "true"; }
    catch { return false; }
  });
  const [theme, setTheme] = useState(() => {
    try {
      const saved = window.localStorage.getItem(APP_THEME_KEY)
        || window.localStorage.getItem(LEGACY_DASHBOARD_THEME_KEY);
      return saved === "light" || saved === "dark" ? saved : "dark";
    } catch {
      return "dark";
    }
  });

  const [sceneCaseId, setSceneCaseId] = useState("");
  const [editingDetainee, setEditingDetainee] = useState(null);
  const [activeCaseId, setActiveCaseId] = useState(null);
  const [caseCtx, setCaseCtx] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const isAdmin = role === "admin";
  const deviceStatus = useDeviceConnections();
  const notifState = useNotifState();

  useLayoutEffect(() => {
    document.documentElement.dataset.appTheme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem(APP_THEME_KEY, theme);
      window.localStorage.setItem(LEGACY_DASHBOARD_THEME_KEY, theme);
    } catch { /* storage may be disabled */ }

    return () => {
      delete document.documentElement.dataset.appTheme;
      document.documentElement.style.colorScheme = "";
    };
  }, [theme]);

  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(sidebarExpanded)); } catch { /* storage may be disabled */ }
  }, [sidebarExpanded]);

  const goPage = async (key, opts = {}) => {
    if (key !== "session_capture") {
      setEditingDetainee(null);
      setCaseCtx(null);
    }
    if (key === "scene_traces") {
      if (opts.openCaseId) {
        setActiveCaseId(opts.openCaseId);
        setPage("case_detail");
        return;
      }
      setActiveCaseId(null);
      setCaseCtx(null);
      setSceneCaseId("");
    }
    setPage(key);
  };

  const editDetainee = async (detainee) => {
    let full = detainee;
    try {
      if (detainee?.id) full = await api.getDetainee(detainee.id);
    } catch { /* fallback to given data */ }
    setEditingDetainee(full);
    setCaseCtx({
      caseId: sceneCaseId || activeCaseId || detainee?.case_id || null,
      caseCode: null,
      caseReadOnly: false,
      returnTo: page === "scene_traces" ? "scene_traces" : null,
    });
    setActiveCaseId(null);
    setPage("session_capture");
  };

  const openCase = (caseId) => {
    setActiveCaseId(caseId);
    setPage("case_detail");
  };

  const backToCaseList = () => {
    setActiveCaseId(null);
    setCaseCtx(null);
    setSceneCaseId("");
    setPage("scene_traces");
  };

  const addDetaineeToCase = (caseId) => {
    setEditingDetainee(null);
    setCaseCtx({ caseId, caseCode: null, caseReadOnly: false });
    setPage("session_capture");
  };

  const addSubjectFromScene = (caseId) => {
    setEditingDetainee(null);
    setCaseCtx({ caseId, caseCode: null, caseReadOnly: false, returnTo: "scene_traces" });
    setPage("session_capture");
  };

  const editDetaineeInCase = (detainee, caseDoc) => {
    setEditingDetainee(detainee);
    setCaseCtx({
      caseId: caseDoc.id,
      caseCode: caseDoc.code,
      caseReadOnly: caseDoc.status !== "investigating",
    });
    setPage("session_capture");
  };

  const doneSessionCapture = () => {
    const back = caseCtx?.returnTo;
    setEditingDetainee(null);
    if (back) {
      setCaseCtx(null);
      setPage(back);
      return;
    }
    if (activeCaseId) {
      setPage("case_detail");
    } else {
      setPage("scene_traces");
    }
  };

  const handleCaseClosed = () => {
    setCaseCtx(null);
    setActiveCaseId(null);
    setPage("scene_traces");
  };

  return (
    <div className={`app dashboard-active ${page !== "dashboard" ? "non-dashboard" : ""} ${sidebarExpanded ? "sidebar-expanded" : ""}`} data-dashboard-theme={theme}>
      <Header
        devices={deviceStatus}
        notif={notifState}
        onEditDetainee={editDetainee}
        theme={theme}
        showThemeToggle
        onThemeToggle={() => setTheme((current) => current === "dark" ? "light" : "dark")}
      />
      {showProfileModal && (
        <ProfileEditModal
          username={username}
          fullName={fullName}
          onClose={() => setShowProfileModal(false)}
          onSaved={(newName) => {
            setShowProfileModal(false);
            onFullNameChange && onFullNameChange(newName);
          }}
        />
      )}

      <Sidebar
        page={page}
        goPage={goPage}
        sidebarExpanded={sidebarExpanded}
        setSidebarExpanded={setSidebarExpanded}
        isAdmin={isAdmin}
        fullName={fullName}
        username={username}
        onOpenProfile={() => setShowProfileModal(true)}
        onLogout={onLogout}
      />

      <main className="content">
        {page === "dashboard" && <DashboardHome go={goPage} isAdmin={isAdmin} fullName={fullName} />}
        {page === "detainees" && <DetaineesPage onEdit={editDetainee} />}
        {page === "scene_traces" && (
          sceneCaseId ? (
            <SceneMatchPage
              caseId={sceneCaseId}
              onBack={() => setSceneCaseId("")}
              onAddSubject={addSubjectFromScene}
              onOpenDetainee={editDetainee}
            />
          ) : (
            <CasesPage
              role={role}
              onPick={setSceneCaseId}
              onOpenCase={openCase}
            />
          )
        )}
        {page === "case_detail" && activeCaseId && (
          <CaseDetailPage
            caseId={activeCaseId}
            role={role}
            onBack={backToCaseList}
            onAddDetainee={addDetaineeToCase}
            onEditDetainee={editDetaineeInCase}
            onCaseClosed={handleCaseClosed}
          />
        )}
        {page === "session_capture" && (
          <DataCapturePage
            go={goPage}
            initial={editingDetainee}
            onDone={() => setEditingDetainee(null)}
            caseId={caseCtx?.caseId}
            caseCode={caseCtx?.caseCode}
            caseReadOnly={caseCtx?.caseReadOnly}
            onSavedInCase={doneSessionCapture}
            onEditProfile={editDetainee}
          />
        )}
        {page === "detainee_history" && <HistoryPage onEdit={editDetainee} initialTab="detainee" />}
        {page === "sync" && <SyncPage />}
        {page === "logs" && <HistoryPage onEdit={editDetainee} initialTab="sync" />}
        {page === "users" && isAdmin && <UsersPage currentUser={username} />}
        {page === "settings" && isAdmin && <SettingsPage />}
      </main>
    </div>
  );
}
