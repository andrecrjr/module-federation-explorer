import * as assert from 'node:assert/strict';
import type { AstNode } from '../../../parser/astUtils';
import { resolveStringExpression } from '../../../parser/expressionResolver';
import { resolveConfigExpressionToObject } from '../../../extractors/configObject';

function node(value: unknown): AstNode {
  return value as AstNode;
}

function identifier(name: string): AstNode {
  return node({ type: 'Identifier', name });
}

function object(): AstNode {
  return node({ type: 'ObjectExpression', properties: [] });
}

function program(body: unknown[]): AstNode {
  return node({ type: 'Program', body });
}

suite('Parser expression resolution', () => {
  test('normalizes literals, identifiers, members, templates, and calls', () => {
    assert.equal(resolveStringExpression(undefined), undefined);
    assert.equal(resolveStringExpression(node({ type: 'Literal', value: 'literal' })), 'literal');
    assert.equal(resolveStringExpression(identifier('REMOTE_URL')), '[VAR: REMOTE_URL]');
    assert.equal(
      resolveStringExpression(
        node({
          type: 'MemberExpression',
          object: identifier('process'),
          property: identifier('env')
        })
      ),
      '[ENV: process.env]'
    );
    assert.equal(
      resolveStringExpression(
        node({
          type: 'MemberExpression',
          object: node({ type: 'MemberExpression', object: identifier('config'), property: identifier('env') }),
          property: identifier('url')
        })
      ),
      '[ENV: env.url]'
    );
    assert.equal(
      resolveStringExpression(
        node({
          type: 'TemplateLiteral',
          quasis: [{ type: 'TemplateElement', value: { type: 'TemplateElementValue', raw: 'https://example.test/' } }],
          expressions: []
        })
      ),
      'https://example.test/'
    );
    assert.equal(
      resolveStringExpression(
        node({
          type: 'TemplateLiteral',
          quasis: [
            { type: 'TemplateElement', value: { type: 'TemplateElementValue', raw: 'https://' } },
            { type: 'TemplateElement', value: { type: 'TemplateElementValue', raw: '/remoteEntry.js' } }
          ],
          expressions: [identifier('host')]
        })
      ),
      'https://[EXPR]/remoteEntry.js'
    );
    assert.equal(
      resolveStringExpression(
        node({
          type: 'CallExpression',
          callee: node({ type: 'MemberExpression', object: identifier('url'), property: identifier('toString') })
        })
      ),
      '[FUNC: toString()]'
    );
  });

  test('uses safe placeholders for dynamic and typed expressions', () => {
    assert.equal(
      resolveStringExpression(
        node({
          type: 'TSAsExpression',
          expression: node({ type: 'Literal', value: 'typed' })
        })
      ),
      'typed'
    );
    assert.equal(
      resolveStringExpression(
        node({
          type: 'TSNonNullExpression',
          expression: node({ type: 'TSTypeAssertion', expression: node({ type: 'Literal', value: 'nested' }) })
        })
      ),
      'nested'
    );
    assert.equal(
      resolveStringExpression(
        node({
          type: 'MemberExpression',
          computed: true,
          object: identifier('process'),
          property: node({ type: 'Literal', value: 'env' })
        })
      ),
      undefined
    );
    assert.equal(resolveStringExpression(node({ type: 'ConditionalExpression' })), '[CONDITIONAL]');
    assert.equal(resolveStringExpression(node({ type: 'BinaryExpression' })), '[EXPR]');
    assert.equal(resolveStringExpression(node({ type: 'Literal', value: 42 })), '[DYNAMIC_URL]');
    assert.equal(resolveStringExpression(node({ type: 'UnknownExpression' })), '[DYNAMIC_URL]');
  });

  test('resolves configuration objects through aliases and wrappers', () => {
    const direct = object();
    const ast = program([
      {
        type: 'VariableDeclaration',
        declarations: [{ type: 'VariableDeclarator', id: identifier('config'), init: direct }]
      }
    ]);

    assert.strictEqual(resolveConfigExpressionToObject(direct, ast), direct);
    assert.strictEqual(resolveConfigExpressionToObject(identifier('config'), ast), direct);
    assert.strictEqual(
      resolveConfigExpressionToObject(node({ type: 'TSAsExpression', expression: identifier('config') }), ast),
      direct
    );
    assert.strictEqual(
      resolveConfigExpressionToObject(node({ type: 'TSTypeAssertion', expression: identifier('config') }), ast),
      direct
    );
    assert.strictEqual(
      resolveConfigExpressionToObject(node({ type: 'TSNonNullExpression', expression: identifier('config') }), ast),
      direct
    );
    assert.equal(resolveConfigExpressionToObject(identifier('missing'), ast), undefined);
    assert.equal(resolveConfigExpressionToObject(undefined, ast), undefined);
  });

  test('resolves calls, functions, conditionals, logical expressions, and sequences', () => {
    const direct = object();
    const ast = program([]);
    const block = node({
      type: 'BlockStatement',
      body: [{ type: 'ReturnStatement', argument: direct }]
    });

    assert.strictEqual(
      resolveConfigExpressionToObject(
        node({
          type: 'CallExpression',
          arguments: [direct]
        }),
        ast
      ),
      direct
    );
    assert.strictEqual(
      resolveConfigExpressionToObject(
        node({
          type: 'ArrowFunctionExpression',
          body: direct
        }),
        ast
      ),
      direct
    );
    assert.strictEqual(
      resolveConfigExpressionToObject(
        node({
          type: 'FunctionExpression',
          body: block
        }),
        ast
      ),
      direct
    );
    assert.strictEqual(
      resolveConfigExpressionToObject(
        node({
          type: 'ConditionalExpression',
          consequent: node({ type: 'UnknownExpression' }),
          alternate: direct
        }),
        ast
      ),
      direct
    );
    assert.strictEqual(
      resolveConfigExpressionToObject(
        node({
          type: 'LogicalExpression',
          left: direct,
          right: node({ type: 'UnknownExpression' })
        }),
        ast
      ),
      direct
    );
    assert.strictEqual(
      resolveConfigExpressionToObject(
        node({
          type: 'SequenceExpression',
          expressions: [node({ type: 'UnknownExpression' }), direct]
        }),
        ast
      ),
      direct
    );
    assert.equal(
      resolveConfigExpressionToObject(
        node({
          type: 'ArrowFunctionExpression',
          body: node({ type: 'BlockStatement', body: [] })
        }),
        ast
      ),
      undefined
    );
    assert.equal(resolveConfigExpressionToObject(node({ type: 'UnknownExpression' }), ast), undefined);
  });

  test('stops alias cycles instead of recursing forever', () => {
    const ast = program([
      {
        type: 'VariableDeclaration',
        declarations: [{ type: 'VariableDeclarator', id: identifier('loop'), init: identifier('loop') }]
      }
    ]);

    assert.equal(resolveConfigExpressionToObject(identifier('loop'), ast), undefined);
  });

  test('resolves a long alias chain without rescanning unrelated declarations', () => {
    const direct = object();
    const aliasCount = 150;
    const body = Array.from({ length: aliasCount }, (_, index) => ({
      type: 'VariableDeclaration',
      declarations: [
        {
          type: 'VariableDeclarator',
          id: identifier(`alias${index}`),
          init: identifier(index === aliasCount - 1 ? 'config' : `alias${index + 1}`)
        }
      ]
    }));
    body.push({
      type: 'VariableDeclaration',
      declarations: [{ type: 'VariableDeclarator', id: identifier('config'), init: direct }]
    });

    const ast = program(body);
    assert.strictEqual(resolveConfigExpressionToObject(identifier('alias0'), ast), direct);
  });
});
