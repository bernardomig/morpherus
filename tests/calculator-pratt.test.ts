import { describe, expect, test } from "bun:test";
import {
  eos,
  runParser,
  UnexpectedEOS,
  UnexpectedInput,
  type PrattTree,
} from "../src";
import {
  between,
  bind,
  chainl1,
  chainr1,
  char,
  digit,
  enumOf,
  eof,
  ignore,
  keepLeft,
  keepOnly,
  keepRight,
  letter,
  many,
  map,
  oneOf,
  optional,
  pratt,
  ref,
  sepBy,
  sepBy1,
  sepEndBy,
  sepEndBy1,
  seq,
  some,
  string,
  StringStream,
  type Parser,
} from "../src/string";

// ---------------------------------------------------------------------------
// Calculator Grammar using `pratt` and string combinators
// ---------------------------------------------------------------------------

const ws = many(oneOf([char(" "), char("\t"), char("\n"), char("\r")]));

function lexeme<T>(p: Parser<T>): Parser<T> {
  return between(ws, p, ws);
}

// Operators and precedence table
type Op = "+" | "-" | "*" | "/" | "%" | "^";

const operator: Parser<Op> = lexeme(enumOf(["+", "-", "*", "/", "%", "^"]));

const priority: Record<Op, number> = {
  "+": 1,
  "-": 1,
  "*": 2,
  "/": 2,
  "%": 2,
  "^": 3,
};

// Number literal: optional '-', integer digits, optional fractional part
const numberLiteral: Parser<number> = lexeme(
  map(
    seq([
      optional(char("-")),
      some(digit),
      optional(seq([char("."), some(digit)])),
    ]),
    ([sign, intDigits, fracPart]) => {
      const intStr = intDigits.join("");
      const fracStr = fracPart ? `.${fracPart[1].join("")}` : "";
      return Number(`${sign ?? ""}${intStr}${fracStr}`);
    },
  ),
);

// Case-insensitive constants (PI, E)
const constantLiteral: Parser<number> = lexeme(
  oneOf([
    map(string("pi", { caseSensitive: false }), () => Math.PI),
    map(char("e", { caseSensitive: false }), () => Math.E),
  ]),
);

// Evaluate a PrattTree<number, Op>
function evalTree(tree: PrattTree<number, Op>): number {
  if (typeof tree === "number") return tree;
  const [left, op, right] = tree;
  const l = evalTree(left);
  const r = evalTree(right);
  switch (op) {
    case "+":
      return l + r;
    case "-":
      return l - r;
    case "*":
      return l * r;
    case "/":
      return l / r;
    case "%":
      return l % r;
    case "^":
      return l ** r;
  }
}

// Recursive expression AST parser
const exprTree: Parser<PrattTree<number, Op>> = ref((self) => {
  const evalSelf: Parser<number> = map(self, evalTree);

  // Parenthesized expression: ( expr )
  const parens: Parser<number> = between(
    lexeme(char("(")),
    evalSelf,
    lexeme(char(")")),
  );

  // Built-in function calls using `bind`, `sepEndBy`, `sepBy1`, `sepBy`
  const funcName = lexeme(enumOf(["sum", "max", "min", "pow"]));
  const funcCall: Parser<number> = bind(funcName, (fn) => {
    const lparen = lexeme(char("("));
    const rparen = lexeme(char(")"));
    const comma = lexeme(char(","));

    if (fn === "sum") {
      // Allows 0 or more arguments with optional trailing comma (sepEndBy)
      return map(between(lparen, sepEndBy(evalSelf, comma), rparen), (args) =>
        args.reduce((a, b) => a + b, 0),
      );
    }
    if (fn === "max") {
      // Requires 1 or more arguments with optional trailing comma (sepEndBy1)
      return map(between(lparen, sepEndBy1(evalSelf, comma), rparen), (args) =>
        Math.max(...args),
      );
    }
    if (fn === "min") {
      // Requires 1 or more arguments without trailing comma (sepBy1)
      return map(between(lparen, sepBy1(evalSelf, comma), rparen), (args) =>
        Math.min(...args),
      );
    }
    // pow(base, exp) using `seq` and `ignore`
    return map(
      between(lparen, seq([evalSelf, ignore(comma), evalSelf]), rparen),
      ([base, exp]) => base ** exp,
    );
  });

  const atom: Parser<number> = oneOf([
    funcCall,
    parens,
    constantLiteral,
    numberLiteral,
  ]);

  return pratt(atom, operator, priority);
});

const calculator: Parser<number> = keepLeft(map(exprTree, evalTree), eof);

function parseTree(input: string): PrattTree<number, Op> {
  return runParser(exprTree, new StringStream(input));
}

