import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  Apple,
  Bell,
  Clock3,
  Cpu,
  FileText,
  HardDrive,
  LayoutDashboard,
  LogIn,
  LogOut,
  LockKeyhole,
  Monitor,
  Menu,
  Network,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  SquarePower,
  UserRound,
  Wifi,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./styles.css";
import "./dashboard.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api";
const REFRESH_SECONDS = 30;
const LIVE_REFRESH_SECONDS = 30;
const nav = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Live Monitoring", icon: Activity },
  { label: "Systems", icon: HardDrive },
  { label: "Alerts", icon: Bell },
  { label: "Port Monitoring", icon: Network },
  { label: "Commands", icon: RotateCcw },
  { label: "Reports", icon: FileText },
  { label: "Audit Logs", icon: FileText },
  { label: "Settings", icon: Settings },
];

const formatTime = (value) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "--:--:--";
const ageLabel = (value) => {
  if (!value) return "Never";
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 1000),
  );
    return seconds < 60 ? `${seconds} sec ago` : `${Math.floor(seconds / 60)} min ago`;
};

const normalizePlatform = (value) => {
  const platform = String(value || "windows").toLowerCase();
  if (platform.startsWith("win")) return "Windows";
  if (platform.startsWith("lin")) return "Linux";
  if (platform.startsWith("mac") || platform === "darwin") return "macOS";
  return "Windows";
};

const getPlatformMeta = (value) => {
  const platform = String(value || "windows").toLowerCase();
  if (platform.startsWith("lin")) return { label: "LINUX", short: "Linux", tone: "linux", icon: Cpu };
  if (platform.startsWith("mac") || platform === "darwin") return { label: "MACOS", short: "macOS", tone: "macos", icon: Apple };
  return { label: "WINDOWS", short: "Windows", tone: "windows", icon: Monitor };
};

function App() {
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("sentinel_session")) || null;
    } catch {
      return null;
    }
  });
  if (!session?.token)
    return (
      <Login
        onLogin={(value) => {
          localStorage.setItem("sentinel_session", JSON.stringify(value));
          setSession(value);
        }}
      />
    );
  return (
    <Dashboard
      session={session}
      logout={() => {
        localStorage.removeItem("sentinel_session");
        setSession(null);
      }}
    />
  );
}

