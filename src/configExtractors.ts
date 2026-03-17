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

// Cache for package manager detection to avoid repeated file system operations
const packageManagerCache = new Map<string, { packageManager: 'npm' | 'pnpm' | 'yarn', startCommand: string }>();

/**
 * Detect package manager and get appropriate start command based on project type
 */
async function detectPackageManagerAndStartCommand(folder: string, configType: 'webpack' | 'vite' | 'rsbuild'): Promise<{ packageManager: 'npm' | 'pnpm' | 'yarn', startCommand: string }> {
  const cacheKey = `${folder}-${configType}`;
  if (packageManagerCache.has(cacheKey)) {
    return packageManagerCache.get(cacheKey)!;
  }

  try {
    // Determine the default start script based on config type
    const startScript = configType === 'vite' ? 'dev' : configType === 'rsbuild' ? 'dev' : 'start';

    // Check for lock files to determine package manager
    const lockFiles = [
      { file: 'package-lock.json', manager: 'npm' as const },
      { file: 'pnpm-lock.yaml', manager: 'pnpm' as const },
      { file: 'yarn.lock', manager: 'yarn' as const }
    ];

    for (const { file, manager } of lockFiles) {
      try {
        await fs.access(path.join(folder, file));
        const result = {
          packageManager: manager,
          startCommand: `${manager}${manager === 'yarn' ? '' : ' run'} ${startScript}`
        };
        packageManagerCache.set(cacheKey, result);
        return result;
      } catch {
        // Continue to next lock file
      }
    }

    // Default to npm if no lock file is found
    const result = { packageManager: 'npm' as const, startCommand: `npm run ${startScript}` };
    packageManagerCache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error('Error detecting package manager:', error);
    // Default to npm if there's an error
    const result = { packageManager: 'npm' as const, startCommand: `npm run ${configType === 'vite' || configType === 'rsbuild' ? 'dev' : 'start'}` };
    packageManagerCache.set(cacheKey, result);
    return result;
  }
}

// Helper functions for AST traversal
function findProperty(obj: any, name: string): any {
  if (!obj?.properties) return undefined;
  return obj.properties.find((p: any) =>
    p.type === 'Property' &&
    ((p.key.type === 'Identifier' && p.key.name === name) ||
      (p.key.type === 'Literal' && p.key.value === name))
  );
}

function getPropertyKey(prop: any): string | undefined {
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal') return prop.key.value;
  return undefined;
}

function isValidRemoteProperty(prop: any): boolean {
  return prop.type === 'Property' &&
    (prop.key.type === 'Identifier' || prop.key.type === 'Literal');
}

