import type { Stream, EOS } from "../stream";
import { eos } from "../stream";

export class StringStream implements Stream<string> {
  constructor(
    public readonly input: string,
    public readonly position: number = 0,
  ) {}

  peek(): string | EOS {
    const ch = this.input[this.position];
    return ch === undefined ? eos : ch;
  }

  consume(): StringStream {
    return new StringStream(this.input, this.position + 1);
  }
}
