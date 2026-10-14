// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-html"],
  viewport: { width: 1100, height: 340 },
  async before() {},
  async prepare(context) {
    const { state, open } = context;
    state.editor = await open("usage/index.html");
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Insert the matching closing tag as an opening tag is completed.",
      timeout: 60000,
      async run(context) {
        const { state } = context;
        {
          state.editor.setCursorBufferPosition([5, 29]);
          state.editor.moveToEndOfLine();
          state.editor.insertText(">");
        }
      },
      ready(context) {
        const { state } = context;
        return Boolean(state.editor.getText().includes("</section>"));
      },
    },
  ],
  async cleanup() {},
};
