const UNKNOWN = Symbol("unknown markup context");
const LIMIT = Symbol("automatic markup budget exceeded");
const MAX_NAME = 4096;
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

class SourceScanner {
  constructor(
    source,
    {
      signal,
      maxUnits = 4 * 1024 * 1024,
      maxMilliseconds = 100,
      maxTokens = 16384,
      maxDepth = 512,
      maxName = MAX_NAME,
    } = {},
  ) {
    this.source = source;
    this.signal = signal;
    this.remaining = maxUnits;
    this.deadline = performance.now() + maxMilliseconds;
    this.tokens = maxTokens;
    this.maxDepth = maxDepth;
    this.maxName = maxName;
    this.start = -1;
    this.text = "";
  }

  read(offset) {
    if (--this.remaining < 0) throw LIMIT;
    if (offset < 0 || offset >= this.source.length) return "";
    if (offset < this.start || offset >= this.start + this.text.length) {
      this.start = Math.floor(offset / 16384) * 16384;
      this.text = this.source.slice(this.start, Math.min(this.source.length, this.start + 16384));
    }
    return this.text[offset - this.start];
  }

  async run(iterator) {
    let nextYield = performance.now() + 4;
    try {
      for (;;) {
        this.signal?.throwIfAborted();
        if (this.remaining < 0 || performance.now() > this.deadline) return UNKNOWN;
        const result = iterator.next();
        if (result.done) return result.value;
        if (performance.now() >= nextYield) {
          await new Promise((resolve) => setImmediate(resolve));
          nextYield = performance.now() + 4;
        }
      }
    } catch (error) {
      if (error === LIMIT) return UNKNOWN;
      throw error;
    } finally {
      iterator.return?.();
    }
  }

