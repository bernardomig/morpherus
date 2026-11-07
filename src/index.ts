import { eos } from "./stream";
import type { EOS, Stream } from "./stream";
import { runParser, ParseError, UnexpectedEOS, UnexpectedInput } from "./parser";
import type { Parser, ParseResult, ParserType, TokenOf } from "./parser";

export { eos, runParser, ParseError, UnexpectedEOS, UnexpectedInput };
export type { EOS, Stream, Parser, ParseResult, ParserType, TokenOf };
export * from "./combinators";
