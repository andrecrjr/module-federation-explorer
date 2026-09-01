import type {
  ManifestArtifact,
  ManifestAsset,
  ManifestDiagnostic,
  ManifestExpose,
  ManifestMetadata,
  ManifestParseOptions,
  ManifestParseResult,
  ManifestRecord,
  ManifestRemote,
  ManifestSharedDependency
} from './manifestTypes';

type JsonRecord = Record<string, unknown>;

const DEFAULT_SOURCE = { kind: 'local' as const, location: '' };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function addDiagnostic(
  diagnostics: ManifestDiagnostic[],
  code: ManifestDiagnostic['code'],
  path: string,
  message: string,
  severity: ManifestDiagnostic['severity'] = 'warning'
): void {
  diagnostics.push({ code, severity, path, message });
}

function parseJson(text: string, diagnostics: ManifestDiagnostic[]): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    addDiagnostic(
      diagnostics,
      'MALFORMED_JSON',
      '$',
      `Manifest JSON could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      'error'
    );
    return undefined;
  }
}

function normalizeArtifact(value: unknown): ManifestArtifact | undefined {
  const directPath = stringValue(value);
  if (directPath) return { path: directPath };
  if (!isRecord(value)) return undefined;

  const path = stringValue(value.path) || stringValue(value.url);
  if (!path) return undefined;
  const artifact: ManifestArtifact = { path };
  const name = stringValue(value.name);
  const type = stringValue(value.type);
  if (name) artifact.name = name;
  if (type) artifact.type = type;
  return artifact;
}

function normalizeAssets(value: unknown, disabled: boolean): ManifestAsset[] {
  if (disabled || value === undefined) return [];

  const assets: ManifestAsset[] = [];
  const visit = (candidate: unknown, type: string | undefined, mode: ManifestAsset['mode']): void => {
    const directPath = stringValue(candidate);
    if (directPath) {
      assets.push({ path: directPath, ...(type ? { type } : {}), ...(mode ? { mode } : {}) });
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, type, mode);
      return;
    }
    if (!isRecord(candidate)) return;

    const artifactPath = stringValue(candidate.path) || stringValue(candidate.url);
    if (artifactPath) {
      const asset: ManifestAsset = {
        path: artifactPath,
        ...(type ? { type } : {}),
        ...(mode ? { mode } : {})
      };
      const name = stringValue(candidate.name);
      if (name) asset.name = name;
      assets.push(asset);
      return;
    }

    for (const [key, nested] of Object.entries(candidate)) {
      if (key === 'sync' || key === 'async') {
        visit(nested, type, key);
      } else if (key !== 'name' && key !== 'type') {
        visit(nested, type || key, mode);
      }
    }
  };

  visit(value, undefined, undefined);
  return assets;
}

function parseMetadata(value: unknown, root: JsonRecord, diagnostics: ManifestDiagnostic[]): ManifestMetadata {
  const metadata: ManifestMetadata = {
    assets: [],
    disableAssetsAnalyze: root.disableAssetsAnalyze === true
  };
  if (value === undefined) {
    metadata.assets = normalizeAssets(root.assets, metadata.disableAssetsAnalyze);
    return metadata;
  }
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, 'INVALID_METADATA', '$.metaData', 'Manifest metaData must be an object.');
    return metadata;
  }

  for (const key of ['type', 'buildVersion', 'buildName', 'description', 'publicPath'] as const) {
    const field = stringValue(value[key]);
    if (field) metadata[key] = field;
  }
  const remoteEntry = normalizeArtifact(value.remoteEntry);
  if (remoteEntry) metadata.remoteEntry = remoteEntry;
  const types = normalizeArtifact(value.types);
  if (types) metadata.types = types;
  metadata.disableAssetsAnalyze = value.disableAssetsAnalyze === true || metadata.disableAssetsAnalyze;
  metadata.assets = normalizeAssets(value.assets, metadata.disableAssetsAnalyze);
  return metadata;
}

function parseRemote(value: unknown, path: string, disabled: boolean, diagnostics: ManifestDiagnostic[]): ManifestRemote | undefined {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, 'INVALID_REMOTE', path, 'Manifest remote must be an object.');
    return undefined;
  }
  const name = stringValue(value.name) || stringValue(value.id);
  if (!name) {
    addDiagnostic(diagnostics, 'INVALID_REMOTE', path, 'Manifest remote must have a name or id.');
    return undefined;
  }

  const remote: ManifestRemote = { name, aliases: [], assets: [] };
  const id = stringValue(value.id);
  if (id) remote.id = id;
  const alias = stringValue(value.alias);
  if (alias) remote.aliases.push(alias);
  if (Array.isArray(value.aliases)) {
    for (const candidate of value.aliases) {
      const aliasValue = stringValue(candidate);
      if (aliasValue && !remote.aliases.includes(aliasValue)) remote.aliases.push(aliasValue);
    }
  }

  const entry = normalizeArtifact(value.entry) || normalizeArtifact(value.remoteEntry);
  if (entry) {
    remote.remoteEntry = entry;
    remote.entry = entry.path;
  }
  const types = normalizeArtifact(value.types);
  if (types) remote.types = types;
  remote.assets = normalizeAssets(value.assets, disabled);
  return remote;
}

function parseExpose(value: unknown, path: string, disabled: boolean, diagnostics: ManifestDiagnostic[]): ManifestExpose | undefined {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, 'INVALID_EXPOSE', path, 'Manifest expose must be an object.');
    return undefined;
  }
  const name = stringValue(value.name) || stringValue(value.id);
  const exposePath = stringValue(value.path);
  if (!name || !exposePath) {
    addDiagnostic(diagnostics, 'INVALID_EXPOSE', path, 'Manifest expose must have a name and path.');
    return undefined;
  }
  const expose: ManifestExpose = { name, path: exposePath, assets: [] };
  const id = stringValue(value.id);
  if (id) expose.id = id;
  const types = normalizeArtifact(value.types);
  if (types) expose.types = types;
  expose.assets = normalizeAssets(value.assets, disabled);
  return expose;
}

function parseShared(value: unknown, path: string, diagnostics: ManifestDiagnostic[]): ManifestSharedDependency | undefined {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, 'INVALID_SHARED_DEPENDENCY', path, 'Manifest shared dependency must be an object.');
    return undefined;
  }
  const name = stringValue(value.name) || stringValue(value.id);
  if (!name) {
    addDiagnostic(diagnostics, 'INVALID_SHARED_DEPENDENCY', path, 'Manifest shared dependency must have a name or id.');
    return undefined;
  }

  const dependency: ManifestSharedDependency = { name };
  for (const key of ['id', 'version', 'requiredVersion', 'shareScope'] as const) {
    const field = stringValue(value[key]);
    if (field) dependency[key] = field;
  }
  for (const key of ['singleton', 'eager', 'strictVersion'] as const) {
    if (typeof value[key] === 'boolean') dependency[key] = value[key];
  }
  return dependency;
}

function parseValue(value: unknown, options: ManifestParseOptions, diagnostics: ManifestDiagnostic[]): ManifestRecord | undefined {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, 'INVALID_ROOT', '$', 'Manifest root must be a JSON object.', 'error');
    return undefined;
  }

  const rawId = stringValue(value.id);
  const rawName = stringValue(value.name);
  if (!rawId && !rawName) {
    addDiagnostic(diagnostics, 'MISSING_IDENTITY', '$.id', 'Manifest must provide a non-empty id or name.', 'error');
    return undefined;
  }
  if (!rawId) addDiagnostic(diagnostics, 'INVALID_IDENTITY', '$.id', 'Manifest id is missing; name was used as the id.');
  if (!rawName) addDiagnostic(diagnostics, 'INVALID_IDENTITY', '$.name', 'Manifest name is missing; id was used as the name.');

  const metadata = parseMetadata(value.metaData, value, diagnostics);
  const disabled = metadata.disableAssetsAnalyze;
  if (disabled) {
    addDiagnostic(
      diagnostics,
      'ASSETS_OMITTED',
      '$.metaData.disableAssetsAnalyze',
      'Manifest asset analysis is disabled; asset records may be omitted.'
    );
  }

  const remotes: ManifestRemote[] = [];
  if (value.remotes !== undefined) {
    if (Array.isArray(value.remotes)) {
      value.remotes.forEach((remote, index) => {
        const parsed = parseRemote(remote, `$.remotes[${index}]`, disabled, diagnostics);
        if (parsed) remotes.push(parsed);
      });
    } else {
      addDiagnostic(diagnostics, 'INVALID_REMOTE', '$.remotes', 'Manifest remotes must be an array.');
    }
  }

  const exposes: ManifestExpose[] = [];
  if (value.exposes !== undefined) {
    if (Array.isArray(value.exposes)) {
      value.exposes.forEach((expose, index) => {
        const parsed = parseExpose(expose, `$.exposes[${index}]`, disabled, diagnostics);
        if (parsed) exposes.push(parsed);
      });
    } else {
      addDiagnostic(diagnostics, 'INVALID_EXPOSE', '$.exposes', 'Manifest exposes must be an array.');
    }
  }

  const shared: ManifestSharedDependency[] = [];
  if (value.shared !== undefined) {
    if (Array.isArray(value.shared)) {
      value.shared.forEach((dependency, index) => {
        const parsed = parseShared(dependency, `$.shared[${index}]`, diagnostics);
        if (parsed) shared.push(parsed);
      });
    } else {
      addDiagnostic(diagnostics, 'INVALID_SHARED_DEPENDENCY', '$.shared', 'Manifest shared must be an array.');
    }
  }

  const source = options.source || DEFAULT_SOURCE;
  return {
    provenance: 'manifest',
    id: rawId || rawName!,
    name: rawName || rawId!,
    metadata,
    shared,
    remotes,
    exposes,
    source,
    manifestPath: source.location,
    loadedAt: options.loadedAt || '',
    diagnostics
  };
}

/** Parses manifest JSON text without executing project code or retaining unknown fields. */
export function parseManifestText(text: string, options: ManifestParseOptions = {}): ManifestParseResult {
  const diagnostics: ManifestDiagnostic[] = [];
  const value = parseJson(text, diagnostics);
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) return { diagnostics };
  return { manifest: parseValue(value, options, diagnostics), diagnostics };
}

/** Parses an already-decoded JSON value using the same pure manifest normalization rules. */
export function parseManifestValue(value: unknown, options: ManifestParseOptions = {}): ManifestParseResult {
  const diagnostics: ManifestDiagnostic[] = [];
  return { manifest: parseValue(value, options, diagnostics), diagnostics };
}
