import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { UI_LOCALES } from "../locales.mjs";

/** Read literal catalog data, including imported spreads, without evaluating app modules. */
export function readCatalogs(directory) {
  const cache = new Map();
  function module(file) {
    if (cache.has(file)) return cache.get(file);
    const values = new Map();
    cache.set(file, values);
    const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function value(node) {
      if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return value(node.expression);
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
      if (ts.isIdentifier(node) && values.has(node.text)) return values.get(node.text);
      if (ts.isObjectLiteralExpression(node)) return Object.assign({}, ...node.properties.map(property => {
        if (ts.isSpreadAssignment(property)) return value(property.expression);
        if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name)) return { [property.name.text]: value(property.initializer) };
        throw new Error(`Unsupported catalog property in ${file}`);
      }));
      throw new Error(`Unsupported catalog value in ${file}`);
    }
    for (const statement of ast.statements) {
      if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) {
        const imported = module(resolve(dirname(file), statement.moduleSpecifier.text + ".ts"));
        for (const binding of statement.importClause?.namedBindings?.elements ?? []) {
          values.set(binding.name.text, imported.get((binding.propertyName ?? binding.name).text));
        }
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) values.set(declaration.name.text, value(declaration.initializer));
      }
    }
    return values;
  }
  return Object.fromEntries(UI_LOCALES.map(locale => [locale, module(resolve(directory, locale + ".ts")).get(locale === "zh-TW" ? "zhTW" : locale === "zh-CN" ? "zhCN" : locale === "pt-BR" ? "ptBR" : locale)]));
}

export function foreignPhrases(catalogs) {
  return Object.fromEntries(Object.keys(catalogs).map(locale => {
    const ownWords = new Set(Object.values(catalogs[locale]));
    return [locale, [...new Set(Object.entries(catalogs).filter(([other]) => other !== locale).flatMap(([, catalog]) => Object.entries(catalog).filter(([, value]) => value.length > 3 && !/[<{}]/.test(value) && !ownWords.has(value)).map(([, value]) => value)))]];
  }));
}
