import Conf from 'conf';
import { mkdirSync } from 'fs';
import { extractSessionId } from './session.js';
import { AnycliError, ErrorCode } from './errors.js';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, '../..');

/** 鉴权策略类型：session-id / bearer-token 已实现；oauth2 / api-key 预留接口 */
export type AuthStrategyType = 'session-id' | 'bearer-token' | 'oauth2' | 'api-key';

/**
 * Profile 级统一鉴权配置（整个 CLI 一套授权方式，跟随环境/Profile，不再按项目细分）。
 * - type：授权方式（session-id / bearer-token），由 `anycli auth login` 选择、`anycli config set auth-type` 切换。
 * - token：bearer-token 凭证（session-id 用 Profile.sessionId）。
 * - refreshUrl / refreshIntervalMs：用户自填的凭证刷新接口地址与间隔（两种方式通用），不配置则不自动刷新。
 * - extraHeaders：刷新接口需要的静态请求头（如租户头），可选。
 */
export interface ProfileAuthConfig {
  type: AuthStrategyType;
  token?: string;
  refreshUrl?: string;
  refreshIntervalMs?: number;
  extraHeaders?: Record<string, string>;
}

/** 一次请求解析出的有效鉴权配置：授权方式/凭证/刷新来自 Profile，静态请求头来自项目（如 x-tenant-id） */
export interface ProjectAuthConfig {
  type: AuthStrategyType;
  /** 每次请求附加的静态请求头（如 x-tenant-id / x-ext-tenant-id），不同公司可自定义 */
  extraHeaders?: Record<string, string>;
  /** 凭证刷新接口地址（Profile 级，用户自填；不配置则不自动刷新） */
  refreshUrl?: string;
  /** 凭证刷新间隔毫秒（如 8h = 28800000），用户可自行配置 */
  refreshIntervalMs?: number;
  /** bearer-token：凭证（Profile 级，存于 Profile.auth.token） */
  token?: string;
}

export interface ProjectConfig {
  baseUrl?: string;
  prefix: string;
  auth?: ProjectAuthConfig;
  /** 1c 之前的遗留字段，已迁移到 auth.extraHeaders，仅作兼容读取 */
  tenantId?: string;
  extTenantId?: string;
}

export interface ProfileData {
  env: 'test' | 'prod' | 'dev';
  /** 本 Profile 对应环境的网关地址（整个工程一份，随 Profile 配置，不在公开代码内置） */
  gatewayUrl?: string;
  /** 本 Profile 对应环境的登录页地址（整个工程一份，随 Profile 配置） */
  loginUrl?: string;
  sessionId: string;
  sessionUpdatedAt?: number;
  /** 统一鉴权配置（整个 CLI 一套授权方式，跟随本 Profile/环境） */
  auth?: ProfileAuthConfig;
  projects: Record<string, ProjectConfig>;
}

export interface AnycliConfig {
  activeProfile: string;
  defaultFormat: 'json' | 'table' | 'text';
  workspace?: string;
  profiles: Record<string, ProfileData>;
}

export const DEFAULT_PROFILE = 'default';

export const ENV_LABELS: Record<string, string> = {
  test: '测试环境',
  prod: '正式环境',
};

const CONFIG_DIR = join(homedir(), '.anycli');

const store = new Conf<AnycliConfig>({
  cwd: CONFIG_DIR,
  configName: 'config',
  defaults: {
    activeProfile: DEFAULT_PROFILE,
    defaultFormat: 'json',
    profiles: {
      [DEFAULT_PROFILE]: {
        env: 'prod',
        sessionId: '',
        projects: {},
      },
    },
  },
});

let profileOverride: string | undefined;

export function setProfileOverride(name: string | undefined): void {
  profileOverride = name;
}

export function getProfileOverride(): string | undefined {
  return profileOverride;
}

function migrateIfNeeded(): void {
  const raw = store.store as unknown as Record<string, unknown>;
  const hasLegacy = 'env' in raw || 'sessionId' in raw || 'projects' in raw;
  if (!hasLegacy) return;

  const legacyEnv = (raw.env as ProfileData['env']) || 'prod';
  const legacySessionId = (raw.sessionId as string) || '';
  const legacyProjects = (raw.projects as Record<string, ProjectConfig>) || {};
  const legacyFormat = (raw.defaultFormat as string) || 'json';

  const profiles = (raw.profiles as Record<string, ProfileData>) || {};
  const targetProfileName = legacyEnv === 'test' ? 'test' : DEFAULT_PROFILE;

  if (!profiles[targetProfileName]) {
    profiles[targetProfileName] = {
      env: legacyEnv,
      sessionId: legacySessionId,
      projects: legacyProjects,
    };
  } else {
    // 存在同名 profile 时，做安全的增量合并，防止外部旧数据丢失
    profiles[targetProfileName].sessionId = profiles[targetProfileName].sessionId || legacySessionId;
    profiles[targetProfileName].projects = {
      ...legacyProjects,
      ...profiles[targetProfileName].projects,
    };
  }

  // 保证至少有 default
  if (!profiles[DEFAULT_PROFILE]) {
    profiles[DEFAULT_PROFILE] = {
      env: 'prod',
      sessionId: '',
      projects: {},
    };
  }

  store.set('profiles', profiles);
  if (!store.get('activeProfile')) {
    store.set('activeProfile', targetProfileName);
  }
  if (!store.get('defaultFormat')) {
    store.set('defaultFormat', legacyFormat as AnycliConfig['defaultFormat']);
  }

  // 彻底清除外层冗余字段
  store.delete('env' as never);
  store.delete('sessionId' as never);
  store.delete('projects' as never);
}

