import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  Bell,
  CircleGauge,
  Clock3,
  FileText,
  HardDrive,
  LayoutDashboard,
  LogIn,
  LogOut,
  LockKeyhole,
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

const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
const REFRESH_SECONDS = 30;
const nav = [
  { label: "Overview", icon: LayoutDashboard },
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
  return seconds < 60
    ? `${seconds} sec ago`
    : `${Math.round(seconds / 60)} min ago`;
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
  const [email, setEmail] = useState("admin@sentinel.local");
  const [password, setPassword] = useState("admin123");
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
          <div className="brand-mark">
            <CircleGauge size={24} />
          </div>
          <div>
            <strong>SENTINEL</strong>
            <small>HEALTH CONTROL</small>
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
          <p className="login-note">
            Demo accounts: admin@sentinel.local or viewer@sentinel.local,
            password admin123.
          </p>
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
        ["systems", "alerts", "commands", "audit-logs", "settings"].map(
          (path) => fetch(`${API}/${path}`, { headers }),
        ),
      );
      if (responses.some((response) => response.status === 401))
        return logout();
      if (responses.some((response) => !response.ok))
        throw new Error("API request failed");
      const [systemData, alertData, commandData, auditData, settingData] =
        await Promise.all(responses.map((response) => response.json()));
      setSystems(systemData);
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

  const matchingSystems = useMemo(() => {
    const query = globalQuery.trim().toLowerCase();
    if (!query) return systems;
    return systems.filter((system) =>
      [system.hostname, system.ip, system._id, system.os]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [systems, globalQuery]);

  const counts = useMemo(
    () => ({
      total: matchingSystems.length,
      online: matchingSystems.filter((s) => s.status === "online").length,
      offline: matchingSystems.filter((s) => s.status === "offline").length,
      healthy: matchingSystems.filter((s) => s.status === "online").length,
      warning: matchingSystems.filter((s) => s.status === "warning").length,
      critical: matchingSystems.filter((s) => s.status === "critical").length,
      antivirus: matchingSystems.filter((s) => !s.antivirus?.enabled).length,
      firewall: matchingSystems.filter(
        (s) =>
          !s.firewall?.domain || !s.firewall?.private || !s.firewall?.public,
      ).length,
      highCpu: matchingSystems.filter((s) => s.cpuPercent >= 80).length,
      highRam: matchingSystems.filter((s) => s.memoryPercent >= 80).length,
      lowDisk: matchingSystems.filter((s) => s.diskPercent >= 80).length,
      portProblems: matchingSystems.filter((s) =>
        (s.listeningPorts || []).some(
          (port) => !(settings?.allowedPorts || []).includes(Number(port.port)),
        ),
      ).length,
      networkProblems: matchingSystems.filter((s) => !s.network?.connected).length,
    }),
    [matchingSystems, settings],
  );

  const content =
    page === "Systems" ? (
      <Systems
        systems={matchingSystems}
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
          <div className="brand-mark">
            <CircleGauge size={22} />
          </div>
          <div className="brand-copy">
            <strong>SENTINEL</strong>
            <small>HEALTH CONTROL</small>
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
              className={serverError ? "live-indicator error" : "live-indicator"}
            >
              <i />
              {serverError ? "Monitoring unavailable" : "Live Monitoring"}
            </span>
            <button className="refresh-button" onClick={loadData}>
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
          system={selected}
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

function Overview({ systems, counts, onSelect, onAction, onReport, isAdmin }) {
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

function Systems({
  systems,
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
              <td>{system.ip || "--"}</td>
              <td>{system.cpuPercent ?? "--"}%</td>
              <td>{system.memoryPercent ?? "--"}%</td>
              <td>{system.diskPercent ?? "--"}%</td>
              <td>
                <span
                  className={
                    system.antivirus?.enabled ? "badge good" : "badge bad"
                  }
                >
                  {system.antivirus?.enabled ? "Enabled" : "Problem"}
                </span>
              </td>
              <td>
                <span
                  className={
                    system.firewall?.public ? "badge good" : "badge bad"
                  }
                >
                  {system.firewall?.public ? "Enabled" : "Problem"}
                </span>
              </td>
              <td>
                <span
                  className={
                    system.network?.connected ? "badge good" : "badge bad"
                  }
                >
                  {system.network?.connected ? "Connected" : "Problem"}
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

function SystemDetails({ system, close, onReport }) {
  const [metrics, setMetrics] = useState([]);
  useEffect(() => {
    fetch(`${API}/systems/${system._id}/metrics`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("sentinel_session") ? JSON.parse(localStorage.getItem("sentinel_session")).token : ""}`,
      },
    })
      .then((response) => (response.ok ? response.json() : []))
      .then(setMetrics)
      .catch(() => {});
  }, [system._id]);
  return (
    <div className="drawer-backdrop" onClick={close}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <p className="kicker">SYSTEM DETAILS</p>
            <h2>{system.hostname}</h2>
            <p className="muted">
              {system.ip} · {system.os}
            </p>
          </div>
          <button className="icon-button" onClick={close}>
            <X size={20} />
          </button>
        </div>
        <button className="primary report-download" onClick={() => onReport(system)}>
          <FileText size={15} /> Download health report
        </button>
        <div className="detail-status">
          <span className={`status-dot ${system.status}`} />
          <strong>{system.status}</strong>
          <span>Agent {system.agentVersion || "--"}</span>
        </div>
        <div className="detail-tabs">
          <span className="active">Overview</span>
          <span>Performance</span>
          <span>Security</span>
          <span>Network</span>
          <span>Ports</span>
        </div>
        <div className="detail-grid">
          <div>
            <small>CPU usage</small>
            <strong>{system.cpuPercent ?? "--"}%</strong>
          </div>
          <div>
            <small>Memory</small>
            <strong>{system.memoryPercent ?? "--"}%</strong>
          </div>
          <div>
            <small>Disk usage</small>
            <strong>{system.diskPercent ?? "--"}%</strong>
          </div>
          <div>
            <small>Uptime</small>
            <strong>{Math.round((system.uptimeSeconds || 0) / 3600)}h</strong>
          </div>
        </div>
        <div className="detail-section">
          <p className="kicker">PERFORMANCE HISTORY</p>
          <div className="detail-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metrics}>
                <XAxis dataKey="timestamp" hide />
                <YAxis domain={[0, 100]} hide />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="cpuPercent"
                  stroke="#3677ff"
                  fill="#3677ff22"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="detail-section">
          <p className="kicker">SECURITY</p>
          <div className="protection-row">
            <ShieldCheck size={19} />
            <span>{system.antivirus?.product || "Antivirus"}</span>
            <b className={system.antivirus?.enabled ? "good-text" : "bad-text"}>
              {system.antivirus?.enabled ? "Enabled" : "Disabled"}
            </b>
          </div>
          <div className="protection-row">
            <ShieldCheck size={19} />
            <span>Firewall profiles</span>
            <b
              className={
                system.firewall?.public &&
                system.firewall?.private &&
                system.firewall?.domain
                  ? "good-text"
                  : "bad-text"
              }
            >
              {system.firewall?.public &&
              system.firewall?.private &&
              system.firewall?.domain
                ? "All enabled"
                : "Review"}
            </b>
          </div>
        </div>
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
