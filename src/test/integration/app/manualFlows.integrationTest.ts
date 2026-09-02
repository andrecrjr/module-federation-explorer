import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ExtensionComposition } from '../../../app/compositionRoot';

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for extension state update');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

suite('Manual flow integration', () => {
  test('activates fixture workspace, loads tree, registers commands, and reloads watcher changes', async () => {
    const extension = vscode.extensions.getExtension<ExtensionComposition>('acjr.mf-explorer');
    assert.ok(extension, 'Extension must be available in Extension Development Host');
    const composition = await extension.activate();
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspacePath, 'Fixture workspace must be open');

    const configDirectory = path.join(workspacePath, '.vscode');
    const rootConfigPath = path.join(configDirectory, 'mf-explorer.json');
    const webpackConfigPath = path.join(workspacePath, 'host', 'webpack.config.js');
    const originalRootConfig = (await exists(rootConfigPath)) ? await fs.readFile(rootConfigPath, 'utf8') : undefined;
    const originalWebpackConfig = await fs.readFile(webpackConfigPath, 'utf8');

    try {
      await fs.mkdir(configDirectory, { recursive: true });
      await fs.writeFile(
        rootConfigPath,
        JSON.stringify({ roots: [path.join(workspacePath, 'host')] }, null, 2),
        'utf8'
      );
      await composition.application.reloadConfigurations();

      const roots = composition.application.getStore().getSnapshot().rootFolders;
      assert.strictEqual(roots.length, 1);
      assert.strictEqual(roots[0].configs[0].name, 'fixture-host');
      const manifests = composition.application.getStore().getSnapshot().manifests;
      assert.strictEqual(manifests.length, 1);
      assert.strictEqual(manifests[0].name, 'fixture-host');
      assert.strictEqual(manifests[0].remotes[0]?.aliases[0], 'authentication');
      const treeRoots = await composition.provider.getChildren();
      if (!treeRoots[0] || !('path' in treeRoots[0])) throw new Error('Expected root folder tree item');
      assert.strictEqual(treeRoots[0].path, path.join(workspacePath, 'host'));
      const manifestFolder = treeRoots[1];
      assert.strictEqual(manifestFolder && 'type' in manifestFolder ? manifestFolder.type : undefined, 'manifestsFolder');
      const manifestItem = manifestFolder ? (await composition.provider.getChildren(manifestFolder))[0] : undefined;
      assert.strictEqual(manifestItem && 'type' in manifestItem ? manifestItem.type : undefined, 'manifestItem');
      assert.ok(manifestItem);
      assert.strictEqual((await composition.provider.getChildren(manifestItem)).length, 5);

      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes('moduleFederation.refresh'));
      assert.ok(commands.includes('moduleFederation.showDependencyGraph'));

      await fs.writeFile(
        webpackConfigPath,
        originalWebpackConfig.replace('fixture-host', 'fixture-host-updated'),
        'utf8'
      );
      await waitFor(
        () =>
          composition.application.getStore().getSnapshot().rootFolders[0]?.configs[0]?.name === 'fixture-host-updated'
      );
    } finally {
      await fs.writeFile(webpackConfigPath, originalWebpackConfig, 'utf8');
      if (originalRootConfig === undefined) await fs.rm(rootConfigPath, { force: true });
      else await fs.writeFile(rootConfigPath, originalRootConfig, 'utf8');
    }
  });
});
