import * as path from 'path';
import * as vscode from 'vscode';
import {
  ExposedModule,
  ExposesFolder,
  Remote,
  RemotesFolder,
  RootFolder
} from '../../types';

export interface LoadingPlaceholder {
  type: 'loadingPlaceholder';
  name: string;
}

export interface EmptyState {
  type: 'emptyState';
  name: string;
  description: string;
}

export type TreeElement =
  | RootFolder
  | RemotesFolder
  | ExposesFolder
  | Remote
  | ExposedModule
  | LoadingPlaceholder
  | EmptyState;

function isRecord(element: unknown): element is Record<string, unknown> {
  return typeof element === 'object' && element !== null;
}

export function isRootFolder(element: unknown): element is RootFolder {
  return isRecord(element) && element.type === 'rootFolder';
}

export function isRemotesFolder(element: unknown): element is RemotesFolder {
  return isRecord(element) && element.type === 'remotesFolder';
}

export function isExposesFolder(element: unknown): element is ExposesFolder {
  return isRecord(element) && element.type === 'exposesFolder';
}

export function isExposedModule(element: unknown): element is ExposedModule {
  return isRecord(element) && 'remoteName' in element;
}

export function isRemote(element: unknown): element is Remote {
  return isRecord(element) && 'name' in element && !('type' in element) && !('remoteName' in element);
}

export function isLoadingPlaceholder(element: unknown): element is LoadingPlaceholder {
  return isRecord(element) && element.type === 'loadingPlaceholder';
}

export function isEmptyState(element: unknown): element is EmptyState {
  return isRecord(element) && element.type === 'emptyState';
}

