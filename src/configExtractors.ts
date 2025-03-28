import * as path from 'path';
import * as estraverse from 'estraverse';
import * as fs from 'fs/promises';
import { ModuleFederationConfig } from './types';

const { parse } = require('@typescript-eslint/parser');

/**
 * Detect package manager and get appropriate start command based on project type
 */
async function detectPackageManagerAndStartCommand(folder: string, configType: 'webpack' | 'vite'): Promise<{ packageManager: 'npm' | 'pnpm' | 'yarn', startCommand: string }> {
  try {
    // Check for package-lock.json (npm)
    const hasPackageLock = await fs.access(path.join(folder, 'package-lock.json')).then(() => true).catch(() => false);
    if (hasPackageLock) {
      const startScript = configType === 'vite' ? 'dev' : 'start';
      return { packageManager: 'npm', startCommand: `npm run ${startScript}` };
    }

    // Check for pnpm-lock.yaml (pnpm)
    const hasPnpmLock = await fs.access(path.join(folder, 'pnpm-lock.yaml')).then(() => true).catch(() => false);
    if (hasPnpmLock) {
      const startScript = configType === 'vite' ? 'dev' : 'start';
      return { packageManager: 'pnpm', startCommand: `pnpm run ${startScript}` };
    }

    // Check for yarn.lock (yarn)
    const hasYarnLock = await fs.access(path.join(folder, 'yarn.lock')).then(() => true).catch(() => false);
    if (hasYarnLock) {
      const startScript = configType === 'vite' ? 'dev' : 'start';
      return { packageManager: 'yarn', startCommand: `yarn ${startScript}` };
    }

    // Default to npm if no lock file is found
    const startScript = configType === 'vite' ? 'dev' : 'start';
    return { packageManager: 'npm', startCommand: `npm run ${startScript}` };
  } catch (error) {
    console.error('Error detecting package manager:', error);
    // Default to npm if there's an error
    const startScript = configType === 'vite' ? 'dev' : 'start';
    return { packageManager: 'npm', startCommand: `npm run ${startScript}` };
  }
}

/**
 * Extract Module Federation configuration from webpack config AST
 */
export async function extractConfigFromWebpack(ast: any, workspaceRoot: string): Promise<ModuleFederationConfig> {
  const config: ModuleFederationConfig = {
    name: '',
    remotes: [],
    exposes: [],
    configType: 'webpack',
    configPath: ''
  };
  
  estraverse.traverse(ast, {
    enter(node: any) {
      // Check for ModuleFederationPlugin instantiation
      if (isModuleFederationPluginNode(node)) {
        const options = node.arguments[0];
        
        // Extract name
        const nameProp = findProperty(options, 'name');
        if (nameProp?.value.type === 'Literal') {
          config.name = nameProp.value.value;
        }
        
        // Extract remotes
        const remotesProp = findProperty(options, 'remotes');
        if (remotesProp?.value.type === 'ObjectExpression') {
          for (const prop of remotesProp.value.properties) {
            if (isValidRemoteProperty(prop)) {
              const remoteName = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
              config.remotes.push({
                name: remoteName,
                url: prop.value.value,
                folder: remoteName,
                remoteEntry: prop.value.value,
                packageManager: 'npm',
                configType: 'webpack'
              });
            }
          }
        }
        
        // Extract exposes
        const exposesProp = findProperty(options, 'exposes');
        if (exposesProp?.value.type === 'ObjectExpression') {
          for (const prop of exposesProp.value.properties) {
            if (prop.key.type === 'Identifier' && prop.value.type === 'Literal') {
              config.exposes.push({
                name: prop.key.name,
                path: prop.value.value,
                remoteName: config.name
              });
            }
          }
        }
        
        console.log(`[Webpack MFE Config] Found name: ${config.name}, remotes: ${config.remotes.length}, exposes: ${config.exposes.length}`);
        if (config.remotes.length > 0) {
          console.log(`[Webpack MFE Config] Remotes:`, config.remotes.map(r => r.name).join(', '));
        }
      }
    }
  });
  
  // Detect package manager for each remote after AST traversal
  for (const remote of config.remotes) {
    const { packageManager, startCommand } = await detectPackageManagerAndStartCommand(remote.folder, 'webpack');
    remote.packageManager = packageManager;
    remote.startCommand = startCommand;
  }
  
  return config;
}

/**
 * Extract Module Federation configuration from vite config AST
 */