// Common function to extract configuration from options object
function extractConfigFromOptions(options: any, config: ModuleFederationConfig): void {
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
        const remoteName = getPropertyKey(prop);
        if (remoteName) {
          let remoteUrl: string | undefined;

          // Handle array format, e.g., remote: ['url'] or object format { url: '...' }
          if (prop.value.type === 'ObjectExpression') {
            // Look for 'url' or 'entry' properties inside the remote object definition
            const urlProp = findProperty(prop.value, 'url') || findProperty(prop.value, 'entry');
            if (urlProp) {
              remoteUrl = extractRemoteUrlFromExpression(urlProp.value);
            }
          } else {
            remoteUrl = extractRemoteUrlFromExpression(prop.value);
          }

          if (remoteUrl) {
            // Check if the URL string has the "name@url" pattern often used in Webpack
            let finalName = remoteName;
            let finalUrl = remoteUrl;
            if (remoteUrl.includes('@') && !remoteUrl.startsWith('[') && !remoteUrl.startsWith('http')) {
              const parts = remoteUrl.split('@');
              if (parts.length === 2) {
                finalName = parts[0];
                finalUrl = parts[1];
              }
            }

            config.remotes.push({
              name: finalName,
              url: finalUrl,
              folder: remoteName, // keep original object key as folder heuristic
              remoteEntry: finalUrl,
              packageManager: 'npm',
              configType: config.configType
            });
          }
        }
      }
    }
  }

  // Extract exposes
  const exposesProp = findProperty(options, 'exposes');
  if (exposesProp?.value.type === 'ObjectExpression') {
    for (const prop of exposesProp.value.properties) {
      const exposeName = getPropertyKey(prop);
      if (exposeName && prop.value.type === 'Literal') {
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
}

// Common function to log configuration
function logConfig(configType: string, config: ModuleFederationConfig): void {
  console.log(`[${configType} MFE Config] Found name: ${config.name}, remotes: ${config.remotes.length}, exposes: ${config.exposes.length}, shared: ${config.shared.length}`);
  if (config.remotes.length > 0) {
    console.log(`[${configType} MFE Config] Remotes:`, config.remotes.map(r => r.name).join(', '));
  }
  if (config.exposes.length > 0) {
    console.log(`[${configType} MFE Config] Exposes:`, config.exposes.map(e => e.name).join(', '));
  }
  if (config.shared.length > 0) {
    console.log(`[${configType} MFE Config] Shared:`, config.shared.map(s => s.name).join(', '));
  }
}

// Common function to update package manager info for remotes
async function updateRemotePackageManagers(config: ModuleFederationConfig): Promise<void> {
  // Batch process all remotes to avoid repeated file system operations
  await Promise.all(config.remotes.map(async (remote) => {
    const configType = config.configType === 'modernjs' ? 'webpack' : config.configType;
    const { packageManager, startCommand } = await detectPackageManagerAndStartCommand(remote.folder, configType);
    remote.packageManager = packageManager;
    remote.startCommand = startCommand;
  }));
}

/**
 * Helper to read and parse a file into an AST, then extract its configuration.
 */
export async function parseConfigFile(
  filePath: string,
  extractor: (ast: any, workspaceRoot: string) => Promise<ModuleFederationConfig>
): Promise<ModuleFederationConfig> {
  const content = await fs.readFile(filePath, 'utf8');
  const ast = parse(content, {
    sourceType: 'module',
    ecmaVersion: 'latest'
  });
  return extractor(ast, path.dirname(filePath));
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
    detected: false,
    configType: 'webpack',
    configPath: ''
  };

  estraverse.traverse(ast, {
    enter(node: any) {
      // Check for ModuleFederationPlugin instantiation
      if (isModuleFederationPluginNode(node)) {
        config.detected = true;
        extractConfigFromOptions(node.arguments[0], config);
        logConfig('Webpack', config);
      }
    },
    fallback
  });

  await updateRemotePackageManagers(config);
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
    detected: false,
    configType: 'vite',
    configPath: ''
  };

  const configObj = findViteConfigObject(ast);
  if (!configObj) return config;

  const federationCallees = getViteFederationCalleeNames(ast);

  // Find plugins array
  const pluginsProp = findProperty(configObj, 'plugins');
  if (pluginsProp?.value.type !== 'ArrayExpression') return config;

  // Process each plugin
  for (const plugin of pluginsProp.value.elements) {
    if (isFederationPlugin(plugin, federationCallees)) {
      config.detected = true;
      extractConfigFromOptions(plugin.arguments[0], config);
      logConfig('Vite', config);
      break; // Assume only one federation plugin per config
    }
  }

  await updateRemotePackageManagers(config);
  return config;
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
    detected: false,
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

        config.detected = true;
        extractConfigFromOptions(node.declaration.arguments[0], config);
        logConfig('ModernJS', config);
      }
    },
    fallback
  });

  await updateRemotePackageManagers(config);
  return config;
}

/**
 * Extract Module Federation configuration from RSBuild config AST
 */
export async function extractConfigFromRSBuild(ast: any, workspaceRoot: string): Promise<ModuleFederationConfig> {
  const config: ModuleFederationConfig = {
    name: '',
    remotes: [],
    exposes: [],
    shared: [],
    detected: false,
    configType: 'rsbuild',
    configPath: ''
  };

  const configObj = findRSBuildConfigObject(ast);
  if (!configObj) return config;
  const rsbuildFederationCallees = getRSBuildFederationCalleeNames(ast);

  // Find moduleFederation property
  const moduleFederationProp = findProperty(configObj, 'moduleFederation');
  if (moduleFederationProp?.value.type === 'ObjectExpression') {
    // Look for options property within moduleFederation
    const optionsProp = findProperty(moduleFederationProp.value, 'options');
    if (optionsProp?.value.type === 'ObjectExpression') {
      config.detected = true;
      extractConfigFromOptions(optionsProp.value, config);
      logConfig('RSBuild', config);
    }
  }

  // Handle common RSBuild plugin style:
  // plugins: [pluginModuleFederation({ ... })]
  if (!config.detected) {
    const pluginsProp = findProperty(configObj, 'plugins');
    if (pluginsProp?.value.type === 'ArrayExpression') {
      for (const plugin of pluginsProp.value.elements) {
        if (isRSBuildFederationPlugin(plugin, rsbuildFederationCallees)) {
          config.detected = true;
          extractConfigFromOptions(plugin.arguments[0], config);
          logConfig('RSBuild', config);
          break;
        }
      }
    } else if (pluginsProp?.value.type === 'ObjectExpression') {
      for (const property of pluginsProp.value.properties) {
        if (property.type === 'Property' && isRSBuildFederationPlugin(property.value, rsbuildFederationCallees)) {
          config.detected = true;
          extractConfigFromOptions(property.value.arguments[0], config);
          logConfig('RSBuild', config);
          break;
        }
      }
    }
  }

  await updateRemotePackageManagers(config);
  return config;
}

