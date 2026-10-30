import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/** Un frammento di testo che può finire davanti all'utente. */
export interface UserString {
  file: string;
  line: number;
  text: string;
}

const SKIP_DIRS = new Set(["node_modules", ".expo", "dist", "build", "admin"]);
const SKIP_FILES = new Set(["types/database.ts"]);

/** Attributi JSX che non sono mai testo: classi, rotte, id. */
const NON_TEXT_ATTRIBUTES = new Set([
  "className",
  "contentContainerClassName",
  "testID",
  "nativeID",
  "href",
  "name",
  "icon",
  "keyboardType",
  "autoComplete",
  "textContentType",
  "autoCapitalize",
  "returnKeyType",
]);

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...listSources(path));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(path);
  }
  return out;
}

function isNonText(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isExternalModuleReference(parent)) return true;
  if (ts.isLiteralTypeNode(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isElementAccessExpression(parent)) return true;
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression.getText();
    // require("…"), cn("…"), import("…"), rotte e chiavi di query.
    if (/^(require|import|cn|clsx|push|replace|navigate|from|rpc|select|eq|channel)$/.test(callee.split(".").pop() ?? "")) {
      return true;
    }
  }
  if (ts.isJsxAttribute(parent) || (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent))) {
    const attr = (ts.isJsxAttribute(parent) ? parent : (parent.parent as ts.JsxAttribute)).name.getText();
    if (NON_TEXT_ATTRIBUTES.has(attr)) return true;
  }
  if (ts.isBinaryExpression(parent) && /===|!==|==|!=/.test(parent.operatorToken.getText())) return true;
  if (ts.isCaseClause(parent)) return true;
  return false;
}

/** Stringhe, template e testo JSX dei sorgenti sotto `roots`, commenti esclusi. */
export function collectUserStrings(repoRoot: string, roots: string[]): UserString[] {
  const out: UserString[] = [];
  for (const root of roots) {
    for (const path of listSources(join(repoRoot, root))) {
      const file = relative(repoRoot, path);
      if ([...SKIP_FILES].some((skip) => file.endsWith(skip))) continue;
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );
      const push = (node: ts.Node, text: string) => {
        if (!text.trim()) return;
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        out.push({ file, line: line + 1, text });
      };
      const visit = (node: ts.Node) => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          if (!isNonText(node)) push(node, node.text);
        } else if (ts.isTemplateExpression(node)) {
          if (!isNonText(node)) {
            push(node, [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" … "));
          }
        } else if (ts.isJsxText(node)) {
          push(node, node.text.replace(/\s+/g, " "));
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return out;
}
