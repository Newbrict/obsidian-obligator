# Obligator

Obligator replaces and extends the function of the built in daily-notes plugin.
With this plugin, you can specify a starting and terminal header in a daily
note template which will contain your to-do items.

Unchecked to-do items will be copied over to the new daily note, along with all
of the headings and formatting structure you used to organize them. It is a
convenient way to manage your to-do list, and leaves you with running history
of to-do items that you can reference if you need to.

![](preview.gif)

## How to use Obligator

When you click the carrot icon, if today's note doesn't already exist, a new
note file will be made reflecting today's date. All items between the specified
header and the terminal header will be copied over, except for finished to-dos.

### Template variables
 * {{date}}, {{time}}, and {{title}} work as they normally would.


 * {{previous_note}} and {{previous_note_path}} create back-links to the
   previous note from the current note. If there is no previous note, then
   these variables will be blank.

## TO-DO
* Make the fold state carry over to the new note
* Add a recurring note template
* Figure out how to make this work on the phone
* Add a check that forces the terminal heading to come after the obligator
heading

## Building
* `yarn install` (install dependencies)
* `yarn run dev` (compile typescript to javascript `main.js`)
* restart Obsidian, or toggle on and off the plugin

## Releasing
Update the version numbers in `manifest.json` and `package.json` to match, then:
* git tag -a 1.3.1 -m "1.3.1"
* git push origin 1.3.1

## Attributions
* File suggestions code taken from [mirnovov](https://github.com/mirnovov/obsidian-homepage/blob/main/src/suggest.ts)
