import mongoose from 'mongoose';

const systemSchema = new mongoose.Schema({
  hostname: { type: String, required: true, unique: true },
  ip: String,
  mac: String,
  os: String,
  osVersion: String,
  manufacturer: String,
  model: String,
  cpuPercent: Number,
  memoryPercent: Number,
  totalMemoryBytes: Number,
  usedMemoryBytes: Number,
  freeMemoryBytes: Number,
  diskPercent: Number,
  diskFreeBytes: Number,
  uptimeSeconds: Number,
  lastBootTime: Date,
  agentVersion: String,
  lastHeartbeat: Date,
  status: String,
  agentTokenHash: String,
  antivirus: mongoose.Schema.Types.Mixed,
  firewall: mongoose.Schema.Types.Mixed,
  network: mongoose.Schema.Types.Mixed,
  listeningPorts: mongoose.Schema.Types.Mixed,
  requiredPortResults: mongoose.Schema.Types.Mixed
}, { timestamps: true });

const metricSchema = new mongoose.Schema({
  systemId: { type: mongoose.Schema.Types.ObjectId, ref: 'System', index: true },
  cpuPercent: Number,
  memoryPercent: Number,
  diskPercent: Number,
  timestamp: { type: Date, default: Date.now, index: true }
});

const commandSchema = new mongoose.Schema({
  systemId: { type: mongoose.Schema.Types.ObjectId, ref: 'System', index: true },
  systemName: String,
  type: { type: String, enum: ['RESTART', 'SHUTDOWN'] },
  requestedBy: String,
  status: { type: String, enum: ['PENDING', 'EXECUTED', 'FAILED'], default: 'PENDING' },
  createdAt: { type: Date, default: Date.now },
  executedAt: Date,
  result: String,
  error: String
});

const alertSchema = new mongoose.Schema({
  systemId: String,
  system: String,
  type: String,
  severity: String,
  message: String,
  status: { type: String, default: 'open' },
  createdAt: { type: Date, default: Date.now }
});

const auditLogSchema = new mongoose.Schema({
  userId: String,
  userEmail: String,
  action: String,
  systemId: String,
  systemName: String,
  timestamp: { type: Date, default: Date.now },
  result: String,
  sourceIP: String
});

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  passwordHash: String,
  role: { type: String, enum: ['Administrator', 'Viewer'], default: 'Viewer' },
  name: String
});

const settingsSchema = new mongoose.Schema({
  heartbeatIntervalSeconds: { type: Number, default: 30 },
  offlineThresholdSeconds: { type: Number, default: 90 },
  cpuWarning: { type: Number, default: 80 },
  cpuCritical: { type: Number, default: 90 },
  ramWarning: { type: Number, default: 80 },
  ramCritical: { type: Number, default: 90 },
  diskWarning: { type: Number, default: 80 },
  diskCritical: { type: Number, default: 90 },
  allowedPorts: { type: [Number], default: [80, 443, 3389] }
});

export const System = mongoose.models.System || mongoose.model('System', systemSchema);
export const SystemMetric = mongoose.models.SystemMetric || mongoose.model('SystemMetric', metricSchema);
export const Command = mongoose.models.Command || mongoose.model('Command', commandSchema);
export const Alert = mongoose.models.Alert || mongoose.model('Alert', alertSchema);
export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const Setting = mongoose.models.Setting || mongoose.model('Setting', settingsSchema);