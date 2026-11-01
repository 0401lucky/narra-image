import "server-only";

import schemaFixture from "../../../contracts/canvas/v1/schema.json";

export const CANVAS_SCHEMA_CONTRACT = schemaFixture;
export const CANVAS_SCHEMA_QUERY_V1 = schemaFixture.catalogQuery;

export type CanvasSchemaCatalogRowV1 = { kind: string; name: string; definition: unknown };
export type CanvasSchemaQueryV1 = (sql: string) => Promise<readonly CanvasSchemaCatalogRowV1[]>;
export type CanvasSchemaIssueV1 = {
  kind: string;
  name: string;
  reason: "missing" | "mismatch" | "duplicate" | "invalid_catalog" | "query_failed";
};
export type CanvasSchemaReportV1 = {
  version: 1;
  ready: boolean;
  code: "CANVAS_SCHEMA_CONTRACT_MISMATCH" | null;
  issues: CanvasSchemaIssueV1[];
};

type CatalogExpression = [string, ...(string | CatalogExpression)[]];
type CatalogToken = { kind: "name" | "identifier" | "string" | "number" | "symbol"; value: string };
const textColumns = new Set(CANVAS_SCHEMA_CONTRACT.objects.flatMap((object) => {
  const definition = object.definition;
  return object.kind === "column" && !Array.isArray(definition) && "type" in definition
    && /^(?:text|character(?: varying)?\(\d+\))$/.test(String(definition.type)) ? [object.name.split(".")[1]] : [];
}));

function unsupportedExpression(): never {
  throw new Error("Unsupported canvas catalog expression");
}

function tokenizeExpression(value: string): CatalogToken[] {
  if (value.length > 32768) return unsupportedExpression();
  const pattern = /\s+|'(?:''|[^'])*'|"(?:""|[^"])*"|[0-9]+|[a-z_][a-z0-9_]*|::|<=|>=|<>|!=|!~\*?|~\*?|[=<>()[\],]/giy;
  const tokens: CatalogToken[] = [];
  let offset = 0;
  while (offset < value.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(value);
    if (!match) return unsupportedExpression();
    const raw = match[0];
    offset = pattern.lastIndex;
    if (/^\s/.test(raw)) continue;
    if (raw.startsWith("'")) tokens.push({ kind: "string", value: raw.slice(1, -1).replaceAll("''", "'") });
    else if (raw.startsWith('"')) tokens.push({ kind: "identifier", value: raw.slice(1, -1).replaceAll('""', '"') });
    else if (/^[0-9]/.test(raw)) tokens.push({ kind: "number", value: raw.replace(/^0+(?=[0-9])/, "") });
    else if (/^[a-z_]/i.test(raw)) tokens.push({ kind: "name", value: raw.toLowerCase() });
    else tokens.push({ kind: "symbol", value: raw });
  }
  return tokens;
}

function normalizeCatalogCast(expression: CatalogExpression, type: string, array: boolean): CatalogExpression {
  const text = type === "text" || type === "character varying";
  if (array && text && expression[0] === "array" && expression.slice(1).every((item) => Array.isArray(item) && item[0] === "string")) return expression;
  if (!array && text && (expression[0] === "string" || (expression[0] === "id" && textColumns.has(String(expression[1]))))) return expression;
  const enumType = CANVAS_SCHEMA_CONTRACT.objects.find((object) => object.kind === "enum" && object.name === type);
  if (!array && expression[0] === "literal" && expression[1] === "null" && (text || enumType)) return expression;
  if (!array && expression[0] === "string" && Array.isArray(enumType?.definition) && enumType.definition.includes(String(expression[1]))) return expression;
  return unsupportedExpression();
}

function booleanExpression(operator: "and" | "or", left: CatalogExpression, right: CatalogExpression): CatalogExpression {
  return [operator, ...(left[0] === operator ? left.slice(1) : [left]), ...(right[0] === operator ? right.slice(1) : [right])];
}

