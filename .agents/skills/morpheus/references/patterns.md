# Morpheus patterns

Copy-paste recipes. All snippets assume:

```ts
import { runParser } from "morpheus";
import {
  between,
  bind,
  chainl1,
  digit,
  enumOf,
  fail,
  keepLeft,
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
  satisfies,
  sepBy,
  sepEndBy,
  seq,
  some,
  string,
  StringStream,
  type Parser,
} from "morpheus/string";
import type { PrattTree } from "morpheus";
```

## 1. Whitespace and `lexeme`

```ts
const ws = many(satisfies((c) => /\s/.test(c), "whitespace"));
const lexeme = <T>(p: Parser<T>): Parser<T> => between(ws, p, ws);

const comma = lexeme(string(","));
const lparen = lexeme(string("("));
const rparen = lexeme(string(")"));
```

Call `lexeme` on every atom; a token like `1+2` then works without spaces. `ws` swallows input,
so put it **inside** the atom wrapper, not between `seq` steps.

## 2. Numbers and identifiers

```ts
const integer = map(some(digit), (ds) => Number(ds.join("")));

const number = map(seq([optional(string("-")), some(digit)]), ([sign, ds]) =>
  Number(`${sign ?? ""}${ds.join("")}`),
);

const identifier = map(some(oneOf([letter, digit])), (cs) => cs.join(""));

// Keyword-first: enumOf tries the longest alternative first.
const keyword = enumOf(["let", "letter"]);
```

## 3. Pratt expressions (precedence climbing)

```ts
type Op = "+" | "-" | "*" | "/" | "^";

const operator = lexeme(enumOf(["+", "-", "*", "/", "^"]));
const priority: Record<Op, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };
const atom = lexeme(map(some(digit), (ds) => Number(ds.join(""))));

const expression: Parser<PrattTree<number, Op>> = pratt(atom, operator, priority);

function evaluate(t: PrattTree<number, Op>): number {
  if (typeof t === "number") return t;
  const [l, op, r] = t;
  const a = evaluate(l);
  const b = evaluate(r);
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return a / b;
    case "^":
      return a ** b;
  }
}

const value = map(expression, evaluate);

runParser(value, new StringStream("2 + 3 * 4")); // 14
```

Equal precedence is left-associative. `pratt` commits once an operator matches: bad input after
an operator reports the deep error (good positions) rather than silently truncating.

## 4. Unary-less associativity alternatives

```ts
const add = map(lexeme(string("+")), () => (l: number, r: number) => l + r);
const mul = map(lexeme(string("*")), () => (l: number, r: number) => l * r);

const sum: Parser<number> = chainl1(atom, add);
const product: Parser<number> = chainl1(atom, mul);
```

`chainl1`/`chainr1` stop on a failed RHS and return the accumulator; leftover input is reported
by `runParser` as trailing input. Use `pratt` when you want deep errors.

## 5. Recursive grammars with `ref`

```ts
const value: Parser<number> = ref((self) => {
  const parenthesized = between(lparen, self, rparen);
  return oneOf([parenthesized, atom]);
});

runParser(value, new StringStream("((7))")); // 7
```

`ref` builds the parser once; recursive references go through `self`, so define it where the
self type is already fixed (`const x: Parser<number> = ref(...)`).

## 6. Statement lists

```ts
const semi = lexeme(string(";"));
const statements = sepEndBy(value, semi); // optional trailing separator
const terminated = sepEndBy1(value, semi); // requires >= 1 item
const each: Parser<number[]> = endBy(value, semi); // separator after every item

runParser(statements, new StringStream("1; 2; 3;")); // [1, 2, 3]
```

- `sepBy(item, sep)` — no trailing separator.
- `sepEndBy` — optional trailing separator (typical for `;`-terminated statements).
- `endBy` — separator mandatory after each item.
- Non-`1` variants succeed with `[]` if the first item fails; `1` variants propagate the failure.

## 7. Lexer → token stream pipeline

