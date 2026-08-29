import * as assert from 'assert';
import { existsSync } from 'fs';
import * as path from 'path';

const legacyModules = [
  'src/types.ts',
  'src/activationLifecycle.ts',
  'src/configExtractors.ts',
  'src/dependencyGraph.ts',
  'src/dialogUtils.ts',
  'src/graph/index.ts',
  'src/outputChannel.ts',
  'src/packageManager.ts',
  'src/pathResolver.ts',
  'src/providerDependencies.ts',
  'src/remoteConfigurationService.ts',
  'src/remoteWorkflow.ts',
  'src/rootAppController.ts',
  'src/rootConfigManager.ts',
  'src/terminalManager.ts',
  'src/treeItemFactory.ts',
  'src/treeModel.ts',
  'src/unifiedTreeProvider.ts',
  'src/onboarding.ts',
  'src/ratingPrompt.ts',
  'src/workspaceScanner.ts',
  'src/features/roots/pathUtils.ts',
  'src/features/roots/rootConfigRepository.ts'
];

suite('Architecture boundaries', () => {
  test('does not retain deprecated compatibility modules', () => {
    const repositoryRoot = path.resolve(__dirname, '../../../../../');
    const remainingModules = legacyModules.filter(modulePath => existsSync(path.join(repositoryRoot, modulePath)));

    assert.deepStrictEqual(remainingModules, []);
  });
});
