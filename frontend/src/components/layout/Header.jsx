import React, { useState, useEffect, useRef } from "react";
import { Bell, Sun, Moon } from "lucide-react";
import { useI18n, LanguageSwitch } from "../../i18n";
import { notify } from "../../notifications";
import DetailModal from "../modals/DetailModal";

const DEVICE_CHIPS = [
  { key: "camera", labelKey: "header.device.camera" },
  { key: "fp", labelKey: "header.device.fp" },
];

export function Header({ devices, notif, onEditDetainee, theme, showThemeToggle, onThemeToggle }) {
  const { t, locale, formatDateTime } = useI18n();
  const chips = DEVICE_CHIPS;
  const [notifOpen, setNotifOpen] = useState(false);
  const [viewingMatch, setViewingMatch] = useState(null);
  const notifRef = useRef(null);

  useEffect(() => {
    if (!notifOpen) return;
    const onClick = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [notifOpen]);

  const toggleNotif = () => {
    const nextOpen = !notifOpen;
    setNotifOpen(nextOpen);
    if (nextOpen && notif?.unread > 0) notify.markAllRead();
  };

  return (
    <header className="header">
      <div className="brand">
        <div className="brand-logo">
          <img src={showThemeToggle ? "/pyxis-favicon.png" : "/pyxis-logo.png"} alt={t("header.brand_logo_alt")} />
        </div>
        <div>
          <div className="brand-title">{t("header.brand_title")}</div>
          <div className="brand-subtitle">{t("header.brand_subtitle")}</div>
        </div>
      </div>

      <div className="header-device-center">
        <div className="device-chips" role="group" aria-label={t("header.device_group")}>
          {chips.map((d) => {
            const ok = Boolean(devices?.[d.key]);
            const label = t(d.labelKey);
            return (
              <div
                key={d.key}
                className={`device-chip ${ok ? "online" : "offline"}`}
                title={`${label}: ${ok ? t("header.device.connected") : t("header.device.disconnected")}`}
              >
                <span className="device-chip-dot" />
                <span className="device-chip-label">{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="header-actions">
        {showThemeToggle && (
          <button
            type="button"
            className="icon-button theme-toggle"
            onClick={onThemeToggle}
            aria-pressed={theme === "light"}
            aria-label={theme === "dark"
              ? (locale === "en" ? "Switch to light mode" : "Chuyển sang giao diện sáng")
              : (locale === "en" ? "Switch to dark mode" : "Chuyển sang giao diện tối")}
            title={theme === "dark"
              ? (locale === "en" ? "Light mode" : "Giao diện sáng")
              : (locale === "en" ? "Dark mode" : "Giao diện tối")}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </button>
        )}

        <div className="notif-wrap" ref={notifRef}>
          <button
            className="icon-button"
            aria-label={t("header.notif.aria")}
            onClick={toggleNotif}
            title={notif?.unread > 0 ? t("header.notif.new", { n: notif.unread }) : t("header.notif.none")}
          >
            <Bell />
            {notif?.unread > 0 && <b>{notif.unread > 99 ? "99+" : notif.unread}</b>}
          </button>
          {notifOpen && (
            <div className="notif-panel">
              <div className="notif-panel-head">
                <strong>{t("header.notif.aria")}</strong>
                {notif?.items?.length > 0 && (
                  <button
                    type="button"
                    className="notif-clear"
                    onClick={() => notify.clearAll()}
                  >
                    {t("common.delete")} {t("common.all").toLowerCase()}
                  </button>
                )}
              </div>
              <div className="notif-panel-list">
                {!notif?.items || notif.items.length === 0 ? (
                  <div className="notif-empty">{t("header.notif.none")}</div>
                ) : (
                  notif.items.map((it) => {
                    const match = it.meta && (it.meta.kind === "match" || it.meta.kind === "face") && it.meta.detainee;
                    return (
                      <div
                        className={"notif-item" + (match ? " notif-item-match" : "")}
                        key={it.id}
                        onClick={match ? () => { setViewingMatch(it.meta.detainee); setNotifOpen(false); } : undefined}
                        role={match ? "button" : undefined}
                        tabIndex={match ? 0 : undefined}
                        title={match ? t("capture.alert.open_profile") : undefined}
                      >
                        <div className={"notif-item-dot" + (match ? " notif-item-dot-alert" : "")} />
                        <div className="notif-item-body">
                          <div className="notif-item-msg">{it.message}</div>
                          <div className="notif-item-time">{formatDateTime(it.at)}</div>
                          {match && (
                            <div className="notif-item-cta">
                              <span className="notif-item-cta-view">{t("capture.alert.open_profile")}</span>
                              {onEditDetainee && (
                                <button
                                  type="button"
                                  className="notif-item-cta-edit"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setNotifOpen(false);
                                    onEditDetainee(it.meta.detainee);
                                  }}
                                >
                                  {t("capture.alert.edit_profile")}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <LanguageSwitch />
      </div>
      {viewingMatch && (
        <DetailModal detainee={viewingMatch} onClose={() => setViewingMatch(null)} />
      )}
    </header>
  );
}

export default Header;