migrateIfNeeded();

export function resolveProfileName(): string {
  return profileOverride || process.env.ANYCLI_PROFILE || store.get('activeProfile') || DEFAULT_PROFILE;
}

export function getProfile(name?: string): ProfileData {
  const profileName = name || resolveProfileName();
  const profiles = store.get('profiles') || {};
  const profile = profiles[profileName];
  if (!profile) {
    return { env: 'prod', sessionId: '', projects: {} };
  }
  return profile;
}

export function setProfileField(field: keyof ProfileData, value: unknown, profileName?: string): void {
  const name = profileName || resolveProfileName();
  const profiles = store.get('profiles') || {};
  if (!profiles[name]) {
    profiles[name] = { env: 'prod', sessionId: '', projects: {} };
  }
  (profiles[name] as unknown as Record<string, unknown>)[field] = value;
  store.set('profiles', profiles);
}

export function createProfile(name: string, env: ProfileData['env'] = 'prod'): ProfileData {
  const profiles = store.get('profiles') || {};
  if (profiles[name]) {
    return profiles[name];
  }
  const profile: ProfileData = { env, sessionId: '', projects: {} };
  profiles[name] = profile;
  store.set('profiles', profiles);
  return profile;
}

export function deleteProfile(name: string): boolean {
  const profiles = store.get('profiles') || {};
  if (!profiles[name]) return false;
  delete profiles[name];
  store.set('profiles', profiles);
  if (store.get('activeProfile') === name) {
    const remaining = Object.keys(profiles);
    store.set('activeProfile', remaining.length > 0 ? remaining[0] : DEFAULT_PROFILE);
    if (remaining.length === 0) {
      createProfile(DEFAULT_PROFILE);
      store.set('activeProfile', DEFAULT_PROFILE);
    }
  }
  return true;
}

export function listProfiles(): Record<string, ProfileData> {
  return store.get('profiles') || {};
}

export function getActiveProfileName(): string {
  return store.get('activeProfile') || DEFAULT_PROFILE;
}

export function setActiveProfile(name: string): void {
  store.set('activeProfile', name);
}

export function profileExists(name: string): boolean {
  const profiles = store.get('profiles') || {};
  return name in profiles;
}

export function getConfig(): AnycliConfig {
  return store.store;
}

export function setConfig(key: string, value: unknown): void {
  store.set(key as keyof AnycliConfig, value as never);
}

export function getSessionId(): string {
  if (process.env.ANYCLI_SESSION_ID) return extractSessionId(process.env.ANYCLI_SESSION_ID);
  return getProfile().sessionId || '';
}

export function setSessionId(sessionId: string): void {
  setProfileField('sessionId', extractSessionId(sessionId));
}

export function getProjectConfig(projectName: string): ProjectConfig | undefined {
  return getProfile().projects[projectName];
}

/**
 * 解析项目级静态请求头（auth.extraHeaders + 兼容旧 tenantId/extTenantId 直填）。
 * 授权方式/凭证不在这里——整个 CLI 一套授权，见 Profile.auth。
 */
export function resolveProjectHeaders(config?: ProjectConfig): Record<string, string> {
  const auth = config?.auth;
  const extra: Record<string, string> = { ...(auth?.extraHeaders || {}) };
  if (config?.tenantId && !('x-tenant-id' in extra)) extra['x-tenant-id'] = config.tenantId;
  if (config?.extTenantId && !('x-ext-tenant-id' in extra)) extra['x-ext-tenant-id'] = config.extTenantId;
  return extra;
}

/**
 * 获取当前 Profile 的统一鉴权配置（授权方式 + 凭证 + 刷新配置）。
 * 未配置时默认 session-id。
 */
export function getProfileAuthConfig(): ProjectAuthConfig {
  const profile = getProfile();
  const profileAuth = profile.auth || { type: 'session-id' as AuthStrategyType };
  return {
    type: profileAuth.type,
    token: profileAuth.token,
    refreshUrl: profileAuth.refreshUrl,
    refreshIntervalMs: profileAuth.refreshIntervalMs,
    extraHeaders: profileAuth.extraHeaders || {},
  };
}