function calc(input: string): number {
  return runParser(calculator, new StringStream(input));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Calculator with pratt parser", () => {
  test("parses single atoms", () => {
    expect(parseTree("42")).toBe(42);
    expect(calc("42")).toBe(42);
    expect(calc("  -3.5  ")).toBe(-3.5);
  });

  test("respects operator precedence in AST and evaluation", () => {
    // 1 + 2 * 3 => [1, "+", [2, "*", 3]]
    expect(parseTree("1 + 2 * 3")).toEqual([1, "+", [2, "*", 3]]);
    expect(calc("1 + 2 * 3")).toBe(7);

    // 2 * 3 + 4 => [[2, "*", 3], "+", 4]
    expect(parseTree("2 * 3 + 4")).toEqual([[2, "*", 3], "+", 4]);
    expect(calc("2 * 3 + 4")).toBe(10);

    // 2 * 3 ^ 2 + 1 => [[2, "*", [3, "^", 2]], "+", 1]
    expect(parseTree("2 * 3 ^ 2 + 1")).toEqual([
      [2, "*", [3, "^", 2]],
      "+",
      1,
    ]);
    expect(calc("2 * 3 ^ 2 + 1")).toBe(19);
  });

  test("associates equal-precedence operators to the left", () => {
    // 10 - 3 - 2 => [[10, "-", 3], "-", 2] = 5
    expect(parseTree("10 - 3 - 2")).toEqual([[10, "-", 3], "-", 2]);
    expect(calc("10 - 3 - 2")).toBe(5);

    // 24 / 6 / 2 => [[24, "/", 6], "/", 2] = 2
    expect(parseTree("24 / 6 / 2")).toEqual([[24, "/", 6], "/", 2]);
    expect(calc("24 / 6 / 2")).toBe(2);

    // 1 + 2 - 3 + 4 => [[[1, "+", 2], "-", 3], "+", 4] = 4
    expect(parseTree("1 + 2 - 3 + 4")).toEqual([
      [[1, "+", 2], "-", 3],
      "+",
      4,
    ]);
    expect(calc("1 + 2 - 3 + 4")).toBe(4);
  });

  test("handles parenthesized sub-expressions via ref and between", () => {
    expect(calc("(1 + 2) * 3")).toBe(9);
    expect(calc("((2 + 3) * (4 - 1)) / 5")).toBe(3);
    expect(calc("(((10)))")).toBe(10);
  });

  test("handles functions with bind, sepEndBy, sepEndBy1, sepBy1, seq, and ignore", () => {
    // sum: sepEndBy (supports empty, normal, and trailing comma)
    expect(calc("sum()")).toBe(0);
    expect(calc("sum(1, 2, 3)")).toBe(6);
    expect(calc("sum(10, 20, 30, )")).toBe(60);

    // max: sepEndBy1 (1+ args, allows trailing comma)
    expect(calc("max(1 + 2, 3 * 4, 5,)")).toBe(12);

    // min: sepBy1 (1+ args, no trailing comma)
    expect(calc("min(10, 2 * 3, 4 + 1)")).toBe(5);

    // pow: seq + ignore
    expect(calc("pow(2, 3) + 1")).toBe(9);
  });

  test("handles case-insensitive constants", () => {
    expect(calc("pi")).toBeCloseTo(Math.PI);
    expect(calc("PI * 2")).toBeCloseTo(Math.PI * 2);
    expect(calc("E ^ 1")).toBeCloseTo(Math.E);
  });

  test("compares chainl1 and chainr1 associativity", () => {
    const num = lexeme(
      map(some(digit), (digits) => Number(digits.join(""))),
    );
    const powOp = map(
      lexeme(char("^")),
      () => (l: number, r: number) => l ** r,
    );

    const leftPow = chainl1(num, powOp);
    const rightPow = chainr1(num, powOp);

    // (2 ^ 3) ^ 2 = 8 ^ 2 = 64
    expect(runParser(leftPow, new StringStream("2 ^ 3 ^ 2"))).toBe(64);
    // 2 ^ (3 ^ 2) = 2 ^ 9 = 512
    expect(runParser(rightPow, new StringStream("2 ^ 3 ^ 2"))).toBe(512);
  });

  test("exercises keepOnly, keepLeft, keepRight, sepBy, and eof", () => {
    // Variable assignment syntax: `let x = 1 + 2 * 3;`
    const ident = map(some(letter), (chars) => chars.join(""));
    const assignment = keepOnly(
      [
        lexeme(string("let")),
        keepRight(ws, ident),
        lexeme(char("=")),
        map(exprTree, evalTree),
        keepLeft(lexeme(char(";")), eof),
      ],
      3,
    );

    expect(runParser(assignment, new StringStream("let answer = 6 * 7;"))).toBe(
      42,
    );

    // Comma-separated list of expressions (0 or more) via sepBy
    const listParser = between(
      lexeme(char("[")),
      sepBy(map(exprTree, evalTree), lexeme(char(","))),
      lexeme(char("]")),
    );
    expect(runParser(listParser, new StringStream("[]"))).toEqual([]);
    expect(runParser(listParser, new StringStream("[1 + 1, 2 * 3]"))).toEqual([
      2, 6,
    ]);

    // Direct eof result check
    expect(runParser(eof, new StringStream(""))).toBe(eos);
  });

  test("reports accurate error types and stream positions on invalid input", () => {
    // Missing RHS after operator -> UnexpectedEOS at end of input
    try {
      calc("1 + ");
      expect.unreachable("Should have thrown UnexpectedEOS");
    } catch (err) {
      expect(err).toBeInstanceOf(UnexpectedEOS);
      expect((err as UnexpectedEOS).position).toBe(4);
    }

    // Invalid token after operator -> UnexpectedInput at '*'
    try {
      calc("1 + * 2");
      expect.unreachable("Should have thrown UnexpectedInput");
    } catch (err) {
      expect(err).toBeInstanceOf(UnexpectedInput);
      expect((err as UnexpectedInput).position).toBe(4);
    }

    // Unclosed parenthesis -> fails at position 0 because `oneOf` backtracks all atom branches
    try {
      calc("(1 + 2");
      expect.unreachable("Should have thrown UnexpectedInput");
    } catch (err) {
      expect(err).toBeInstanceOf(UnexpectedInput);
      expect((err as UnexpectedInput).position).toBe(0);
    }

    // Trailing unexpected input -> UnexpectedInput at 'a'
    try {
      calc("1 + 2 abc");
      expect.unreachable("Should have thrown UnexpectedInput");
    } catch (err) {
      expect(err).toBeInstanceOf(UnexpectedInput);
      expect((err as UnexpectedInput).position).toBe(6);
    }
  });
});