// This is deliberately only the CHECK/default grammar in the shared conformance
// fixture. Unknown SQL fails closed; grouping, operators and quoted names survive.
export function normalizeCanvasCatalogExpressionV1(value: string): string {
  const tokens = tokenizeExpression(value);
  let cursor = 0;
  const is = (value: string) => (tokens[cursor]?.kind === "name" || tokens[cursor]?.kind === "symbol") && tokens[cursor].value === value;
  const accept = (value: string) => { if (!is(value)) return false; cursor += 1; return true; };
  const require = (value: string) => { if (!accept(value)) unsupportedExpression(); };

  function primary(): CatalogExpression {
    let expression: CatalogExpression;
    const token = tokens[cursor];
    if (accept("(")) { expression = or(); require(")"); }
    else if (accept("array")) {
      require("[");
      const items: CatalogExpression[] = [primary()];
      while (accept(",")) items.push(primary());
      require("]");
      expression = ["array", ...items];
    } else {
      if (!token) return unsupportedExpression();
      cursor += 1;
      if (token.kind === "string" || token.kind === "number") expression = [token.kind, token.value];
      else if (token.kind === "name" && ["true", "false", "null"].includes(token.value)) expression = ["literal", token.value];
      else if (token.kind === "name" || token.kind === "identifier") {
        if (accept("(")) {
          const args: CatalogExpression[] = [];
          if (!accept(")")) {
            args.push(primary());
            while (accept(",")) args.push(primary());
            require(")");
          }
          if (!((token.value === "clock_timestamp" && args.length === 0) || (token.value === "length" && args.length === 1))) return unsupportedExpression();
          expression = ["call", token.value, ...args];
        } else expression = ["id", token.value];
      } else return unsupportedExpression();
    }
    while (accept("::")) {
      const type = tokens[cursor++];
      if (!type || !["name", "identifier"].includes(type.kind)) return unsupportedExpression();
      let typeName = type.value;
      if (type.kind === "name" && typeName === "character") { require("varying"); typeName += " varying"; }
      const array = accept("[");
      if (array) require("]");
      expression = normalizeCatalogCast(expression, typeName, array);
    }
    return expression;
  }

  function comparison(): CatalogExpression {
    const left = primary();
    if (accept("is")) {
      const negated = accept("not");
      require("null");
      return [negated ? "is-not-null" : "is-null", left];
    }
    if (accept("between")) {
      const lower = primary();
      require("and");
      return booleanExpression("and", [">=", left, lower], ["<=", left, primary()]);
    }
    const negated = accept("not");
    if (negated || is("in")) {
      require("in"); require("(");
      const items = [primary()];
      while (accept(",")) items.push(primary());
      require(")");
      return [negated ? "not-in" : "in", left, ...items];
    }
    const operator = tokens[cursor];
    if (operator?.kind !== "symbol" || !["=", "<>", "!=", "<", ">", "<=", ">=", "~", "!~", "~*", "!~*"].includes(operator.value)) return left;
    cursor += 1;
    const name = operator.value === "!=" ? "<>" : operator.value;
    if ((name === "=" && accept("any")) || (name === "<>" && accept("all"))) {
      require("(");
      const array = primary();
      require(")");
      if (array[0] !== "array") return unsupportedExpression();
      return [name === "=" ? "in" : "not-in", left, ...array.slice(1)];
    }
    return [name, left, primary()];
  }

  function not(): CatalogExpression { return accept("not") ? ["not", not()] : comparison(); }
  function and(): CatalogExpression {
    let expression = not();
    while (accept("and")) expression = booleanExpression("and", expression, not());
    return expression;
  }
  function or(): CatalogExpression {
    let expression = and();
    while (accept("or")) expression = booleanExpression("or", expression, and());
    return expression;
  }
  const expression = or();
  if (cursor !== tokens.length) return unsupportedExpression();
  return JSON.stringify(expression);
}

function stable(value: unknown, key = ""): string {
  if (typeof value === "string" && (key === "default" || key === "expression")) return JSON.stringify(normalizeCanvasCatalogExpressionV1(value));
  if (typeof value === "string" && key === "argumentDefaults") return JSON.stringify(value.split(",").map((expression) => normalizeCanvasCatalogExpressionV1(expression)));
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, item]) => `${JSON.stringify(name)}:${stable(item, name)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function sameDefinition(actual: unknown, expected: unknown): boolean {
  try { return stable(actual) === stable(expected); } catch { return false; }
}

function report(issues: CanvasSchemaIssueV1[]): CanvasSchemaReportV1 {
  return { version: 1, ready: issues.length === 0, code: issues.length === 0 ? null : "CANVAS_SCHEMA_CONTRACT_MISMATCH", issues };
}

export function checkCanvasSchemaInventoryV1(rows: unknown): CanvasSchemaReportV1 {
  if (!Array.isArray(rows)) return report([{ kind: "catalog", name: "canvas", reason: "invalid_catalog" }]);
  const inventory = new Map<string, CanvasSchemaCatalogRowV1[]>();
  for (const row of rows) {
    if (row === null || typeof row !== "object" || typeof row.kind !== "string" || typeof row.name !== "string" || !("definition" in row)) {
      return report([{ kind: "catalog", name: "canvas", reason: "invalid_catalog" }]);
    }
    const key = `${row.kind}:${row.name}`;
    inventory.set(key, [...(inventory.get(key) ?? []), row]);
  }
  const issues: CanvasSchemaIssueV1[] = [];
  for (const expected of CANVAS_SCHEMA_CONTRACT.objects) {
    const found = inventory.get(`${expected.kind}:${expected.name}`);
    const reason = !found ? "missing" : found.length !== 1 ? "duplicate" : !sameDefinition(found[0].definition, expected.definition) ? "mismatch" : null;
    if (reason) issues.push({ kind: expected.kind, name: expected.name, reason });
  }
  return report(issues);
}

export async function probeCanvasSchemaV1(query: CanvasSchemaQueryV1): Promise<CanvasSchemaReportV1> {
  try {
    return checkCanvasSchemaInventoryV1(await query(CANVAS_SCHEMA_QUERY_V1));
  } catch {
    // A readiness response must not contain SQL, connection strings or DB errors.
    return report([{ kind: "catalog", name: "canvas", reason: "query_failed" }]);
  }
}
