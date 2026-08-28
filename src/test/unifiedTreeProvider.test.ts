import * as assert from 'assert';
import * as vscode from 'vscode';
import { ConfigurationLoader, DependencyGraphService, RootConfigService } from '../providerDependencies';
import { PathResolver } from '../pathResolver';
import { TerminalManager } from '../terminalManager';
import { UnifiedModuleFederationProvider } from '../unifiedTreeProvider';
import { ModuleFederationConfig, RootFolder } from '../types';

function createConfig(): ModuleFederationConfig {
  return {
    name: 'host',
    remotes: [{
      name: 'auth',
      folder: '/workspace/auth',
      packageManager: 'npm',
      configType: 'webpack'
    }],
    exposes: [{ name: 'Shell', path: './src/Shell.tsx', remoteName: 'host' }],
    shared: [],
    detected: true,
    configType: 'webpack',
    configPath: '/workspace/host/webpack.config.ts'
  };
}

function createProvider(): UnifiedModuleFederationProvider {
  const rootConfigManager: RootConfigService = {
    hasConfiguredRoots: async () => false,
    loadRootConfig: async () => ({ roots: [] }),
    getConfigPath: () => '/workspace/.vscode/mf-explorer.roots.json',
    setConfigPath: async () => {},
    saveRootConfig: async () => {},
    addRoot: async () => {},
    removeRoot: async () => {},
    changeConfigFile: async () => false
  };
  const configurationService: ConfigurationLoader = {
    load: async () => ({ configs: new Map(), errors: [] })
  };
  const dependencyGraphManager: DependencyGraphService = {
    refreshDependencyGraph: () => {},
    generateDependencyGraph: () => ({
      nodes: [],
      edges: [],
      metadata: {
        totalHosts: 0,
        totalRemotes: 0,
        totalSharedDeps: 0,
        totalExposedModules: 0
      }
    }),
    showDependencyGraph: () => {}
  };

  return new UnifiedModuleFederationProvider('/workspace', {} as vscode.ExtensionContext, {
    rootConfigManager,
    configurationService,
    dependencyGraphManager,
    terminalManager: new TerminalManager(),
    pathResolver: new PathResolver()
  });
}

suite('UnifiedModuleFederationProvider', () => {
  test('keeps tree behavior behind the provider facade', async () => {
    const provider = createProvider();
    const rootFolder: RootFolder = {
      type: 'rootFolder',
      path: '/workspace/host',
      name: 'host',
      configs: [createConfig()]
    };

    const children = await provider.getChildren(rootFolder);
    assert.deepStrictEqual(
      children.map(child => 'type' in child ? child.type : 'remote'),
      ['remotesFolder', 'exposesFolder']
    );
    assert.strictEqual(provider.getTreeItem(rootFolder).label, 'host');
  });
});