/** 设置当前 Profile 的统一鉴权配置字段 */
export function setProfileAuthField(field: keyof ProfileAuthConfig, value: unknown): void {
  const profile = getProfile();
  const auth: ProfileAuthConfig = { type: 'session-id', ...(profile.auth || {}) };
  (auth as unknown as Record<string, unknown>)[field] = value;
  setProfileField('auth', auth);
}

/** 设置当前 Profile 的授权方式（session-id / bearer-token） */
export function setProfileAuthType(type: AuthStrategyType): void {
  setProfileAuthField('type', type);
}

/** 获取当前 Profile 的 bearer-token 凭证 */
export function getProfileToken(): string {
  return getProfile().auth?.token || '';
}

/** 设置当前 Profile 的 bearer-token 凭证 */
export function setProfileToken(token: string): void {
  setProfileAuthField('token', token);
}

/**
 * 解析某项目一次请求的有效鉴权配置。
 * 授权方式/凭证/刷新配置来自 Profile（整个 CLI 一套），静态请求头来自项目（如 x-tenant-id / x-ext-tenant-id）。
 * 1c 之前公司配置用 tenantId/extTenantId 直填 x-tenant-id/x-ext-tenant-id；现统一走 auth.extraHeaders，
 * 开源框架不硬编码公司头名。新项目请直接在项目 auth.extraHeaders 中配置所需请求头。
 */
export function resolveAuthFromProjectConfig(config?: ProjectConfig): ProjectAuthConfig {
  const profileAuth = getProfile().auth || { type: 'session-id' as AuthStrategyType };
  return {
    type: profileAuth.type,
    token: profileAuth.token,
    refreshUrl: profileAuth.refreshUrl,
    refreshIntervalMs: profileAuth.refreshIntervalMs,
    extraHeaders: resolveProjectHeaders(config),
  };
}

export function getProjectAuthConfig(projectName: string): ProjectAuthConfig {
  return resolveAuthFromProjectConfig(getProfile().projects[projectName]);
}

export function setProjectConfig(projectName: string, config: ProjectConfig): void {
  const profile = getProfile();
  const projects = { ...profile.projects, [projectName]: config };
  setProfileField('projects', projects);
}

export function getEnv(): string {
  if (process.env.ANYCLI_ENV) return process.env.ANYCLI_ENV;
  return getProfile().env || 'prod';
}

export function getDefaultFormat(): string {
  return store.get('defaultFormat') || 'json';
}

/**
 * 解析网关地址。
 * 优先级：Profile.gatewayUrl > ANYCLI_GATEWAY_URL 环境变量 > 报错。
 * 单项目可用 ProjectConfig.baseUrl 覆盖（client 优先取 baseUrl）。
 */
export function getGatewayUrl(): string {
  const profile = getProfile();
  if (profile.gatewayUrl && profile.gatewayUrl.trim()) return profile.gatewayUrl.trim();
  if (process.env.ANYCLI_GATEWAY_URL) return process.env.ANYCLI_GATEWAY_URL;
  throw new AnycliError(
    ErrorCode.CONFIG_MISSING,
    '未配置网关地址，请先执行: anycli config init 或 anycli config set gateway-url <url>',
    'anycli config init'
  );
}

/**
 * 解析登录页地址（session-id 授权使用）。
 * 优先级：Profile.loginUrl > ANYCLI_LOGIN_URL 环境变量 > 报错。
 */
export function getLoginUrl(): string {
  const profile = getProfile();
  if (profile.loginUrl && profile.loginUrl.trim()) return profile.loginUrl.trim();
  if (process.env.ANYCLI_LOGIN_URL) return process.env.ANYCLI_LOGIN_URL;
  throw new AnycliError(
    ErrorCode.CONFIG_MISSING,
    '未配置登录页地址，请先执行: anycli config init 或 anycli config set login-url <url>',
    'anycli config init'
  );
}

export function getAllProjects(): Record<string, ProjectConfig> {
  return getProfile().projects || {};
}

export function projectExists(projectName: string): boolean {
  return projectName in (getProfile().projects || {});
}

/**
 * 解析数据工作区（apis/skills/flows 的根目录）。
 * 优先级：ANYCLI_WORKSPACE 环境变量 > ~/.anycli/config 的 workspace 字段 > ~/.anycli（默认，配置与产出统一）。
 */
export function resolveWorkspace(): string {
  if (process.env.ANYCLI_WORKSPACE) return process.env.ANYCLI_WORKSPACE;
  const ws = store.get('workspace');
  if (typeof ws === 'string' && ws.trim()) return ws.trim();
  // 默认工作目录 = ~/.anycli：配置与产出（apis/、skills/、src/projects/）统一存放，
  // 使用者可直接把该目录纳入 git 管理。包内不再作为默认 workspace。
  mkdirSync(CONFIG_DIR, { recursive: true });
  return CONFIG_DIR;
}

export { CONFIG_DIR, store, PACKAGE_ROOT };
