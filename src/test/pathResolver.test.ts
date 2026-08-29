import * as assert from 'assert';
import { FileSystemAdapter, PathResolver } from '../infrastructure/node/pathResolver';

class FakeFileSystem implements FileSystemAdapter {
  constructor(
    private readonly files: Record<string, string> = {},
    private readonly directories: Set<string> = new Set()
  ) {}

  existsSync(filePath: string): boolean {
    return filePath in this.files || this.directories.has(filePath);
  }

  statSync(filePath: string): { isFile(): boolean; isDirectory(): boolean } {
    return {
      isFile: () => filePath in this.files,
      isDirectory: () => this.directories.has(filePath)
    };
  }

  readdirSync(directoryPath: string): string[] {
    return Object.keys(this.files)
      .filter(filePath => filePath.startsWith(`${directoryPath}/`))
      .map(filePath => filePath.slice(directoryPath.length + 1));
  }

  readFileSync(filePath: string): string {
    return this.files[filePath];
  }
}

suite('PathResolver', () => {
  test('returns an existing file without changing it', () => {
    const resolver = new PathResolver({
      fileSystem: new FakeFileSystem({ '/workspace/app.ts': '' })
    });

    assert.strictEqual(resolver.resolveFileExtensionForPath('/workspace/app.ts'), '/workspace/app.ts');
  });

  test('selects the project-appropriate entry file from a directory', () => {
    const resolver = new PathResolver({
      fileSystem: new FakeFileSystem(
        {
          '/workspace/app/package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
          '/workspace/app/index.tsx': ''
        },
        new Set(['/workspace/app'])
      )
    });

    assert.strictEqual(
      resolver.resolveFileExtensionForPath('/workspace/app'),
      '/workspace/app/index.tsx'
    );
  });

  test('uses the correct extension priority for Vue, Angular, Svelte, and unknown projects', () => {
    const cases: Array<{ project: string; files: Record<string, string>; expected: string }> = [
      {
        project: 'vue',
        files: {
          '/workspace/vue/package.json': JSON.stringify({ dependencies: { vue: '^3.0.0' } }),
          '/workspace/vue/main.vue': ''
        },
        expected: '/workspace/vue/main.vue'
      },
      {
        project: 'angular',
        files: {
          '/workspace/angular/tsconfig.json': '{}',
          '/workspace/angular/angular.json': '{}',
          '/workspace/angular/main.component.ts': ''
        },
        expected: '/workspace/angular/main.component.ts'
      },
      {
        project: 'svelte',
        files: {
          '/workspace/svelte/package.json': JSON.stringify({ devDependencies: { svelte: '^4.0.0' } }),
          '/workspace/svelte/entry.svelte': ''
        },
        expected: '/workspace/svelte/entry.svelte'
      },
      {
        project: 'unknown',
        files: { '/workspace/unknown/app.js': '' },
        expected: '/workspace/unknown/app.js'
      }
    ];

    for (const entry of cases) {
      const resolver = new PathResolver({
        fileSystem: new FakeFileSystem(entry.files, new Set([`/workspace/${entry.project}`]))
      });
      assert.strictEqual(resolver.resolveFileExtensionForPath(`/workspace/${entry.project}`), entry.expected);
    }
  });

  test('selects matching and shortest extension candidates when no conventional entry exists', () => {
    const resolver = new PathResolver({
      fileSystem: new FakeFileSystem(
        {
          '/workspace/app/a.js': '',
          '/workspace/app/long-name.js': '',
          '/workspace/app/widget.tsx': '',
          '/workspace/app/widget.jsx': ''
        },
        new Set(['/workspace/app'])
      )
    });

    assert.strictEqual(resolver.resolveFileExtensionForPath('/workspace/app'), '/workspace/app/a.js');
    assert.strictEqual(resolver.resolveFileExtensionForPath('/workspace/app/widget'), '/workspace/app/widget.tsx');
  });

  test('appends an extension when the parent directory is unavailable', () => {
    const resolver = new PathResolver({
      fileSystem: new FakeFileSystem({ '/workspace/widget.ts': '' })
    });

    assert.strictEqual(resolver.resolveFileExtensionForPath('/workspace/widget'), '/workspace/widget.ts');
    assert.strictEqual(resolver.resolveFileExtensionForPath('/workspace/widget.css'), '/workspace/widget.css');
  });

  test('falls back after malformed package metadata and reports file-system failures', () => {
    const messages: string[] = [];
    const errors: string[] = [];
    const resolver = new PathResolver({
      fileSystem: new FakeFileSystem(
        {
          '/workspace/app/package.json': '{invalid',
          '/workspace/app/z.js': '',
          '/workspace/app/a.js': ''
        },
        new Set(['/workspace/app'])
      ),
      log: message => messages.push(message),
      logError: (message, error) => errors.push(`${message}: ${String(error)}`)
    });

    assert.strictEqual(resolver.resolveFileExtensionForPath('/workspace/app'), '/workspace/app/a.js');
    assert.ok(messages.some(message => message.includes('Error parsing package.json')));

    const failingResolver = new PathResolver({
      fileSystem: {
        existsSync: () => { throw new Error('stat failed'); },
        statSync: () => ({ isFile: () => false, isDirectory: () => false }),
        readdirSync: () => [],
        readFileSync: () => ''
      },
      logError: (message, error) => errors.push(`${message}: ${String(error)}`)
    });

    assert.strictEqual(failingResolver.resolveFileExtensionForPath('/workspace/app'), '/workspace/app');
    assert.ok(errors.some(message => message.includes('stat failed')));
  });

  test('falls back to the original path when no candidate exists', () => {
    const resolver = new PathResolver({
      fileSystem: new FakeFileSystem({}, new Set(['/workspace']))
    });

    assert.strictEqual(resolver.resolveFileExtensionForPath('/workspace/missing'), '/workspace/missing');
  });
});
