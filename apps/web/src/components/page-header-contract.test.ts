import { readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const source = resolve(import.meta.dirname, '..')
const app = join(source, 'app/(app)')
const slash = (path: string) => path.replaceAll('\\', '/')
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : entry.name.endsWith('.tsx')
        ? [join(directory, entry.name)]
        : [],
  )
}

describe('authenticated header contract', () => {
  it('HEADER-001: page titles use the shared header and every caller selects a pattern', () => {
    const violations: string[] = []
    const candidates = [...files(app), ...files(join(source, 'components'))].filter(
      (file) => !slash(file).includes('/ui/'),
    )
    for (const file of candidates) {
      const text = readFileSync(file, 'utf8')
      if (!/<(?:PageHeader|h1)\b/.test(text)) continue
      const path = slash(relative(source, file))
      const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      function visit(node: ts.Node) {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const name = node.tagName.getText(tree)
          if (
            name === 'PageHeader' &&
            !node.attributes.properties.some(
              (attribute) =>
                ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'pattern',
            )
          )
            violations.push(`${path}: missing PageHeader.pattern`)
          // These two established workspaces already compose their own illustrated hero.
          const custom =
            path === 'app/(app)/dashboard/page.tsx' ||
            path === 'app/(app)/dashboard/error.tsx' ||
            path === 'app/(app)/forecasts/page.tsx'
          if (name === 'h1' && path.startsWith('app/(app)/') && !custom)
            violations.push(`${path}: bare page heading`)
        }
        ts.forEachChild(node, visit)
      }
      visit(tree)
    }
    expect(violations).toEqual([])
  })

  it('HEADER-002: every existing loading boundary uses its illustrated section header', () => {
    const violations: string[] = []
    const boundaries = files(app).filter((file) => basename(file) === 'loading.tsx')
    expect(boundaries).toContain(join(app, 'imports/(operations)/loading.tsx'))
    for (const loading of boundaries) {
      if (
        !/SectionLoading|PageHeader|StockLocatorHeader|data-dashboard/.test(
          readFileSync(loading, 'utf8'),
        )
      )
        violations.push(`${slash(relative(app, loading))}: plain loading boundary`)
    }
    expect(violations).toEqual([])
  })

  it('HEADER-005: page render branches retain a header, including invalid selections', () => {
    const wrappers = new Set([
      'PageHeader',
      'ListScreen',
      'EditScreen',
      'IntegrationWorkbenchScreen',
      'StockLocatorHeader',
      'PolicyWorkbench',
      'NewForecastPage',
      'ClassifyPage',
      'PreparePage',
      'ForecastQuality',
    ])
    const violations: string[] = []
    for (const file of files(app).filter((file) => basename(file) === 'page.tsx')) {
      const path = slash(relative(app, file))
      if (path === 'dashboard/page.tsx' || path === 'forecasts/page.tsx') continue
      const tree = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      )
      const headerVariables = new Set<string>()
      function hasHeader(node: ts.Node): boolean {
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          wrappers.has(node.tagName.getText(tree))
        )
          return true
        if (
          ts.isJsxExpression(node) &&
          node.expression &&
          ts.isIdentifier(node.expression) &&
          headerVariables.has(node.expression.text)
        )
          return true
        return ts.forEachChild(node, hasHeader) ?? false
      }
      for (const declaration of tree.statements) {
        if (
          !ts.isFunctionDeclaration(declaration) ||
          !declaration.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
        )
          continue
        function collect(node: ts.Node) {
          if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer &&
            hasHeader(node.initializer)
          )
            headerVariables.add(node.name.text)
          ts.forEachChild(node, collect)
        }
        collect(declaration)
        function check(node: ts.Node) {
          if (node !== declaration && ts.isFunctionLike(node)) return
          if (ts.isReturnStatement(node) && node.expression) {
            let expression = node.expression
            while (ts.isParenthesizedExpression(expression)) expression = expression.expression
            if (
              (ts.isJsxElement(expression) ||
                ts.isJsxFragment(expression) ||
                ts.isJsxSelfClosingElement(expression)) &&
              !hasHeader(expression)
            ) {
              const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
              violations.push(`${path}:${line}: render branch without section header`)
            }
          }
          ts.forEachChild(node, check)
        }
        check(declaration)
      }
    }
    expect(violations).toEqual([])
  })
})
