# Morpheus — Agent & Developer Guide

**Morpheus** is a TypeScript parser combinator library inspired by Haskell's parser combinator libraries (`Parsec`, `Megaparsec`, `Attoparsec`, and `Control.Applicative`). It supports both scannerless character-by-character parsing (`morpheus/string`) and tokenized stream parsing (`morpheus/lexer`), as well as generic streams (`morpheus`).

---

## Commands & Tooling

- **Runtime & Package Manager:** [Bun](https://bun.com)
- **Install dependencies:** `bun install`
- **Build (`tsc` to `dist/`):** `bun run build`
- **Run tests:** `bun test`

---

## Repository Structure

```text
src/
├── index.ts                # Root package entry ("morpheus"): core types, errors, runParser, generic combinators
├── stream.ts               # Stream<T> interface and `eos` (end-of-stream) unique symbol
├── parser.ts               # Parser<T, Tok>, ParseResult<T, Tok>, runParser, ParseError hierarchy
├── combinators.ts          # Token-agnostic combinators and `createForToken<Tok>()` factory
├── string/
│   ├── index.ts            # Subpath entry ("morpheus/string"): string-specialized Parser<T>, StringStream, string combinators
│   ├── stringstream.ts     # Immutable `StringStream` implementation of `Stream<string>`
│   └── combinators.ts      # String primitives (`char`, `string`, `enumOf`, `satisfies`, `digit`, `letter`, `alpha`) + combinators
└── lexer/
    └── index.ts            # Subpath entry ("morpheus/lexer"): `Lexer`, `TokenStream`, and `createCombinators<T>()`
tests/
├── calculator-pratt.test.ts # Calculator grammar exercising `pratt` and all string/core combinators
└── json.test.ts            # Full RFC-compliant JSON parser test suite
```

---

## Core Architecture & Design Principles

### 1. Immutable `Stream<T>` (`src/stream.ts`)

Every input source implements `Stream<T>`:

```ts
export const eos: unique symbol = Symbol();
export type EOS = typeof eos;

export interface Stream<T> {
  readonly position: number;
  peek(): T | EOS;
  consume(): Stream<T>;
}
```

- **Immutability:** `consume()` **must** return a new `Stream<T>` instance positioned at `this.position + 1` without mutating the current stream instance.
- **Zero-Cost Backtracking:** Because streams are immutable cursor wrappers (`StringStream`, `TokenStream`), combinators like `oneOf`, `optional`, `many`, and `sepBy` backtrack automatically simply by reusing an earlier `Stream<T>` reference.
- **Zero-Progress Detection:** Looping combinators (`many`, `some`, `sepBy1`, `chainl1`, `chainr1`, `pratt`) guard against infinite loops on zero-width inner parsers (e.g. `many(optional(...))`) by checking reference equality (`nextStream === currentStream`) and breaking cleanly.

### 2. `Parser<T, Tok>` & `ParseResult<T, Tok>` (`src/parser.ts`)

```ts
export type ParseResult<T, Tok> = [T, Stream<Tok>] | ParseError;
export type Parser<T, Tok> = (stream: Stream<Tok>) => ParseResult<T, Tok>;
```

- A parser is a pure function from `Stream<Tok>` to either a tuple `[value, remainingStream]` or a `ParseError` instance (never throwing during normal combinator composition).
- `runParser(parser, stream)` executes `parser(stream)`:
  - Throws the `ParseError` if the parser returned one.
  - Verifies the entire stream was consumed (`s.peek() === eos`), throwing `new UnexpectedInput(s.position)` if trailing input remains.
  - Returns the parsed value `T`.

### 3. Error Hierarchy & Furthest-Error Tracking (`src/parser.ts`, `src/combinators.ts`)

- `ParseError(position: number, message?: string, label?: string)`
  - `UnexpectedEOS(position: number, message?: string, label?: string)`
  - `UnexpectedInput(position: number, message?: string, label?: string)`
- All errors carry `readonly position: number` indicating the stream offset where parsing failed, and an optional `label?: string` populated by `label(parser, expected)`.
- **Furthest-Error Selection in `oneOf`:** When all branches in `oneOf` fail, `oneOf` returns the `ParseError` with the largest `position` (preferring `UnexpectedEOS` on ties). This ensures deep syntax errors inside a partially matched branch (like an unclosed `(` in `(1 + 2`) are preserved rather than erased to the start of `oneOf`.

### 4. Currying Token Types via `createForToken<Tok>()` (`src/combinators.ts`)

Because TypeScript lacks partial type application, calling generic combinators directly with a custom token type `Tok` can require repetitive type annotations.

- `createForToken<Tok>()` returns all core combinators pre-bound to `Tok`.
- `src/string/combinators.ts` uses `createForToken<string>()` to export string-specialized combinators.
- `src/lexer/index.ts` exports `createCombinators<T>()` which merges `createForToken<T>()` with a strongly-typed `token(name)` primitive.
- **Important:** Whenever a new combinator is added to `src/combinators.ts`, remember to also add it to:
  1. `createForToken<Tok>()` in `src/combinators.ts`
  2. Destructured exports in `src/string/combinators.ts`

---

## Combinator Reference

### Core Combinators (`src/combinators.ts`)

- **`pure(value)`**: Succeeds without consuming any input, returning `[value, stream]`.
- **`fail(message?)`**: Always fails at the current stream position with `new ParseError(stream.position, message)`.
- **`label(parser, expected)`**: Attaches `label = expected` (and formats `message`) on any `ParseError` returned by `parser`.
- **`lookAhead(parser)`**: Runs `parser` and returns its value on success without advancing the stream (`[value, stream]`).
- **`notFollowedBy(parser)`**: Succeeds with `[undefined, stream]` (without consuming input) only if `parser` fails; otherwise returns `UnexpectedInput(stream.position)`.
- **`map(parser, fn)`**: Transforms the parsed value `I -> O` on success.
- **`bind(parser, fn)`**: Monadic bind (`>>=`). Feeds the result `T` of `parser` into `fn(value)` to dynamically produce the next `Parser<U, Tok>`.
- **`seq([...parsers])` & `ignore(parser)`**: Runs a tuple of parsers in sequence. Any parser wrapped in `ignore(...)` produces the `ignored` symbol (`Ignored`), which is filtered out at **both the TypeScript tuple type level (`Seq<Tok, Ps>`) and runtime**.
- **`oneOf([...parsers])`**: Ordered choice (`<|>`). Returns the first succeeding branch, or the furthest `ParseError` if all fail.
- **`optional(parser)`**: Returns `T | undefined`, succeeding with `[undefined, stream]` without consuming input if `parser` fails.
- **`many(parser)` / `some(parser)`**: 0 or more (`T[]`) / 1 or more (`[T, ...T[]]`) repetitions.
- **`sepBy(item, sep)` / `sepBy1(item, sep)`**: 0 or more (`T[]`) / 1 or more (`[T, ...T[]]`) items separated by `sep`.
- **`sepEndBy(item, sep)` / `sepEndBy1(item, sep)`**: Like `sepBy` / `sepBy1`, additionally consuming an optional trailing separator.
- **`endBy(item, sep)` / `endBy1(item, sep)`**: 0 or more (`T[]`) / 1 or more (`[T, ...T[]]`) items where every item must be terminated by `sep`.
- **`keepOnly(parsers, index)` / `keepLeft(left, right)` / `keepRight(left, right)` / `between(left, parser, right)`**: Runs a sequence of parsers and returns only the selected element's value with exact static type inference (`ParserType<Ps[Ix]>`).
- **`chainl1(item, op)` / `chainr1(item, op)`**: Parses 1+ occurrences of `item` separated by binary operator functions `(left: T, right: T) => T`, folding left- or right-associatively.
- **`pratt(value, operator, priority)`**: Higher-order Pratt precedence-climbing parser. Takes an atom parser `Parser<T, Tok>`, operator parser `Parser<Op, Tok>`, and precedence map `Record<Op, number>`, returning `Parser<PrattTree<T, Op>, Tok>` where `PrattTree<T, Op> = T | [PrattTree<T, Op>, Op, PrattTree<T, Op>]` (left-associative for equal precedence).
- **`ref(fn)`**: Fixed-point combinator for recursive grammars. Memoizes `const parser = fn(self)` once at construction time and forwards recursive calls through `self`.
- **`eof`**: Parser that succeeds with `eos` (`Parser<EOS, Tok>`) only when `stream.peek() === eos`.

### String Primitives (`src/string/combinators.ts`)

- **`char(c, { caseSensitive })`**: Matches a single character `c`, returning the literal type `T`.
- **`string(s, { caseSensitive })`**: Matches an exact string `s` character-by-character, returning the literal type `T`.
- **`enumOf([...strings], { caseSensitive })`**: Matches one of the literal strings, inferred as the union of string literals `VectorEnum<Ts>`.
- **`satisfies(predicate)`**: Matches a single character satisfying `predicate(ch)`.
- **`digit` / `letter` / `alpha`**: Pre-built `satisfies` parsers for `[0-9]`, `[A-Za-z]`, and `[0-9A-Za-z]`.

### Lexer & Token Streams (`src/lexer/index.ts`)

- **`new Lexer(def)`**: Accepts a record mapping token names to non-empty `string` literals or `RegExp` patterns. Pre-compiles sticky (`y`) regexes while preserving user flags (`i`, `u`, `m`, etc.) and guards against zero-length matches.
- **`lexer.tokenize(input)`**: Generator yielding strongly-typed `[tokenName, matchedValue]` tuples.
- **`new TokenStream(tokens)`**: Immutable `Stream<T>` over an array of `[name, value]` tokens.
- **`createCombinators<TokenTuple>()`**: Returns all core combinators alongside `token(name)`, which matches a token by name and resolves to its payload type.
