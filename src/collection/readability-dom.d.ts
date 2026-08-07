declare module "@mozilla/readability/JSDOMParser.js" {
  interface ParsedDocument {
    documentElement: unknown;
  }

  export default class JSDOMParser {
    parse(input: string): ParsedDocument;
  }
}

