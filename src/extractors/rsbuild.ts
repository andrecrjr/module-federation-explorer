import type { AstNode } from '../parser/astUtils';
import { asNode, findProperty, getIdentifierName, getMemberName, getProgramBody, nodeList } from '../parser/astUtils';
import { createConfig, extractConfigFromOptions } from './shared';
import { resolveConfigExpressionToObject } from './configObject';

export function extractConfigFromRSBuild(ast: AstNode, _workspaceRoot: string) {
  const config = createConfig('rsbuild');
  const configObject = findConfigObject(ast);
  if (!configObject) return config;

  const moduleFederation = asNode(findProperty(configObject, 'moduleFederation')?.value);
  const options =
    moduleFederation?.type === 'ObjectExpression'
      ? asNode(findProperty(moduleFederation, 'options')?.value)
      : undefined;
  if (options?.type === 'ObjectExpression') {
    config.detected = true;
    extractConfigFromOptions(options, config);
    return config;
  }

  const plugins = asNode(findProperty(configObject, 'plugins')?.value);
  const pluginNodes =
    plugins?.type === 'ArrayExpression'
      ? nodeList(plugins.elements)
      : plugins?.type === 'ObjectExpression'
        ? nodeList(plugins.properties)
            .map(property => asNode(property.value))
            .filter((item): item is AstNode => !!item)
        : [];
  for (const plugin of pluginNodes) {
    const callee = asNode(plugin.callee);
    const name = getIdentifierName(callee) || getMemberName(callee);
    if (
      plugin.type === 'CallExpression' &&
      name &&
      (name === 'pluginModuleFederation' ||
        name.toLowerCase().includes('modulefederation') ||
        name.toLowerCase() === 'mf') &&
      asNode(nodeList(plugin.arguments)[0])?.type === 'ObjectExpression'
    ) {
      config.detected = true;
      extractConfigFromOptions(nodeList(plugin.arguments)[0], config);
      break;
    }
  }
  return config;
}

function findConfigObject(ast: AstNode): AstNode | undefined {
  for (const statement of getProgramBody(ast)) {
    const expression =
      statement.type === 'ExportDefaultDeclaration' ? statement.declaration : asNode(statement.expression)?.right;
    const resolved = resolveConfigExpressionToObject(expression, ast);
    if (resolved) return resolved;
  }
  return undefined;
}
