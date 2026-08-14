# autoclose-html

Close HTML and XML tags automatically as you type.

Finish an opening tag and its closing tag appears behind the cursor. Block elements get theirs on a line of its own with the cursor waiting, indented, between the two; inline elements get theirs right where the cursor already is.

## Features

- **Automatic closing**: writes the closing tag the moment an opening tag is finished.
- **Block and inline layout**: block elements open out over three lines, inline elements close on the spot.
- **Void elements**: elements that take no closing tag are left alone, or rewritten to close themselves.
- **Attribute aware**: a `>` inside a quoted attribute value never reads as the end of a tag.
- **Multiple cursors**: every cursor gets its own closing tag, in a single undo step.
- **Grammar scoped**: only the grammars you list get closing tags, so a comparison in a script is safe.

## Installation

To install `autoclose-html` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/autoclose-html`.

## Commands

Commands available in `lumine-workspace`:

- `autoclose-html:toggle`: turn automatic closing on or off.

## Usage

Closing tags are written for the grammars named in the `grammars` setting, which covers HTML, XML, EJS, ERB, Mustache, PHP and TSX out of the box. `source.js` is deliberately absent: in plain JavaScript a comparison such as `a < b > c` reads exactly like a tag, so add it only if you write JSX in `.js` files.

Whether a closing tag lands on its own line follows the element's default display, with `forceInline` and `forceBlock` to overrule it per element. Elements listed in `neverClose` take no closing tag at all and are instead rewritten to close themselves, so `<br>` becomes `<br />`.

For closing a tag on demand rather than as you type — including one you opened much earlier — the `bracket-matcher` package's `close-tag` command does that.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
