import type { Stream, EOS } from "../stream";
import { eos } from "../stream";

export class StringStream implements Stream<string> {
  constructor(
    public readonly input: string,
    private cursor: number = 0,
  ) {}

  peek(n: number = 1): string | EOS {
    if (!(this.cursor + n <= this.input.length)) {
      return eos;
    }
    return this.input.slice(this.cursor, this.cursor + n);
  }

  consume(n: number = 1): StringStream {
    return new StringStream(this.input, this.cursor + n);
  }
}
