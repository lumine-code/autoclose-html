const { CompositeDisposable } = require("lumine");
const { openingTagBefore } = require("./tag-scanner");
const { isInline, isNeverClosed } = require("./tags");

module.exports = {
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
    lumine.notifications.addInfo(
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

  flush(editor) {
    const positions = this.pending.get(editor);
    this.pending.delete(editor);
    if (!positions || editor.isDestroyed()) return;
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
      const line = editor.lineTextForBufferRow(position.row);
      return { position, tag: line == null ? null : openingTagBefore(line, position.column) };
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

    // The `>` landed in its own transaction one microtask ago. Fold this one
    // into it so a single undo takes back the whole tag rather than leaving the
    // opening tag stranded without its pair.
    editor.getBuffer().groupLastChanges();

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
  closeTag(editor, { position, tag }, options) {
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
