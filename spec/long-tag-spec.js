describe("Autoclose fallback long tag names", () => {
  let main, editor;
  beforeEach(async () => {
    editor = await lumine.workspace.open();
    main = (await lumine.packages.activatePackage("autoclose-html")).mainModule;
    lumine.config.set("autoclose-html.grammars", [editor.getGrammar().scopeName]);
  });

  it("keeps a long explicit self-closing tag unchanged through actual insertion", async () => {
    const name = "a".repeat(1000),
      opening = `<${name}/`;
    editor.setText(opening);
    editor.setCursorBufferPosition([0, opening.length]);
    let finished = false;
    const close = main.closeTagsAt.bind(main);
    spyOn(main, "closeTagsAt").and.callFake((...args) => {
      close(...args);
      finished = true;
    });

    editor.insertText(">");
    await conditionPromise(() => finished, "the real deferred closing pass");

    expect(editor.getText()).toBe(opening + ">");
    expect(editor.getCursorBufferPosition()).toEqual([0, opening.length + 1]);
    editor.undo();
    expect(editor.getText()).toBe(opening);
  });
});
