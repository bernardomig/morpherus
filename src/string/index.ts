import { type Parser as GenericParser } from "../parser";

export type Parser<T> = GenericParser<T, string>;

export * from "./combinators";
export * from "./stringstream";