export async function extractConfigFromVite(ast: any, workspaceRoot: string): Promise<ModuleFederationConfig> {
  const config: ModuleFederationConfig = {
    name: '',
    remotes: [],
    exposes: [],
    configType: 'vite',
    configPath: ''
  };
  
  const configObj = findViteConfigObject(ast);
  if (!configObj) return config;
  
  // Find plugins array
  const pluginsProp = findProperty(configObj, 'plugins');
  if (pluginsProp?.value.type !== 'ArrayExpression') return config;
  
  // Process each plugin
  for (const plugin of pluginsProp.value.elements) {
    if (isFederationPlugin(plugin)) {
      const options = plugin.arguments[0];
      
      // Extract name
      const nameProp = findProperty(options, 'name');
      if (nameProp?.value.type === 'Literal') {
        config.name = nameProp.value.value;
      }
      
      // Extract remotes
      const remotesProp = findProperty(options, 'remotes');
      if (remotesProp?.value.type === 'ObjectExpression') {
        for (const prop of remotesProp.value.properties) {
          if (prop.key.type === 'Identifier' || prop.key.type === 'Literal') {
            const remoteName = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
            const remoteUrl = prop.value.type === 'Literal' ? prop.value.value : undefined;
            config.remotes.push({
              name: remoteName,
              url: remoteUrl,
              folder: remoteName,
              packageManager: 'npm',
              configType: 'vite'
            });
          }
        }
      }
      
      // Extract exposes
      const exposesProp = findProperty(options, 'exposes');
      if (exposesProp?.value.type === 'ObjectExpression') {
        for (const prop of exposesProp.value.properties) {
          if (prop.key.type === 'Identifier' || prop.key.type === 'Literal') {
            const exposeName = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
            if (prop.value.type === 'Literal') {
              config.exposes.push({
                name: exposeName,
                path: prop.value.value,
                remoteName: config.name
              });
            }
          }
        }
      }
      
      console.log(`[Vite MFE Config] Found name: ${config.name}, remotes: ${config.remotes.length}, exposes: ${config.exposes.length}`);
      if (config.remotes.length > 0) {
        console.log(`[Vite MFE Config] Remotes:`, config.remotes.map(r => r.name).join(', '));
      }
    }
  }
  
  // Detect package manager for each remote after AST traversal
  for (const remote of config.remotes) {
    const { packageManager, startCommand } = await detectPackageManagerAndStartCommand(remote.folder, 'vite');
    remote.packageManager = packageManager;
    remote.startCommand = startCommand;
  }
  
  return config;
}

// Helper functions for AST traversal
function findProperty(obj: any, name: string): any {
  return obj.properties.find((p: any) =>
    p.type === 'Property' &&
    ((p.key.type === 'Identifier' && p.key.name === name) ||
     (p.key.type === 'Literal' && p.key.value === name))
  );
}

function isValidRemoteProperty(prop: any): boolean {
  return prop.type === 'Property' &&
         (prop.key.type === 'Identifier' || prop.key.type === 'Literal') &&
         prop.value.type === 'Literal' &&
         typeof prop.value.value === 'string';
}

function isModuleFederationPluginNode(node: any): boolean {
  if (node.type !== 'NewExpression' || node.arguments.length === 0) {
    return false;
  }
  
  let calleeName: string | undefined;
  
  if (node.callee.type === 'Identifier') {
    calleeName = node.callee.name;
  } else if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
    calleeName = node.callee.property.name;
  }
  
  return calleeName === 'ModuleFederationPlugin' && 
         node.arguments[0]?.type === 'ObjectExpression';
}

function findViteConfigObject(ast: any): any {
  let configObj = null;
  
  estraverse.traverse(ast, {
    enter(node: any) {
      if (node.type === 'ExportDefaultDeclaration') {
        if (node.declaration.type === 'CallExpression' &&
            node.declaration.callee.type === 'Identifier' &&
            node.declaration.callee.name === 'defineConfig' &&
            node.declaration.arguments.length > 0) {
          configObj = node.declaration.arguments[0];
        } else if (node.declaration.type === 'ObjectExpression') {
          configObj = node.declaration;
        }
      }
    }
  });
  
  return configObj;
}

function isFederationPlugin(plugin: any): boolean {
  return plugin.type === 'CallExpression' &&
         plugin.callee.type === 'Identifier' &&
         plugin.callee.name === 'federation' &&
         plugin.arguments.length > 0 &&
         plugin.arguments[0].type === 'ObjectExpression';
} 