import ts from "typescript";

export type ImplementationAnalysis = {
  values: string[];
  attributes: string[];
};

export function analyzeImplementation(code: string): ImplementationAnalysis {
  const values = new Set<string>();
  const attributes = new Set<string>();
  const source = ts.createSourceFile("implementation.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      values.add(node.text);
    }
    if (ts.isJsxAttribute(node)) {
      attributes.add(node.name.getText(source));
      const initializer = node.initializer;
      if (initializer && ts.isStringLiteral(initializer)) values.add(initializer.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  for (const match of code.matchAll(/#[0-9a-fA-F]{3,8}|\d+(?:\.\d+)?px|var\(--[a-z0-9-]+\)/g)) {
    values.add(match[0]);
  }

  return {
    values: [...values].sort(),
    attributes: [...attributes].sort()
  };
}
