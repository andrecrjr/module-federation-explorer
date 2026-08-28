import type { AstNode } from '../parser/astUtils';
import { asNode, findProperty, getIdentifierName, getMemberName, getProgramBody, nodeList } from '../parser/astUtils';
import { createConfig, extractConfigFromOptions } from './shared';
import { resolveConfigExpressionToObject } from './configObject';

export function extractConfigFromVite(ast: AstNode, _workspaceRoot: string) {
  const config = createConfig('vite');
  const configObject = findConfigObject(ast);
  if (!configObject) return config;
  const plugins = asNode(findProperty(configObject, 'plugins')?.value);
  if (plugins?.type !== 'ArrayExpression') return config;

  const callees = getImportedCallees(ast, new Set(['federation']), new Set(['@module-federation/vite', '@originjs/vite-plugin-federation']));
  for (const plugin of nodeList(plugins.elements)) {
    const pluginNode = asNode(plugin);
    const callee = asNode(pluginNode?.callee);
    const name = getIdentifierName(callee) || getMemberName(callee);
    if (pluginNode?.type === 'CallExpression' && name && (callees.has(name) || name.toLowerCase().includes('federation')) && asNode(nodeList(pluginNode.arguments)[0])?.type === 'ObjectExpression') {
      config.detected = true;
      extractConfigFromOptions(nodeList(pluginNode.arguments)[0], config);
      break;
    }
  }
  return config;
}

function findConfigObject(ast: AstNode): AstNode | undefined {
  const statement = getProgramBody(ast).find(item => item.type === 'ExportDefaultDeclaration' || item.type === 'ExpressionStatement');
  if (!statement) return undefined;
  const expression = statement.type === 'ExportDefaultDeclaration' ? statement.declaration : asNode(statement.expression)?.right;
  return resolveConfigExpressionToObject(expression, ast) || undefined;
}

function getImportedCallees(ast: AstNode, defaults: Set<string>, sources: Set<string>): Set<string> {
  const names = new Set(defaults);
  for (const statement of getProgramBody(ast)) {
    if (statement.type !== 'ImportDeclaration') continue;
    const source = asNode(statement.source);
    if (typeof source?.value !== 'string' || !sources.has(source.value)) continue;
    for (const specifier of nodeList(statement.specifiers)) {
      const local = asNode(specifier.local);
      if (typeof local?.name === 'string') names.add(local.name);
    }
  }
  return names;
}
