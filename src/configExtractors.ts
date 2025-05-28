import * as path from 'path';
import * as estraverse from 'estraverse';
import * as fs from 'fs/promises';
import { ModuleFederationConfig, SharedDependency } from './types';

const { parse } = require('@typescript-eslint/parser');

// Define custom fallback for TypeScript AST node types that estraverse doesn't know
const fallback = (node: any) => {
  // Return the keys that should be traversed for this node
  if (!node || !node.type) {
    return [];
  }

  // Handle specific TypeScript node types
  switch (node.type) {
    case 'TSNonNullExpression':
      return ['expression'];
    case 'TSAsExpression':
    case 'TSTypeAssertion':
      return ['expression']; // The part being asserted
    case 'TSTypeReference':
      return ['typeName', 'typeParameters']; // Type name and any generic parameters
    case 'TSParameterProperty':
      return ['parameter']; // The parameter
    case 'TSArrayType':
      return ['elementType']; // The element type
    case 'TSTypeAnnotation':
      return ['typeAnnotation']; // The type annotation
    case 'TSTypeParameterDeclaration':
    case 'TSTypeParameterInstantiation':
      return ['params']; // Type parameters
    case 'TSQualifiedName': 
      return ['left', 'right']; // Namespace qualified names
    case 'TSEnumDeclaration':
      return ['id', 'members']; // Enum name and members
    case 'TSInterfaceDeclaration':
      return ['id', 'body', 'extends']; // Interface name, body, and extended interfaces
    case 'TSTypeAliasDeclaration': 
      return ['id', 'typeParameters', 'typeAnnotation']; // Type alias name, parameters, and type
    case 'TSPropertySignature':
      return ['key', 'typeAnnotation', 'initializer']; // Property signature components
    case 'TSMethodSignature':
      return ['key', 'parameters', 'returnType']; // Method signature components
  }

  // Generic handling for other TS node types
  if (typeof node.type === 'string' && node.type.startsWith('TS')) {
    return Object.keys(node).filter(key => 
      typeof node[key] === 'object' && 
      node[key] !== null && 
      !key.startsWith('_') && 
      key !== 'type' && 
      key !== 'loc' && 
      key !== 'range'
    );
  }
  
  // For non-TS nodes, use estraverse's built-in visitor keys
  return (estraverse.VisitorKeys as any)[node.type] || [];
};

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
    shared: [],
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
              
              // Extract remote URL using our helper function
              const remoteUrl = extractRemoteUrlFromExpression(prop.value);
              
              config.remotes.push({
                name: remoteName,
                url: remoteUrl,
                folder: remoteName,
                remoteEntry: remoteUrl,
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
        
        // Extract shared dependencies
        const sharedProp = findProperty(options, 'shared');
        if (sharedProp) {
          config.shared = extractSharedDependencies(sharedProp.value);
        }
        
        console.log(`[Webpack MFE Config] Found name: ${config.name}, remotes: ${config.remotes.length}, exposes: ${config.exposes.length}, shared: ${config.shared.length}`);
        if (config.remotes.length > 0) {
          console.log(`[Webpack MFE Config] Remotes:`, config.remotes.map(r => r.name).join(', '));
        }
        if (config.shared.length > 0) {
          console.log(`[Webpack MFE Config] Shared:`, config.shared.map(s => s.name).join(', '));
        }
      }
    },
    fallback
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
    shared: [],
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
          if (isValidRemoteProperty(prop)) {
            const remoteName = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
            
            // Extract remote URL using our helper function
            const remoteUrl = extractRemoteUrlFromExpression(prop.value);
            
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
      
      // Extract shared dependencies
      const sharedProp = findProperty(options, 'shared');
      if (sharedProp) {
        config.shared = extractSharedDependencies(sharedProp.value);
      }
      
      console.log(`[Vite MFE Config] Found name: ${config.name}, remotes: ${config.remotes.length}, exposes: ${config.exposes.length}, shared: ${config.shared.length}`);
      if (config.remotes.length > 0) {
        console.log(`[Vite MFE Config] Remotes:`, config.remotes.map(r => r.name).join(', '));
      }
      if (config.shared.length > 0) {
        console.log(`[Vite MFE Config] Shared:`, config.shared.map(s => s.name).join(', '));
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
         extractRemoteUrlFromExpression(prop.value) !== undefined;
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
            node.declaration.callee.name === 'defineConfig') {
          // Handle defineConfig({ ... })
          if (node.declaration.arguments.length > 0 && 
              node.declaration.arguments[0].type === 'ObjectExpression') {
            configObj = node.declaration.arguments[0];
          }
          // Handle defineConfig(({ mode }) => ({ ... }))
          else if (node.declaration.arguments.length > 0 && 
                  node.declaration.arguments[0].type === 'ArrowFunctionExpression' &&
                  node.declaration.arguments[0].body.type === 'ObjectExpression') {
            configObj = node.declaration.arguments[0].body;
          }
          // Handle defineConfig(({ mode }) => { return { ... }; })
          else if (node.declaration.arguments.length > 0 && 
                  node.declaration.arguments[0].type === 'ArrowFunctionExpression' &&
                  node.declaration.arguments[0].body.type === 'BlockStatement') {
            // Try to find the return statement
            const returnStatement = node.declaration.arguments[0].body.body.find(
              (stmt: any) => stmt.type === 'ReturnStatement'
            );
            if (returnStatement && returnStatement.argument && 
                returnStatement.argument.type === 'ObjectExpression') {
              configObj = returnStatement.argument;
            }
          }
        } else if (node.declaration.type === 'ObjectExpression') {
          configObj = node.declaration;
        }
      }
    },
    fallback
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

