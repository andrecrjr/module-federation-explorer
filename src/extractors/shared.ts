import { asNode, findProperty, getLiteralString, getPropertyKey, nodeList } from '../parser/astUtils';
import { resolveStringExpression } from '../parser/expressionResolver';
import type { ModuleFederationConfig, SharedDependency } from '../types';

export function createConfig(configType: ModuleFederationConfig['configType']): ModuleFederationConfig {
  return { name: '', remotes: [], exposes: [], shared: [], detected: false, configType, configPath: '' };
}

export function extractConfigFromOptions(options: unknown, config: ModuleFederationConfig): void {
  const name = getLiteralString(findProperty(options, 'name')?.value);
  if (name) config.name = name;

  const remotes = asNode(findProperty(options, 'remotes')?.value);
  if (remotes?.type === 'ObjectExpression') {
    for (const property of nodeList(remotes.properties)) {
      if (property.type !== 'Property') continue;
      const remoteName = getPropertyKey(property);
      if (!remoteName) continue;
      const remoteObject = asNode(property.value);
      const remoteUrl = remoteObject?.type === 'ObjectExpression'
        ? resolveStringExpression(findProperty(remoteObject, 'url')?.value || findProperty(remoteObject, 'entry')?.value)
        : resolveStringExpression(property.value);
      if (!remoteUrl) continue;

      let finalName = remoteName;
      let finalUrl = remoteUrl;
      if (remoteUrl.includes('@') && !remoteUrl.startsWith('[') && !remoteUrl.startsWith('http')) {
        const parts = remoteUrl.split('@');
        if (parts.length === 2) [finalName, finalUrl] = parts;
      }

      config.remotes.push({
        name: finalName,
        url: finalUrl,
        folder: remoteName,
        remoteEntry: finalUrl,
        packageManager: 'npm',
        configType: config.configType
      });
    }
  }

  const exposes = asNode(findProperty(options, 'exposes')?.value);
  if (exposes?.type === 'ObjectExpression') {
    for (const property of nodeList(exposes.properties)) {
      const exposeName = getPropertyKey(property);
      const exposePath = resolveStringExpression(property.value);
      if (property.type === 'Property' && exposeName && exposePath) {
        config.exposes.push({ name: exposeName, path: exposePath, remoteName: config.name });
      }
    }
  }

  const shared = findProperty(options, 'shared')?.value;
  if (shared) config.shared = extractSharedDependencies(shared);
}

export function extractSharedDependencies(value: unknown): SharedDependency[] {
  const node = asNode(value);
  if (!node) return [];

  if (node.type === 'ArrayExpression') {
    return nodeList(node.elements)
      .map(getLiteralString)
      .filter((name): name is string => !!name)
      .map(name => ({ name }));
  }

  if (node.type === 'CallExpression') return [{ name: '[DYNAMIC_SHARED]' }];
  if (node.type !== 'ObjectExpression') return [];

  return nodeList(node.properties).flatMap(property => {
    if (property.type !== 'Property') return [];
    const name = getPropertyKey(property);
    if (!name) return [];
    const dependency: SharedDependency = { name };
    const options = asNode(property.value);
    if (options?.type !== 'ObjectExpression') return [dependency];

    for (const option of nodeList(options.properties)) {
      if (option.type !== 'Property') continue;
      const key = getPropertyKey(option);
      const literal = asNode(option.value);
      if (!key || !literal || literal.type !== 'Literal') continue;
      if (typeof literal.value === 'boolean' && ['singleton', 'eager', 'strictVersion'].includes(key)) {
        dependency[key as 'singleton' | 'eager' | 'strictVersion'] = literal.value;
      }
      if (typeof literal.value === 'string' && ['version', 'requiredVersion'].includes(key)) {
        dependency[key as 'version' | 'requiredVersion'] = literal.value;
      }
    }
    return [dependency];
  });
}
