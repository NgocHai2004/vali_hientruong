import React from "react";
import {
  LayoutDashboard,
  Folder,
  FileText,
  History,
  RefreshCw,
  Settings,
  Users,
  ChevronRight,
  LogOut,
} from "lucide-react";
import { useI18n } from "../../i18n";

export const NAV_BASE = [
  { key: "dashboard", labelKey: "nav.dashboard", icon: <LayoutDashboard />, dashboardLabel: { vi: "Tổng quan", en: "Overview" } },
  { key: "scene_traces", labelKey: "nav.scene_traces", icon: <Folder />, dashboardLabel: { vi: "Vụ án", en: "Cases" } },
  { key: "detainees", labelKey: "nav.detainees", icon: <FileText />, dashboardLabel: { vi: "Hồ sơ", en: "Profiles" } },
  { key: "detainee_history", labelKey: "nav.detainee_history", icon: <History />, dashboardLabel: { vi: "Lịch sử", en: "History" } },
  { key: "sync", labelKey: "nav.sync", icon: <RefreshCw />, dashboardSecondary: true },
];

export const NAV_ADMIN = [
  { key: "settings", labelKey: "nav.settings", icon: <Settings />, dashboardLabel: { vi: "Cài đặt", en: "Settings" } },
  { key: "users", labelKey: "nav.users", icon: <Users />, dashboardSecondary: true },
];

export function Sidebar({
  page,
  goPage,
  sidebarExpanded,
  setSidebarExpanded,
  isAdmin,
  fullName,
  username,
  onOpenProfile,
  onLogout,
}) {
  const { t, locale } = useI18n();
  const navItems = isAdmin ? [...NAV_BASE, ...NAV_ADMIN] : NAV_BASE;

  return (
    <aside className="sidebar">
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setSidebarExpanded((expanded) => !expanded)}
        aria-label={sidebarExpanded ? "Thu gọn thanh điều hướng" : "Mở rộng thanh điều hướng"}
        aria-expanded={sidebarExpanded}
      >
        <ChevronRight className="sidebar-toggle-chevron" />
      </button>
      <nav className="nav">
        {navItems.map((item) => (
          <button
            key={item.key}
            className={`nav-item ${page === item.key ? "active" : ""} ${item.dashboardSecondary ? "dashboard-secondary" : ""}`}
            onClick={() => goPage(item.key)}
            data-tip={t(item.labelKey)}
            aria-label={t(item.labelKey)}
            aria-current={page === item.key ? "page" : undefined}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.dashboardLabel ? item.dashboardLabel[locale] : t(item.labelKey)}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-account-area">
        <button
          type="button"
          className="sidebar-account"
          onClick={onOpenProfile}
          aria-label={t("profile.edit_menu")}
          data-tip={t("profile.edit_menu")}
        >
          <span className="sidebar-account-avatar">{(fullName || username || "U").slice(0, 1).toUpperCase()}</span>
          <span className="sidebar-account-copy">
            <strong>{fullName || username}</strong>
            <small>{isAdmin ? t("common.role.admin") : t("common.role.officer")}</small>
          </span>
        </button>
        <button
          type="button"
          className="sidebar-logout"
          onClick={onLogout}
          aria-label={t("header.logout")}
          data-tip={t("header.logout")}
        >
          <span className="sidebar-logout-icon"><LogOut /></span>
          <span className="sidebar-logout-label">{t("header.logout")}</span>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
