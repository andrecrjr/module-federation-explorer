import * as fs from 'fs/promises';
import * as path from 'path';
import type { UnifiedRootConfig } from '../../features/roots/types';

export interface RootConfigRepository {
  exists(filePath: string): Promise<boolean>;
  read(filePath: string): Promise<unknown>;
  write(filePath: string, config: UnifiedRootConfig): Promise<void>;
}

export class JsonRootConfigRepository implements RootConfigRepository {
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async read(filePath: string): Promise<unknown> {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  }

  async write(filePath: string, config: UnifiedRootConfig): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
  }
}
