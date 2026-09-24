import React, { useState, useEffect } from "react";
import {
  BatteryCharging,
  Brain,
  ClipboardList,
  Cpu,
  FileText,
  Folder,
  HardDrive,
  MemoryStick,
  Plus,
  ShieldCheck,
  Thermometer,
} from "lucide-react";
import { api } from "../../api";
import Button from "../../components/Button";
import { StateBox } from "../../components/common/CommonUI";
import { useI18n } from "../../i18n";

const Icon = {
  arrow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}><path d="m9 18 6-6-6-6" /></svg>
  ),
};

function jitter(base, spread, min = 0, max = 100) {
  const v = base + (Math.random() - 0.5) * spread;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function makeHwSample() {
  return {
    cpu: jitter(38, 14),
    ram: jitter(54, 8),
    disk: jitter(41, 3),
    gpu: jitter(22, 10),
    temp: jitter(48, 5, 30, 90),
    battery: jitter(86, 3, 0, 100),
    powerIn: (jitter(53, 6, 30, 90) / 10).toFixed(1),
    fan: jitter(2100, 400, 800, 4200),
    uptime: 4 * 3600 + Math.floor(Math.random() * 60) * 60,
  };
}

export function Sparkline({ data = [], color = "#2371f4" }) {
  if (!data.length) return null;
  const w = 120;
  const h = 28;
  const max = Math.max(1, ...data);
  const step = w / Math.max(1, data.length - 1);
  const points = data.map((v, i) => `${i * step},${h - (v / max) * h}`).join(" ");
  const area = `0,${h} ${points} ${w},${h}`;
  return (
    <svg className="sparkline-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polygon fill={color} fillOpacity="0.15" points={area} />
      <polyline fill="none" stroke={color} strokeWidth="1.8" points={points} />
    </svg>
  );
}

export function BarChart({ data = [] }) {
  const { t } = useI18n();
  if (!data.length) return <div className="empty">{t("dashboard.no_data")}</div>;
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="bar-chart">
      <div className="bar-chart-body">
        {data.map((d) => {
          const pct = d.count ? Math.max(6, Math.round((d.count / max) * 100)) : 0;
          const day = new Date(d.date);
          const label = `${day.getDate()}/${day.getMonth() + 1}`;
          return (
            <div className="bar-col" key={d.date} title={t("dashboard.hoso.for_day", { label, n: d.count })}>
              <span className="bar-count">{d.count || ""}</span>
              <span className="bar-fill" style={{ height: `${pct}%` }} />
              <span className="bar-label">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DonutGender({ male, female, malePct, femalePct }) {
  const { t, formatNumber } = useI18n();
  const total = male + female;
  const r = 52;
  const c = 2 * Math.PI * r;
  const maleLen = total ? (malePct / 100) * c : 0;
  const femaleLen = total ? (femalePct / 100) * c : 0;
  const MALE_GRADIENT = "linear-gradient(135deg, #168BFF, #5145F5)";
  const FEMALE_COLOR = "#8FA3C5";
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 140 140" className="donut">
        <defs>
          <linearGradient id="genderMaleGradient" x1="18" y1="18" x2="122" y2="122" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#168BFF" />
            <stop offset="100%" stopColor="#5145F5" />
          </linearGradient>
          <filter id="genderRingGlow" x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation="3.2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(53, 216, 255, 0.10)" strokeWidth="18" />
        <circle
          cx="70" cy="70" r={r} fill="none"
          stroke="url(#genderMaleGradient)" strokeWidth="18" strokeLinecap="round"
          strokeDasharray={`${maleLen} ${c}`}
          transform="rotate(-90 70 70)"
          filter="url(#genderRingGlow)"
        />
        <circle
          cx="70" cy="70" r={r} fill="none"
          stroke={FEMALE_COLOR} strokeWidth="18" strokeLinecap="butt"
          strokeDasharray={`${femaleLen} ${c}`}
          strokeDashoffset={-maleLen}
          transform="rotate(-90 70 70)"
        />
        <text x="70" y="66" textAnchor="middle" className="donut-value">{malePct}%</text>
        <text x="70" y="86" textAnchor="middle" className="donut-label">{t("dashboard.donut.male")}</text>
      </svg>
      <div className="donut-legend">
        <div className="donut-legend-row">
          <span className="donut-dot donut-dot-male" style={{ background: MALE_GRADIENT }} />
          <span>{t("dashboard.donut.male")}</span>
          <strong>{formatNumber(male)}</strong>
          <small>{malePct}%</small>
        </div>
        <div className="donut-legend-row">
          <span className="donut-dot" style={{ background: FEMALE_COLOR }} />
          <span>{t("dashboard.donut.female")}</span>
          <strong>{formatNumber(female)}</strong>
          <small>{femalePct}%</small>
        </div>
      </div>
    </div>
  );
}

export function HardwareTile({ value, label, tone, icon }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className={`hardware-tile hardware-tile-${tone}`} aria-label={`${label}: ${pct}%`} title={`${label}: ${pct}%`}>
      <div className="hardware-tile-top">
        <span className="hardware-tile-icon" aria-hidden="true">{icon}</span>
        <span className="hardware-tile-value">{pct}%</span>
      </div>
      <strong>{label}</strong>
      <div className="hardware-tile-track">
        <div className="hardware-tile-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function HardwareBar({ label, value, unit = "%", tone = "cyan", icon }) {
  const palette = {
    red: "#ef4444",
    orange: "#f59e0b",
    green: "#24d777",
    blue: "#3b82f6",
    cyan: "#35d8ff",
    purple: "#8b5cf6",
  };
  const color = palette[tone] || palette.cyan;
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="hw-bar">
      <div className="hw-bar-head">
        <span className="hw-bar-label">
          {icon && <span className="hw-bar-icon" aria-hidden="true">{icon}</span>}
          {label}
        </span>
        <strong className="hw-bar-val">{value}{unit}</strong>
      </div>
      <div className="hw-bar-track">
        <div className="hw-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function HardwareStatus({ hw }) {
  const { t, formatNumber } = useI18n();
  const uptimeH = Math.floor(hw.uptime / 3600);
  const uptimeM = Math.floor((hw.uptime % 3600) / 60);
  return (
    <div className="hw-status">
      <div className="hw-rings">
        <HardwareTile value={hw.cpu} label={t("hw.cpu")} tone="green" icon={<Cpu />} />
        <HardwareTile value={hw.ram} label={t("hw.ram")} tone="purple" icon={<MemoryStick />} />
        <HardwareTile value={hw.disk} label={t("hw.disk")} tone="blue" icon={<HardDrive />} />
        <HardwareTile value={hw.gpu} label={t("hw.chip")} tone="pink" icon={<Brain />} />
      </div>
      <div className="hw-bars">
        <HardwareBar
          icon={<Thermometer size={14} />}
          label={t("hw.temp")}
          value={hw.temp}
          unit="°C"
          tone={hw.temp > 70 ? "red" : hw.temp > 55 ? "orange" : "cyan"}
        />
        <HardwareBar
          icon={<BatteryCharging size={14} />}
          label={t("hw.battery")}
          value={hw.battery}
          tone={hw.battery < 20 ? "red" : hw.battery < 50 ? "orange" : "cyan"}
        />
      </div>
      <div className="hw-meta">
        <div className="hw-meta-item">
          <span>{t("hw.power_in")}</span>
          <strong>{hw.powerIn} V</strong>
        </div>
        <div className="hw-meta-item">
          <span>{t("hw.fan")}</span>
          <strong>{formatNumber(hw.fan)} rpm</strong>
        </div>
        <div className="hw-meta-item">
          <span>{t("hw.uptime")}</span>
          <strong>{uptimeH}h {String(uptimeM).padStart(2, "0")}m</strong>
        </div>
        <div className="hw-meta-item">
          <span>{t("hw.status")}</span>
          <strong className="hw-meta-ok">{t("hw.ready")}</strong>
        </div>
      </div>
    </div>
  );
}

export function StatCard({ tone, icon, label, value, note, ring, delta, extra, alert, onClick }) {
  return (
    <div className={`stat-card ${tone} ${onClick ? "clickable" : ""}`} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-content">
        <span>{label}</span>
        <strong>{value}</strong>
        <small className={alert ? "stat-alert" : ""}>{note}</small>
      </div>
      {extra ? (
        <div className="stat-extra">{extra}</div>
      ) : typeof ring === "number" ? (
        <div
          className="stat-ring"
          style={{ background: `conic-gradient(#35D8FF ${ring}%, rgba(53, 216, 255, 0.12) 0)` }}
        >
          <span>{ring}%</span>
        </div>
      ) : (
        <div className="sparkline">⌁</div>
      )}
    </div>
  );
}

export function PanelHeader({ title, action, onAction, showChevron = true }) {
  return (
    <div className="panel-header">
      <h3>{title}</h3>
      {(action || onAction) ? (
        <button onClick={onAction}>
          {action}
          {Icon.arrow}
        </button>
      ) : showChevron ? (
        <span className="panel-chevron" aria-hidden="true">{Icon.arrow}</span>
      ) : null}
    </div>
  );
}

export function DashboardHome({ go, isAdmin = false, fullName = "" }) {
  const { t, locale, greeting, dayNames, formatNumber, formatDateTime, formatDate } = useI18n();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(new Date());
  const [hw, setHw] = useState(() => makeHwSample());

  useEffect(() => {
    api.stats().then(setStats).catch((e) => setError(e.message));
    const tmr = setInterval(() => setNow(new Date()), 30_000);
    const th = setInterval(() => setHw(makeHwSample()), 2500);
    return () => { clearInterval(tmr); clearInterval(th); };
  }, []);

  if (error) return <StateBox type="error">{t("common.error_prefix", { message: error })}</StateBox>;
  if (!stats) return <StateBox>{t("dashboard.loading")}</StateBox>;

  const total = stats.total || 0;
  const male = stats.male || 0;
  const female = stats.female || 0;
  const malePct = total ? Math.round((male / total) * 100) : 0;
  const femalePct = total ? 100 - malePct : 0;
  const activity = stats.activity_14d || [];
  const recentCases = stats.recent_cases || [];
  const recentDetainees = stats.recent || [];
  const recentActivity = stats.recent_activity || [];
  const investigatingCases = stats.investigating_cases || 0;
  const missing = stats.missing_data_count || 0;

  const hour = now.getHours();
  const greet = greeting(hour);
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const dateStr = `${dayNames[now.getDay()]}, ${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;

  const todayDelta = stats.today - (stats.yesterday || 0);

  return (
    <div className="page dashboard-page">
      <div className="dash-hero">
        <div>
          <h1 title={`${greet}, ${fullName || t("dashboard.greet_officer_default")}`}>{greet}, {fullName || t("dashboard.greet_officer_default")} <span className="dash-hero-wave" aria-hidden="true">👋</span></h1>
          <p>{timeStr} • {dateStr}</p>
          <span className="dash-hero-motto">{locale === "en" ? "Have a productive day!" : "Hôm nay là một ngày làm việc hiệu quả!"}</span>
        </div>
        <div className="dash-hero-session">
          <div className="dash-hero-session-info">
            <div className="dash-hero-session-head">
              <span className="dash-hero-badge">{t("dashboard.case.investigating_badge")}</span>
              <strong className="dash-hero-count">{formatNumber(investigatingCases)}</strong>
            </div>
            <small>{t("dashboard.case.investigating_hint")}</small>
          </div>
          <Button
            className="dashboard-primary-action"
            variant="primary"
            size="large"
            startIcon={isAdmin ? null : <Plus />}
            onClick={() => go("scene_traces")}
          >
            {t(isAdmin ? "dashboard.case.view_all" : "dashboard.case.manage")}
          </Button>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard
          tone="blue"
          icon={<FileText />}
          label={t("dashboard.stat.today")}
          value={stats.today}
          note={todayDelta === 0 ? t("dashboard.stat.today.same") : todayDelta > 0 ? t("dashboard.stat.today.up", { n: todayDelta }) : t("dashboard.stat.today.down", { n: Math.abs(todayDelta) })}
          delta={todayDelta}
          extra={<Sparkline data={activity.map((a) => a.count)} color="#21d4fd" />}
        />
        <StatCard
          tone="purple"
          icon={<Folder />}
          label={t("dashboard.stat.total")}
          value={formatNumber(total)}
          note={t("dashboard.stat.total.note")}
          onClick={() => go("detainees")}
        />
        <StatCard
          tone="orange"
          icon={<ClipboardList />}
          label={t("dashboard.stat.investigating_cases")}
          value={investigatingCases}
          note={investigatingCases ? t("dashboard.stat.investigating_cases.note") : t("dashboard.stat.investigating_cases.none")}
          onClick={() => go("scene_traces")}
        />
        <StatCard
          tone={missing > 0 ? "orange" : "green"}
          icon={<ShieldCheck />}
          label={t("dashboard.stat.missing")}
          value={missing}
          note={missing > 0 ? t("dashboard.stat.missing.need") : t("dashboard.stat.missing.ok")}
          alert={missing > 0}
          onClick={() => go("detainees")}
        />
      </div>

      <div className="dashboard-body">
        <section className="panel">
          <PanelHeader title={t("dashboard.panel.activity14")} />
          <BarChart data={activity} />
        </section>

        <section className="panel panel-donut">
          <PanelHeader title={t("dashboard.panel.gender")} />
          <DonutGender male={male} female={female} malePct={malePct} femalePct={femalePct} />
        </section>

        <section className="panel">
          <PanelHeader
            title={t("dashboard.panel.recent_detainees")}
            action={t("dashboard.panel.view_all")}
            onAction={() => go("detainees")}
          />
          <div className="dash-detainee-list">
            {recentDetainees.map((d) => (
              <div
                className="dash-detainee-row"
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => go("detainees")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    go("detainees");
                  }
                }}
              >
                <div className="dash-detainee-avatar">
                  {d.photo_url ? (
                    <img src={d.photo_url} alt="" />
                  ) : (
                    <span>{(d.full_name || "?").slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <div className="dash-detainee-main">
                  <div className="dash-detainee-line">
                    <strong>{d.full_name || "—"}</strong>
                    <small className="mono">{d.personal_id || d.code || "—"}</small>
                  </div>
                  <div className="dash-detainee-meta">
                    {d.cccd_number ? `CCCD: ${d.cccd_number}` : (d.gender === "female" ? t("common.female") : t("common.male"))}
                    {d.charge ? ` • ${d.charge}` : (d.dob ? ` • ${formatDate(d.dob)}` : "")}
                  </div>
                </div>
                <span className="dash-detainee-badge">
                  {d.gender === "female" ? t("common.female") : t("common.male")}
                </span>
              </div>
            ))}
            {!recentDetainees.length && <div className="empty">{t("dashboard.detainee.list.empty")}</div>}
          </div>
        </section>

        <section className="panel">
          <PanelHeader
            title={t("dashboard.panel.recent_cases")}
            action={t("dashboard.panel.view_all")}
            onAction={() => go("scene_traces")}
          />
          <div className="session-list">
            {recentCases.map((c) => {
              const open = c.status === "investigating";
              return (
                <div
                  className="session-row"
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => go("scene_traces", { openCaseId: c.id })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      go("scene_traces", { openCaseId: c.id });
                    }
                  }}
                >
                  <span className={`session-dot ${open ? "open" : "closed"}`} />
                  <div className="session-main">
                    <div className="session-line">
                      <strong>{c.name || c.code}</strong>
                      <small className="mono">{c.code}</small>
                    </div>
                    <div className="session-meta">
                      {t("dashboard.case.record_count", { n: c.detainee_count || 0 })}
                      {" • "}{formatDateTime(c.occurred_at)}
                      {c.officer_name && ` • ${c.officer_rank ? `${c.officer_rank} ` : ""}${c.officer_name}`}
                    </div>
                  </div>
                  <span className={`session-status ${open ? "open" : "closed"}`}>
                    {t(open ? "case.status.investigating" : "case.status.closed")}
                  </span>
                </div>
              );
            })}
            {!recentCases.length && <div className="empty">{t("dashboard.case.list.empty")}</div>}
          </div>
        </section>

        <section className="panel">
          <PanelHeader
            title={t("dashboard.panel.logs")}
            action={t("dashboard.panel.view_report")}
            onAction={() => go("detainee_history")}
          />
          <div className="activity-feed">
            {recentActivity.map((a) => (
              <div className="activity-row" key={a.id}>
                <span className={`activity-dot ${a.action}`} />
                <div className="activity-main">
                  <div className="activity-line">
                    <strong>{a.actor_full_name}</strong> {t(`activity.${a.action}`, undefined) || a.action}{" "}
                    <span className="mono">{a.ref || a.resource}</span>
                  </div>
                  <div className="activity-time">{formatDateTime(a.at)}</div>
                </div>
              </div>
            ))}
            {!recentActivity.length && <div className="empty">{t("dashboard.activity.empty")}</div>}
          </div>
        </section>

        <section className="panel">
          <PanelHeader title={t("dashboard.panel.hardware")} showChevron={false} />
          <HardwareStatus hw={hw} />
        </section>
      </div>
    </div>
  );
}

export default DashboardHome;
