// Finds the opening tag that a just-typed `>` completes.
//
// The whole scanner is pure text -> tag name, which is what makes it testable
// without an editor.

// A `<`, not followed by `!` or `/` (so neither a comment/doctype nor a closing
// tag), then the element name, then anything that is not `>` or `/` -- the `/`
// exclusion is what rejects an already self-closed `<br />`.
const OPENING_TAG = /<(?![!/])([a-z][^>\s='"/]*)[^>/]*>$/i;

// Blanks out quoted attribute values, keeping the string the same length so
// column offsets stay meaningful. Returns null when a quote is left open, which
// means the caller's `>` sits inside an attribute value rather than closing a
// tag.
//
// Upstream searched for the last `<` first and only then looked at quotes, so
// `<div title="a<b">` found the `<` *inside* the value, and the odd-quote guard
// then rejected the tag outright. Masking first gets that case right.
function maskQuotedValues(text) {
  let masked = "";
  let quote = null;

  for (const character of text) {
    if (quote) {
      masked += character === quote ? character : " ";
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
      masked += character;
    } else {
      masked += character;
    }
  }

  return quote ? null : masked;
}

// Given the text of a line and a column immediately after a `>`, returns the
// name of the opening tag that `>` closed, or null when it closed nothing that
// wants a closing tag.
function openingTagBefore(lineText, column) {
  const upToCursor = lineText.slice(0, column);
  if (!upToCursor.endsWith(">")) return null;

  const masked = maskQuotedValues(upToCursor);
  if (masked === null) return null;

  const start = masked.lastIndexOf("<");
  // Upstream indexed with the raw -1 here, and `substr(-1)` quietly handed the
  // regex the final character of the line instead of bailing out.
  if (start === -1) return null;

  const match = OPENING_TAG.exec(masked.slice(start));
  return match ? match[1] : null;
}

module.exports = { OPENING_TAG, maskQuotedValues, openingTagBefore };
