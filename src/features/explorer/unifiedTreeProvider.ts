import * as vscode from 'vscode';
import { ExplorerStore } from './explorerStore';
import type { RootFolder } from './types';
import {
  LoadingPlaceholder,
  TreeElement,
  createTreeItem,
  isExposedModule,
  isExposesFolder,
  isManifestItem,
  isManifestSection,
  isManifestValueItem,
  isManifestsFolder,
  isRemotesFolder,
  isRemote,
  isRootFolder
} from './treeItemFactory';
import {
  buildRemoteExposedModulesIndex,
  getRemoteExposedModulesFromIndex,
  getRootFolderChildren,
  getManifestChildren,
  type RemoteExposedModulesIndex
} from './treeModel';

export interface ExplorerTreeActions {
  isRemoteRunning: (remoteKey: string) => boolean;
  log: (message: string) => void;
  reorderRoots: (dragged: RootFolder, target?: RootFolder) => Promise<void>;
}

/** VS Code adapter for the explorer tree; application workflows live outside this class. */
export class UnifiedModuleFederationProvider
  implements vscode.TreeDataProvider<TreeElement>, vscode.TreeDragAndDropController<TreeElement>, vscode.Disposable
{
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeElement | undefined>();
  private readonly unsubscribeFromStore: () => void;
  private remoteExposedModulesIndex: RemoteExposedModulesIndex | undefined;

  readonly onDidChangeTreeData: vscode.Event<TreeElement | undefined> = this.onDidChangeTreeDataEmitter.event;
  readonly dragMimeTypes = ['application/vnd.code.tree.moduleFederation'];
  readonly dropMimeTypes = ['application/vnd.code.tree.moduleFederation'];

  constructor(
    private readonly store: ExplorerStore,
    private readonly actions: ExplorerTreeActions
  ) {
    this.unsubscribeFromStore = store.subscribe(() => {
      this.remoteExposedModulesIndex = undefined;
      this.refresh();
    });
  }

  dispose(): void {
    this.unsubscribeFromStore();
    this.onDidChangeTreeDataEmitter.dispose();
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return createTreeItem(element, this.actions.isRemoteRunning);
  }

  getChildren(element?: TreeElement): Thenable<TreeElement[]> {
    try {
      const snapshot = this.store.getSnapshot();
      if (
        snapshot.isLoading ||
        (snapshot.isManifestLoading && snapshot.rootFolders.length === 0 && snapshot.manifests.length === 0)
      ) {
        return Promise.resolve([
          {
            type: 'loadingPlaceholder',
            name: 'Loading configurations...'
          } as LoadingPlaceholder
        ]);
      }

      if (!element) {
        const manifestsFolder =
          snapshot.manifests.length > 0
            ? ({ type: 'manifestsFolder', manifests: snapshot.manifests } as const)
            : undefined;
        return Promise.resolve(
          manifestsFolder ? [...snapshot.rootFolders, manifestsFolder] : [...snapshot.rootFolders]
        );
      }
      if (isRootFolder(element)) {
        return Promise.resolve(getRootFolderChildren(element, this.actions.log));
      }
      if (isRemotesFolder(element)) return Promise.resolve(element.remotes);
      if (isExposesFolder(element)) return Promise.resolve(element.exposes);
      if (isManifestsFolder(element)) {
        return Promise.resolve(element.manifests.map(manifest => ({ type: 'manifestItem', manifest }) as const));
      }
      if (isExposedModule(element)) return Promise.resolve([]);
      if (isRemote(element)) {
        this.remoteExposedModulesIndex ??= buildRemoteExposedModulesIndex(snapshot.configs);
        return Promise.resolve(getRemoteExposedModulesFromIndex(this.remoteExposedModulesIndex, element.name));
      }
      if (isManifestItem(element)) return Promise.resolve(getManifestChildren(element.manifest));
      if (isManifestSection(element)) return Promise.resolve([...element.items]);
      if (isManifestValueItem(element)) return Promise.resolve([]);
      return Promise.resolve([]);
    } catch (error) {
      this.actions.log(`Failed to get children: ${String(error)}`);
      return Promise.resolve([]);
    }
  }

  handleDrag(
    source: readonly TreeElement[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): void {
    if (source.length === 1 && isRootFolder(source[0])) {
      dataTransfer.set('application/vnd.code.tree.moduleFederation', new vscode.DataTransferItem(source[0]));
    }
  }

  async handleDrop(
    target: TreeElement | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const draggedItem = dataTransfer.get('application/vnd.code.tree.moduleFederation')?.value;
    if (!draggedItem || !isRootFolder(draggedItem)) return;
    if (target && !isRootFolder(target)) return;

    await this.actions.reorderRoots(draggedItem, target);
  }
}
