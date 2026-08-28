import * as assert from 'assert';
import * as vscode from 'vscode';
import { createTreeItem } from '../features/explorer/treeItemFactory';

suite('TreeItemFactory', () => {
  test('renders an external remote with external context', () => {
    const item = createTreeItem({
      name: 'auth',
      url: 'https://example.test/remoteEntry.js',
      folder: '',
      packageManager: '',
      configType: 'external',
      isExternal: true
    }, () => false);

    assert.strictEqual(item.label, 'auth');
    assert.strictEqual(item.contextValue, 'externalRemote');
  });

  test('renders the loading placeholder', () => {
    const item = createTreeItem({
      type: 'loadingPlaceholder',
      name: 'Loading configurations...'
    }, () => false);

    assert.strictEqual(item.label, 'Loading Module Federation configurations...');
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });
});