/**
 * Extract Module Federation configuration from ModernJS config AST
 */
export async function extractConfigFromModernJS(ast: any, workspaceRoot: string): Promise<ModuleFederationConfig> {
  const config: ModuleFederationConfig = {
    name: '',
    remotes: [],
    exposes: [],
    shared: [],
    configType: 'modernjs',
    configPath: ''
  };
  
  estraverse.traverse(ast, {
    enter(node: any) {
      // Look for export default createModuleFederationConfig({ ... })
      if (node.type === 'ExportDefaultDeclaration' &&
          node.declaration.type === 'CallExpression' &&
          node.declaration.callee.type === 'Identifier' &&
          node.declaration.callee.name === 'createModuleFederationConfig' &&
          node.declaration.arguments.length > 0 &&
          node.declaration.arguments[0].type === 'ObjectExpression') {
          
        const options = node.declaration.arguments[0];
          
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
              
              // Extract remote URL using our helper function
              const remoteUrl = extractRemoteUrlFromExpression(prop.value);
              
              config.remotes.push({
                name: remoteName,
                url: remoteUrl,
                folder: remoteName,
                remoteEntry: remoteUrl,
                packageManager: 'npm',
                configType: 'modernjs'
              });
            }
          }
        }
        
        // Extract exposes
        const exposesProp = findProperty(options, 'exposes');
        if (exposesProp?.value.type === 'ObjectExpression') {
          for (const prop of exposesProp.value.properties) {
            // Handle string literal keys like './Components'
            if (prop.key.type === 'Literal' && prop.value.type === 'Literal') {
              const exposeName = prop.key.value;
              config.exposes.push({
                name: exposeName,
                path: prop.value.value,
                remoteName: config.name
              });
            }
            // Also handle identifier keys
            else if (prop.key.type === 'Identifier' && prop.value.type === 'Literal') {
              const exposeName = prop.key.name;
              config.exposes.push({
                name: exposeName,
                path: prop.value.value,
                remoteName: config.name
              });
            }
          }
        }
        
        // Extract shared dependencies
        const sharedProp = findProperty(options, 'shared');
        if (sharedProp) {
          config.shared = extractSharedDependencies(sharedProp.value);
        }
        
        console.log(`[ModernJS MFE Config] Found name: ${config.name}, remotes: ${config.remotes.length}, exposes: ${config.exposes.length}, shared: ${config.shared.length}`);
        if (config.remotes.length > 0) {
          console.log(`[ModernJS MFE Config] Remotes:`, config.remotes.map(r => r.name).join(', '));
        }
        if (config.exposes.length > 0) {
          console.log(`[ModernJS MFE Config] Exposes:`, config.exposes.map(e => e.name).join(', '));
        }
        if (config.shared.length > 0) {
          console.log(`[ModernJS MFE Config] Shared:`, config.shared.map(s => s.name).join(', '));
        }
      }
    },
    fallback
  });
  
  // Detect package manager for each remote after AST traversal
  for (const remote of config.remotes) {
    const { packageManager, startCommand } = await detectPackageManagerAndStartCommand(remote.folder, 'webpack');
    remote.packageManager = packageManager;
    remote.startCommand = startCommand;
  }
  
  return config;
}