function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      onLogin(result);
    } catch (loginError) {
      setError(loginError.message || "Unable to sign in");
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="login-shell">
      <div className="login-visual">
        <div className="login-orbit orbit-one" />
        <div className="login-orbit orbit-two" />
        <div className="login-brand">
          <div className="brand-mark" aria-label="SMH">SMH</div>
          <div>
            <strong>SMH</strong>
            <small>SYSTEM MONITORING HEALTH</small>
          </div>
        </div>
        <div className="login-message">
          <p className="kicker">CENTRAL IT OPERATIONS</p>
          <h1>Every machine. One clear signal.</h1>
          <p>
            Monitor Windows health, security, network exposure, and authorized
            power actions from one control plane.
          </p>
          <div className="login-signal">
            <span>
              <i /> 30 second telemetry
            </span>
            <span>
              <i /> Role-protected actions
            </span>
          </div>
        </div>
      </div>
      <section className="login-panel">
        <div className="login-panel-inner">
          <div className="login-icon">
            <LockKeyhole size={20} />
          </div>
          <p className="kicker">SECURE ACCESS</p>
          <h2>Welcome back</h2>
          <p className="muted">
            Sign in to continue to your operations center.
          </p>
          <form onSubmit={submit}>
            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="primary wide-button" disabled={loading}>
              {loading ? (
                "Signing in..."
              ) : (
                <>
                  <LogIn size={16} /> Sign in
                </>
              )}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function Dashboard({ session, logout }) {
  const [page, setPage] = useState("Overview");
  const [systems, setSystems] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [commands, setCommands] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [settings, setSettings] = useState(null);
  const [platformSummary, setPlatformSummary] = useState({
    windows: { total: 0, online: 0, offline: 0, warning: 0, critical: 0 },
    linux: { total: 0, online: 0, offline: 0, warning: 0, critical: 0 },
    macos: { total: 0, online: 0, offline: 0, warning: 0, critical: 0 },
  });
  const [liveMonitoring, setLiveMonitoring] = useState({ systems: [], summary: {} });
  const [liveError, setLiveError] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [nextRefresh, setNextRefresh] = useState(REFRESH_SECONDS);
  const [serverError, setServerError] = useState(false);
  const [selected, setSelected] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [mobile, setMobile] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("sentinel_theme") || "dark";
    } catch {
      return "dark";
    }
  });
  const [globalQuery, setGlobalQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [reportPeriod, setReportPeriod] = useState({
    preset: "24h",
    from: "",
    to: "",
  });
  const headers = { Authorization: `Bearer ${session.token}` };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("sentinel_theme", theme);
    } catch {}
  }, [theme]);

  const loadData = async () => {
    try {
      const responses = await Promise.all(
        ["systems", "platform-summary", "alerts", "commands", "audit-logs", "settings"].map(
          (path) => fetch(`${API}/${path}`, { headers }),
        ),
      );
      if (responses.some((response) => response.status === 401))
        return logout();
      if (responses.some((response) => !response.ok))
        throw new Error("API request failed");
      const [systemData, platformSummaryData, alertData, commandData, auditData, settingData] =
        await Promise.all(responses.map((response) => response.json()));
      setSystems(systemData);
      setPlatformSummary(platformSummaryData);
      setAlerts(alertData);
      setCommands(commandData);
      setAuditLogs(auditData);
      setSettings(settingData);
      setLastUpdate(new Date());
      setNextRefresh(REFRESH_SECONDS);
      setServerError(false);
    } catch {
      setServerError(true);
    }
  };
  const loadLiveMonitoring = async () => {
    try {
      const response = await fetch(`${API}/live-monitoring`, { headers });
      if (response.status === 401) return logout();
      if (!response.ok) throw new Error("Live monitoring request failed");
      setLiveMonitoring(await response.json());
      setLiveError(false);
    } catch {
      setLiveError(true);
    }
  };
  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, REFRESH_SECONDS * 1000);
    const countdown = setInterval(
      () =>
        setNextRefresh((value) => (value <= 1 ? REFRESH_SECONDS : value - 1)),
      1000,
    );
    return () => {
      clearInterval(timer);
      clearInterval(countdown);
    };
  }, [session.token]);
  useEffect(() => {
    loadLiveMonitoring();
    const timer = setInterval(loadLiveMonitoring, LIVE_REFRESH_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [session.token]);

  const performAction = async () => {
    if (!confirm) return;
    const response = await fetch(
      `${API}/systems/${confirm.system._id}/actions/${confirm.action.toLowerCase()}`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: "{}",
      },
    );
    if (response.ok) await loadData();
    setConfirm(null);
  };

  const downloadReport = async (system) => {
    const params = new URLSearchParams();
    if (reportPeriod.preset === "custom") {
      if (!reportPeriod.from || !reportPeriod.to)
        return window.alert("Choose both dates for a custom report period.");
      params.set("from", new Date(reportPeriod.from).toISOString());
      params.set("to", new Date(reportPeriod.to).toISOString());
    } else params.set("period", reportPeriod.preset);
    const response = await fetch(
      `${API}/systems/${system._id}/report/pdf?${params}`,
      { headers },
    );
    if (!response.ok)
      return window.alert("Unable to generate the health report.");
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `SystemHealth_${system.hostname}_${new Date().toISOString().slice(0, 10)}.pdf`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const downloadBulkReport = async (systemIds) => {
    if (!systemIds.length) return window.alert("Select at least one system.");
    const response = await fetch(`${API}/reports/pdf`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemIds,
        period: reportPeriod.preset,
        from: reportPeriod.from ? new Date(reportPeriod.from).toISOString() : undefined,
        to: reportPeriod.to ? new Date(reportPeriod.to).toISOString() : undefined,
      }),
    });
    if (!response.ok) return window.alert("Unable to generate the selected reports.");
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `System-Health-Reports-${new Date().toISOString().slice(0, 10)}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const liveById = useMemo(
    () => new Map(liveMonitoring.systems.map((system) => [system._id, system])),
    [liveMonitoring.systems],
  );
  const dashboardSystems = useMemo(() => systems.map((system) => {
    const live = liveById.get(system._id);
    const current = live?.current;
    const health = current?.systemHealth || {};
    const memory = health.memory || {};
    const cpu = health.cpu || {};
    const disk = health.disk || {};
    const diskVolumes = disk.volumes || [];
    const diskUsages = diskVolumes.map((volume) => volume.usagePercent).filter((value) => typeof value === "number" && Number.isFinite(value));
    const security = health.security || {};
    return {
      ...system,
      ip: live?.ipAddress || system.ipAddress || system.ip,
      os: live?.os || system.os,
      status: live?.status || "offline",
      lastHeartbeat: live?.lastHeartbeat || null,
      cpuPercent: live?.isCurrent ? (cpu.usagePercent ?? health.cpuPercent ?? system.cpuPercent) : null,
      memoryPercent: live?.isCurrent ? (memory.usagePercent ?? health.memoryPercent ?? system.memoryPercent) : null,
      diskPercent: live?.isCurrent ? (diskUsages.length ? Math.max(...diskUsages) : health.diskPercent ?? system.diskPercent) : null,
      antivirus: live?.isCurrent ? (security.antivirus || system.antivirus) : null,
      firewall: live?.isCurrent ? (security.firewall || system.firewall) : null,
      network: live?.isCurrent ? current.network : null,
      listeningPorts: live?.isCurrent ? (health.ports || system.listeningPorts) : [],
    };
  }), [systems, liveById]);

  const matchingSystems = useMemo(() => {
    const query = globalQuery.trim().toLowerCase();
    const byPlatform = platformFilter === "all"
      ? dashboardSystems
      : dashboardSystems.filter((system) => normalizePlatform(system.platform).toLowerCase() === platformFilter);
    if (!query) return byPlatform;
    return byPlatform.filter((system) =>
      [system.hostname, system.ip, system._id, system.os]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [dashboardSystems, globalQuery, platformFilter]);

  const platformSummaryCards = useMemo(() => [
    { key: "windows", label: "Windows", total: platformSummary.windows?.total ?? 0, online: platformSummary.windows?.online ?? 0, offline: platformSummary.windows?.offline ?? 0, warning: platformSummary.windows?.warning ?? 0, critical: platformSummary.windows?.critical ?? 0 },
    { key: "linux", label: "Linux", total: platformSummary.linux?.total ?? 0, online: platformSummary.linux?.online ?? 0, offline: platformSummary.linux?.offline ?? 0, warning: platformSummary.linux?.warning ?? 0, critical: platformSummary.linux?.critical ?? 0 },
    { key: "macos", label: "macOS", total: platformSummary.macos?.total ?? 0, online: platformSummary.macos?.online ?? 0, offline: platformSummary.macos?.offline ?? 0, warning: platformSummary.macos?.warning ?? 0, critical: platformSummary.macos?.critical ?? 0 },
  ], [platformSummary]);

  const counts = useMemo(
    () => ({
      total: matchingSystems.length,
      online: matchingSystems.filter((s) => s.status === "online").length,
      offline: matchingSystems.filter((s) => s.status === "offline").length,
      healthy: matchingSystems.filter((s) => s.status === "online").length,
      warning: matchingSystems.filter((s) => s.status === "warning").length,
      critical: matchingSystems.filter((s) => s.status === "critical").length,
      antivirus: matchingSystems.filter((s) => s.antivirus?.enabled === false).length,
      firewall: matchingSystems.filter(
        (s) =>
          s.firewall?.domain === false || s.firewall?.private === false || s.firewall?.public === false,
      ).length,
      highCpu: matchingSystems.filter((s) => s.cpuPercent >= 80).length,
      highRam: matchingSystems.filter((s) => s.memoryPercent >= 80).length,
      lowDisk: matchingSystems.filter((s) => s.diskPercent >= 80).length,
      portProblems: matchingSystems.filter((s) =>
        (s.listeningPorts || []).some(
          (port) => !(settings?.allowedPorts || []).includes(Number(port.port)),
        ),
      ).length,
      networkProblems: matchingSystems.filter((s) => s.network?.status === "CRITICAL" || s.network?.connected === false).length,
    }),
    [matchingSystems, settings],
  );

  const content =
    page === "Live Monitoring" ? (
      <LiveMonitoring
        records={liveMonitoring.systems}
        summary={liveMonitoring.summary}
        error={liveError}
        onSelect={setSelected}
      />
    ) : page === "Systems" ? (
      <Systems
        systems={matchingSystems}
        platformFilter={platformFilter}
        setPlatformFilter={setPlatformFilter}
        onSelect={setSelected}
        onAction={setConfirm}
        onReport={downloadReport}
        isAdmin={session.user.role === "Administrator"}
        reportPeriod={reportPeriod}
        setReportPeriod={setReportPeriod}
      />
    ) : page === "Alerts" ? (
      <Alerts alerts={alerts} />
    ) : page === "Port Monitoring" ? (
      <Ports systems={matchingSystems} settings={settings} />
    ) : page === "Commands" ? (
      <Commands commands={commands} />
    ) : page === "Reports" ? (
      <BulkReports
        systems={matchingSystems}
        reportPeriod={reportPeriod}
        setReportPeriod={setReportPeriod}
        onGenerate={downloadBulkReport}
      />
    ) : page === "Audit Logs" ? (
      <AuditLogs logs={auditLogs} />
    ) : page === "Settings" ? (
      <SettingsPage settings={settings} />
    ) : (
      <Overview
        systems={matchingSystems}
        counts={counts}
        platformSummary={platformSummaryCards}
        platformFilter={platformFilter}
        setPlatformFilter={setPlatformFilter}
        onSelect={setSelected}
        onAction={setConfirm}
        onReport={downloadReport}
        isAdmin={session.user.role === "Administrator"}
      />
    );

  return (
    <div className="app-shell">
      <aside className={mobile ? `sidebar open ${sidebarCollapsed ? "collapsed" : ""}` : `sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="brand">
          <div className="brand-mark" aria-label="SMH">SMH</div>
          <div className="brand-copy">
            <strong>System Monitoring Health</strong>
            <small>SMH</small>
          </div>
          <button
            className="icon-button mobile-close"
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="nav-header-row">
          <div className="nav-label">WORKSPACE</div>
          <button
            className="icon-button collapse-button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <Menu size={16} /> : <SlidersHorizontal size={16} />}
          </button>
        </div>
        <nav className="nav-list">
          {nav.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={page === label ? "nav-item active" : "nav-item"}
              onClick={() => {
                setPage(label);
                setMobile(false);
              }}
              title={label}
              aria-label={label}
            >
              <Icon size={18} />
              <span>{label}</span>
              {label === "Alerts" && (
                <b>{alerts.filter((a) => a.status === "open").length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="avatar">
            <UserRound size={15} />
          </div>
          <div className="user-meta">
            <strong>{session.user.name}</strong>
            <small>{session.user.role}</small>
          </div>
          <button className="icon-button" onClick={logout} title="Log out" aria-label="Log out">
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button menu-button"
              onClick={() => setMobile(true)}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <div className="topbar-title">
              <span className="eyebrow">
                CENTRAL MONITORING / {session.user.role.toUpperCase()}
              </span>
              <h1>{page}</h1>
            </div>
          </div>

          <div className="topbar-search" role="search">
            <Search size={15} />
            <input
              value={globalQuery}
              onChange={(event) => setGlobalQuery(event.target.value)}
              placeholder="Search hostname, IP or system ID"
              aria-label="Search systems"
            />
          </div>

          <div className="top-actions">
            <div className="header-badges">
              <div className="mini-pill">
                <span>Last updated</span>
                <strong>{formatTime(lastUpdate)}</strong>
              </div>
              <div className="mini-pill">
                <span>Next refresh</span>
                <strong>{serverError ? "--" : `${nextRefresh}s`}</strong>
              </div>
            </div>
            <span
              className={serverError || liveError ? "live-indicator error" : "live-indicator"}
            >
              <i />
              {serverError || liveError ? "Monitoring unavailable" : "Live Monitoring"}
            </span>
            <button className="refresh-button" onClick={() => { loadData(); loadLiveMonitoring(); }}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button
              className="theme-button"
              onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
              aria-label="Toggle color theme"
            >
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            <div className="profile-button" title={`${session.user.name} · ${session.user.role}`}>
              <span>{session.user.name?.slice(0, 2).toUpperCase()}</span>
            </div>
          </div>
        </header>
        <div className="update-strip">
          <span>
            <strong>{alerts.filter((alert) => alert.status === "open").length}</strong> open alerts
          </span>
          <span>
            <strong>{serverError ? "Connection issue" : "Monitoring active"}</strong>
          </span>
          <span>
            Last refresh: <strong>{formatTime(lastUpdate)}</strong>
          </span>
          <span>
            Next refresh: <strong>{serverError ? "waiting" : `${nextRefresh}s`}</strong>
          </span>
        </div>
        <div className="content">{content}</div>
      </main>
      {selected && (
        <SystemDetails
          system={dashboardSystems.find((system) => system._id === selected._id) || selected}
          live={liveById.get(selected._id)}
          headers={headers}
          close={() => setSelected(null)}
          onReport={downloadReport}
        />
      )}{" "}
      {confirm && (
        <ConfirmDialog
          confirm={confirm}
          close={() => setConfirm(null)}
          submit={performAction}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, tone = "blue", detail, accent }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}>
        <Icon size={19} />
      </div>
      <div className="stat-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail || (accent ? `Flagged: ${accent}` : "No historical trend available")}</small>
      </div>
    </div>
  );
}

function InfrastructureHealth({ counts }) {
  const segments = [
    { label: "Healthy", value: counts.healthy, color: "var(--success)" },
    { label: "Warning", value: counts.warning, color: "var(--warning)" },
    { label: "Critical", value: counts.critical, color: "var(--danger)" },
    { label: "Offline", value: counts.offline, color: "var(--muted)" },
  ];
  const active = segments.filter((segment) => segment.value > 0);
  const total = active.reduce((sum, item) => sum + item.value, 0) || 1;
  const donutBackground = `conic-gradient(${segments
    .map((segment) => {
      const start = segments
        .slice(0, segments.indexOf(segment))
        .reduce((sum, current) => sum + current.value, 0);
      const end = start + segment.value;
      return `${segment.color} ${start / total * 100}% ${end / total * 100}%`;
    })
    .join(", ")})`;

  return (
    <section className="panel overview-panel">
      <div className="section-heading">
        <div>
          <p className="kicker">INFRASTRUCTURE HEALTH</p>
          <h3>System status overview</h3>
        </div>
      </div>
      <div className="health-layout">
        <div className="donut-chart" style={{ background: donutBackground }}>
          <div className="donut-center">
            <strong>{counts.total}</strong>
            <span>systems</span>
          </div>
        </div>
        <div className="legend-list">
          {segments.map((segment) => (
            <button
              key={segment.label}
              type="button"
              className="legend-item"
              title={`Filter ${segment.label.toLowerCase()}`}
            >
              <span className="legend-swatch" style={{ background: segment.color }} />
              <div>
                <strong>{segment.label}</strong>
                <small>{segment.value} systems</small>
              </div>
              <b>{Math.round((segment.value / Math.max(1, counts.total)) * 100)}%</b>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function PlatformOverview({ platformSummary, platformFilter, setPlatformFilter }) {
  const total = platformSummary.reduce((sum, item) => sum + item.total, 0);

  return (
    <section className="panel overview-panel">
      <div className="section-heading">
        <div>
          <p className="kicker">PLATFORM DISTRIBUTION</p>
          <h3>Windows, Linux, and macOS fleet mix</h3>
        </div>
      </div>

      <div className="platform-toggle-group" role="tablist" aria-label="Platform filters">
        <button type="button" className={platformFilter === "all" ? "platform-toggle active" : "platform-toggle"} onClick={() => setPlatformFilter("all")}>All ({total})</button>
        {platformSummary.map((platform) => (
          <button key={platform.key} type="button" className={platformFilter === platform.key ? "platform-toggle active" : "platform-toggle"} onClick={() => setPlatformFilter(platform.key)}>{platform.label} ({platform.total})</button>
        ))}
      </div>

      <div className="platform-summary-grid">
        {platformSummary.map((platform) => {
          const pct = total ? Math.round((platform.total / total) * 100) : 0;
          return (
            <div key={platform.key} className={`platform-summary-card ${platform.key}`}>
              <div className="platform-summary-header">
                <div className={`platform-badge ${platform.key}`}>
                  {platform.key === "windows" ? <Monitor size={15} /> : platform.key === "linux" ? <Cpu size={15} /> : <Apple size={15} />}
                </div>
                <span>{platform.label}</span>
              </div>
              <strong>{platform.total}</strong>
              <small>{pct}% of fleet</small>
              <div className="platform-distribution-track" aria-label={`${pct}% of fleet`}>
                <span className={platform.key} style={{ width: `${pct}%` }} />
              </div>
              <div className="platform-status-row">
                <span className="muted-inline">Online {platform.online}</span>
                <span className="warning-inline">Warning {platform.warning}</span>
                <span className="bad-inline">Critical {platform.critical}</span>
                <span className="bad-inline">Offline {platform.offline}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Overview({ systems, counts, platformSummary, platformFilter, setPlatformFilter, onSelect, onAction, onReport, isAdmin }) {
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="kicker">SYSTEM OVERVIEW</p>
          <h2>Centralized infrastructure monitoring</h2>
          <p className="muted">
            Centralized infrastructure monitoring and remote management across {counts.total} registered endpoints.
          </p>
        </div>
        <div className="page-actions">
          <span className="live-chip">
            <i /> Live monitoring
          </span>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Total systems" value={counts.total} icon={Server} detail="Registered endpoints" />
        <StatCard label="Online" value={counts.online} icon={Wifi} tone="green" detail="Heartbeat active" />
        <StatCard label="Offline" value={counts.offline} icon={Activity} tone="red" detail="Connectivity check required" />
        <StatCard label="Healthy" value={counts.healthy} icon={ShieldCheck} tone="green" detail="Within threshold" />
        <StatCard label="Warning" value={counts.warning} icon={AlertTriangle} tone="orange" detail="Needs review" />
        <StatCard label="Critical" value={counts.critical} icon={Bell} tone="red" detail="Immediate attention" />
      </div>

      <div className="dashboard-grid">
        <InfrastructureHealth counts={counts} />

        <section className="panel overview-panel">
          <div className="section-heading">
            <div>
              <p className="kicker">OPERATIONS SIGNALS</p>
              <h3>Security posture</h3>
            </div>
          </div>
          <div className="mini-grid">
            <Metric label="Antivirus issues" value={counts.antivirus} tone="red" />
            <Metric label="Firewall issues" value={counts.firewall} tone="orange" />
            <Metric label="High CPU" value={counts.highCpu} tone="orange" />
            <Metric label="High RAM" value={counts.highRam} tone="orange" />
            <Metric label="Low disk" value={counts.lowDisk} tone="red" />
            <Metric label="Port problems" value={counts.portProblems} tone="orange" />
          </div>
        </section>
      </div>

      <PlatformOverview platformSummary={platformSummary} platformFilter={platformFilter} setPlatformFilter={setPlatformFilter} />

      <section className="panel overview-panel">
        <div className="section-heading">
          <div>
            <p className="kicker">PERFORMANCE</p>
            <h3>Historical metrics</h3>
          </div>
        </div>
        <div className="history-grid">
          <HistoryCard title="CPU usage" />
          <HistoryCard title="Memory usage" />
          <HistoryCard title="Disk usage" />
        </div>
      </section>

      <SystemTable
        systems={systems.slice(0, 8)}
        onSelect={onSelect}
        onAction={onAction}
        onReport={onReport}
        isAdmin={isAdmin}
      />
    </>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className={`metric-tile ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HistoryCard({ title }) {
  return (
    <div className="history-card">
      <div className="history-header">
        <span>{title}</span>
      </div>
      <p>Historical data is not available yet.</p>
    </div>
  );
}

  function valueLabel(value, suffix = "") {
    if (value === null || value === undefined || value === "N/A") return "N/A";
    return `${value}${suffix}`;
  }

  function rateLabel(value) {
    if (!Number.isFinite(value)) return "N/A";
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB/s`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB/s`;
    return `${value.toFixed(0)} B/s`;
  }

  function StatusLabel({ value }) {
    const normalized = String(value || "unknown").toLowerCase().replaceAll("_", " ");
    return <span className={`status-label ${normalized.replaceAll(" ", "-")}`}>{normalized}</span>;
  }

  function LiveMonitoring({ records, summary, error, onSelect }) {
    const [query, setQuery] = useState("");
    const filtered = records.filter((record) =>
      `${record.hostname} ${record.ip || ""}`.toLowerCase().includes(query.toLowerCase()),
    );
    return (
      <>
        <div className="page-intro live-page-intro">
          <div>
            <p className="kicker">AGENT TELEMETRY · 30 SECOND REFRESH</p>
            <h2>Live fleet status</h2>
            <p className="muted">Current readings come from the latest authenticated platform heartbeat across the monitored fleet.</p>
          </div>
          <span className={error ? "live-chip muted-chip" : "live-chip"}>
            <i /> {error ? "Telemetry unavailable" : "Polling active"}
          </span>
        </div>

        <div className="live-summary-grid">
          <section className="live-summary-panel">
            <div className="live-summary-heading"><Server size={17} /><span>Systems</span></div>
            <strong>{summary.total ?? records.length}</strong>
            <div className="live-summary-values">
              <span className="good-text">Online {summary.online ?? 0}</span>
              <span className="warning-text">Warning {summary.warning ?? 0}</span>
              <span className="bad-text">Critical {summary.critical ?? 0}</span>
              <span className="warning-text">Stale {summary.stale ?? 0}</span>
              <span>Offline {summary.offline ?? 0}</span>
            </div>
          </section>
          <section className="live-summary-panel">
            <div className="live-summary-heading"><Activity size={17} /><span>UPS</span></div>
            <strong>{summary.upsOnline ?? 0}</strong>
            <div className="live-summary-values">
              <span>Online</span>
              <span className="warning-text">On battery {summary.upsOnBattery ?? 0}</span>
              <span>No data {summary.upsNoData ?? 0}</span>
            </div>
          </section>
          <section className="live-summary-panel">
            <div className="live-summary-heading"><Network size={17} /><span>Network</span></div>
            <strong>{summary.networkHealthy ?? 0}</strong>
            <div className="live-summary-values">
              <span className="good-text">Healthy</span>
              <span className="warning-text">Warning {summary.networkWarning ?? 0}</span>
              <span className="bad-text">Critical {summary.networkCritical ?? 0}</span>
              <span>Offline {summary.networkOffline ?? 0}</span>
            </div>
          </section>
        </div>

        <section className="panel live-table-panel">
          <div className="live-table-toolbar">
            <div><p className="kicker">CURRENT MEASUREMENTS</p><h3>{filtered.length} monitored systems</h3></div>
            <label className="search live-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter systems" /></label>
          </div>
          <div className="table-scroll live-table-scroll">
            <table className="live-table">
              <thead><tr><th>System</th><th>Status</th><th>CPU</th><th>Memory</th><th>Disk</th><th>UPS</th><th>Network</th><th>Traffic</th><th>Latency / loss</th><th>Updated</th></tr></thead>
              <tbody>
                {filtered.map((record) => {
                  const current = record.current;
                  const health = current?.systemHealth || {};
                  const cpu = health.cpu?.usagePercent ?? health.cpuPercent;
                  const memory = health.memory?.usagePercent ?? health.memoryPercent;
                  const diskVolumes = health.disk?.volumes || [];
                  const diskUsages = diskVolumes.map((volume) => volume.usagePercent).filter((value) => typeof value === "number" && Number.isFinite(value));
                  const disk = diskUsages.length ? Math.max(...diskUsages) : health.diskPercent;
                  const ups = current?.ups;
                  const network = current?.network;
                  const traffic = network?.traffic || {};
                  const latency = network?.latency || {};
                  const adapter = network?.adapters?.find((item) => item.name === network.activeAdapter);
                  return (
                    <tr key={record._id}>
                      <td><button className="table-link" onClick={() => onSelect(record)}><strong>{record.hostname}</strong><small>{record.ip || adapter?.ipv4?.[0] || "IP unavailable"}</small></button></td>
                      <td><StatusLabel value={record.status} /><small className="live-cell-subtext">Heartbeat {record.heartbeatStatus || "OFFLINE"}</small></td>
                      <td>{valueLabel(cpu, cpu === "N/A" || cpu == null ? "" : "%")}</td>
                      <td>{valueLabel(memory, memory === "N/A" || memory == null ? "" : "%")}</td>
                      <td>{valueLabel(disk, disk === "N/A" || disk == null ? "" : "%")}</td>
                      <td><StatusLabel value={record.isCurrent ? ups?.status || "unknown" : "offline"} /><small className="live-cell-subtext">{valueLabel(ups?.chargePercent, ups?.chargePercent == null || ups?.chargePercent === "N/A" ? "" : "%")}</small></td>
                      <td><StatusLabel value={record.isCurrent ? network?.status || "unknown" : "offline"} /><small className="live-cell-subtext">{network?.activeAdapter || "N/A"}</small></td>
                      <td><span>↓ {rateLabel(traffic.downloadBytesPerSecond)}</span><small className="live-cell-subtext">↑ {rateLabel(traffic.uploadBytesPerSecond)}</small></td>
                      <td><span>{valueLabel(latency.gatewayMs, latency.gatewayMs == null ? "" : " ms")}</span><small className="live-cell-subtext">{valueLabel(network?.packetLossPercent, network?.packetLossPercent == null ? "" : "% loss")}</small></td>
                      <td>{record.isCurrent ? ageLabel(record.lastUpdated) : "No current data"}</td>
                    </tr>
                  );
                })}
                {!filtered.length && <tr><td colSpan="10" className="empty-state">No monitored systems match this filter.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  }

function Systems({
  systems,
  platformFilter,
  setPlatformFilter,
  onSelect,
  onAction,
  onReport,
  isAdmin,
  reportPeriod,
  setReportPeriod,
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const filtered = systems
    .filter((system) =>
      `${system.hostname} ${system.ip}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .filter(
      (system) =>
        platformFilter === "all" ||
        normalizePlatform(system.platform).toLowerCase() === platformFilter,
    )
    .filter(
      (system) =>
        filter === "all" ||
        system.status === filter ||
        (filter === "antivirus" && !system.antivirus?.enabled) ||
        (filter === "firewall" && !system.firewall?.public) ||
        (filter === "cpu" && system.cpuPercent >= 80) ||
        (filter === "ram" && system.memoryPercent >= 80) ||
        (filter === "disk" && system.diskPercent >= 80),
    );
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="kicker">ENDPOINT INVENTORY</p>
          <h2>All systems</h2>
          <p className="muted">
            Search, inspect, export a period-aware PDF, and manage authorized
            power actions.
          </p>
        </div>
      </div>
      <section className="report-period panel">
        <div>
          <p className="kicker">REPORT PERIOD</p>
          <strong>PDF health reports</strong>
        </div>
        <select
          value={reportPeriod.preset}
          onChange={(event) =>
            setReportPeriod({ ...reportPeriod, preset: event.target.value })
          }
        >
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="custom">Custom range</option>
        </select>
        {reportPeriod.preset === "custom" && (
          <>
            <label>
              From
              <input
                type="datetime-local"
                value={reportPeriod.from}
                onChange={(event) =>
                  setReportPeriod({ ...reportPeriod, from: event.target.value })
                }
              />
            </label>
            <label>
              To
              <input
                type="datetime-local"
                value={reportPeriod.to}
                onChange={(event) =>
                  setReportPeriod({ ...reportPeriod, to: event.target.value })
                }
              />
            </label>
          </>
        )}
      </section>
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div className="search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search hostname or IP"
            />
          </div>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
            <option value="antivirus">Antivirus problem</option>
            <option value="firewall">Firewall problem</option>
            <option value="cpu">High CPU</option>
            <option value="ram">High RAM</option>
            <option value="disk">Low disk</option>
          </select>
          <select
            value={platformFilter}
            onChange={(event) => setPlatformFilter(event.target.value)}
          >
            <option value="all">All platforms</option>
            <option value="windows">Windows</option>
            <option value="linux">Linux</option>
            <option value="macos">macOS</option>
          </select>
        </div>
        <SystemTable
          systems={filtered}
          onSelect={onSelect}
          onAction={onAction}
          onReport={onReport}
          isAdmin={isAdmin}
        />
      </section>
    </>
  );
}
function SystemTable({ systems, onSelect, onAction, onReport, isAdmin }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>System</th>
            <th>Platform</th>
            <th>IP</th>
            <th>CPU</th>
            <th>RAM</th>
            <th>Disk</th>
            <th>Antivirus</th>
            <th>Firewall</th>
            <th>Network</th>
            <th>Last seen</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {systems.map((system) => (
            <tr key={system._id}>
              <td>
                <button className="table-link" onClick={() => onSelect(system)}>
                  <strong>{system.hostname}</strong>
                  <small>{system.os}</small>
                </button>
              </td>
              <td>
                <span className={`platform-badge inline ${getPlatformMeta(system.platform).tone}`}>
                  {getPlatformMeta(system.platform).short}
                </span>
              </td>
              <td>{system.ip || "--"}</td>
              <td>{system.cpuPercent ?? "--"}%</td>
              <td>{system.memoryPercent ?? "--"}%</td>
              <td>{system.diskPercent ?? "--"}%</td>
              <td>
                <span
                  className={
                    system.antivirus?.enabled == null ? "badge" : system.antivirus.enabled ? "badge good" : "badge bad"
                  }
                >
                  {system.antivirus?.enabled == null ? "N/A" : system.antivirus.enabled ? "Enabled" : "Problem"}
                </span>
              </td>
              <td>
                <span
                  className={
                    system.firewall?.public == null ? "badge" : system.firewall.public ? "badge good" : "badge bad"
                  }
                >
                  {system.firewall?.public == null ? "N/A" : system.firewall.public ? "Enabled" : "Problem"}
                </span>
              </td>
              <td>
                <span
                  className={
                    system.network?.connected == null ? "badge" : system.network.connected ? "badge good" : "badge bad"
                  }
                >
                  {system.network?.connected == null ? "N/A" : system.network.connected ? "Connected" : "Problem"}
                </span>
              </td>
              <td>{ageLabel(system.lastHeartbeat)}</td>
              <td>
                <span className={`status-label ${system.status}`}>
                  {system.status}
                </span>
              </td>
              <td>
                <div className="row-actions">
                  <button
                    className="small-button"
                    onClick={() => onSelect(system)}
                  >
                    View
                  </button>
                  <button
                    className="small-button report-button"
                    onClick={() => onReport(system)}
                    title="Download PDF health report"
                  >
                    <FileText size={14} /> PDF
                  </button>
                  {isAdmin && (
                    <>
                      <button
                        className="small-button"
                        onClick={() => onAction({ system, action: "RESTART" })}
                        title="Restart computer"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        className="small-button danger"
                        onClick={() => onAction({ system, action: "SHUTDOWN" })}
                        title="Shutdown computer"
                      >
                        <SquarePower size={14} />
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BulkReports({ systems, reportPeriod, setReportPeriod, onGenerate }) {
  const [selected, setSelected] = useState([]);
  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <><div className="page-intro"><div><p className="kicker">REPORT CENTER</p><h2>Health reports</h2><p className="muted">Generate individual system PDFs packaged into one download.</p></div></div><section className="report-period panel"><div><p className="kicker">REPORT PERIOD</p><strong>{selected.length} systems selected</strong></div><select value={reportPeriod.preset} onChange={(event) => setReportPeriod({ ...reportPeriod, preset: event.target.value })}><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="custom">Custom range</option></select>{reportPeriod.preset === "custom" && <><label>From<input type="datetime-local" value={reportPeriod.from} onChange={(event) => setReportPeriod({ ...reportPeriod, from: event.target.value })} /></label><label>To<input type="datetime-local" value={reportPeriod.to} onChange={(event) => setReportPeriod({ ...reportPeriod, to: event.target.value })} /></label></>}<button className="primary" onClick={() => onGenerate(selected)}><FileText size={15} /> Generate selected reports</button></section><section className="panel report-selection">{systems.map((system) => <label key={system._id} className="report-check"><input type="checkbox" checked={selected.includes(system._id)} onChange={() => toggle(system._id)} /><span><strong>{system.hostname}</strong><small>{system.ip} · {system.status}</small></span></label>)}</section></>;
}

function Alerts({ alerts }) {
  return (
    <PageTable
      title="Alerts"
      kicker="SIGNAL CENTER"
      description="Events generated from endpoint heartbeats and policy checks."
      headers={["Alert", "System", "Severity", "Created", "Status"]}
      rows={alerts.map((alert) => [
        <>
          <strong>{alert.type}</strong>
          <small>{alert.message}</small>
        </>,
        alert.system,
        alert.severity,
        formatTime(alert.createdAt),
        alert.status,
      ])}
    />
  );
}
function Ports({ systems, settings }) {
  const rows = systems.flatMap((system) =>
    (system.listeningPorts || []).map((port) => [
      system.hostname,
      port.port,
      port.protocol,
      (settings?.allowedPorts || []).includes(Number(port.port))
        ? "Allowed"
        : "Unexpected",
      port.state,
    ]),
  );
  return (
    <PageTable
      title="Port monitoring"
      kicker="NETWORK EXPOSURE"
      description={`Listening TCP ports compared with the approved list: ${(settings?.allowedPorts || []).join(", ") || "none"}.`}
      headers={["System", "Port", "Protocol", "Policy", "State"]}
      rows={rows}
    />
  );
}
function Commands({ commands }) {
  return (
    <PageTable
      title="Command history"
      kicker="REMOTE OPERATIONS"
      description="Only explicit Restart and Shutdown commands are accepted by agents."
      headers={[
        "Time",
        "Administrator",
        "System",
        "Action",
        "Status",
        "Result",
      ]}
      rows={commands.map((command) => [
        formatTime(command.createdAt),
        command.requestedBy,
        command.systemName,
        command.type,
        command.status,
        command.result || "Waiting for agent",
      ])}
    />
  );
}
function AuditLogs({ logs }) {
  return (
    <PageTable
      title="Audit logs"
      kicker="ACCOUNTABILITY"
      description="Immutable operational events recorded by the control plane."
      headers={["Time", "User", "Action", "System", "Result", "Source"]}
      rows={logs.map((log) => [
        formatTime(log.timestamp),
        log.userEmail,
        log.action,
        log.systemName || "--",
        log.result,
        log.sourceIP,
      ])}
    />
  );
}
function PageTable({ title, kicker, description, headers, rows }) {
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="kicker">{kicker}</p>
          <h2>{title}</h2>
          <p className="muted">{description}</p>
        </div>
      </div>
      <section className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
function SettingsPage({ settings }) {
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="kicker">CONTROL PLANE</p>
          <h2>Monitoring settings</h2>
          <p className="muted">
            Thresholds used by the server to classify endpoint health.
          </p>
        </div>
      </div>
      <section className="settings-layout">
        <div className="panel settings-section">
          <div className="settings-fields">
            <label>
              Heartbeat interval
              <input
                value={`${settings?.heartbeatIntervalSeconds || 30} seconds`}
                readOnly
              />
            </label>
            <label>
              Offline threshold
              <input
                value={`${settings?.offlineThresholdSeconds || 90} seconds`}
                readOnly
              />
            </label>
            <label>
              CPU warning
              <input value={`${settings?.cpuWarning || 80}%`} readOnly />
            </label>
            <label>
              CPU critical
              <input value={`${settings?.cpuCritical || 90}%`} readOnly />
            </label>
            <label>
              RAM warning
              <input value={`${settings?.ramWarning || 80}%`} readOnly />
            </label>
            <label>
              Disk critical
              <input value={`${settings?.diskCritical || 90}%`} readOnly />
            </label>
          </div>
          <p className="settings-help">
            Allowed ports: {(settings?.allowedPorts || []).join(", ") || "none"}
            .
          </p>
        </div>
      </section>
    </>
  );
}

function SystemDetails({ system, live, headers, close, onReport }) {
  const [metrics, setMetrics] = useState([]);
  const [historyError, setHistoryError] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [period, setPeriod] = useState("24h");
  const isCurrent = Boolean(live?.isCurrent);
  const current = live?.current || {};
  const health = current.systemHealth || {};
  const cpu = health.cpu || {};
  const memory = health.memory || {};
  const disk = health.disk || {};
  const volumes = disk.volumes || [];
  const volume = volumes.find((item) => item.drive === "C:" || item.name === "C:") || volumes[0] || {};
  const network = current.network || {};
  const ups = current.ups || {};
  const security = health.security || {};
  const antivirus = security.antivirus || (isCurrent ? system.antivirus : null);
  const firewall = security.firewall || (isCurrent ? system.firewall : null);
  const adapter = network.adapters?.find((item) => item.name === network.activeAdapter || item.interfaceName === network.activeAdapter) || {};
  const ports = isCurrent ? (health.ports || system.listeningPorts || []) : [];
  const last = live?.lastKnown || {};
  const authToken = headers.Authorization;

  useEffect(() => {
    let mounted = true;
    const loadHistory = async () => {
      setHistoryLoading(true);
      try {
        const response = await fetch(`${API}/systems/${system._id}/history?range=${period}`, { headers: { Authorization: authToken } });
        if (!response.ok) throw new Error("History request failed");
        const result = await response.json();
        if (mounted) {
          setMetrics(result.samples || result.metrics || []);
          setHistoryError(false);
        }
      } catch {
        if (mounted) {
          setMetrics([]);
          setHistoryError(true);
        }
      } finally {
        if (mounted) setHistoryLoading(false);
      }
    };
    loadHistory();
    const timer = setInterval(loadHistory, REFRESH_SECONDS * 1000);
    return () => { mounted = false; clearInterval(timer); };
  }, [system._id, period, authToken]);

  const cpuPercent = cpu.usagePercent ?? health.cpuPercent;
  const memoryPercent = memory.usagePercent ?? health.memoryPercent;
  const diskPercent = volume.usagePercent ?? health.diskPercent;
  const uptime = health.operatingSystem?.uptimeSeconds ?? health.uptimeSeconds;
  const uptimeLabel = Number.isFinite(uptime)
    ? [`${Math.floor(uptime / 86400)}d`, `${Math.floor((uptime % 86400) / 3600)}h`, `${Math.floor((uptime % 3600) / 60)}m`].join(" ")
    : "N/A";
  const lastBoot = health.operatingSystem?.lastBootTime || system.lastBootTime;
  const operatingSystem = health.operatingSystem || {};
  const osDetails = [
    operatingSystem.version && `Version ${operatingSystem.version}`,
    operatingSystem.buildNumber && `Build ${operatingSystem.buildNumber}`,
    operatingSystem.architecture,
  ].filter(Boolean);
  const antivirusName = antivirus?.name || antivirus?.product || "Unknown";
  return (
    <div className="drawer-backdrop" onClick={close}>
      <aside className="drawer live-detail-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head"><div><p className="kicker">SYSTEM DETAILS</p><h2>{system.hostname}</h2><p className="muted">{live?.ipAddress || system.ipAddress || system.ip || adapter.ipv4?.[0] || "IP unavailable"} · {live?.os || system.os || "OS unavailable"}{osDetails.map((detail) => ` · ${detail}`).join("")}</p></div><button className="icon-button" onClick={close} aria-label="Close system details"><X size={20} /></button></div>
        <button className="primary report-download" onClick={() => onReport(system)}><FileText size={15} /> Download health report</button>
        <div className="detail-status"><StatusLabel value={live?.status || "offline"} /><span>Heartbeat {live?.heartbeatStatus || "OFFLINE"}</span><span>Agent {health.operatingSystem?.agentVersion || live?.agentVersion || (isCurrent ? system.agentVersion : "N/A")}</span><span>{live?.lastHeartbeat ? `Updated ${ageLabel(live.lastHeartbeat)}` : "Last heartbeat unavailable"}</span></div>
        {!isCurrent && <div className="detail-offline-note"><strong>Current readings unavailable</strong><span>{last.systemHealth ? `Last reported ${ageLabel(live?.lastUpdated)}` : "No real agent telemetry has been received."}</span>{last.systemHealth && <small>Last known CPU {valueLabel(last.systemHealth.cpu?.usagePercent ?? last.systemHealth.cpuPercent, "%")} · UPS {last.ups?.status || "N/A"} · Network {last.network?.status || "N/A"}</small>}</div>}

        <section className="detail-section live-detail-section"><p className="kicker">SYSTEM HEALTH</p><div className="detail-grid">
          <div><small>CPU usage</small><strong>{isCurrent ? valueLabel(cpuPercent, cpuPercent == null || cpuPercent === "N/A" ? "" : "%") : "N/A"}</strong><small>Temperature {isCurrent ? valueLabel(cpu.temperatureC, cpu.temperatureC == null || cpu.temperatureC === "N/A" ? "" : " °C") : "N/A"}</small></div>
          <div><small>Memory</small><strong>{isCurrent ? valueLabel(memoryPercent, memoryPercent == null || memoryPercent === "N/A" ? "" : "%") : "N/A"}</strong><small>{isCurrent ? `${valueLabel(memory.usedBytes ?? health.usedMemoryBytes)} / ${valueLabel(memory.totalBytes ?? health.totalMemoryBytes)} bytes` : "Current usage unavailable"}</small></div>
          <div><small>Uptime</small><strong>{isCurrent ? uptimeLabel : "N/A"}</strong><small>Last boot: {lastBoot ? new Date(lastBoot).toLocaleString() : "N/A"}</small></div>
        </div><div className="detail-facts disk-volume-list">{isCurrent && volumes.length ? volumes.map((item) => <div key={item.drive || item.name}><small>{item.drive || item.name}</small><strong>{valueLabel(item.usagePercent, item.usagePercent == null || item.usagePercent === "N/A" ? "" : "% used")}</strong><small>Total {valueLabel(item.totalBytes)} · Used {valueLabel(item.usedBytes)} · Free {valueLabel(item.freeBytes)} bytes</small></div>) : <div><small>Disk</small><strong>{isCurrent ? valueLabel(diskPercent, diskPercent == null || diskPercent === "N/A" ? "" : "%") : "N/A"}</strong><small>{isCurrent ? `${valueLabel(health.diskFreeBytes)} bytes free` : "Current usage unavailable"}</small></div>}</div></section>

        <section className="detail-section live-detail-section"><p className="kicker">UPS</p><div className="detail-facts">
          <div><small>Status</small><strong>{isCurrent ? ups.status || "UNKNOWN" : "N/A"}</strong></div><div><small>Device</small><strong>{isCurrent ? ups.name || "N/A" : "N/A"}</strong></div><div><small>Manufacturer / model</small><strong>{isCurrent ? `${ups.manufacturer || "N/A"} / ${ups.model || "N/A"}` : "N/A"}</strong></div><div><small>Battery</small><strong>{isCurrent ? valueLabel(ups.chargePercent, ups.chargePercent == null || ups.chargePercent === "N/A" ? "" : "%") : "N/A"}</strong></div><div><small>Battery state / health</small><strong>{isCurrent ? `${ups.batteryStatus || "N/A"} / ${ups.batteryHealth || "N/A"}` : "N/A"}</strong></div><div><small>Runtime</small><strong>{isCurrent && Number.isFinite(ups.remainingRuntimeSeconds) ? `${Math.floor(ups.remainingRuntimeSeconds / 60)} min` : "N/A"}</strong></div><div><small>Input / output voltage</small><strong>{isCurrent ? `${valueLabel(ups.inputVoltage)} / ${valueLabel(ups.outputVoltage)} V` : "N/A"}</strong></div><div><small>Battery voltage / source</small><strong>{isCurrent ? `${valueLabel(ups.batteryVoltage)} V / ${ups.powerSource || "N/A"}` : "N/A"}</strong></div>
        </div></section>

        <section className="detail-section live-detail-section"><p className="kicker">NETWORK</p><div className="detail-facts">
          <div><small>Interface</small><strong>{isCurrent ? network.activeAdapter || adapter.name || "N/A" : "N/A"}</strong></div><div><small>Adapter state</small><strong>{isCurrent ? adapter.status || (network.connected == null ? "N/A" : network.connected ? "Connected" : "Disconnected") : "N/A"}</strong></div><div><small>IP / gateway</small><strong>{isCurrent ? `${adapter.ipv4?.[0] || live?.ipAddress || network.ipAddress || "N/A"} / ${network.gateway || adapter.gateway || "N/A"}` : "N/A"}</strong></div><div><small>MAC address</small><strong>{isCurrent ? adapter.macAddress || system.mac || "N/A" : "N/A"}</strong></div><div><small>DNS</small><strong>{isCurrent ? (network.dns || adapter.dnsServers || []).join(", ") || "N/A" : "N/A"}</strong></div><div><small>Download / upload</small><strong>{isCurrent ? `${rateLabel(network.traffic?.downloadBytesPerSecond)} / ${rateLabel(network.traffic?.uploadBytesPerSecond)}` : "N/A"}</strong></div><div><small>Bytes sent / received</small><strong>{isCurrent ? `${valueLabel(network.traffic?.bytesSent)} / ${valueLabel(network.traffic?.bytesReceived)}` : "N/A"}</strong></div><div><small>Packets sent / received</small><strong>{isCurrent ? `${valueLabel(network.traffic?.packetsSent)} / ${valueLabel(network.traffic?.packetsReceived)}` : "N/A"}</strong></div><div><small>Gateway / internet latency</small><strong>{isCurrent ? `${valueLabel(network.latency?.gatewayMs, network.latency?.gatewayMs == null ? "" : " ms")} / ${valueLabel(network.latency?.internetMs, network.latency?.internetMs == null ? "" : " ms")}` : "N/A"}</strong></div><div><small>Other reported latency</small><strong>{isCurrent ? valueLabel(network.latency?.reportedMs ?? network.latencyMs, network.latency?.reportedMs != null || network.latencyMs != null ? " ms" : "") : "N/A"}</strong></div><div><small>Packet loss</small><strong>{isCurrent ? valueLabel(network.packetLossPercent ?? network.latency?.packetLossPercent, network.packetLossPercent != null || network.latency?.packetLossPercent != null ? "%" : "") : "N/A"}</strong></div><div><small>Internet / DNS</small><strong>{isCurrent ? `${network.connectivity?.internet == null ? "N/A" : network.connectivity.internet ? "Reachable" : "Unavailable"} / ${network.connectivity?.dns == null ? "N/A" : network.connectivity.dns ? "Available" : "Unavailable"}` : "N/A"}</strong></div><div><small>Link speed</small><strong>{isCurrent ? valueLabel(network.linkSpeedMbps ?? adapter.linkSpeedMbps, network.linkSpeedMbps == null && adapter.linkSpeedMbps == null ? "" : " Mbps") : "N/A"}</strong></div>
        </div></section>

        <section className="detail-section live-detail-section"><p className="kicker">SECURITY & PORTS</p><div className="detail-facts">
          <div><small>Antivirus</small><strong>{isCurrent ? `${antivirusName} · ${antivirus?.enabled == null ? "Status unknown" : antivirus.enabled ? "Enabled" : "Disabled"}` : "N/A"}</strong></div><div><small>Real-time protection</small><strong>{isCurrent && antivirus?.realTimeProtection != null ? antivirus.realTimeProtection ? "Enabled" : "Disabled" : "N/A"}</strong></div><div><small>Definition status</small><strong>{isCurrent && (antivirus?.updated ?? antivirus?.definitionsUpToDate) != null ? (antivirus.updated ?? antivirus.definitionsUpToDate) ? "Current" : "Out of date" : "N/A"}</strong></div><div><small>Signature version / last update</small><strong>{isCurrent ? `${antivirus?.signatureVersion || "N/A"} / ${antivirus?.lastDefinitionUpdate ? new Date(antivirus.lastDefinitionUpdate).toLocaleString() : "N/A"}` : "N/A"}</strong></div><div><small>Firewall Domain / Private / Public</small><strong>{isCurrent ? `${firewall?.domain ?? "N/A"} / ${firewall?.private ?? "N/A"} / ${firewall?.public ?? "N/A"}` : "N/A"}</strong></div><div><small>Firewall status</small><strong>{isCurrent ? firewall?.overallStatus || (firewall?.domain == null || firewall?.private == null || firewall?.public == null ? "UNKNOWN" : firewall.domain && firewall.private && firewall.public ? "HEALTHY" : "WARNING") : "N/A"}</strong></div>
        </div>{isCurrent && <div className="live-ports-list"><table className="live-ports-table"><thead><tr><th>Protocol</th><th>Local address</th><th>Port</th><th>State</th><th>PID</th><th>Process</th></tr></thead><tbody>{ports.slice(0, 100).map((port) => <tr key={`${port.protocol}-${port.localAddress}-${port.port}-${port.pid}`}><td>{port.protocol || "N/A"}</td><td>{port.localAddress || "*"}</td><td>{port.port ?? "N/A"}</td><td>{port.state || "N/A"}</td><td>{port.pid ?? "N/A"}</td><td>{port.process || "N/A"}</td></tr>)}</tbody></table>{!ports.length && <span>No listening ports reported</span>}</div>}</section>

        <section className="detail-section live-detail-section"><div className="history-toolbar"><div><p className="kicker">MEASURED HISTORY</p><strong>Agent samples from MongoDB</strong></div><select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="History period"><option value="1h">1 hour</option><option value="6h">6 hours</option><option value="24h">24 hours</option><option value="7d">7 days</option><option value="30d">30 days</option></select></div>
          {historyLoading && !metrics.length ? <p className="muted">Loading historical samples…</p> : historyError ? <p className="history-error">Could not load historical samples from the server.</p> : !metrics.length ? <p className="muted">No historical samples available for this period.</p> : <><div className="detail-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={metrics}><XAxis dataKey="timestamp" hide /><YAxis domain={[0, 100]} hide /><Tooltip labelFormatter={(value) => new Date(value).toLocaleString()} /><Area type="monotone" dataKey="cpuPercent" name="CPU %" stroke="#e5a63b" fill="#e5a63b22" /><Area type="monotone" dataKey="memoryPercent" name="Memory %" stroke="#36b9a0" fill="#36b9a022" /><Area type="monotone" dataKey="diskPercent" name="Disk %" stroke="#3677ff" fill="#3677ff22" /></AreaChart></ResponsiveContainer></div><div className="detail-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={metrics}><XAxis dataKey="timestamp" hide /><YAxis hide /><Tooltip labelFormatter={(value) => new Date(value).toLocaleString()} /><Area type="monotone" dataKey="downloadBytesPerSecond" name="Download B/s" stroke="#3677ff" fill="#3677ff22" /><Area type="monotone" dataKey="uploadBytesPerSecond" name="Upload B/s" stroke="#36b9a0" fill="#36b9a022" /></AreaChart></ResponsiveContainer></div><div className="detail-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={metrics}><XAxis dataKey="timestamp" hide /><YAxis domain={[0, 100]} hide /><Tooltip labelFormatter={(value) => new Date(value).toLocaleString()} /><Area type="monotone" dataKey="upsBatteryPercent" name="UPS battery %" stroke="#e5a63b" fill="#e5a63b22" /></AreaChart></ResponsiveContainer></div><div className="history-samples-scroll"><table className="history-samples-table"><thead><tr><th>Timestamp</th><th>CPU</th><th>Memory</th><th>Disk</th><th>System status</th></tr></thead><tbody>{metrics.map((sample) => <tr key={sample.timestamp}><td>{new Date(sample.timestamp).toLocaleString()}</td><td>{valueLabel(sample.cpuPercent, sample.cpuPercent == null ? "" : "%")}</td><td>{valueLabel(sample.memoryPercent, sample.memoryPercent == null ? "" : "%")}</td><td>{valueLabel(sample.diskPercent, sample.diskPercent == null ? "" : "%")}</td><td>{sample.status || "N/A"}</td></tr>)}</tbody></table></div></>}
        </section>
      </aside>
    </div>
  );
}
function ConfirmDialog({ confirm, close, submit }) {
  const isShutdown = confirm.action === "SHUTDOWN";
  return (
    <div className="dialog-backdrop">
      <section className="confirm-dialog">
        <div className={`confirm-icon ${isShutdown ? "danger" : ""}`}>
          {isShutdown ? <SquarePower size={22} /> : <RotateCcw size={22} />}
        </div>
        <p className="kicker">AUTHORIZED POWER ACTION</p>
        <h2>{isShutdown ? "Shutdown computer" : "Restart computer"}</h2>
        <p>
          Are you sure you want to {isShutdown ? "shut down" : "restart"}{" "}
          <strong>{confirm.system.hostname}</strong>?
        </p>
        {isShutdown && (
          <p className="muted">
            This will stop the computer and interrupt active work.
          </p>
        )}
        <div className="dialog-actions">
          <button className="filter-button" onClick={close}>
            Cancel
          </button>
          <button
            className={isShutdown ? "danger-button" : "primary"}
            onClick={submit}
          >
            {isShutdown ? "Shutdown" : "Restart"}
          </button>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
