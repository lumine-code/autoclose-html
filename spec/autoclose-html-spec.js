describe("autoclose-html", () => {
  let editor, workspaceElement;

  // Types a `>` at `position` in `text` and waits out the microtask the package
  // defers its edit to.
  async function type(text, position) {
    editor.setText(text);
    editor.setCursorBufferPosition(position ?? [0, text.length]);
    editor.insertText(">");
    await flushMicrotasks();
  }

  beforeEach(async () => {
    workspaceElement = lumine.views.getView(lumine.workspace);
    jasmine.attachToDOM(workspaceElement);

    await lumine.packages.activatePackage("autoclose-html");
    editor = await lumine.workspace.open();

    // Drive the real grammar gate rather than depending on a grammar package
    // being installed alongside this one.
    lumine.config.set("autoclose-html.grammars", [editor.getGrammar().scopeName]);
  });

  describe("activation", () => {
    it("activates and registers its command", () => {
      expect(lumine.packages.isPackageActive("autoclose-html")).toBe(true);
      const commands = lumine.commands
        .findCommands({ target: workspaceElement })
        .map((command) => command.name);
      expect(commands).toContain("autoclose-html:toggle");
    });
  });

  describe("inline elements", () => {
    it("closes on the spot and leaves the cursor between the tags", async () => {
      await type("<span");
      expect(editor.getText()).toBe("<span></span>");
      expect(editor.getCursorBufferPosition().toArray()).toEqual([0, 6]);
    });

    it("closes an element it has never heard of", async () => {
      await type("<my-element");
      expect(editor.getText()).toBe("<my-element></my-element>");
    });

    it("keeps the case the tag was typed in", async () => {
      await type("<SPAN");
      expect(editor.getText()).toBe("<SPAN></SPAN>");
    });

    it("closes a tag carrying attributes", async () => {
      await type('<a href="/x"');
      expect(editor.getText()).toBe('<a href="/x"></a>');
    });
  });

  describe("block elements", () => {
    it("opens out over three lines with the cursor indented between them", async () => {
      await type("<div");
      expect(editor.getText()).toBe("<div>\n  \n</div>");
      expect(editor.getCursorBufferPosition().toArray()).toEqual([1, 2]);
    });

    it("indents relative to the line the tag is on", async () => {
      await type("  <div");
      expect(editor.getText()).toBe("  <div>\n    \n  </div>");
      expect(editor.getCursorBufferPosition().toArray()).toEqual([1, 4]);
    });

    it("respects the editor's tab length", async () => {
      editor.setTabLength(4);
      await type("<div");
      expect(editor.getText()).toBe("<div>\n    \n</div>");
    });

    it("honours forceInline", async () => {
      lumine.config.set("autoclose-html.forceInline", ["div"]);
      await type("<div");
      expect(editor.getText()).toBe("<div></div>");
    });

    it("honours forceBlock", async () => {
      lumine.config.set("autoclose-html.forceBlock", ["span"]);
      await type("<span");
      expect(editor.getText()).toBe("<span>\n  \n</span>");
    });
  });

  describe("elements that take no closing tag", () => {
    it("rewrites them to close themselves", async () => {
      await type("<br");
      expect(editor.getText()).toBe("<br />");
      expect(editor.getCursorBufferPosition().toArray()).toEqual([0, 6]);
    });

    it("does not double a space that is already there", async () => {
      // Upstream tested the character after the one it meant to, so it always
      // added a space and produced `<br  />`.
      await type("<br ");
      expect(editor.getText()).toBe("<br />");
    });

    it("leaves them alone when the setting is off", async () => {
      lumine.config.set("autoclose-html.makeNeverCloseSelfClosing", false);
      await type("<br");
      expect(editor.getText()).toBe("<br>");
      expect(editor.getCursorBufferPosition().toArray()).toEqual([0, 4]);
    });

    it("keeps attributes when closing an input", async () => {
      await type('<input type="text"');
      expect(editor.getText()).toBe('<input type="text" />');
    });
  });

  describe("things that are not opening tags", () => {
    it("ignores a closing tag", async () => {
      await type("</div");
      expect(editor.getText()).toBe("</div>");
    });

    it("ignores a comment and a doctype", async () => {
      await type("<!-- a --");
      expect(editor.getText()).toBe("<!-- a -->");

      await type("<!DOCTYPE html");
      expect(editor.getText()).toBe("<!DOCTYPE html>");
    });

    it("ignores a tag that already closes itself", async () => {
      await type("<br /");
      expect(editor.getText()).toBe("<br />");
    });

    it("ignores a `>` with no tag in front of it", async () => {
      await type("a ");
      expect(editor.getText()).toBe("a >");
    });

    it("ignores a `>` inside an unterminated attribute value", async () => {
      await type('<a title="x');
      expect(editor.getText()).toBe('<a title="x>');
    });

    it("still closes a tag whose attribute value contains angle brackets", async () => {
      await type('<a title="x>y"');
      expect(editor.getText()).toBe('<a title="x>y"></a>');
    });
  });

  describe("grammar scoping", () => {
    it("does nothing in a grammar that is not listed", async () => {
      lumine.config.set("autoclose-html.grammars", ["text.html.basic"]);
      await type("<div");
      expect(editor.getText()).toBe("<div>");
    });

    it("does nothing while disabled", async () => {
      lumine.config.set("autoclose-html.enabled", false);
      await type("<div");
      expect(editor.getText()).toBe("<div>");
    });
  });

  describe("multiple cursors", () => {
    it("closes a tag at every cursor", async () => {
      editor.setText("<div\n<span");
      editor.setCursorBufferPosition([0, 4]);
      editor.addCursorAtBufferPosition([1, 5]);
      editor.insertText(">");
      await flushMicrotasks();

      expect(editor.getText()).toBe("<div>\n  \n</div>\n<span></span>");
      expect(editor.getCursorBufferPositions().map((point) => point.toArray())).toEqual([
        [1, 2],
        [3, 6],
      ]);
    });

    it("keeps a cursor that closed nothing", async () => {
      editor.setText("<span\na ");
      editor.setCursorBufferPosition([0, 5]);
      editor.addCursorAtBufferPosition([1, 2]);
      editor.insertText(">");
      await flushMicrotasks();

      expect(editor.getText()).toBe("<span></span>\na >");
      expect(editor.getCursorBufferPositions().length).toBe(2);
    });
  });

  describe("undo", () => {
    it("takes back the closing tag and the `>` in one step", async () => {
      await type("<div");
      expect(editor.getText()).toBe("<div>\n  \n</div>");

      editor.undo();
      expect(editor.getText()).toBe("<div");
    });
  });

  describe("the toggle command", () => {
    it("flips the enabled setting", () => {
      lumine.config.set("autoclose-html.enabled", true);
      lumine.commands.dispatch(workspaceElement, "autoclose-html:toggle");
      expect(lumine.config.get("autoclose-html.enabled")).toBe(false);

      lumine.commands.dispatch(workspaceElement, "autoclose-html:toggle");
      expect(lumine.config.get("autoclose-html.enabled")).toBe(true);
    });
  });

  describe("teardown", () => {
    it("stops closing tags once deactivated", async () => {
      await lumine.packages.deactivatePackage("autoclose-html");
      await type("<div");
      expect(editor.getText()).toBe("<div>");
    });
  });
});
