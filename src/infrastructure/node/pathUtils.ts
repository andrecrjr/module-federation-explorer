import * as path from 'path';

export function normalizePath(filePath: string): string {
  return path.normalize(path.resolve(filePath));
}

export function isPathWithin(candidatePath: string, rootPath: string): boolean {
  const candidate = normalizePath(candidatePath);
  const root = normalizePath(rootPath);
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Return deepest matching root, preventing `/host-app` matching `/host`. */
export function findContainingRoot(candidatePath: string, rootPaths: readonly string[]): string | undefined {
  return [...rootPaths]
    .filter(rootPath => isPathWithin(candidatePath, rootPath))
    .sort((left, right) => normalizePath(right).length - normalizePath(left).length)[0];
}
