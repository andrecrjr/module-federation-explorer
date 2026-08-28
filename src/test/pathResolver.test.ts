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

  test('falls back to the original path when no candidate exists', () => {
    const resolver = new PathResolver({
      fileSystem: new FakeFileSystem({}, new Set(['/workspace']))
    });

    assert.strictEqual(resolver.resolveFileExtensionForPath('/workspace/missing'), '/workspace/missing');
  });
});
