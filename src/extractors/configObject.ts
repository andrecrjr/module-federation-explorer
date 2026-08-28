import type { AstNode } from '../parser/astUtils';
import { asNode, getIdentifierName, getProgramBody } from '../parser/astUtils';

export function resolveConfigExpressionToObject(expression: unknown, ast: AstNode, seen = new Set<string>()): AstNode | undefined {
  const node = asNode(expression);
  if (!node) return undefined;
  if (node.type === 'ObjectExpression') return node;
  if (node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion' || node.type === 'TSNonNullExpression') {
    return resolveConfigExpressionToObject(node.expression, ast, seen);
  }
  const identifier = getIdentifierName(node);
  if (identifier) {
    if (seen.has(identifier)) return undefined;
    seen.add(identifier);
    for (const statement of getProgramBody(ast)) {
      if (statement.type !== 'VariableDeclaration') continue;
      for (const declaration of Array.isArray(statement.declarations) ? statement.declarations.map(asNode).filter((item): item is AstNode => !!item) : []) {
        if (getIdentifierName(declaration.id) === identifier) return resolveConfigExpressionToObject(declaration.init, ast, seen);
      }
    }
  }
  if (node.type === 'CallExpression') return resolveConfigExpressionToObject(nodeList(node.arguments)[0], ast, seen);
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
    const body = asNode(node.body);
    if (body?.type === 'ObjectExpression') return body;
    if (body?.type === 'BlockStatement') {
      const returnStatement = Array.isArray(body.body) ? body.body.map(asNode).find(item => item?.type === 'ReturnStatement') : undefined;
      return resolveConfigExpressionToObject(returnStatement?.argument, ast, seen);
    }
  }
  if (node.type === 'ConditionalExpression') {
    return resolveConfigExpressionToObject(node.consequent, ast, seen) || resolveConfigExpressionToObject(node.alternate, ast, seen);
  }
  if (node.type === 'LogicalExpression') {
    return resolveConfigExpressionToObject(node.right, ast, seen) || resolveConfigExpressionToObject(node.left, ast, seen);
  }
  if (node.type === 'SequenceExpression') {
    const expressions = nodeList(node.expressions);
    return resolveConfigExpressionToObject(expressions[expressions.length - 1], ast, seen);
  }
  return undefined;
}

function nodeList(value: unknown): AstNode[] {
  return Array.isArray(value) ? value.map(asNode).filter((item): item is AstNode => !!item) : [];
}
