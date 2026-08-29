import * as fs from 'fs';
import * as path from 'path';
import type { FileSystemPort } from '../../app/ports';

export interface FileSystemAdapter extends FileSystemPort {}

export interface PathResolverDependencies {
  fileSystem?: FileSystemAdapter;
  log?: (message: string) => void;
  logError?: (message: string, error: unknown) => void;
}

const defaultFileSystem: FileSystemAdapter = {
  existsSync: filePath => fs.existsSync(filePath),
  statSync: filePath => fs.statSync(filePath),
  readdirSync: directoryPath => fs.readdirSync(directoryPath),
  readFileSync: filePath => fs.readFileSync(filePath, 'utf8')
};

export class PathResolver {
  private readonly fileSystem: FileSystemAdapter;
  private readonly log: (message: string) => void;
  private readonly logError: (message: string, error: unknown) => void;

  constructor(dependencies: PathResolverDependencies = {}) {
    this.fileSystem = dependencies.fileSystem ?? defaultFileSystem;
    this.log = dependencies.log ?? (() => {});
    this.logError = dependencies.logError ?? (() => {});
  }

  resolveFileExtensionForPath(basePath: string): string {
    try {
      this.log(`Resolving path: ${basePath}`);

      if (this.fileSystem.existsSync(basePath) && this.fileSystem.statSync(basePath).isFile()) {
        return basePath;
      }

      if (this.fileSystem.existsSync(basePath) && this.fileSystem.statSync(basePath).isDirectory()) {
        this.log(`Path is a directory: ${basePath}, scanning contents`);
        const dirContents = this.fileSystem.readdirSync(basePath);
        let projectType: 'react' | 'vue' | 'angular' | 'svelte' | 'unknown' = 'unknown';

        if (dirContents.some(file => file.includes('tsconfig.json'))) {
          if (dirContents.some(file => file.includes('angular.json') || file.includes('angular-cli.json'))) {
            projectType = 'angular';
          } else if (dirContents.some(file => file.includes('react-app-env.d.ts'))) {
            projectType = 'react';
          }
        }

        if (projectType === 'unknown' && dirContents.some(file => file.includes('package.json'))) {
          try {
            const packageJsonPath = path.join(basePath, 'package.json');
            const packageJson: {
              dependencies?: Record<string, unknown>;
              devDependencies?: Record<string, unknown>;
            } = JSON.parse(this.fileSystem.readFileSync(packageJsonPath));
            const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

            if (dependencies.react) {
              projectType = 'react';
            } else if (dependencies.vue) {
              projectType = 'vue';
            } else if (dependencies.angular || dependencies['@angular/core']) {
              projectType = 'angular';
            } else if (dependencies.svelte) {
              projectType = 'svelte';
            }
          } catch (error) {
            this.log(`Error parsing package.json: ${String(error)}`);
          }
        }

        this.log(`Detected project type: ${projectType}`);
        const filePatterns = ['index', 'main', 'app', 'entry'];
        const prioritizedExtensions = this.getExtensionPriority(projectType);

        for (const pattern of filePatterns) {
          for (const extension of prioritizedExtensions) {
            const exactFilename = `${pattern}${extension}`;
            if (dirContents.includes(exactFilename)) {
              const match = path.join(basePath, exactFilename);
              this.log(`Found exact match: ${match}`);
              return match;
            }
          }

          const matchingFiles = dirContents.filter(file => file.startsWith(`${pattern}.`) || file === pattern);

          if (matchingFiles.length > 0) {
            const sortedFiles = matchingFiles.sort((first, second) =>
              this.compareByExtensionPriority(first, second, prioritizedExtensions)
            );
            const bestMatch = path.join(basePath, sortedFiles[0]);
            this.log(`Found best matching file: ${bestMatch}`);
            return bestMatch;
          }
        }

        for (const extension of prioritizedExtensions) {
          const filesWithExtension = dirContents.filter(file => file.endsWith(extension));
          if (filesWithExtension.length > 0) {
            const sortedFiles = filesWithExtension.sort((first, second) => {
              if (first.length !== second.length) return first.length - second.length;
              return first.localeCompare(second);
            });
            const bestMatch = path.join(basePath, sortedFiles[0]);
            this.log(`Found file with extension ${extension}: ${bestMatch}`);
            return bestMatch;
          }
        }

        this.log('No suitable file found in directory, returning directory path');
        return basePath;
      }

      if (!path.extname(basePath)) {
        const dirPath = path.dirname(basePath);
        const baseName = path.basename(basePath);

        if (this.fileSystem.existsSync(dirPath) && this.fileSystem.statSync(dirPath).isDirectory()) {
          const dirContents = this.fileSystem.readdirSync(dirPath);
          const commonExtensions = ['.ts', '.js', '.tsx', '.jsx', '.vue', '.svelte', '.component.ts'];

          for (const extension of commonExtensions) {
            const candidateFile = `${baseName}${extension}`;
            if (dirContents.includes(candidateFile)) {
              const match = path.join(dirPath, candidateFile);
              this.log(`Found exact file match with extension: ${match}`);
              return match;
            }
          }

          const matchingFiles = dirContents.filter(file => file.startsWith(`${baseName}.`) || file === baseName);

          if (matchingFiles.length > 0) {
            const order = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte'];
            const sortedFiles = matchingFiles.sort((first, second) =>
              this.compareByExtensionPriority(first, second, order)
            );
            const bestMatch = path.join(dirPath, sortedFiles[0]);
            this.log(`Found matching file: ${bestMatch}`);
            return bestMatch;
          }
        }

        const commonExtensions = ['.ts', '.js', '.tsx', '.jsx', '.vue', '.svelte', '.component.ts'];
        for (const extension of commonExtensions) {
          const pathWithExtension = `${basePath}${extension}`;
          if (this.fileSystem.existsSync(pathWithExtension)) {
            this.log(`Found file with appended extension: ${pathWithExtension}`);
            return pathWithExtension;
          }
        }
      }

      return basePath;
    } catch (error) {
      this.logError(`Failed to resolve file extension for path: ${basePath}`, error);
      return basePath;
    }
  }

  private getExtensionPriority(projectType: 'react' | 'vue' | 'angular' | 'svelte' | 'unknown'): string[] {
    if (projectType === 'react') return ['.tsx', '.jsx', '.ts', '.js'];
    if (projectType === 'vue') return ['.vue', '.ts', '.js'];
    if (projectType === 'angular') return ['.component.ts', '.component.html', '.ts', '.js'];
    if (projectType === 'svelte') return ['.svelte', '.ts', '.js'];
    return ['.ts', '.js', '.tsx', '.jsx', '.vue', '.svelte'];
  }

  private compareByExtensionPriority(first: string, second: string, extensions: string[]): number {
    const firstExtension = path.extname(first);
    const secondExtension = path.extname(second);
    const firstIndex = extensions.indexOf(firstExtension);
    const secondIndex = extensions.indexOf(secondExtension);

    if (firstIndex !== -1 && secondIndex !== -1) return firstIndex - secondIndex;
    if (firstIndex !== -1) return -1;
    if (secondIndex !== -1) return 1;
    return first.localeCompare(second);
  }
}
