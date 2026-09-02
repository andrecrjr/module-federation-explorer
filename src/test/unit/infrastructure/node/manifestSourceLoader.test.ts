import * as assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { NodeManifestSourceLoader } from '../../../../infrastructure/node/manifestSourceLoader';

suite('Node manifest source loader', () => {
  let server: Server;
  let baseUrl = '';

  suiteSetup(async () => {
    server = createServer((request, response) => {
      if (request.url === '/manifest.json') {
        assert.equal(request.method, 'GET');
        assert.equal(request.headers.cookie, undefined);
        assert.equal(request.headers.authorization, undefined);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"id":"server-id","name":"server"}');
        return;
      }
      if (request.url === '/redirect') {
        response.writeHead(302, { location: '/manifest.json' });
        response.end();
        return;
      }
      if (request.url?.startsWith('/loop/')) {
        const next = Number(request.url.slice('/loop/'.length)) + 1;
        response.writeHead(302, { location: `/loop/${next}` });
        response.end();
        return;
      }
      if (request.url === '/large') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('x'.repeat(2 * 1024 * 1024 + 1));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  suiteTeardown(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  test('loads HTTP manifests with a GET and follows bounded redirects', async () => {
    const loader = new NodeManifestSourceLoader();
    assert.equal(
      await loader.load({ kind: 'url', location: `${baseUrl}/manifest.json` }),
      '{"id":"server-id","name":"server"}'
    );
    assert.equal(
      await loader.load({ kind: 'url', location: `${baseUrl}/redirect` }),
      '{"id":"server-id","name":"server"}'
    );
  });

  test('rejects redirect loops and responses over the size limit', async () => {
    const loader = new NodeManifestSourceLoader();
    await assert.rejects(() => loader.load({ kind: 'url', location: `${baseUrl}/loop/0` }), /redirect/i);
    await assert.rejects(() => loader.load({ kind: 'url', location: `${baseUrl}/large` }), /size/i);
  });
});
