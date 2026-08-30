import type { ExposedModule, ModuleFederationConfig, Remote } from '../../federation/types';
import type { ExposesFolder, RemotesFolder, RootFolder } from './types';

export type RootFolderChild = RemotesFolder | ExposesFolder;
export type RemoteExposedModulesIndex = ReadonlyMap<string, readonly ExposedModule[]>;

export function getRootFolderChildren(
  rootFolder: RootFolder,
  log: (message: string) => void = () => {}
): RootFolderChild[] {
  const allRemotes: Remote[] = [];
  const allExposes: ExposedModule[] = [];
  for (const config of rootFolder.configs) {
    allRemotes.push(...config.remotes);
    allExposes.push(...config.exposes);
  }

  log(`Building tree for Host folder ${rootFolder.name}:`);
  log(
    `- Found ${rootFolder.configs.length} configs with ${allRemotes.length} remotes and ${allExposes.length} exposes`
  );

  if (allRemotes.length > 0) {
    log(`- Remotes to display: ${allRemotes.map(remote => remote.name).join(', ')}`);
  } else {
    log('- No remotes found to display');
  }

  if (allExposes.length > 0) {
    log(`- Exposes to display: ${allExposes.map(expose => expose.name).join(', ')}`);
  } else {
    log('- No exposes found to display');
  }

  const children: RootFolderChild[] = [];
  if (allRemotes.length > 0) {
    children.push({
      type: 'remotesFolder',
      parentName: rootFolder.name,
      parentPath: rootFolder.path,
      remotes: allRemotes
    });
  }

  if (allExposes.length > 0) {
    children.push({
      type: 'exposesFolder',
      parentName: rootFolder.name,
      exposes: allExposes
    });
  }

  log(`- Generated ${children.length} tree folders for ${rootFolder.name}`);
  return children;
}

export function buildRemoteExposedModulesIndex(
  rootConfigs: ReadonlyMap<string, ModuleFederationConfig[]>
): RemoteExposedModulesIndex {
  const index = new Map<string, ExposedModule[]>();

  for (const configs of rootConfigs.values()) {
    for (const config of configs) {
      const remoteNames = new Set(config.remotes.map(remote => remote.name));
      for (const expose of config.exposes) {
        if (!remoteNames.has(expose.remoteName)) continue;
        const modules = index.get(expose.remoteName) ?? [];
        modules.push(expose);
        index.set(expose.remoteName, modules);
      }
    }
  }

  return index;
}

export function getRemoteExposedModulesFromIndex(
  index: RemoteExposedModulesIndex,
  remoteName: string
): ExposedModule[] {
  return index.get(remoteName)?.slice() ?? [];
}

export function getRemoteExposedModules(
  rootConfigs: ReadonlyMap<string, ModuleFederationConfig[]>,
  remoteName: string
): ExposedModule[] {
  return getRemoteExposedModulesFromIndex(buildRemoteExposedModulesIndex(rootConfigs), remoteName);
}
