const path = require("node:path");

describe("autoclose-html with no grammar", () => {
  let editor, main;
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-html");
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    editor = await lumine.workspace.open("null-grammar.html");
  });
  afterEach(() => editor?.destroy());

  it("ignores None even if its scope is configured and drops a queued insertion", async () => {
    const grammar = editor.getGrammar();
    const scopes = lumine.config.get("autoclose-html.grammars");
    lumine.config.set("autoclose-html.grammars", [
      ...scopes,
      lumine.grammars.nullGrammar.scopeName,
    ]);
    try {
      editor.setText("<div");
      editor.setCursorBufferPosition([0, 4]);
      editor.insertText(">");
      editor.setGrammar(lumine.grammars.nullGrammar);
      await flushMicrotasks();
      expect(editor.getText()).toBe("<div>");
      expect(main.handlesGrammar(editor)).toBe(false);
      editor.setGrammar(grammar);
      expect(main.handlesGrammar(editor)).toBe(true);
    } finally {
      lumine.config.set("autoclose-html.grammars", scopes);
    }
  });

  it("retires a queued insertion across None and accepts fresh typing after grammar restoration", async () => {
    jasmine.useRealClock();
    const grammar = editor.getGrammar();
    editor.setText("<div");
    editor.setCursorBufferPosition([0, 4]);
    editor.insertText(">");
    const analyze = spyOn(editor, "analyzeSyntax").and.callThrough();
    editor.setGrammar(lumine.grammars.nullGrammar);
    editor.setGrammar(grammar);
    await flushMicrotasks();
    expect(analyze).not.toHaveBeenCalled();
    expect(editor.getText()).toBe("<div>");
    editor.setText("<span");
    editor.setCursorBufferPosition([0, 5]);
    await editor.whenGrammarSettled();
    editor.insertText(">");
    await conditionPromise(() => editor.getText() === "<span></span>");
    expect(analyze).toHaveBeenCalledTimes(1);
  });
});