// This function will extract a simplified representation of various expressions that might be used for remote URLs
function extractRemoteUrlFromExpression(valueNode: any): string | undefined {
  if (!valueNode) {
    return undefined;
  }

  // Handle TypeScript non-null assertion operator (!)
  if (valueNode.type === 'TSNonNullExpression') {
    // Process the expression without the non-null assertion
    return extractRemoteUrlFromExpression(valueNode.expression);
  }

  // Handle type assertions (as Type or <Type>)
  if (valueNode.type === 'TSAsExpression' || valueNode.type === 'TSTypeAssertion') {
    // Process the expression without the type assertion
    return extractRemoteUrlFromExpression(valueNode.expression);
  }

  // Simple string literal
  if (valueNode.type === 'Literal' && typeof valueNode.value === 'string') {
    return valueNode.value;
  }

  // Identifier - could be an imported variable or constant
  if (valueNode.type === 'Identifier') {
    return `[VAR: ${valueNode.name}]`;
  }

  // Environment variable like env.VAR_NAME or process.env.VAR_NAME
  if (valueNode.type === 'MemberExpression') {
    let objectName = '';
    // Get the object part (env or process.env)
    if (valueNode.object.type === 'Identifier') {
      objectName = valueNode.object.name;
    } else if (valueNode.object.type === 'MemberExpression' && 
               valueNode.object.object.type === 'Identifier' && 
               valueNode.object.property.type === 'Identifier') {
      objectName = `${valueNode.object.object.name}.${valueNode.object.property.name}`;
    }
    
    // Get the property part (VAR_NAME)
    if (valueNode.property.type === 'Identifier') {
      return `[ENV: ${objectName}.${valueNode.property.name}]`;
    }
  }

  // Template literal like `http://${env.HOST}:${env.PORT}/remoteEntry.js`
  if (valueNode.type === 'TemplateLiteral') {
    let result = '';
    // Combine all parts of the template literal
    for (let i = 0; i < valueNode.quasis.length; i++) {
      result += valueNode.quasis[i].value.raw;
      if (i < valueNode.expressions.length) {
        // For expressions, just add a placeholder
        result += '[EXPR]';
      }
    }
    return result;
  }

  // Function calls like getRemoteUrl() or getUrl(param)
  if (valueNode.type === 'CallExpression') {
    let functionName = '';
    if (valueNode.callee.type === 'Identifier') {
      functionName = valueNode.callee.name;
    } else if (valueNode.callee.type === 'MemberExpression' && valueNode.callee.property.type === 'Identifier') {
      let objectPart = '';
      if (valueNode.callee.object.type === 'Identifier') {
        objectPart = valueNode.callee.object.name;
      }
      functionName = objectPart ? `${objectPart}.${valueNode.callee.property.name}` : valueNode.callee.property.name;
    }
    return `[FUNC: ${functionName}()]`;
  }

  // Conditional expressions (ternary) like condition ? valueA : valueB
  if (valueNode.type === 'ConditionalExpression') {
    return '[CONDITIONAL]';
  }

  // Binary expressions like 'prefix-' + someVar
  if (valueNode.type === 'BinaryExpression') {
    return '[EXPR]';
  }

  // For any other types, return a generic placeholder
  return '[DYNAMIC_URL]';
}

function extractSharedDependencies(valueNode: any): SharedDependency[] {
  const shared: SharedDependency[] = [];
  
  if (!valueNode) {
    return shared;
  }
  
  // Handle array format: shared: ['react', 'react-dom']
  if (valueNode.type === 'ArrayExpression') {
    for (const element of valueNode.elements) {
      if (element && element.type === 'Literal' && typeof element.value === 'string') {
        shared.push({
          name: element.value
        });
      }
    }
  }
  
  // Handle object format: shared: { react: { singleton: true }, 'react-dom': { eager: true } }
  else if (valueNode.type === 'ObjectExpression') {
    for (const prop of valueNode.properties) {
      if (prop.type === 'Property') {
        let depName: string | undefined;
        
        // Get dependency name from key
        if (prop.key.type === 'Identifier') {
          depName = prop.key.name;
        } else if (prop.key.type === 'Literal' && typeof prop.key.value === 'string') {
          depName = prop.key.value;
        }
        
        if (depName) {
          const sharedDep: SharedDependency = { name: depName };
          
          // Parse configuration object if present
          if (prop.value.type === 'ObjectExpression') {
            for (const configProp of prop.value.properties) {
              if (configProp.type === 'Property' && configProp.key.type === 'Identifier') {
                const configKey = configProp.key.name;
                
                // Extract boolean values
                if (configProp.value.type === 'Literal' && typeof configProp.value.value === 'boolean') {
                  switch (configKey) {
                    case 'singleton':
                      sharedDep.singleton = configProp.value.value;
                      break;
                    case 'eager':
                      sharedDep.eager = configProp.value.value;
                      break;
                    case 'strictVersion':
                      sharedDep.strictVersion = configProp.value.value;
                      break;
                  }
                }
                
                // Extract string values
                else if (configProp.value.type === 'Literal' && typeof configProp.value.value === 'string') {
                  switch (configKey) {
                    case 'version':
                      sharedDep.version = configProp.value.value;
                      break;
                    case 'requiredVersion':
                      sharedDep.requiredVersion = configProp.value.value;
                      break;
                  }
                }
              }
            }
          }
          
          shared.push(sharedDep);
        }
      }
    }
  }
  
  // Handle function calls or other complex expressions
  else if (valueNode.type === 'CallExpression') {
    // For function calls like shareAll() or share(), we can't statically analyze
    // but we can at least indicate that shared dependencies are configured
    shared.push({
      name: '[DYNAMIC_SHARED]'
    });
  }
  
  return shared;
} 