import ts from "typescript";
import type { CodeFunction, FunctionKind } from "@code-zero/shared";
import { extension, isJsTs } from "./classify";

export interface ImportBinding {
  local: string;
  imported: string; // "default", "*" or the exported name
}

export interface ParsedImport {
  specifier: string;
  line: number;
  bindings: ImportBinding[];
  kind: "import" | "require" | "dynamic" | "re-export";
}

export interface ParsedCall {
  fromId: string | null; // enclosing function id, null for module scope
  callee: string;
  line: number;
}

export interface ParsedModule {
  path: string;
  functions: CodeFunction[];
  imports: ParsedImport[];
  calls: ParsedCall[];
  exportedNames: string[];
  parseError: string | null;
}

export const MAX_PARSE_BYTES = 400_000;

function scriptKind(path: string): ts.ScriptKind {
  switch (extension(path)) {
    case "tsx":
      return ts.ScriptKind.TSX;
    case "jsx":
      return ts.ScriptKind.JSX;
    case "js":
    case "mjs":
    case "cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function hasExportModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** Parses a JS/TS module into functions, imports and identifier calls using the TypeScript compiler AST. */
export function parseModule(path: string, content: string): ParsedModule {
  const result: ParsedModule = { path, functions: [], imports: [], calls: [], exportedNames: [], parseError: null };
  if (!isJsTs(path)) {
    result.parseError = "Unsupported language for AST parsing";
    return result;
  }
  if (content.length > MAX_PARSE_BYTES) {
    result.parseError = `File exceeds ${MAX_PARSE_BYTES} byte parse limit`;
    return result;
  }

  let sf: ts.SourceFile;
  try {
    sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind(path));
  } catch (err) {
    result.parseError = `Parse failure: ${(err as Error).message}`;
    return result;
  }
  const diagnostics = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    result.parseError = `Syntax errors (${diagnostics.length}); results may be partial`;
  }

  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const exported = new Set<string>();
  const stack: string[] = [];

  const addFn = (name: string, kind: FunctionKind, node: ts.Node, isExported: boolean): string => {
    const id = `${path}#${name}`;
    if (!result.functions.some((f) => f.id === id)) {
      result.functions.push({
        id,
        name,
        kind,
        filePath: path,
        startLine: lineOf(node.getStart(sf)),
        endLine: lineOf(node.getEnd()),
        exported: isExported,
      });
    }
    if (isExported) exported.add(name);
    return id;
  };

  const visit = (node: ts.Node, className: string | null): void => {
    let pushed = false;

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings: ImportBinding[] = [];
      const clause = node.importClause;
      if (clause?.name) bindings.push({ local: clause.name.text, imported: "default" });
      const nb = clause?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) bindings.push({ local: nb.name.text, imported: "*" });
      if (nb && ts.isNamedImports(nb))
        for (const el of nb.elements) bindings.push({ local: el.name.text, imported: (el.propertyName ?? el.name).text });
      result.imports.push({ specifier: node.moduleSpecifier.text, line: lineOf(node.getStart(sf)), bindings, kind: "import" });
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        result.imports.push({ specifier: node.moduleSpecifier.text, line: lineOf(node.getStart(sf)), bindings: [], kind: "re-export" });
      }
      if (node.exportClause && ts.isNamedExports(node.exportClause))
        for (const el of node.exportClause.elements) exported.add((el.propertyName ?? el.name).text);
    } else if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
      exported.add(node.expression.text);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      stack.push(addFn(node.name.text, "function", node, hasExportModifier(node)));
      pushed = true;
    } else if (ts.isClassDeclaration(node) && node.name) {
      addFn(node.name.text, "class", node, hasExportModifier(node));
      const name = node.name.text;
      node.forEachChild((c) => visit(c, name));
      return;
    } else if ((ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) && className) {
      const methodName = ts.isConstructorDeclaration(node)
        ? "constructor"
        : node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
          ? node.name.text
          : null;
      if (methodName) {
        stack.push(addFn(`${className}.${methodName}`, "method", node, false));
        pushed = true;
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      const stmt = node.parent?.parent;
      const isExp = !!stmt && ts.isVariableStatement(stmt) && hasExportModifier(stmt);
      stack.push(addFn(node.name.text, "arrow", node, isExp && stack.length === 0));
      pushed = true;
    } else if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr)) {
        if (expr.text === "require" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          result.imports.push({ specifier: node.arguments[0].text, line: lineOf(node.getStart(sf)), bindings: [], kind: "require" });
        } else {
          result.calls.push({ fromId: stack[stack.length - 1] ?? null, callee: expr.text, line: lineOf(node.getStart(sf)) });
        }
      } else if (expr.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        result.imports.push({ specifier: node.arguments[0].text, line: lineOf(node.getStart(sf)), bindings: [], kind: "dynamic" });
      } else if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
        // namespace.member() — resolved later against `import * as ns`
        result.calls.push({ fromId: stack[stack.length - 1] ?? null, callee: `${expr.expression.text}.${expr.name.text}`, line: lineOf(node.getStart(sf)) });
      }
    }

    node.forEachChild((c) => visit(c, className));
    if (pushed) stack.pop();
  };

  visit(sf, null);
  for (const f of result.functions) if (exported.has(f.name)) f.exported = true;
  result.exportedNames = [...exported];
  return result;
}

/** Functions whose span contains any of the given lines. Classes are dropped when one of their methods matched. */
export function functionsTouchingLines(functions: CodeFunction[], lines: number[]): CodeFunction[] {
  if (lines.length === 0) return [];
  const hit = functions.filter((f) => lines.some((l) => l >= f.startLine && l <= f.endLine));
  return hit.filter((f) => {
    if (f.kind === "class") return !hit.some((m) => m.kind === "method" && m.name.startsWith(`${f.name}.`));
    // Drop outer functions when a nested function (strictly inside) also matched.
    return !hit.some(
      (o) => o !== f && o.kind !== "class" && o.startLine >= f.startLine && o.endLine <= f.endLine && (o.startLine > f.startLine || o.endLine < f.endLine) &&
        lines.every((l) => !(l >= f.startLine && l <= f.endLine) || (l >= o.startLine && l <= o.endLine)),
    );
  });
}
