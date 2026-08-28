import type { AstNode } from '../parser/astUtils';
import { asNode, getIdentifierName, getProgramBody, nodeList } from '../parser/astUtils';
import { createConfig, extractConfigFromOptions } from './shared';

export function extractConfigFromModernJS(ast: AstNode, _workspaceRoot: string) {
  const config = createConfig('modernjs');
  for (const statement of getProgramBody(ast)) {
    const declaration = asNode(statement.declaration);
    const callee = asNode(declaration?.callee);
    if (statement.type === 'ExportDefaultDeclaration' && declaration?.type === 'CallExpression' && getIdentifierName(callee) === 'createModuleFederationConfig' && asNode(nodeList(declaration.arguments)[0])?.type === 'ObjectExpression') {
      config.detected = true;
      extractConfigFromOptions(nodeList(declaration.arguments)[0], config);
    }
  }
  return config;
}
