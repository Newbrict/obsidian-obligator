# Obligator

Obligator replaces and extends the function of the built in daily-notes plugin.
With this plugin, you can specify a header containing your todo items. Unchecked
todo items will be copied over to the new daily note. This leaves you with a
running history of your todo-list.

![](preview.gif)

Currently, it will copy over everything (except for checked todo-list items)
between the specified header, and the terminal sequence: `----`. This will
be improved soon.


## How to use Obligator

When you click the carrot icon, if today's note doesn't already exist, a new
note file will be made reflecting today's date. All items between the specified
header and the terminal sequence will be copied over, except for finished todos.

---

## TODO

* Add better terminal sequence support
* https://marcus.se.net/obsidian-plugin-docs/publishing/release-your-plugin-with-github-actions
* Right now template variables do not work


## Building
* `yarn install` (install dependencies)
* `yarn run dev` (compile typescript to javascript `main.js`)
* restart Obsidian

### Attributions
* File suggestions code taken from [mirnovov](https://github.com/mirnovov/obsidian-homepage/blob/main/src/suggest.ts)
