import type { Stream, EOS } from "../stream";
import { eos } from "../stream";

export class StringStream implements Stream<string> {
  constructor(
    public readonly input: string,
    private cursor: number = 0,
  ) {}

  peek(): string | EOS {
    const ch = this.input[this.cursor];
    return ch === undefined ? eos : ch;
  }

  consume(): StringStream {
    return new StringStream(this.input, this.cursor + 1);
  }
}
