const { CompositeDisposable } = require("lumine");
const { openingTagBefore, hasMatchingClosingTag } = require("./tag-scanner");
const { isInline, isNeverClosed } = require("./tags");

const OPEN_TAG_TYPES = new Set(["start_tag", "jsx_opening_element", "STag"]);
const CLOSE_TAG_TYPES = new Set(["end_tag", "jsx_closing_element", "ETag"]);

function tagName(node) {
  return (
    node?.childForFieldName("name") ??
    node?.namedChildren.find((child) => ["tag_name", "Name"].includes(child.type))
  )?.text;
}

function parsedTagAt(editor, position) {
  const node = editor.getSyntaxNodeAtBufferPosition([position.row, position.column - 1]);
  const opening = node?.parent;
  if (node?.type !== ">" || !OPEN_TAG_TYPES.has(opening?.type)) return null;
  const tag = tagName(opening);
  if (!tag) return null;
  const element = opening.parent;
  const closing =
    element?.childForFieldName("close_tag") ??
    element?.namedChildren.find((child) => CLOSE_TAG_TYPES.has(child.type));
  const caseSensitive = opening.type !== "start_tag";
  const normalize = (name) => (caseSensitive ? name : name?.toLowerCase());
  return {
    tag,
    hasClosingTag:
      closing != null &&
      closing.endIndex > closing.startIndex &&
      normalize(tagName(closing)) === normalize(tag),
  };
}

