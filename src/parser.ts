import { eos, type Stream } from "./stream";

export type ParseResult<T, Tok> = [T, Stream<Tok>] | ParseError;
export type Parser<T, Tok> = (stream: Stream<Tok>) => ParseResult<T, Tok>;

// Utility types
export type ParserType<P extends Parser<any, any>> = P extends Parser<infer T, any> ? T : never;

// run parser
export function runParser<T, Tok>(parser: Parser<T, Tok>, stream: Stream<Tok>): T {
  const out = parser(stream);
  if (out instanceof ParseError) throw out;
  const [value, s] = out;
  if (s.peek() !== eos) throw new UnexpectedInput(s.position);
  return value;
}

export class ParseError extends Error {
  constructor(
    public readonly position: number,
    message?: string,
  ) {
    super(message);
  }
}

export class UnexpectedEOS extends ParseError {
  constructor(position: number, message?: string) {
    super(position, message);
  }
}

export class UnexpectedInput extends ParseError {
  constructor(position: number, message?: string) {
    super(position, message);
  }
}
