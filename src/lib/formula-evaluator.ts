// Safe formula evaluation for custom calculation columns.
//
// This is a hand-rolled recursive-descent parser + evaluator. It deliberately
// avoids `eval` / `new Function` so user-supplied expressions cannot access
// the JS environment. Supported grammar:
//
//   expression := term (('+' | '-') term)*
//   term       := factor (('*' | '/') factor)*
//   factor     := power
//   power      := unary ('^' unary)*
//   unary      := ('+' | '-')? primary
//   primary    := number | variable | func '(' args ')' | '(' expression ')'
//   args       := expression (',' expression)*
//
// Functions: log (base-10), ln (natural), sqrt, abs, min, max, exp.

export type FormulaContext = {
  area: number;
  height: number;
  rt: number;
  fwhm: number;
  sn: number;
  mz: number;
  isArea: number;
  slope: number;
  intercept: number;
  [key: string]: number;
};

// ---- Tokenizer ----

type Token =
  | { type: "num"; value: number }
  | { type: "id"; value: string }
  | { type: "op"; value: string }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "comma" }
  | { type: "eof" };

const FUNCS = new Set(["log", "ln", "sqrt", "abs", "min", "max", "exp"]);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input;

  while (i < s.length) {
    const ch = s[i];

    // Whitespace.
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // Numbers (integers and decimals).
    if ((ch >= "0" && ch <= "9") || (ch === "." && s[i + 1] >= "0" && s[i + 1] <= "9")) {
      let j = i;
      let dotSeen = false;
      while (j < s.length && ((s[j] >= "0" && s[j] <= "9") || (s[j] === "." && !dotSeen))) {
        if (s[j] === ".") dotSeen = true;
        j++;
      }
      const num = Number(s.slice(i, j));
      if (!Number.isFinite(num)) throw new Error(`Invalid number at position ${i}`);
      tokens.push({ type: "num", value: num });
      i = j;
      continue;
    }

    // Identifiers (variables and function names).
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      let j = i;
      while (
        j < s.length &&
        ((s[j] >= "a" && s[j] <= "z") ||
          (s[j] >= "A" && s[j] <= "Z") ||
          (s[j] >= "0" && s[j] <= "9") ||
          s[j] === "_")
      ) {
        j++;
      }
      tokens.push({ type: "id", value: s.slice(i, j) });
      i = j;
      continue;
    }

    // Operators.
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma" });
      i++;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }

  tokens.push({ type: "eof" });
  return tokens;
}

// ---- AST ----

type Node =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "unary"; op: "+" | "-"; operand: Node }
  | { kind: "binary"; op: "+" | "-" | "*" | "/" | "^"; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] };