function bufferTextAfter(editor, position) {
  const buffer = editor.getBuffer();
  return buffer.getTextInRange([position, buffer.getEndPosition()]);
}

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "autoclose-html",
      tips: [
        "You can have a closing tag written for you as soon as you finish typing an opening one.",
      ],
    };
  },

  activate() {
    this.subscriptions = new CompositeDisposable();
    this.pending = new Map();

    this.subscriptions.add(
      lumine.commands.add("lumine-workspace", {
        "autoclose-html:toggle": () => this.toggle(),
      }),
      lumine.workspace.observeTextEditors((editor) => this.watchEditor(editor)),
    );
  },

  deactivate() {
    this.subscriptions.dispose();
    this.subscriptions = null;
    this.pending.clear();
  },

  toggle() {
    const enabled = !lumine.config.get("autoclose-html.enabled");
    lumine.config.set("autoclose-html.enabled", enabled);
    lumine.notifications.addHint(
      `Closing tags are ${enabled ? "inserted automatically" : "no longer inserted"}.`,
    );
  },

  watchEditor(editor) {
    const editorSubscriptions = new CompositeDisposable();

    editorSubscriptions.add(
      editor.onDidInsertText((event) => this.onDidInsertText(editor, event)),
      editor.onDidDestroy(() => {
        this.pending.delete(editor);
        editorSubscriptions.dispose();
        this.subscriptions.remove(editorSubscriptions);
      }),
    );

    this.subscriptions.add(editorSubscriptions);
  },

  handlesGrammar(editor) {
    const scopeName = editor.getGrammar()?.scopeName;
    if (!scopeName) return false;
    return (lumine.config.get("autoclose-html.grammars") ?? []).includes(scopeName);
  },

  onDidInsertText(editor, event) {
    // A typed `>` is the only thing that inserts exactly that one character, so
    // this doubles as the trigger test and as the guard keeping the closing tag
    // this package writes from arriving back here.
    if (event?.text !== ">") return;
    if (!lumine.config.get("autoclose-html.enabled")) return;
    if (!this.handlesGrammar(editor)) return;

    // `did-insert-text` is emitted from inside `mutateSelectedText`, once per
    // selection, while the editor is still iterating them. Editing the buffer
    // from here would mutate that collection mid-walk, so the work is deferred
    // to a microtask and runs once the whole `insertText` call has returned.
    let positions = this.pending.get(editor);
    if (!positions) {
      positions = [];
      this.pending.set(editor, positions);
      Promise.resolve().then(() => this.flush(editor));
    }
    positions.push(event.range.end);
  },

  async flush(editor) {
    const positions = this.pending.get(editor);
    this.pending.delete(editor);
    if (!positions || editor.isDestroyed()) return;
    const subscriptions = this.subscriptions;
    const buffer = editor.getBuffer();
    const languageMode = buffer.getLanguageMode();
    let changed = false;
    const changes = buffer.onDidChangeText(() => (changed = true));
    subscriptions.add(changes);
    try {
      await languageMode.atTransactionEnd?.();
    } catch {
      return;
    } finally {
      subscriptions.remove(changes);
      changes.dispose();
    }
    if (
      changed ||
      editor.isDestroyed() ||
      this.subscriptions !== subscriptions ||
      buffer.getLanguageMode() !== languageMode ||
      !lumine.config.get("autoclose-html.enabled") ||
      !this.handlesGrammar(editor)
    ) {
      return;
    }
    this.closeTagsAt(editor, positions);
  },

  closeTagsAt(editor, positions) {
    const options = {
      forceInline: lumine.config.get("autoclose-html.forceInline") ?? [],
      forceBlock: lumine.config.get("autoclose-html.forceBlock") ?? [],
      neverClose: lumine.config.get("autoclose-html.neverClose") ?? [],
      selfClose: lumine.config.get("autoclose-html.makeNeverCloseSelfClosing"),
    };

    const entries = positions.map((position) => {
      const parsed = parsedTagAt(editor, position);
      if (parsed) return { position, ...parsed };
      const scopeName = editor.getGrammar()?.scopeName ?? "";
      const jsx = /^source\.(?:tsx|jsx|js)(?:\.|$)/.test(scopeName);
      // A parsed JSX token that is not an opening tag is an expression, a
      // string, or another delimiter. Text heuristics must not override it.
      if (jsx && editor.getSyntaxNodeAtBufferPosition([position.row, position.column - 1])) {
        return { position, tag: null };
      }
      const line = editor.lineTextForBufferRow(position.row);
      const tag = line == null ? null : openingTagBefore(line, position.column, { jsx });
      return {
        position,
        tag,
        hasClosingTag:
          tag != null &&
          hasMatchingClosingTag(bufferTextAfter(editor, position), tag, {
            caseSensitive: jsx || scopeName.startsWith("text.xml"),
            neverClose: options.neverClose,
          }),
      };
    });

    if (!entries.some((entry) => entry.tag)) return;

    // Applied bottom-up, so an insertion can never shift a position that has
    // not been handled yet. The cursor each entry should end on is held by a
    // marker rather than a plain point, because an insertion higher up the
    // buffer still moves the positions already decided further down.
    const bottomUp = [...entries].sort(
      (a, b) => b.position.row - a.position.row || b.position.column - a.position.column,
    );

    editor.transact(() => {
      for (const entry of bottomUp) {
        const cursor = entry.tag ? this.closeTag(editor, entry, options) : entry.position;
        entry.marker = editor.markBufferPosition(cursor, { invalidate: "never" });
      }
    });

    // The `>` landed in its own transaction before parsing. Fold an actual
    // closing edit into it so a single undo removes the whole insertion; a
    // no-op must leave the preceding transaction untouched.
    const inserted = entries.some(({ tag, hasClosingTag }) => {
      if (!tag) return false;
      return isNeverClosed(tag, options.neverClose) ? options.selfClose : !hasClosingTag;
    });
    if (inserted) editor.getBuffer().groupLastChanges();

    const cursors = entries.map((entry) => {
      const position = entry.marker.getHeadBufferPosition();
      entry.marker.destroy();
      return position;
    });

    editor.setCursorBufferPosition(cursors[0]);
    for (const cursor of cursors.slice(1)) editor.addCursorAtBufferPosition(cursor);
  },

  // Writes the closing tag for a single `>` and returns where its cursor
  // belongs afterwards.
  closeTag(editor, { position, tag, hasClosingTag }, options) {
    const buffer = editor.getBuffer();

    if (isNeverClosed(tag, options.neverClose)) {
      if (!options.selfClose) return position;

      // Replace the `>` itself, keeping a single space in front of the slash.
      // Upstream tested the character *after* the one it meant to, so it always
      // added a space and turned `<br >` into `<br  />`.
      const slashStart = [position.row, position.column - 1];
      const preceding = editor.getTextInBufferRange([
        [position.row, Math.max(0, position.column - 2)],
        slashStart,
      ]);
      const replacement = preceding === " " ? "/>" : " />";
      buffer.setTextInRange([slashStart, position], replacement);
      return [position.row, position.column - 1 + replacement.length];
    }

    if (hasClosingTag) return position;

    if (isInline(tag, options)) {
      buffer.insert(position, `</${tag}>`);
      return position;
    }

    const indent = editor.indentationForBufferRow(position.row);
    buffer.insert(position, `\n\n</${tag}>`);
    // Indent explicitly rather than leaning on the grammar's auto-indent: the
    // result is the same for every HTML-ish grammar, respects soft tabs and tab
    // length, and is what a spec can actually assert.
    editor.setIndentationForBufferRow(position.row + 1, indent + 1);
    editor.setIndentationForBufferRow(position.row + 2, indent);
    return [position.row + 1, editor.lineTextForBufferRow(position.row + 1).length];
  },
};
