import * as vscode from 'vscode';
import { ExplorerApplication } from './explorerApplication';

const CONFIG_WATCH_PATTERN = '**/{webpack,vite,rsbuild,rspack}.config.{js,ts},**/module-federation.config.{js,ts}';
const ROOT_CONFIG_WATCH_PATTERN = '**/.vscode/mf-explorer.roots.json';
const RELOAD_DEBOUNCE_MS = 500;

/** Registers all workspace watchers and owns their debounce/listener disposables. */
export function registerWatchers(application: ExplorerApplication): vscode.Disposable[] {
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  const updateOnFileChange = (uri: vscode.Uri): void => {
    application.log(`Configuration file changed: ${uri.fsPath}`);
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = undefined;
      void application.reloadConfigurations().catch(error => {
        application.logError('Error handling file change', error);
      });
    }, RELOAD_DEBOUNCE_MS);
  };

  const fileWatcher = vscode.workspace.createFileSystemWatcher(CONFIG_WATCH_PATTERN);
  const rootConfigWatcher = vscode.workspace.createFileSystemWatcher(ROOT_CONFIG_WATCH_PATTERN);
  const listeners = [
    fileWatcher.onDidChange(updateOnFileChange),
    fileWatcher.onDidCreate(updateOnFileChange),
    fileWatcher.onDidDelete(updateOnFileChange),
    rootConfigWatcher.onDidChange(updateOnFileChange),
    rootConfigWatcher.onDidCreate(updateOnFileChange),
    rootConfigWatcher.onDidDelete(updateOnFileChange)
  ];

  return [
    fileWatcher,
    rootConfigWatcher,
    ...listeners,
    new vscode.Disposable(() => {
      if (reloadTimer) clearTimeout(reloadTimer);
    })
  ];
}