function isRSBuildFederationPlugin(plugin: any, federationCallees: Set<string>): boolean {
  if (!plugin || plugin.type !== 'CallExpression' || plugin.arguments.length === 0) {
    return false;
  }

  const firstArg = plugin.arguments[0];
  if (!firstArg || firstArg.type !== 'ObjectExpression') {
    return false;
  }

  // Matches pluginModuleFederation({ ... }) and aliases like mf({ ... })
  // while still requiring a clear federation-like callee name.
  if (plugin.callee.type === 'Identifier') {
    const calleeName = plugin.callee.name;
    const normalized = calleeName.toLowerCase();
    return federationCallees.has(calleeName) || normalized.includes('modulefederation') || normalized === 'mf';
  }

  if (plugin.callee.type === 'MemberExpression' && plugin.callee.property.type === 'Identifier') {
    const calleeName = plugin.callee.property.name;
    const normalized = calleeName.toLowerCase();
    return federationCallees.has(calleeName) || normalized.includes('modulefederation') || normalized === 'mf';
  }

  return false;
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
  return findConfigObjectFromAst(ast);
}

function isFederationPlugin(plugin: any, federationCallees: Set<string>): boolean {
  return plugin.type === 'CallExpression' &&
    plugin.arguments.length > 0 &&
    plugin.arguments[0].type === 'ObjectExpression' &&
    (
      (plugin.callee.type === 'Identifier' && (federationCallees.has(plugin.callee.name) || plugin.callee.name.toLowerCase().includes('federation'))) ||
      (plugin.callee.type === 'MemberExpression' && plugin.callee.property.type === 'Identifier' &&
        (federationCallees.has(plugin.callee.property.name) || plugin.callee.property.name.toLowerCase().includes('federation')))
    );
}

