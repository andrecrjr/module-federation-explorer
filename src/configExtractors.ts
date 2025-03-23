import * as path from 'path';
import * as estraverse from 'estraverse';
import { ModuleFederationConfig } from './types';

const { parse } = require('@typescript-eslint/parser');

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
              const folderPath = path.join(workspaceRoot, prop.key.name);
              config.remotes.push({
                name: prop.key.name,
                url: prop.value.value,
                folder: folderPath,
                remoteEntry: prop.value.value,
                packageManager: 'npm'
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
      }
    }
  });
  
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
          if (prop.key.type === 'Identifier') {
            const folderPath = path.join(workspaceRoot, prop.key.name);
            config.remotes.push({
              name: prop.key.name,
              folder: folderPath,
              packageManager: 'npm'
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
    }
  }
  
  return config;
}

// Helper functions for AST traversal
function findProperty(obj: any, name: string): any {
  return obj.properties.find((p: any) =>
    p.type === 'Property' &&
    p.key.type === 'Identifier' &&
    p.key.name === name
  );
}

function isValidRemoteProperty(prop: any): boolean {
  return prop.type === 'Property' &&
         prop.key.type === 'Identifier' &&
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