  *opening(start, end, { jsx = false } = {}) {
    if (end - start > this.remaining) return UNKNOWN;
    if (end <= start || this.read(end - 1) !== ">") return null;
    let quote = null,
      expressionDepth = 0,
      comment = false,
      candidate = null;
    const consume = (char, index) => {
      if (char === "<") {
        candidate = { name: "", phase: "first", valid: true };
        return;
      }
      if (!candidate) return;
      if (candidate.phase === "closed") {
        candidate.valid = false;
        return;
      }
      if (candidate.phase === "first") {
        if (!/[a-z]/i.test(char)) candidate.valid = false;
        candidate.phase = "name";
      }
      if (candidate.phase === "name" && !/[>\s='"/]/u.test(char)) {
        if (candidate.name.length === this.maxName) throw LIMIT;
        candidate.name += char;
        return;
      }
      candidate.phase = "attributes";
      if (char === "/") candidate.valid = false;
      if (char === ">") {
        candidate.phase = "closed";
        candidate.end = index + 1;
      }
    };
    for (let index = start; index < end; index++) {
      const char = this.read(index),
        next = index + 1 < end ? this.read(index + 1) : "";
      if (comment) {
        consume(" ", index);
        if (char === "*" && next === "/") {
          consume(" ", ++index);
          comment = false;
        }
      } else if (quote) {
        consume(expressionDepth ? " " : char === quote ? char : " ", index);
        if (expressionDepth && char === "\\") {
          consume(" ", ++index);
          continue;
        }
        if (char === quote) quote = null;
      } else if (expressionDepth && char === "/" && next === "*") {
        comment = true;
        consume(" ", index);
        consume(" ", ++index);
      } else if (expressionDepth && char === "/" && next === "/") return null;
      else if (char === '"' || char === "'" || (expressionDepth && char === "`")) {
        quote = char;
        consume(expressionDepth ? " " : char, index);
      } else if (jsx && char === "{") {
        if (++expressionDepth > this.maxDepth) return UNKNOWN;
        consume(" ", index);
      } else if (expressionDepth && char === "}") {
        expressionDepth--;
        consume(" ", index);
      } else consume(expressionDepth ? " " : char, index);
      if ((index - start) % 2048 === 0) yield;
    }
    return quote ||
      expressionDepth ||
      comment ||
      !candidate?.valid ||
      candidate.phase !== "closed" ||
      candidate.end !== end ||
      !candidate.name
      ? null
      : candidate.name;
  }

  *skipUntil(index, delimiter) {
    let tail = "";
    for (; index < this.source.length; index++) {
      const char = this.read(index);
      tail = (tail + char).slice(-delimiter.length);
      if (tail === delimiter) return index + 1;
      if (index % 2048 === 0) yield;
    }
    return this.source.length;
  }

  *nextToken(index) {
    const source = this.source;
    while (index < source.length) {
      // All lookahead remains bounded. Text between tags can be skipped by
      // native indexOf, but exhausting its budget means unknown, not absence.
      const end = Math.min(source.length, index + 16384);
      const text = source.slice(index, end),
        found = text.indexOf("<");
      this.remaining -= found < 0 ? text.length : found + 1;
      if (this.remaining < 0) return UNKNOWN;
      if (found < 0) {
        index = end;
        yield;
        continue;
      }
      const start = index + found;
      index = start + 1;
      const prefix = source.slice(start, Math.min(source.length, start + 9));
      if (prefix.startsWith("<!--")) {
        index = yield* this.skipUntil(start + 4, "-->");
        yield;
        continue;
      }
      if (prefix.toUpperCase().startsWith("<![CDATA[")) {
        index = yield* this.skipUntil(start + 9, "]]>");
        yield;
        continue;
      }
      const closing = this.read(index) === "/";
      if (closing) index++;
      if (!/[a-z]/i.test(this.read(index))) continue;
      let name = "";
      while (index < source.length && /[\w:.-]/.test(this.read(index))) {
        if (name.length === this.maxName) return UNKNOWN;
        name += this.read(index++);
        if (index % 2048 === 0) yield;
      }
      let char = this.read(index),
        selfClosing = false;
      if (char === "/" && this.read(index + 1) === ">") {
        selfClosing = true;
        index++;
        char = ">";
      }
      if (char !== ">") {
        if (!/\s/u.test(char) || !char) continue;
        let quote = null,
          lastNonWhitespace = "";
        for (; index < source.length; index++) {
          char = this.read(index);
          if (quote) {
            if (char === quote) quote = null;
          } else if (char === "'" || char === '"') quote = char;
          else if (char === "<" || char === ">") break;
          if (!/\s/u.test(char)) lastNonWhitespace = char;
          if (index % 2048 === 0) yield;
        }
        if (quote) return UNKNOWN;
        if (char !== ">") {
          if (index >= source.length) return null;
          continue;
        }
        selfClosing = lastNonWhitespace === "/";
      }
      if (--this.tokens < 0) return UNKNOWN;
      return { name, closing, selfClosing, end: index + 1 };
    }
    return null;
  }

  *hasClosing(start, tag, { caseSensitive = false, neverClose = [] } = {}) {
    const normalize = (name) => (caseSensitive ? name : name.toLowerCase());
    const stack = [normalize(tag)];
    let rawTag = RAW_TEXT.has(tag.toLowerCase()) ? normalize(tag) : null;
    for (let index = start; index < this.source.length;) {
      const token = yield* this.nextToken(index);
      if (token === UNKNOWN) return UNKNOWN;
      if (!token) return false;
      index = token.end;
      const name = normalize(token.name);
      if (rawTag) {
        if (!token.closing || name !== rawTag) continue;
        rawTag = null;
      }
      if (token.closing) {
        if (name !== stack.at(-1)) return false;
        stack.pop();
        if (!stack.length) return true;
      } else if (!token.selfClosing && !neverClose.includes(token.name.toLowerCase())) {
        if (stack.length === this.maxDepth) return UNKNOWN;
        stack.push(name);
        if (RAW_TEXT.has(token.name.toLowerCase())) rawTag = name;
      }
      yield;
    }
    return false;
  }
}

module.exports = { SourceScanner, UNKNOWN, MAX_NAME };
