import {
  ExposedModule,
  ExposesFolder,
  ModuleFederationConfig,
  RemotesFolder,
  RootFolder
} from './types';

export type RootFolderChild = RemotesFolder | ExposesFolder;

export function getRootFolderChildren(
  rootFolder: RootFolder,
  log: (message: string) => void = () => {}
): RootFolderChild[] {
  const allRemotes = rootFolder.configs.flatMap(config => config.remotes);
  const allExposes = rootFolder.configs.flatMap(config => config.exposes);

  log(`Building tree for Host folder ${rootFolder.name}:`);
  log(`- Found ${rootFolder.configs.length} configs with ${allRemotes.length} remotes and ${allExposes.length} exposes`);

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

export function getRemoteExposedModules(
  rootConfigs: ReadonlyMap<string, ModuleFederationConfig[]>,
  remoteName: string
): ExposedModule[] {
  const exposedModules: ExposedModule[] = [];

  for (const configs of rootConfigs.values()) {
    for (const config of configs) {
      if (config.remotes.some(remote => remote.name === remoteName)) {
        exposedModules.push(...config.exposes.filter(expose => expose.remoteName === remoteName));
      }
    }
  }

  return exposedModules;
}
