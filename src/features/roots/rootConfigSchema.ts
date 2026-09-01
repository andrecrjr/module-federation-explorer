import type { UnifiedRootConfig } from './types';
import type { ManifestSourceConfig } from '../../federation/manifestTypes';

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ROOT_CONFIG_TYPES = new Set(['webpack', 'vite', 'modernjs', 'rsbuild', 'rspack', 'external']);
const MANIFEST_SOURCE_KINDS = new Set(['local', 'url']);

function optionalString(record: JsonRecord, key: string): boolean {
  return record[key] === undefined || typeof record[key] === 'string';
}

function isRemoteConfig(value: unknown): boolean {
  if (!isJsonRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    typeof value.folder === 'string' &&
    typeof value.packageManager === 'string' &&
    typeof value.configType === 'string' &&
    ROOT_CONFIG_TYPES.has(value.configType) &&
    optionalString(value, 'url') &&
    optionalString(value, 'remoteEntry') &&
    optionalString(value, 'startCommand') &&
    optionalString(value, 'buildCommand') &&
    optionalString(value, 'configSource') &&
    (value.isExternal === undefined || typeof value.isExternal === 'boolean')
  );
}

function isExternalRemoteConfig(value: unknown): boolean {
  return (
    isJsonRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.url === 'string' &&
    value.configType === 'external' &&
    value.isExternal === true
  );
}

function isRootConfigEntry(value: unknown): boolean {
  if (!isJsonRecord(value) || !optionalString(value, 'startCommand')) return false;
  if (
    value.remotes !== undefined &&
    (!isJsonRecord(value.remotes) || !Object.values(value.remotes).every(isRemoteConfig))
  )
    return false;
  if (
    value.externalRemotes !== undefined &&
    (!isJsonRecord(value.externalRemotes) || !Object.values(value.externalRemotes).every(isExternalRemoteConfig))
  )
    return false;
  return true;
}

function isRootConfigs(value: unknown): value is NonNullable<UnifiedRootConfig['rootConfigs']> {
  return isJsonRecord(value) && Object.values(value).every(isRootConfigEntry);
}

function isManifestSource(value: unknown): value is ManifestSourceConfig {
  return (
    isJsonRecord(value) &&
    typeof value.kind === 'string' &&
    MANIFEST_SOURCE_KINDS.has(value.kind) &&
    typeof value.location === 'string' &&
    value.location.trim().length > 0 &&
    (value.environment === undefined || typeof value.environment === 'string')
  );
}

function isManifestSources(value: unknown): value is ManifestSourceConfig[] {
  return Array.isArray(value) && value.every(isManifestSource);
}

/** Pure validation for current root configuration schema. */
export function parseRootConfig(value: unknown): UnifiedRootConfig | undefined {
  if (!isJsonRecord(value) || !Array.isArray(value.roots) || !value.roots.every(root => typeof root === 'string'))
    return undefined;
  if (value.rootConfigs !== undefined && !isRootConfigs(value.rootConfigs)) return undefined;
  if (value.manifestSources !== undefined && !isManifestSources(value.manifestSources)) return undefined;
  const config: UnifiedRootConfig = { roots: value.roots };
  if (value.rootConfigs !== undefined) config.rootConfigs = value.rootConfigs;
  if (value.manifestSources !== undefined) config.manifestSources = value.manifestSources;
  return config;
}

/** Pure migration for documented legacy root arrays. */
export function migrateLegacyRootConfig(value: unknown): UnifiedRootConfig | undefined {
  if (!isJsonRecord(value)) return undefined;
  for (const field of ['paths', 'directories']) {
    const roots = value[field];
    if (Array.isArray(roots) && roots.every(root => typeof root === 'string')) return { roots };
  }
  return undefined;
}
