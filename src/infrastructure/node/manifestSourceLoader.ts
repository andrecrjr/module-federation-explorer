import { readFile, stat } from 'node:fs/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import type { IncomingMessage, RequestOptions } from 'node:http';
import type { ManifestSourceConfig } from '../../federation/manifestTypes';
import type { ManifestSourceLoader } from '../../federation/manifestDiscoveryService';

export const MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
export const MANIFEST_REQUEST_TIMEOUT_MS = 10_000;
export const MANIFEST_MAX_REDIRECTS = 3;

function responseLocation(response: IncomingMessage): string | undefined {
  const location = response.headers.location;
  return Array.isArray(location) ? location[0] : location;
}

function validateUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Manifest URLs must use http or https: ${url.protocol}`);
  }
  return url;
}

function readResponse(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const contentLength = Number(response.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > MANIFEST_MAX_BYTES) {
      response.resume();
      reject(new Error(`Manifest response exceeds the ${MANIFEST_MAX_BYTES}-byte size limit.`));
      return;
    }

    response.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MANIFEST_MAX_BYTES) {
        response.destroy();
        reject(new Error(`Manifest response exceeds the ${MANIFEST_MAX_BYTES}-byte size limit.`));
        return;
      }
      chunks.push(buffer);
    });
    response.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    response.once('error', reject);
  });
}

function requestUrl(url: URL, redirects: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestOptions: RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        accept: 'application/json'
      }
    };
    const requestModule = url.protocol === 'https:' ? https : http;
    const request = requestModule.request(requestOptions, response => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400) {
        const location = responseLocation(response);
        response.resume();
        if (!location) {
          reject(new Error(`Manifest response returned redirect status ${status} without a location.`));
          return;
        }
        if (redirects >= MANIFEST_MAX_REDIRECTS) {
          reject(new Error(`Manifest URL exceeded the ${MANIFEST_MAX_REDIRECTS}-redirect limit.`));
          return;
        }
        try {
          const nextUrl = validateUrl(new URL(location, url).toString());
          void requestUrl(nextUrl, redirects + 1).then(resolve, reject);
        } catch (error) {
          reject(error);
        }
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Manifest request failed with HTTP status ${status}.`));
        return;
      }
      void readResponse(response).then(resolve, reject);
    });
    request.setTimeout(MANIFEST_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Manifest request timed out after ${MANIFEST_REQUEST_TIMEOUT_MS} ms.`));
    });
    request.once('error', reject);
    request.end();
  });
}

/** Loads local files and bounded HTTP(S) manifest responses without credentials or cookies. */
export class NodeManifestSourceLoader implements ManifestSourceLoader {
  async load(source: ManifestSourceConfig): Promise<string> {
    if (source.kind === 'local') {
      const fileStats = await stat(source.location);
      if (fileStats.size > MANIFEST_MAX_BYTES) {
        throw new Error(`Manifest file exceeds the ${MANIFEST_MAX_BYTES}-byte size limit.`);
      }
      return readFile(source.location, 'utf8');
    }
    if (source.kind === 'url') return requestUrl(validateUrl(source.location), 0);
    throw new Error(`Unsupported manifest source kind: ${source.kind}`);
  }
}
