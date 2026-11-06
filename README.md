# morpheus

A parser combinator library for TypeScript, inspired by Haskell's parser
combinators.

## Usage

```ts
import { runParser } from "morpheus";
import { StringStream, char, many, seq } from "morpheus/string";

const parser = seq([char("a"), many(char("b"))]);
const result = runParser(parser, new StringStream("abbb")); // [["a", ["b", "b", "b"]], ...]
```

## Tests

A complete JSON parser built entirely with the library's combinators lives in
[`tests/json.test.ts`](tests/json.test.ts). Run it with:

```bash
bun test
```

## Development

```bash
bun install
bun run build
```
