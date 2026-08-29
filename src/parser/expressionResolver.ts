import { asNode, getIdentifierName, getMemberName, getLiteralString } from './astUtils';

export function resolveStringExpression(value: unknown): string | undefined {
  const node = asNode(value);
  if (!node) return undefined;

  if (node.type === 'TSNonNullExpression' || node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion') {
    return resolveStringExpression(node.expression);
  }

  const literal = getLiteralString(node);
  if (literal !== undefined) return literal;

  if (node.type === 'Identifier') {
    const name = getIdentifierName(node);
    return name ? `[VAR: ${name}]` : undefined;
  }

  if (node.type === 'MemberExpression') {
    const propertyName = getMemberName(node);
    if (!propertyName) return undefined;
    const object = asNode(node.object);
    const objectName = getIdentifierName(object) || getMemberName(object) || '';
    return `[ENV: ${objectName}.${propertyName}]`;
  }

  if (node.type === 'TemplateLiteral') {
    const quasis = Array.isArray(node.quasis) ? node.quasis : [];
    const expressions = Array.isArray(node.expressions) ? node.expressions : [];
    return quasis
      .map((quasi, index) => {
        const quasiNode = asNode(quasi);
        const quasiValue = quasiNode?.value;
        const raw =
          typeof quasiValue === 'object' &&
          quasiValue !== null &&
          !Array.isArray(quasiValue) &&
          typeof (quasiValue as { raw?: unknown }).raw === 'string'
            ? (quasiValue as { raw: string }).raw
            : '';
        return raw + (index < expressions.length ? '[EXPR]' : '');
      })
      .join('');
  }

  if (node.type === 'CallExpression') {
    const callee = asNode(node.callee);
    const calleeName = getIdentifierName(callee) || getMemberName(callee);
    return `[FUNC: ${calleeName || ''}()]`;
  }

  if (node.type === 'ConditionalExpression') return '[CONDITIONAL]';
  if (node.type === 'BinaryExpression') return '[EXPR]';
  return '[DYNAMIC_URL]';
}
