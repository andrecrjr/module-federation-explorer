import type { ModuleFederationConfig } from './types';
import type {
  ManifestDiagnostic,
  ManifestDiscoveryOptions,
  ManifestDiscoveryResult,
  ManifestLoadError,
  ManifestRecord,
  ManifestSourceConfig,
  ManifestSourceKind
} from './manifestTypes';
import { parseManifestText } from './manifestParser';

export interface ManifestFileDiscovery {
  findFiles(rootPath: string, pattern: string, excludePattern: string): Promise<string[]>;
}

export interface ManifestSourceLoader {
  load(source: ManifestSourceConfig): Promise<string>;
}

export interface ManifestDiscoveryDependencies extends ManifestFileDiscovery {
  loadSource: ManifestSourceLoader['load'];
  workspaceRoot?: string;
  now?: () => string;
}

const MANIFEST_PATTERN = '**/mf-manifest.json';
const NODE_MODULES_EXCLUDE_PATTERN = '**/node_modules/**';

function normalizeLocalPath(filePath: string): string {
  const value = filePath.replace(/\\/g, '/');
  const drive = /^[A-Za-z]:/.test(value) ? value.slice(0, 2) : '';
  const hasRoot = value.startsWith('/') || drive.length > 0;
  const segments = value.slice(drive.length).split('/');
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (normalized.length > 0 && normalized[normalized.length - 1] !== '..') normalized.pop();
      else if (!hasRoot) normalized.push(segment);
      continue;
    }
    normalized.push(segment);
  }
  const prefix = drive ? `${drive}/` : hasRoot ? '/' : '';
  return `${prefix}${normalized.join('/')}` || (hasRoot ? prefix : '.');
}

function isWithin(candidatePath: string, rootPath: string): boolean {
  const candidate = normalizeLocalPath(candidatePath);
  const root = normalizeLocalPath(rootPath).replace(/\/$/, '');
  return candidate === root || candidate.startsWith(`${root}/`);
}

function containingRoot(candidatePath: string, rootPaths: readonly string[]): string | undefined {
  return [...rootPaths]
    .filter(rootPath => isWithin(candidatePath, rootPath))
    .sort((left, right) => normalizeLocalPath(right).length - normalizeLocalPath(left).length)[0];
}

function resolveLocalLocation(location: string, workspaceRoot: string | undefined): string {
  if (/^(?:[A-Za-z]:[\\/]|\/)/.test(location)) return normalizeLocalPath(location);
  return normalizeLocalPath(workspaceRoot ? `${workspaceRoot}/${location}` : location);
}

function canonicalizeUrl(location: string): string {
  const url = new URL(location);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported manifest URL protocol: ${url.protocol}`);
  }
  url.hash = '';
  return url.toString();
}

function sourceKey(source: ManifestSourceConfig): string {
  return `${source.kind}:${source.location}`;
}

/** Returns a safe source label for logs without URL credentials, queries, or fragments. */
export function formatManifestSource(source: ManifestSourceConfig): string {
  if (source.kind === 'local') return source.location;
  try {
    const url = new URL(source.location);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[invalid manifest URL]';
  }
}

function normalizeSource(source: ManifestSourceConfig, workspaceRoot: string | undefined): ManifestSourceConfig {
  if (source.kind === 'local') {
    return { ...source, location: resolveLocalLocation(source.location, workspaceRoot) };
  }
  if (source.kind === 'url') return { ...source, location: canonicalizeUrl(source.location) };
  const unsupportedKind = source.kind as string;
  throw new Error(`Unsupported manifest source kind: ${unsupportedKind}`);
}

function errorForParse(source: ManifestSourceConfig, diagnostics: ManifestDiagnostic[]): ManifestLoadError {
  return {
    source,
    error: new Error(`Manifest at ${source.location} did not contain a usable identity.`),
    diagnostics
  };
}

function associateManifest(
  manifest: ManifestRecord,
  rootPaths: readonly string[],
  staticConfigs: ReadonlyMap<string, ModuleFederationConfig[]> | undefined
): void {
  if (manifest.source.kind === 'local') manifest.rootPath = containingRoot(manifest.manifestPath, rootPaths);
  if (!staticConfigs) return;

  const candidates: Array<{ rootPath: string; configPath: string }> = [];
  for (const [rootPath, configs] of staticConfigs) {
    for (const config of configs) {
      if (config.name !== manifest.name && config.name !== manifest.id) continue;
      candidates.push({ rootPath, configPath: config.configPath });
    }
  }

  const manifestRootPath = manifest.rootPath;
  const rootedCandidates = manifestRootPath
    ? candidates.filter(candidate => normalizeLocalPath(candidate.rootPath) === normalizeLocalPath(manifestRootPath))
    : candidates;
  if (rootedCandidates.length === 1) {
    const match = rootedCandidates[0]!;
    manifest.rootPath = match.rootPath;
    manifest.configPath = match.configPath;
    return;
  }
  if (rootedCandidates.length > 1) {
    manifest.diagnostics.push({
      code: 'AMBIGUOUS_STATIC_ASSOCIATION',
      severity: 'warning',
      path: '$.name',
      message: `Manifest name "${manifest.name}" matches multiple static configurations.`
    });
  }
}

/** Discovers local and explicitly configured manifest sources without executing project code. */
export class ManifestDiscoveryService {
  constructor(private readonly dependencies: ManifestDiscoveryDependencies) {}

  async discover(
    rootPaths: readonly string[],
    options: ManifestDiscoveryOptions = {}
  ): Promise<ManifestDiscoveryResult> {
    const sources = new Map<string, ManifestSourceConfig>();
    const errors: ManifestLoadError[] = [];
    const addSource = (source: ManifestSourceConfig): void => {
      try {
        const normalized = normalizeSource(source, this.dependencies.workspaceRoot);
        const key = sourceKey(normalized);
        if (!sources.has(key)) sources.set(key, normalized);
      } catch (error) {
        errors.push({ source, error, diagnostics: [] });
      }
    };

    for (const source of options.sources || []) addSource(source);
    for (const rootPath of rootPaths) {
      try {
        const matches = await this.dependencies.findFiles(rootPath, MANIFEST_PATTERN, NODE_MODULES_EXCLUDE_PATTERN);
        for (const filePath of [...matches].sort()) addSource({ kind: 'local', location: filePath });
      } catch (error) {
        errors.push({ source: { kind: 'local', location: rootPath }, error, diagnostics: [] });
      }
    }

    const manifests: ManifestRecord[] = [];
    for (const source of sources.values()) {
      try {
        const text = await this.dependencies.loadSource(source);
        const parsed = parseManifestText(text, {
          source,
          loadedAt: this.dependencies.now ? this.dependencies.now() : new Date().toISOString()
        });
        if (!parsed.manifest) {
          errors.push(errorForParse(source, parsed.diagnostics));
          continue;
        }
        associateManifest(parsed.manifest, rootPaths, options.staticConfigs);
        manifests.push(parsed.manifest);
      } catch (error) {
        errors.push({ source, error, diagnostics: [] });
      }
    }

    return { manifests, errors };
  }
}

export { MANIFEST_PATTERN, NODE_MODULES_EXCLUDE_PATTERN };
export type { ManifestDiscoveryOptions, ManifestSourceKind };
