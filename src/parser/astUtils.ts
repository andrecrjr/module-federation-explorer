export type AstNode = {
  readonly type: string;
  readonly [key: string]: unknown;
};

export function asNode(value: unknown): AstNode | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as { type?: unknown };
  return typeof candidate.type === 'string' ? value as AstNode : undefined;
}

export function nodeList(value: unknown): AstNode[] {
  return Array.isArray(value) ? value.map(asNode).filter((node): node is AstNode => !!node) : [];
}

export function findProperty(objectNode: unknown, name: string): AstNode | undefined {
  const object = asNode(objectNode);
  if (!object || object.type !== 'ObjectExpression') return undefined;

  return nodeList(object.properties).find(property =>
    property.type === 'Property' && getPropertyKey(property) === name
  );
}

export function getPropertyKey(propertyNode: unknown): string | undefined {
  const property = asNode(propertyNode);
  const key = asNode(property?.key);
  if (!key) return undefined;
  if (key.type === 'Identifier' && typeof key.name === 'string') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return undefined;
}

export function getMemberName(memberNode: unknown): string | undefined {
  const member = asNode(memberNode);
  const property = asNode(member?.property);
  return member?.type === 'MemberExpression' && !member.computed &&
    property?.type === 'Identifier' && typeof property.name === 'string'
    ? property.name
    : undefined;
}

export function getIdentifierName(value: unknown): string | undefined {
  const node = asNode(value);
  return node?.type === 'Identifier' && typeof node.name === 'string' ? node.name : undefined;
}

export function getLiteralString(value: unknown): string | undefined {
  const node = asNode(value);
  return node?.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined;
}

export function getProgramBody(ast: unknown): AstNode[] {
  const program = asNode(ast);
  return program?.type === 'Program' ? nodeList(program.body) : [];
}

/** Walk AST nodes without relying on untyped estraverse fallback hooks. */
export function walkAst(root: unknown, visitor: (node: AstNode) => void): void {
  const seen = new Set<object>();

  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);

    const node = asNode(value);
    if (node) visitor(node);

    for (const [key, child] of Object.entries(value)) {
      if (key === 'loc' || key === 'range' || key === 'tokens' || key === 'comments') continue;
      visit(child);
    }
  };

  visit(root);
}
