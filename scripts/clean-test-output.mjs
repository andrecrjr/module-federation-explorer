#!/usr/bin/env node

import { rm } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await rm(path.join(repositoryRoot, 'out', 'test'), { recursive: true, force: true });
