import * as assert from 'assert';
import { detectPackageManagerAndStartCommand } from '../packageManager';

suite('Package manager detection', () => {
  test('uses the project lock file and config type to build the start command', async () => {
    const result = await detectPackageManagerAndStartCommand(
      '/workspace/remote',
      'vite',
      async filePath => filePath.endsWith('yarn.lock')
    );

    assert.deepStrictEqual(result, { packageManager: 'yarn', startCommand: 'yarn dev' });
  });

  test('falls back to npm start when no lock file is available', async () => {
    const result = await detectPackageManagerAndStartCommand(
      '/workspace/host',
      'webpack',
      async () => false
    );

    assert.deepStrictEqual(result, { packageManager: 'npm', startCommand: 'npm run start' });
  });
});
