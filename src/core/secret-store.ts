import { createRequire } from 'node:module';

/**
 * 系统钥匙串（keychain）凭证存储底层。
 * 基于 @napi-rs/keyring（optionalDependencies）：Windows Credential Manager / macOS Keychain / Linux libsecret。
 * 该库为可选依赖，同步加载失败时返回 null/false，由上层降级到 file（config.json）模式。
 */
const nodeRequire = createRequire(import.meta.url);

type KeyringEntry = {
  setPassword(password: string): void;
  getPassword(): string | null;
  deletePassword(): boolean;
};
type KeyringModule = { Entry?: new (service: string, account: string) => KeyringEntry };

let keyringModule: KeyringModule | null | undefined;

function getKeyringModule(): KeyringModule | null {
  if (keyringModule !== undefined) return keyringModule;
  keyringModule = null;
  try {
    const mod = nodeRequire('@napi-rs/keyring') as KeyringModule & { default?: KeyringModule };
    const entryCtor = mod.Entry ?? mod.default?.Entry;
    if (entryCtor) keyringModule = mod as KeyringModule;
  } catch {
    keyringModule = null;
  }
  return keyringModule;
}

/** keychain 是否可用（便于 UI 展示 / 提示）。 */
export function keychainAvailable(): boolean {
  return !!getKeyringModule();
}

/** 写入系统钥匙串。成功返回 true；keyring 不可用或写入失败返回 false（由调用方决定是否降级）。 */
export function keychainSet(service: string, account: string, password: string): boolean {
  const mod = getKeyringModule();
  if (!mod?.Entry) return false;
  try {
    new mod.Entry(service, account).setPassword(password);
    return true;
  } catch {
    return false;
  }
}

/** 从系统钥匙串读取。无凭证或 keyring 不可用返回 null。 */
export function keychainGet(service: string, account: string): string | null {
  const mod = getKeyringModule();
  if (!mod?.Entry) return null;
  try {
    return new mod.Entry(service, account).getPassword();
  } catch {
    return null;
  }
}

/** 删除系统钥匙串中的凭证。成功删除返回 true；不存在或失败返回 false。 */
export function keychainDelete(service: string, account: string): boolean {
  const mod = getKeyringModule();
  if (!mod?.Entry) return false;
  try {
    return new mod.Entry(service, account).deletePassword();
  } catch {
    return false;
  }
}
