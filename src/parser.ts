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
  if (s.peek() !== eos) throw new UnexpectedInput(s.position, undefined, undefined, "eof");
  return value;
}

export class ParseError extends Error {
  public expected: string[];

  constructor(
    public readonly position: number,
    message?: string,
    public label?: string,
    expected: string | string[] = [],
  ) {
    const expList = Array.isArray(expected) ? [...expected] : [expected];
    if (expList.length === 0 && label !== undefined) {
      expList.push(label);
    }
    super(
      message ??
        (expList.length > 0 ? `Expected ${expList.join(" or ")} at position ${position}` : undefined),
    );
    this.expected = expList;
  }
}

export class UnexpectedEOS extends ParseError {
  constructor(
    position: number,
    message?: string,
    label?: string,
    expected: string | string[] = [],
  ) {
    super(position, message, label, expected);
  }
}

export class UnexpectedInput extends ParseError {
  constructor(
    position: number,
    message?: string,
    label?: string,
    expected: string | string[] = [],
  ) {
    super(position, message, label, expected);
  }
}