// This function will extract a simplified representation of various expressions that might be used for remote URLs
function extractRemoteUrlFromExpression(valueNode: any): string | undefined {
  if (!valueNode) {
    return undefined;
  }

  // Handle TypeScript non-null assertion operator (!) and type assertions
  if (valueNode.type === 'TSNonNullExpression' || valueNode.type === 'TSAsExpression' || valueNode.type === 'TSTypeAssertion') {
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
        const depName = getPropertyKey(prop);

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

function findRSBuildConfigObject(ast: any): any {
  return findConfigObjectFromAst(ast);
} 

function getProgramBody(ast: any): any[] {
  return ast?.type === 'Program' && Array.isArray(ast.body) ? ast.body : [];
}

function isModuleExportsNode(node: any): boolean {
  return node?.type === 'MemberExpression' &&
    !node.computed &&
    node.object?.type === 'Identifier' &&
    node.object.name === 'module' &&
    node.property?.type === 'Identifier' &&
    node.property.name === 'exports';
}

function isExportsDefaultNode(node: any): boolean {
  return node?.type === 'MemberExpression' &&
    !node.computed &&
    node.object?.type === 'Identifier' &&
    node.object.name === 'exports' &&
    node.property?.type === 'Identifier' &&
    node.property.name === 'default';
}

function findTopLevelVariableInitializer(ast: any, name: string): any {
  const body = getProgramBody(ast);
  for (const statement of body) {
    if (statement.type !== 'VariableDeclaration') {
      continue;
    }

    for (const declaration of statement.declarations || []) {
      if (declaration.id?.type === 'Identifier' && declaration.id.name === name) {
        return declaration.init;
      }
    }
  }

  return undefined;
}

function resolveConfigExpressionToObject(expression: any, ast: any, seenIdentifiers = new Set<string>()): any {
  if (!expression) {
    return null;
  }

  if (expression.type === 'ObjectExpression') {
    return expression;
  }

  if (expression.type === 'TSAsExpression' || expression.type === 'TSTypeAssertion' || expression.type === 'TSNonNullExpression') {
    return resolveConfigExpressionToObject(expression.expression, ast, seenIdentifiers);
  }

  if (expression.type === 'Identifier') {
    const identifierName = expression.name;
    if (seenIdentifiers.has(identifierName)) {
      return null;
    }

    seenIdentifiers.add(identifierName);
    const initializer = findTopLevelVariableInitializer(ast, identifierName);
    return resolveConfigExpressionToObject(initializer, ast, seenIdentifiers);
  }

  if (expression.type === 'CallExpression' && expression.arguments.length > 0) {
    return resolveConfigExpressionToObject(expression.arguments[0], ast, seenIdentifiers);
  }

  if (expression.type === 'ArrowFunctionExpression' || expression.type === 'FunctionExpression') {
    if (expression.body?.type === 'ObjectExpression') {
      return expression.body;
    }

    if (expression.body?.type === 'BlockStatement') {
      const returnStatement = expression.body.body.find((statement: any) => statement.type === 'ReturnStatement');
      if (returnStatement?.argument) {
        return resolveConfigExpressionToObject(returnStatement.argument, ast, seenIdentifiers);
      }
    }
  }

  if (expression.type === 'ConditionalExpression') {
    return resolveConfigExpressionToObject(expression.consequent, ast, seenIdentifiers) ||
      resolveConfigExpressionToObject(expression.alternate, ast, seenIdentifiers);
  }

  if (expression.type === 'LogicalExpression') {
    return resolveConfigExpressionToObject(expression.right, ast, seenIdentifiers) ||
      resolveConfigExpressionToObject(expression.left, ast, seenIdentifiers);
  }

  if (expression.type === 'SequenceExpression' && Array.isArray(expression.expressions) && expression.expressions.length > 0) {
    return resolveConfigExpressionToObject(expression.expressions[expression.expressions.length - 1], ast, seenIdentifiers);
  }

  return null;
}

function findConfigObjectFromAst(ast: any): any {
  const body = getProgramBody(ast);

  for (const statement of body) {
    if (statement.type === 'ExportDefaultDeclaration') {
      const resolved = resolveConfigExpressionToObject(statement.declaration, ast);
      if (resolved) {
        return resolved;
      }
    }

    if (statement.type === 'ExpressionStatement' && statement.expression?.type === 'AssignmentExpression') {
      const assignment = statement.expression;
      if (isModuleExportsNode(assignment.left) || isExportsDefaultNode(assignment.left)) {
        const resolved = resolveConfigExpressionToObject(assignment.right, ast);
        if (resolved) {
          return resolved;
        }
      }
    }
  }

  return null;
}

function getViteFederationCalleeNames(ast: any): Set<string> {
  const calleeNames = new Set<string>(['federation']);
  const knownSources = new Set<string>(['@module-federation/vite', '@originjs/vite-plugin-federation']);

  for (const statement of getProgramBody(ast)) {
    if (statement.type !== 'ImportDeclaration' || typeof statement.source?.value !== 'string') {
      continue;
    }

    if (!knownSources.has(statement.source.value)) {
      continue;
    }

    for (const specifier of statement.specifiers || []) {
      if (specifier.type === 'ImportDefaultSpecifier' || specifier.type === 'ImportSpecifier') {
        if (specifier.local?.name) {
          calleeNames.add(specifier.local.name);
        }
      }
    }
  }

  return calleeNames;
}

function getRSBuildFederationCalleeNames(ast: any): Set<string> {
  const calleeNames = new Set<string>(['pluginModuleFederation']);
  const knownSource = '@module-federation/rsbuild-plugin';

  for (const statement of getProgramBody(ast)) {
    if (statement.type !== 'ImportDeclaration' || statement.source?.value !== knownSource) {
      continue;
    }

    for (const specifier of statement.specifiers || []) {
      if (specifier.type === 'ImportDefaultSpecifier' || specifier.type === 'ImportSpecifier') {
        if (specifier.local?.name) {
          calleeNames.add(specifier.local.name);
        }
      }
    }
  }

  return calleeNames;
}