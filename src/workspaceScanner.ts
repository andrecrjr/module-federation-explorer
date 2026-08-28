import * as vscode from 'vscode';
import * as path from 'path';
import {
  createVscodeDiscoveryDependencies,
  FederationDiscoveryService,
  type ConfigFileType
} from './federation/configFileRegistry';

export interface DetectedProject {
  path: string;
  name: string;
  configType: ConfigFileType;
  configPath: string;
  remotes: { name: string; url?: string }[];
}

/** Onboarding adapter over same federation discovery pipeline used by explorer loading. */
export async function detectModuleFederationProjects(): Promise<DetectedProject[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const result = await new FederationDiscoveryService(createVscodeDiscoveryDependencies()).discover(
    workspaceFolders.map(folder => folder.uri.fsPath)
  );

  return result.configurations.map(({ filePath, type, config }) => ({
    path: path.dirname(filePath),
    name: config.name || path.basename(path.dirname(filePath)) || 'Module Federation project',
    configType: type,
    configPath: filePath,
    remotes: config.remotes.map(remote => ({ name: remote.name, url: remote.url }))
  }));
}
