import type { Stream, EOS } from "../stream";
import { eos } from "../stream";

export class StringStream implements Stream<string, string> {
  constructor(
    public readonly input: string,
    public readonly position: number = 0,
  ) {}

  peek(): string | EOS;
  peek(n: number): string | EOS;
  peek(n = 1): string | EOS {
    if (n === 1) {
      const ch = this.input[this.position];
      return ch === undefined ? eos : ch;
    }
    if (this.position + n > this.input.length) return eos;
    return this.input.slice(this.position, this.position + n);
  }

  consume(): StringStream;
  consume(n: number): StringStream;
  consume(n = 1): StringStream {
    if (n === 0) return this;
    return new StringStream(this.input, this.position + n);
  }
}