```ts
import type { Parser as GenericParser } from "morpheus";
import { Lexer, TokenStream, createCombinators } from "morpheus/lexer";

const lexer = new Lexer({
  num: /\d+/,
  plus: "+",
  lparen: "(",
  rparen: ")",
  ws: /\s+/,
});

const tokens = new TokenStream(
  [...lexer.tokenize("1 + (2 + 3)")].filter(([name]) => name !== "ws"),
);

type Token = (typeof tokens)["tokens"][number];
const { token, chainl1, map, between, oneOf, ref } = createCombinators<Token>();

const expr: GenericParser<number, Token> = ref((self) => {
  const parens = between(token("lparen"), self, token("rparen"));
  const atom = oneOf([parens, map(token("num"), Number)]);
  const plus = map(token("plus"), () => (l: number, r: number) => l + r);
  return chainl1(atom, plus);
});

runParser(expr, tokens); // 6
```

Every combinator a token stream needs must come from `createCombinators<Token>()` (including
`ref`, `oneOf`, `between`, `chainl1`); the ones from `morpheus/string` are bound to `Tok = string`
and will not typecheck against token parsers.

Notes:

- Rules are ordered; put `""`-prefix-free, longer literals first
  (`{ eqeq: "==", eq: "=" }`).
- The lexer rejects regexes that can match the empty string, and reports unmatched input as
  `failed to match token at offset N`.
- `token(name)` is typed from the lexer mapping; `regex` rules yield `string`, literal rules
  yield their literal type.
- A `TokenStream` position counts tokens; `new TokenStream(tokens)` accepts a plain array.

## 8. Error reporting

```ts
const number = label(lexeme(map(some(digit), (ds) => Number(ds.join("")))), "number");

// Custom message (survives label).
const even = bind(number, (n) => (n % 2 === 0 ? pure(n) : fail(`expected even number, got ${n}`)));
```

- `label(p, "x")` replaces `expected`/`message` only when `p` fails without consuming input
  (or with no expectations). Deeper errors keep their more precise `expected`.
- `fail("...")` produces a `ParseError` at the current position with your message; `label` will
  not overwrite it.
- `lookAhead(p)` succeeds without consuming; `notFollowedBy(p)` fails with
  `Unexpected input at position N` when `p` would match.

```ts
const division = keepLeft(string("/"), notFollowedBy(string("/"))); // not "//"
const peeked = seq([lookAhead(enumOf(["==", "="])), enumOf(["==", "="])]);
```

## 9. Testing parsers

```ts
import { describe, expect, test } from "bun:test";
import { UnexpectedInput } from "morpheus";

test("accepts", () => {
  expect(runParser(number, new StringStream("42"))).toBe(42);
});

test("reports the position", () => {
  const out = number(new StringStream("x"));
  expect(out).toBeInstanceOf(UnexpectedInput);
  expect((out as UnexpectedInput).position).toBe(0);
  expect((out as UnexpectedInput).expected).toEqual(["number"]);
});

test("rejects trailing input", () => {
  expect(() => runParser(number, new StringStream("42x"))).toThrow(UnexpectedInput);
});
```

Call the parser function directly to inspect the `ParseError`; `runParser` throws instead.

## 10. Choosing between combinators

| Situation                             | Use                    |
| ------------------------------------- | ---------------------- |
| Ordered alternatives, want best error | `oneOf`                |
| Optional prefix                       | `optional`             |
| Zero-or-more, stop at first failure   | `many` / `sepBy`       |
| Structural delimiters, keep middle    | `between` / `keepOnly` |
| Line/statement terminators            | `sepEndBy` / `endBy`   |
| Binary operators with precedence      | `pratt`                |
| Left/right folding without precedence | `chainl1` / `chainr1`  |
| Recursive grammar                     | `ref`                  |
| Dynamic next parser from a value      | `bind`                 |

Avoid `many(optional(...))`: the zero-progress guard stops it, and it always yields `undefined`.
