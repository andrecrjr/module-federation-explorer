import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { JsonRootConfigRepository } from '../../../../infrastructure/node/rootConfigRepository';

suite('JsonRootConfigRepository', () => {
  let directory: string;

  suiteSetup(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mf-explorer-repository-'));
  });

  suiteTeardown(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  test('writes nested configuration files and reads them back', async () => {
    const repository = new JsonRootConfigRepository();
    const filePath = path.join(directory, 'nested', 'roots.json');
    const config = { roots: ['/workspace/host'], rootConfigs: { '/workspace/host': { startCommand: 'npm start' } } };

    assert.equal(await repository.exists(filePath), false);
    await repository.write(filePath, config);

    assert.equal(await repository.exists(filePath), true);
    assert.deepEqual(await repository.read(filePath), config);
  });

  test('rejects malformed JSON instead of returning a partial configuration', async () => {
    const repository = new JsonRootConfigRepository();
    const filePath = path.join(directory, 'invalid.json');
    await fs.writeFile(filePath, '{not-json', 'utf8');

    await assert.rejects(repository.read(filePath), SyntaxError);
  });
});