export function createTreeItem(
  element: TreeElement,
  isRemoteRunning: (remoteKey: string) => boolean
): vscode.TreeItem {
  if (isLoadingPlaceholder(element)) {
    const treeItem = new vscode.TreeItem(
      'Loading Module Federation configurations...',
      vscode.TreeItemCollapsibleState.None
    );
    treeItem.iconPath = new vscode.ThemeIcon('loading~spin');
    return treeItem;
  }

  if (isEmptyState(element)) {
    const treeItem = new vscode.TreeItem(
      element.name,
      vscode.TreeItemCollapsibleState.None
    );
    treeItem.description = element.description;
    treeItem.iconPath = new vscode.ThemeIcon('info');
    treeItem.tooltip = new vscode.MarkdownString(
      '**No Module Federation Hosts found**\n\n' +
      'To get started:\n\n' +
      '1. Click the "+" button in the toolbar to add a Host folder\n' +
      '2. Select a folder containing Module Federation configurations\n' +
      '3. The extension will automatically scan for webpack, Vite, ModernJS, or RSBuild configurations'
    );
    return treeItem;
  }

  if (isRootFolder(element)) {
    const treeItem = new vscode.TreeItem(
      element.name,
      vscode.TreeItemCollapsibleState.Expanded
    );
    const tooltip = new vscode.MarkdownString(`## ${element.name}\n\n**Path:** ${element.path}\n\n`);

    if (element.configs.length > 0) {
      tooltip.appendMarkdown('**Configuration files:**\n\n');
      element.configs.forEach(config => {
        tooltip.appendMarkdown(`- ${path.basename(config.configPath)}\n`);
      });
    }

    if (element.startCommand) {
      tooltip.appendMarkdown(`\n**Serve build command:** \`${element.startCommand}\``);
    }

    if (element.isRunning) {
      tooltip.appendMarkdown('\n\n$(play) **Running**');
      treeItem.iconPath = new vscode.ThemeIcon('vm-running');
      treeItem.contextValue = 'runningRootApp';
    } else if (element.startCommand) {
      treeItem.iconPath = new vscode.ThemeIcon('vm');
      treeItem.contextValue = 'configurableRootApp';
    } else {
      treeItem.iconPath = new vscode.ThemeIcon('folder');
      treeItem.contextValue = 'rootFolder';
    }

    treeItem.tooltip = tooltip;
    return treeItem;
  }

  if (isRemotesFolder(element)) {
    const treeItem = new vscode.TreeItem(
      `Remotes (${element.remotes.length})`,
      element.remotes.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );
    treeItem.iconPath = new vscode.ThemeIcon('references');
    treeItem.tooltip = new vscode.MarkdownString(
      `## Remotes\n\n${element.remotes.length} remotes imported by ${element.parentName}`
    );
    treeItem.contextValue = 'remotesFolder';
    return treeItem;
  }

  if (isExposesFolder(element)) {
    const treeItem = new vscode.TreeItem(
      `Exposed Modules (${element.exposes.length})`,
      element.exposes.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );
    treeItem.iconPath = new vscode.ThemeIcon('export');
    treeItem.tooltip = new vscode.MarkdownString(
      `## Exposed Modules\n\n${element.exposes.length} modules exposed by ${element.parentName}`
    );
    treeItem.contextValue = 'exposesFolder';
    return treeItem;
  }

  if (isRemote(element)) {
    const isRunning = isRemoteRunning(`remote-${element.name}`);
    const hasFolder = !!element.folder;
    const hasStartCommand = !!element.startCommand;
    const isExternal = element.isExternal || element.configType === 'external';

    const treeItem = new vscode.TreeItem(
      element.name,
      vscode.TreeItemCollapsibleState.None
    );
    const tooltip = new vscode.MarkdownString(`## Remote: ${element.name}\n\n`);

    if (isExternal) {
      tooltip.appendMarkdown('**Type:** External Remote\n\n');
    }

    if (element.url) {
      tooltip.appendMarkdown(`**URL:** ${element.url}\n\n`);
    }

    if (element.remoteEntry) {
      tooltip.appendMarkdown(`**Remote entry:** ${element.remoteEntry}\n\n`);
    }

    if (element.folder && !isExternal) {
      tooltip.appendMarkdown(`**Folder:** ${element.folder}\n\n`);
    }

    if (element.startCommand && !isExternal) {
      tooltip.appendMarkdown(`**Serve build command:** \`${element.startCommand}\`\n\n`);
    }

    if (element.buildCommand && !isExternal) {
      tooltip.appendMarkdown(`**Build command:** \`${element.buildCommand}\`\n\n`);
    }

    tooltip.appendMarkdown(`**Config type:** ${element.configType}`);

    if (isExternal) {
      treeItem.iconPath = new vscode.ThemeIcon('globe');
      treeItem.contextValue = 'externalRemote';
      tooltip.appendMarkdown('\n\n$(globe) **External Remote**');
    } else if (isRunning) {
      tooltip.appendMarkdown('\n\n$(play) **Running**');
      treeItem.iconPath = new vscode.ThemeIcon('vm-running');
      treeItem.contextValue = 'runningRemote';
    } else if (hasFolder && hasStartCommand) {
      treeItem.iconPath = new vscode.ThemeIcon('vm');
      treeItem.contextValue = 'remote';
    } else {
      treeItem.iconPath = new vscode.ThemeIcon('vm-outline');
      treeItem.contextValue = 'unconfiguredRemote';
    }

    if (element.url) {
      treeItem.description = element.url;
    }

    treeItem.tooltip = tooltip;
    return treeItem;
  }

  if (isExposedModule(element)) {
    const treeItem = new vscode.TreeItem(
      element.name,
      vscode.TreeItemCollapsibleState.None
    );
    treeItem.iconPath = new vscode.ThemeIcon('symbol-module');
    treeItem.tooltip = new vscode.MarkdownString(
      `## Exposed Module: ${element.name}\n\n**Path:** ${element.path}\n\n**From remote:** ${element.remoteName}`
    );
    treeItem.description = element.path;
    if (element.configSource) {
      treeItem.command = {
        command: 'vscode.open',
        title: 'Open Exposed Module',
        arguments: [vscode.Uri.file(path.resolve(path.dirname(element.configSource), element.path))]
      };
    }
    return treeItem;
  }

  throw new Error('Unknown element type');
}