// ---- Parser (recursive descent) ----

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: Token["type"], value?: string): Token {
    const t = this.peek();
    if (t.type !== type || (value !== undefined && (t as any).value !== value)) {
      throw new Error(
        `Expected ${value ?? type} but got ${t.type === "eof" ? "end of input" : `'${(t as any).value ?? t.type}'`}`,
      );
    }
    return this.next();
  }

  parse(): Node {
    const node = this.parseExpression();
    if (this.peek().type !== "eof") {
      throw new Error("Unexpected trailing input");
    }
    return node;
  }

  private parseExpression(): Node {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t.type === "op" && (t.value === "+" || t.value === "-")) {
        this.next();
        const op = t.value as "+" | "-";
        const right = this.parseTerm();
        left = { kind: "binary", op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseTerm(): Node {
    let left = this.parsePower();
    for (;;) {
      const t = this.peek();
      if (t.type === "op" && (t.value === "*" || t.value === "/")) {
        this.next();
        const op = t.value as "*" | "/";
        const right = this.parsePower();
        left = { kind: "binary", op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parsePower(): Node {
    const left = this.parseUnary();
    const t = this.peek();
    if (t.type === "op" && t.value === "^") {
      this.next();
      const right = this.parsePower(); // right-associative
      return { kind: "binary", op: "^", left, right };
    }
    return left;
  }

  private parseUnary(): Node {
    const t = this.peek();
    if (t.type === "op" && (t.value === "+" || t.value === "-")) {
      this.next();
      const op = t.value as "+" | "-";
      const operand = this.parseUnary();
      return { kind: "unary", op, operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const t = this.peek();

    if (t.type === "num") {
      this.next();
      return { kind: "num", value: t.value };
    }

    if (t.type === "lparen") {
      this.next();
      const inner = this.parseExpression();
      this.expect("rparen");
      return inner;
    }

    if (t.type === "id") {
      this.next();
      const name = t.value;

      // Function call?
      if (this.peek().type === "lparen") {
        if (!FUNCS.has(name)) {
          throw new Error(`Unknown function '${name}'`);
        }
        this.next(); // consume '('
        const args: Node[] = [];
        if (this.peek().type !== "rparen") {
          args.push(this.parseExpression());
          while (this.peek().type === "comma") {
            this.next();
            args.push(this.parseExpression());
          }
        }
        this.expect("rparen");
        return { kind: "call", name, args };
      }

      // Variable reference.
      return { kind: "var", name };
    }

    throw new Error(
      t.type === "eof"
        ? "Unexpected end of input"
        : `Unexpected token '${(t as any).value ?? t.type}'`,
    );
  }
}

// ---- Evaluator ----

function evalNode(node: Node, ctx: FormulaContext): number {
  switch (node.kind) {
    case "num":
      return node.value;

    case "var": {
      if (!(node.name in ctx)) {
        throw new Error(`Unknown variable '${node.name}'`);
      }
      const v = ctx[node.name];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new Error(`Variable '${node.name}' is not a finite number`);
      }
      return v;
    }

    case "unary": {
      const v = evalNode(node.operand, ctx);
      return node.op === "-" ? -v : v;
    }

    case "binary": {
      const l = evalNode(node.left, ctx);
      const r = evalNode(node.right, ctx);
      switch (node.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/":
          if (r === 0) throw new Error("Division by zero");
          return l / r;
        case "^":
          return Math.pow(l, r);
      }
    }

    case "call": {
      const args = node.args.map((a) => evalNode(a, ctx));
      switch (node.name) {
        case "log":
          if (args.length !== 1) throw new Error("log() expects 1 argument");
          if (args[0] <= 0) throw new Error("log() requires a positive argument");
          return Math.log10(args[0]);
        case "ln":
          if (args.length !== 1) throw new Error("ln() expects 1 argument");
          if (args[0] <= 0) throw new Error("ln() requires a positive argument");
          return Math.log(args[0]);
        case "sqrt":
          if (args.length !== 1) throw new Error("sqrt() expects 1 argument");
          if (args[0] < 0) throw new Error("sqrt() requires a non-negative argument");
          return Math.sqrt(args[0]);
        case "abs":
          if (args.length !== 1) throw new Error("abs() expects 1 argument");
          return Math.abs(args[0]);
        case "exp":
          if (args.length !== 1) throw new Error("exp() expects 1 argument");
          return Math.exp(args[0]);
        case "min":
          if (args.length < 1) throw new Error("min() expects at least 1 argument");
          return Math.min(...args);
        case "max":
          if (args.length < 1) throw new Error("max() expects at least 1 argument");
          return Math.max(...args);
        default:
          throw new Error(`Unknown function '${node.name}'`);
      }
    }
  }
}

/**
 * Safely evaluate a formula string against the given context.
 * Returns null on any error (syntax, unknown variable, math domain, etc.).
 */
export function evaluateFormula(formula: string, ctx: FormulaContext): number | null {
  if (!formula || !formula.trim()) return null;
  try {
    const tokens = tokenize(formula);
    const ast = new Parser(tokens).parse();
    const result = evalNode(ast, ctx);
    if (!Number.isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

/** Collect all variable names referenced in a formula AST. */
function collectVars(node: Node, into: Set<string>): void {
  switch (node.kind) {
    case "var":
      into.add(node.name);
      return;
    case "unary":
      collectVars(node.operand, into);
      return;
    case "binary":
      collectVars(node.left, into);
      collectVars(node.right, into);
      return;
    case "call":
      for (const a of node.args) collectVars(a, into);
      return;
    case "num":
      return;
  }
}

/**
 * Validate a formula's syntax and ensure every variable it references is
 * present in `availableVars`. Returns `{ valid: true }` on success or
 * `{ valid: false, error }` describing the problem.
 */
export function validateFormula(
  formula: string,
  availableVars: string[],
): { valid: boolean; error?: string } {
  if (!formula || !formula.trim()) {
    return { valid: false, error: "Formula is empty" };
  }
  try {
    const tokens = tokenize(formula);
    const ast = new Parser(tokens).parse();
    const allowed = new Set(availableVars);
    const used = new Set<string>();
    collectVars(ast, used);
    for (const v of used) {
      if (!allowed.has(v)) {
        return { valid: false, error: `Unknown variable '${v}'` };
      }
    }
    return { valid: true };
  } catch (e: any) {
    return { valid: false, error: e?.message ?? "Invalid formula" };
  }
}
