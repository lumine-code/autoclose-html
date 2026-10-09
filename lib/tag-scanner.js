// Finds the opening tag that a just-typed `>` completes.
//
// The whole scanner is pure text -> tag name, which is what makes it testable
// without an editor.

// A `<`, not followed by `!` or `/` (so neither a comment/doctype nor a closing
// tag), then the element name, then anything that is not `>` or `/` -- the `/`
// exclusion is what rejects an already self-closed `<br />`.
// Capture the name atomically so a rejected slash cannot repeatedly repartition
// a long name between the two otherwise overlapping repetitions.
const OPENING_TAG = /<(?![!/])(?=([a-z][^>\s='"/]*))\1[^>/]*>$/i;

// Blanks out quoted attribute values, keeping the string the same length so
// column offsets stay meaningful. Returns null when a quote is left open, which
// means the caller's `>` sits inside an attribute value rather than closing a
// tag.
//
// Upstream searched for the last `<` first and only then looked at quotes, so
// `<div title="a<b">` found the `<` *inside* the value, and the odd-quote guard
// then rejected the tag outright. Masking first gets that case right.
// JSX expressions are masked too, including nested objects, escaped strings,
// templates and comments. An unfinished expression cannot complete a tag.
function maskQuotedValues(text, { jsx = false } = {}) {
  let masked = "";
  let quote = null;
  let expressionDepth = 0;
  let blockComment = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (blockComment) {
      masked += " ";
      if (text.startsWith("*/", index)) {
        masked += " ";
        index++;
        blockComment = false;
      }
    } else if (quote) {
      masked += expressionDepth ? " " : character === quote ? character : " ";
      if (expressionDepth && character === "\\") {
        masked += " ";
        index++;
        continue;
      }
      if (character === quote) quote = null;
    } else if (expressionDepth && text.startsWith("/*", index)) {
      blockComment = true;
      masked += "  ";
      index++;
    } else if (expressionDepth && text.startsWith("//", index)) {
      masked += " ".repeat(text.length - index);
      break;
    } else if (character === '"' || character === "'" || (expressionDepth && character === "`")) {
      quote = character;
      masked += expressionDepth ? " " : character;
    } else if (jsx && character === "{") {
      expressionDepth++;
      masked += " ";
    } else if (expressionDepth && character === "}") {
      expressionDepth--;
      masked += " ";
    } else {
      masked += expressionDepth ? " " : character;
    }
  }

  return quote || expressionDepth || blockComment ? null : masked;
}

// Given the text of a line and a column immediately after a `>`, returns the
// name of the opening tag that `>` closed, or null when it closed nothing that
// wants a closing tag.
function openingTagBefore(lineText, column, options) {
  const upToCursor = lineText.slice(0, column);
  if (!upToCursor.endsWith(">")) return null;

  const masked = maskQuotedValues(upToCursor, options);
  if (masked === null) return null;

  const start = masked.lastIndexOf("<");
  // Upstream indexed with the raw -1 here, and `substr(-1)` quietly handed the
  // regex the final character of the line instead of bailing out.
  if (start === -1) return null;

  const match = OPENING_TAG.exec(masked.slice(start));
  return match ? match[1] : null;
}

const MARKUP_TOKEN =
  /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<(\/?)([a-z][\w:.-]*)(?:\s(?:"[^"]*"|'[^']*'|[^"'<>])*)?\/?>/gi;
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

// Conservative fallback for a grammar with no syntax tree. Nest every element,
// not just names matching the candidate, so a later unrelated close cannot win.
function hasMatchingClosingTag(text, tag, { caseSensitive = false, neverClose = [] } = {}) {
  const normalize = (name) => (caseSensitive ? name : name.toLowerCase());
  const stack = [normalize(tag)];
  let rawTag = RAW_TEXT_ELEMENTS.has(tag.toLowerCase()) ? normalize(tag) : null;

  for (const match of text.matchAll(MARKUP_TOKEN)) {
    if (!match[2]) continue;
    const closing = match[1] === "/";
    const name = normalize(match[2]);
    if (rawTag) {
      if (!closing || name !== rawTag) continue;
      rawTag = null;
    }
    if (closing) {
      if (name !== stack.at(-1)) return false;
      stack.pop();
      if (stack.length === 0) return true;
    } else if (!/\/\s*>$/.test(match[0]) && !neverClose.includes(match[2].toLowerCase())) {
      stack.push(name);
      if (RAW_TEXT_ELEMENTS.has(match[2].toLowerCase())) rawTag = name;
    }
  }
  return false;
}

module.exports = { OPENING_TAG, maskQuotedValues, openingTagBefore, hasMatchingClosingTag };
