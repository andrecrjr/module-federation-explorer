import type { AstNode } from '../parser/astUtils';
import { asNode, getIdentifierName, getMemberName, walkAst } from '../parser/astUtils';
import type { ModuleFederationConfig } from '../types';
import { createConfig, extractConfigFromOptions } from './shared';

export function extractConfigFromWebpack(
  ast: AstNode,
  _workspaceRoot: string,
  configType: ModuleFederationConfig['configType'] = 'webpack'
): ModuleFederationConfig {
  const config = createConfig(configType);
  walkAst(ast, node => {
    if (node.type !== 'NewExpression' || !Array.isArray(node.arguments)) return;
    const callee = asNode(node.callee);
    const calleeName = getIdentifierName(callee) || getMemberName(callee);
    if (calleeName === 'ModuleFederationPlugin' && asNode(node.arguments[0])?.type === 'ObjectExpression') {
      config.detected = true;
      extractConfigFromOptions(node.arguments[0], config);
    }
  });
  return config;
}
