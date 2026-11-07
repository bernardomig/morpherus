import { describe, expect, test } from "bun:test";
import { eos, ParseError, runParser, UnexpectedEOS, UnexpectedInput, type PrattTree } from "../src";
import {
  between,
  bind,
  chainl1,
  chainr1,
  char,
  digit,
  endBy,
  endBy1,
  enumOf,
  eof,
  fail,
  ignore,
  keepLeft,
  keepOnly,
  keepRight,
  label,
  letter,
  lookAhead,
  many,
  map,
  notFollowedBy,
  oneOf,
  optional,
  pratt,
  pure,
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
    seq([optional(char("-")), some(digit), optional(seq([char("."), some(digit)]))]),
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
  const parens: Parser<number> = between(lexeme(char("(")), evalSelf, lexeme(char(")")));

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
      return map(between(lparen, sepEndBy1(evalSelf, comma), rparen), (args) => Math.max(...args));
    }
    if (fn === "min") {
      // Requires 1 or more arguments without trailing comma (sepBy1)
      return map(between(lparen, sepBy1(evalSelf, comma), rparen), (args) => Math.min(...args));
    }
    // pow(base, exp) using `seq` and `ignore`
    return map(
      between(lparen, seq([evalSelf, ignore(comma), evalSelf]), rparen),
      ([base, exp]) => base ** exp,
    );
  });

  const atom: Parser<number> = oneOf([funcCall, parens, constantLiteral, numberLiteral]);

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
    expect(parseTree("2 * 3 ^ 2 + 1")).toEqual([[2, "*", [3, "^", 2]], "+", 1]);
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
    expect(parseTree("1 + 2 - 3 + 4")).toEqual([[[1, "+", 2], "-", 3], "+", 4]);
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
    const num = lexeme(map(some(digit), (digits) => Number(digits.join(""))));
    const powOp = map(lexeme(char("^")), () => (l: number, r: number) => l ** r);

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

    expect(runParser(assignment, new StringStream("let answer = 6 * 7;"))).toBe(42);

    // Comma-separated list of expressions (0 or more) via sepBy
    const listParser = between(
      lexeme(char("[")),
      sepBy(map(exprTree, evalTree), lexeme(char(","))),
      lexeme(char("]")),
    );
    expect(runParser(listParser, new StringStream("[]"))).toEqual([]);
    expect(runParser(listParser, new StringStream("[1 + 1, 2 * 3]"))).toEqual([2, 6]);

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

    // Invalid token after operator -> UnexpectedInput at '*' with merged expected tokens from atom branches
    try {
      calc("1 + * 2");
      expect.unreachable("Should have thrown UnexpectedInput");
    } catch (err) {
      expect(err).toBeInstanceOf(UnexpectedInput);
      const parseErr = err as UnexpectedInput;
      expect(parseErr.position).toBe(4);
      expect(parseErr.expected).toEqual(["sum", "max", "min", "pow", "(", "pi", "e", "digit"]);
    }

    // Unclosed parenthesis -> preserves furthest error from `parens` branch at position 6 expecting ")"
    try {
      calc("(1 + 2");
      expect.unreachable("Should have thrown UnexpectedEOS");
    } catch (err) {
      expect(err).toBeInstanceOf(UnexpectedEOS);
      const parseErr = err as UnexpectedEOS;
      expect(parseErr.position).toBe(6);
      expect(parseErr.expected).toEqual([")"]);
    }

    // Trailing unexpected input -> UnexpectedInput at 'a' expecting "eof"
    try {
      calc("1 + 2 abc");
      expect.unreachable("Should have thrown UnexpectedInput");
    } catch (err) {
      expect(err).toBeInstanceOf(UnexpectedInput);
      const parseErr = err as UnexpectedInput;
      expect(parseErr.position).toBe(6);
      expect(parseErr.expected).toEqual(["eof"]);
    }
  });

  test("exercises pure, fail, label, endBy, endBy1, lookAhead, and notFollowedBy", () => {
    // pure & fail inside bind: parse only even numbers
    const evenNumber = bind(numberLiteral, (n) =>
      n % 2 === 0 ? pure(n) : fail(`Expected even number, got ${n}`),
    );
    expect(runParser(evenNumber, new StringStream("42"))).toBe(42);
    try {
      runParser(evenNumber, new StringStream("43"));
      expect.unreachable("Should have failed on odd number");
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).message).toBe("Expected even number, got 43");
    }

    // label attaches expected label to ParseError and replaces expected when failing without progress
    const labeledNumber = label(numberLiteral, "number literal");
    try {
      runParser(labeledNumber, new StringStream("abc"));
      expect.unreachable("Should have failed with label");
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).label).toBe("number literal");
      expect((err as ParseError).expected).toEqual(["number literal"]);
    }

    // label does not override a deeper error that consumed input — its more
    // specific expected tokens survive untouched (Parsec `<?>` semantics)
    const labeledParens = label(
      between(char("("), numberLiteral, char(")")),
      "parenthesized number",
    );
    try {
      runParser(labeledParens, new StringStream("(42"));
      expect.unreachable("Should have failed expecting closing paren");
    } catch (err) {
      expect(err).toBeInstanceOf(UnexpectedEOS);
      expect((err as ParseError).position).toBe(3);
      expect((err as ParseError).label).toBeUndefined();
      expect((err as ParseError).expected).toEqual([")"]);
      expect((err as ParseError).message).toBe("Expected ) at position 3");
    }

    // Nested label: the outer label only applies when the inner parser failed
    // without consuming input (or produced no expected tokens)
    const nestedLabel = label(label(string("foo"), "inner"), "outer");

    // Fails mid-literal on "fX" (consumed "f") → deeper error wins, outer
    // label does not apply — and neither does the inner label for the same reason
    try {
      runParser(nestedLabel, new StringStream("fX"));
      expect.unreachable("Should have failed mid-literal");
    } catch (err) {
      expect(err).toBeInstanceOf(UnexpectedInput);
      expect((err as ParseError).position).toBe(1);
      expect((err as ParseError).label).toBeUndefined();
      expect((err as ParseError).expected).toEqual(["foo"]);
      expect((err as ParseError).message).toBe("Expected foo at position 1");
    }

    // Fails at position 0 → no input consumed → outer label wins
    try {
      runParser(nestedLabel, new StringStream("bX"));
      expect.unreachable("Should have failed at start");
    } catch (err) {
      expect(err).toBeInstanceOf(UnexpectedInput);
      expect((err as ParseError).position).toBe(0);
      expect((err as ParseError).label).toBe("outer");
      expect((err as ParseError).expected).toEqual(["outer"]);
      expect((err as ParseError).message).toBe("Expected outer at position 0");
    }

    // endBy & endBy1: semicolon-terminated expressions
    const semi = lexeme(char(";"));
    const exprVal = map(exprTree, evalTree);
    const statements0 = endBy(exprVal, semi);
    const statements1 = endBy1(exprVal, semi);

    expect(runParser(statements0, new StringStream(""))).toEqual([]);
    expect(runParser(statements0, new StringStream("1 + 1; 2 * 3;"))).toEqual([2, 6]);
    expect(runParser(statements1, new StringStream("10 - 4;"))).toEqual([6]);
    expect(() => runParser(statements1, new StringStream(""))).toThrow();

    // lookAhead: peeks without consuming input
    const peekPlus = seq([lookAhead(char("+")), char("+")]);
    expect(runParser(peekPlus, new StringStream("+"))).toEqual(["+", "+"]);

    // notFollowedBy: match `/` only when not followed by `/` (division vs line comment)
    const divOp = keepLeft(char("/"), notFollowedBy(char("/")));
    expect(runParser(divOp, new StringStream("/"))).toBe("/");
    expect(() => runParser(seq([divOp, char("/")]), new StringStream("//"))).toThrow(
      UnexpectedInput,
    );
  });
});
