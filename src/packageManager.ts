import * as path from 'path';
import * as fs from 'fs/promises';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';
export type PackageManagerConfigType = 'webpack' | 'vite' | 'rsbuild';

export interface PackageManagerInfo {
  packageManager: PackageManager;
  startCommand: string;
}

export type FileExists = (filePath: string) => Promise<boolean>;

const defaultFileExists: FileExists = async filePath => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Detect the package manager from lockfiles and choose the conventional
 * development/start script for the detected bundler.
 */
export async function detectPackageManagerAndStartCommand(
  folder: string,
  configType: PackageManagerConfigType,
  fileExists: FileExists = defaultFileExists
): Promise<PackageManagerInfo> {
  const startScript = configType === 'vite' || configType === 'rsbuild' ? 'dev' : 'start';
  const lockFiles: Array<{ file: string; packageManager: PackageManager }> = [
    { file: 'package-lock.json', packageManager: 'npm' },
    { file: 'pnpm-lock.yaml', packageManager: 'pnpm' },
    { file: 'yarn.lock', packageManager: 'yarn' }
  ];

  for (const lockFile of lockFiles) {
    if (await fileExists(path.join(folder, lockFile.file))) {
      return {
        packageManager: lockFile.packageManager,
        startCommand: lockFile.packageManager === 'yarn'
          ? `yarn ${startScript}`
          : `${lockFile.packageManager} run ${startScript}`
      };
    }
  }

  return {
    packageManager: 'npm',
    startCommand: `npm run ${startScript}`
  };
}
