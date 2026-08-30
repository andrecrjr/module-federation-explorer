import type { AstNode } from '../parser/astUtils';
import { asNode, getIdentifierName, getProgramBody } from '../parser/astUtils';

type DeclarationIndex = Map<string, AstNode | undefined>;

const declarationIndexes = new WeakMap<object, DeclarationIndex>();

export function resolveConfigExpressionToObject(
  expression: unknown,
  ast: AstNode,
  seen = new Set<string>()
): AstNode | undefined {
  return resolveConfigExpressionToObjectWithIndex(expression, getDeclarationIndex(ast), seen);
}

function resolveConfigExpressionToObjectWithIndex(
  expression: unknown,
  declarationIndex: DeclarationIndex,
  seen: Set<string>
): AstNode | undefined {
  const node = asNode(expression);
  if (!node) return undefined;
  if (node.type === 'ObjectExpression') return node;
  if (node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion' || node.type === 'TSNonNullExpression') {
    return resolveConfigExpressionToObjectWithIndex(node.expression, declarationIndex, seen);
  }
  const identifier = getIdentifierName(node);
  if (identifier) {
    if (seen.has(identifier)) return undefined;
    seen.add(identifier);
    if (declarationIndex.has(identifier))
      return resolveConfigExpressionToObjectWithIndex(declarationIndex.get(identifier), declarationIndex, seen);
  }
  if (node.type === 'CallExpression')
    return resolveConfigExpressionToObjectWithIndex(nodeList(node.arguments)[0], declarationIndex, seen);
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
    const body = asNode(node.body);
    if (body?.type === 'ObjectExpression') return body;
    if (body?.type === 'BlockStatement') {
      const returnStatement = Array.isArray(body.body)
        ? body.body.map(asNode).find(item => item?.type === 'ReturnStatement')
        : undefined;
      return resolveConfigExpressionToObjectWithIndex(returnStatement?.argument, declarationIndex, seen);
    }
  }
  if (node.type === 'ConditionalExpression') {
    return (
      resolveConfigExpressionToObjectWithIndex(node.consequent, declarationIndex, seen) ||
      resolveConfigExpressionToObjectWithIndex(node.alternate, declarationIndex, seen)
    );
  }
  if (node.type === 'LogicalExpression') {
    return (
      resolveConfigExpressionToObjectWithIndex(node.right, declarationIndex, seen) ||
      resolveConfigExpressionToObjectWithIndex(node.left, declarationIndex, seen)
    );
  }
  if (node.type === 'SequenceExpression') {
    const expressions = nodeList(node.expressions);
    return resolveConfigExpressionToObjectWithIndex(expressions[expressions.length - 1], declarationIndex, seen);
  }
  return undefined;
}

function getDeclarationIndex(ast: AstNode): DeclarationIndex {
  const cached = declarationIndexes.get(ast);
  if (cached) return cached;

  const declarations: DeclarationIndex = new Map();
  for (const statement of getProgramBody(ast)) {
    if (statement.type !== 'VariableDeclaration') continue;
    for (const declaration of nodeList(statement.declarations)) {
      const identifier = getIdentifierName(declaration.id);
      if (identifier && !declarations.has(identifier)) declarations.set(identifier, asNode(declaration.init));
    }
  }

  declarationIndexes.set(ast, declarations);
  return declarations;
}

function nodeList(value: unknown): AstNode[] {
  return Array.isArray(value) ? value.map(asNode).filter((item): item is AstNode => !!item) : [];
}
