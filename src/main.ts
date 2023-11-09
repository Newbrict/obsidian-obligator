import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFolder,
	TFile,
	MomentFormatComponent,
	normalizePath
} from 'obsidian';

import {
	FileSuggest,
	FolderSuggest
} from "./ui";

import {
	HEADING_REGEX_GLOBAL,
	OBLIGATION_REGEX,
	CHECKEDBOX_REGEX,
	structurize,
	destructure,
	merge_structure,
	filter_structure,
	cron_segment_to_list,
	should_trigger_obligation
} from "./note_utils"

interface ObligatorSettings {
	terminal: string;
	date_format: string;
	template_path: string;
	note_path: string;
	archive: boolean;
	archive_path: string;
	delete_empty_headings: boolean;
}

const DEFAULT_SETTINGS: ObligatorSettings = {
	terminal: "",
	date_format: "YYYY-MM-DD",
	template_path: "",
	note_path: "",
	archive: false,
	archive_path: "",
	delete_empty_headings: true
}

export default class Obligator extends Plugin {
	settings: ObligatorSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon. This function is called
		// when the user clicks the icon.
		const ribbonIconEl = this.addRibbonIcon('carrot', `Open today's obligator note`, async (evt: MouseEvent) => {

			// ----------------------------------------------------------------
			// Basic logical overview
			// ----------------------------------------------------------------
			// 1. Check that all of the settings are correctly set, and
			//    initialize some basic values we'll need later.
			// 2. Switch to today's note if it already exists.
			// 3. Process the last note, if there is one.
			// 4. Process the template file.
			// 5. Merge the contents of the last note into the template.
			// ----------------------------------------------------------------
			// Step 1
			// ----------------------------------------------------------------

			// Make sure the note path is set, if not, error.
			if (["", null].includes(this.settings.note_path)) {
				new Notice(`You must specify a note path in the settings.`);
				return;
			}

			// Make sure the note folder exists
			const NOTE_FOLDER = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.note_path));
			if (NOTE_FOLDER == undefined) {
				new Notice(`The note path "${this.settings.note_path}" specified in the settings does not exist, aborting...`);
				return;
			}

			// Make sure the terminal is set, if not, error.
			if (this.settings.terminal === "") {
				new Notice("You must specify the terminal heading in the settings.");
				return;
			}

			// Make sure that the template file exists
			const TEMPLATE_FILE = this.app.vault.getAbstractFileByPath(`${this.settings.template_path}.md`);
			if (TEMPLATE_FILE == undefined) {
				if (["", null].includes(this.settings.template_path)) {
					new Notice(`You must specify a template file in the settings.`);
				} else {
					new Notice(`The template file "${this.settings.template_path}" specified in the settings does not exist.`);
				}
				return;
			}
			if (!(TEMPLATE_FILE instanceof TFile)) {
				new Notice(`${this.settings.template_path} is not a regular file! Aborting.`);
				return;
			}

			// Make sure that the archive path is set if the archive option is on.
			if (this.settings.archive) {
				if (["", null].includes(this.settings.archive_path)) {
					new Notice("The archive path must be specified when the archive option is turned on, aborting.");
					return;
				}
			}

			// Make sure the default value is applied if it's left blank
			const NOW = window.moment();
			const DATE_FORMAT = this.settings.date_format || DEFAULT_SETTINGS.date_format;
			const NOTE_NAME = NOW.format(DATE_FORMAT);
			const ACTIVE_LEAF = this.app.workspace.getLeaf();

			// ----------------------------------------------------------------
			// Step 2
			// Context: settings are valid
			// ----------------------------------------------------------------
			const NEW_NOTE_PATH = `${this.settings.note_path}/${NOTE_NAME}.md`
			let output_file = this.app.vault.getAbstractFileByPath(NEW_NOTE_PATH);
			if (output_file != undefined && output_file instanceof TFile) {
				await ACTIVE_LEAF.openFile(output_file);
				return;
			}

			// ----------------------------------------------------------------
			// Step 3
			// Context: settings are valid, new note doesn't exist.
			// ----------------------------------------------------------------
			// Get a list of all the files in the daily notes directory
			let notes: TFile[] = [];
			if (NOTE_FOLDER instanceof TFolder) {
			  for (let child of NOTE_FOLDER.children) {
					if(child instanceof TFile) {
						notes.push(child);
					}
				}
			}
			notes.sort((a, b) =>
				window.moment(b.basename, this.settings.date_format).valueOf()
			  - window.moment(a.basename, this.settings.date_format).valueOf()
			);

			// Get the last note that's not today's.
			let last_note = null;
			for (let i=0; i < notes.length; i++) {
				if (window.moment(notes[i].basename, this.settings.date_format).isBefore(NOW, 'day')) {
					last_note = notes[i];
					break;
				}
			}

			let last_note_structure = null;

			if (last_note) {
				const last_note_content = await this.app.vault.read(last_note);
				const last_note_lines = last_note_content.split('\n')
				const last_note_terminal_index = last_note_lines.indexOf(this.settings.terminal);
				if (last_note_terminal_index === -1) {
					new Notice(`${last_note.basename} does not contain the
					   specified terminal heading... aborting.`);
					return;
				}
				last_note_structure = structurize(last_note_lines.slice(0, last_note_terminal_index))
			}

			// ----------------------------------------------------------------
			// Step 4
			// Context: settings are valid, new note doesn't exist,
			//          last note has been processed
			// ----------------------------------------------------------------
			let template_contents = await this.app.vault.read(TEMPLATE_FILE);

			// ------------------------------------------------------------
			// {{ date }} macro
			// ------------------------------------------------------------
			template_contents = template_contents.replace(/{{\s*date:?(.*?)\s*}}/g, (_, format) => {
				if (format) {
					return NOW.format(format)
				} else {
					// default format
					return NOW.format("YYYY-MM-DD")
				}
			});

			// ------------------------------------------------------------
			// {{ time }} macro
			// ------------------------------------------------------------
			template_contents = template_contents.replace(/{{\s*time:?(.*?)\s*}}/g, (_, format) => {
				if (format) {
					return NOW.format(format)
				} else {
					// default format
					return NOW.format("HH:mm")
				}
			});

			// ------------------------------------------------------------
			// {{ title }} macro
			// ------------------------------------------------------------
			template_contents = template_contents.replace(/{{\s*title\s*}}/g, NOTE_NAME);

			// ------------------------------------------------------------
			// {{ previous_note }} and {{ previous_note_path }} macros
			// ------------------------------------------------------------
			if (last_note === null) {
				template_contents = template_contents.replace(/{{\s*previous_note\s*}}/g, "");
				template_contents = template_contents.replace(/{{\s*previous_note_path\s*}}/g, "");
			} else {
				template_contents = template_contents.replace(/{{\s*previous_note\s*}}/g, last_note.basename);
				template_contents = template_contents.replace(/{{\s*previous_note_path\s*}}/g, last_note.path);
			}

			// ------------------------------------------------------------
			// {{ obligate }} macro
			// ------------------------------------------------------------
			const template_lines = template_contents.split('\n')
			let processed_lines = [];
			for (let i = 0; i < template_lines.length; i++) {
				const line = template_lines[i];
				// If this is an obligator line, then go ahead and run the
				// logic which deterimnes if we should now obligate
				if (OBLIGATION_REGEX.test(line)) {
					// Increment the iterator so we skip over the next line
					i++;
					let should_trigger = should_trigger_obligation(line, NOW);
					// If there is no source note, then we would only
					// trigger above.
					if (!should_trigger && last_note) {
						// Walk forward from the source note date (+1) and
						// check every skipped date.
						let skipped_moment = window.moment(last_note.basename, this.settings.date_format);
						while (skipped_moment.add(1, 'd').isBefore(NOW) && !should_trigger) {
							should_trigger = should_trigger_obligation(line, skipped_moment);
						}
					}
					if (should_trigger) {
						// Increment the iterator and get the next line
						try {
							// This is the NEXT line, since we incremented the iterator above
							processed_lines.push(template_lines[i]);
						} catch (error) {
							new Notice(`Template malformed, "${line}" must be followed by another line`);
							return;
						}
					}
				// Not an obligator line, so just add it.
				} else {
					processed_lines.push(line);
				}
			}

			const PROCESSED_TI = processed_lines.indexOf(this.settings.terminal);
			let template_structure = structurize(processed_lines.slice(0, PROCESSED_TI));
			const OUTPUT_TERMINAL_LINES = processed_lines.slice(PROCESSED_TI)

			// ----------------------------------------------------------------
			// Step 5
			// Context: settings are valid, new note doesn't exist,
			//          last note has been processed,
			//          template has been processed
			// ----------------------------------------------------------------

			if (last_note_structure) {
				merge_structure(
					template_structure,
					last_note_structure
				);
			}

			filter_structure(template_structure, this.settings.delete_empty_headings);
			let new_note_lines = destructure(template_structure).concat(OUTPUT_TERMINAL_LINES);

			output_file = await this.app.vault.create(NEW_NOTE_PATH, new_note_lines.join('\n'));

			if (this.settings.archive && last_note) {
				const archived_note_path = `${this.settings.archive_path}/${last_note.basename}.md`;
				try {
					await this.app.fileManager.renameFile(last_note, archived_note_path);
				} catch (error) {
					new Notice(`A file called ${archived_note_path} already exists, archival skipped.`);
				}
			}

			// Open up the new file
			if (output_file != undefined && output_file instanceof TFile) {
				await ACTIVE_LEAF.openFile(output_file);
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ObligatorSettingTab(this.app, this));

	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class ObligatorSettingTab extends PluginSettingTab {
	plugin: Obligator;

	constructor(app: App, plugin: Obligator) {
		super(app, plugin);
		this.plugin = plugin;
	}
	async is_file(file_path:string) {
		let file = this.app.vault.getAbstractFileByPath(file_path);
		if (file === null) {
			file = this.app.vault.getAbstractFileByPath(`${file_path}.md`);
		}
		if (file === null || !(file instanceof TFile)) {
			return false;
		}
		return true;
	}

	async getHeadings(file_path:string) {
		let file = this.app.vault.getAbstractFileByPath(file_path);
		if (file === null) {
			file = this.app.vault.getAbstractFileByPath(`${file_path}.md`);
		}
		if (file === null || !(file instanceof TFile)) {
			return [];
		}
		const content = await this.app.vault.read(file);
		const headings: {[index:string]:any} = Array.from(content.matchAll(HEADING_REGEX_GLOBAL))
			.reduce((accumulator, [heading], index) => {
				return {...accumulator, [index.toString()]: heading};
		}, {});
		return headings;
	}

	async display(): Promise<void> {
		const {containerEl} = this;

		containerEl.empty();

		// --------------------------------------------------------------------
		// New note file directory
		// --------------------------------------------------------------------
		new Setting(containerEl)
			.setName("New file location")
			.setDesc("New daily notes will be placed here.")
			.addText(text => {
				new FolderSuggest(this.app, text.inputEl);
				text.setValue(this.plugin.settings.note_path)
				    .onChange(async value => {
					this.plugin.settings.note_path = value;
					await this.plugin.saveSettings();
				})
			});

		// --------------------------------------------------------------------
		// Template file
		// --------------------------------------------------------------------
		new Setting(containerEl)
			.setName("Template file")
			.setDesc("New daily notes will utilize the template file specified.")
			.addText(text => {
				new FileSuggest(this.app, text.inputEl);
				text.setValue(this.plugin.settings.template_path)
				.onChange(async value => {
					const check = await this.is_file(value);
					if (check || value === "" ) {
						this.plugin.settings.template_path = value;
						await this.plugin.saveSettings();
						if (check) {
							this.display();
						}
					}
				})
			});

		// --------------------------------------------------------------------
		// New note file date format (file name)
		// --------------------------------------------------------------------
		let date_formatter: MomentFormatComponent;
		const setting_date_format = new Setting(containerEl)
			.setName("Date format")
			.addMomentFormat((format: MomentFormatComponent) => {
				date_formatter = format
					.setDefaultFormat(DEFAULT_SETTINGS.date_format)
					.setPlaceholder(DEFAULT_SETTINGS.date_format)
					.setValue(this.plugin.settings.date_format)
					.onChange(async (value) => {
						this.plugin.settings.date_format = value;
						await this.plugin.saveSettings();
					});
			});

		const date_format_el = setting_date_format.descEl.createEl("b", {
			cls: "u-pop",
			text: "test"
		});
		// @ts-ignore
		date_formatter.setSampleEl(date_format_el);
		setting_date_format.descEl.append(
			"For syntax information, refer to the ",
			setting_date_format.descEl.createEl("a", {
				href: "https://momentjs.com/docs/#/displaying/format/",
				text: "moment documentation"
			}),
			setting_date_format.descEl.createEl("br"),
			"Today's note would look like this: ",
			date_format_el
		);

		// --------------------------------------------------------------------
		// Create the dropdown options for the terminal heading selection
		// --------------------------------------------------------------------
		const headings = await this.getHeadings(this.plugin.settings.template_path);
		const terminal_value = Object.keys(headings)
			.find(key => headings[key] === this.plugin.settings.terminal)
			|| "";
		// --------------------------------------------------------------------
		// The heading which terminates the to-do list items
		// --------------------------------------------------------------------
		new Setting(containerEl)
			.setName('Terminal Heading')
			.setDesc(`The heading from the template which terminates what Obligator will copy. Everything between the start of the note and this heading in your daily note will be copied over.`)
			.addDropdown(dropdown => dropdown
				.addOptions(headings)
				.setValue(terminal_value)
				.onChange(async value => {
					this.plugin.settings.terminal = headings[value] || null;
					await this.plugin.saveSettings();
				})
			);
		// --------------------------------------------------------------------
		// Toggle the archiving function
		// --------------------------------------------------------------------
		new Setting(containerEl)
			.setName("Archive old notes")
			.setDesc(`Enabling this will move the previous to-do note into the
					 directory specified when a new note is created.`)
			.addToggle(toggle => { toggle
				.setValue(this.plugin.settings.archive)
			    .onChange(async value => {
					this.plugin.settings.archive = value;
					await this.plugin.saveSettings();
				})
			})
			.addText(text => {
				new FolderSuggest(this.app, text.inputEl);
				text.setValue(this.plugin.settings.archive_path).onChange(
				async value => {
					this.plugin.settings.archive_path = value;
					await this.plugin.saveSettings();
				})
			});

		// --------------------------------------------------------------------
		// Toggle for the setting to delete empty headings.
		// --------------------------------------------------------------------
		new Setting(containerEl)
			.setName("Delete empty headings")
			.setDesc(`If this is enabled, obligator will automatically delete
					 headings which don't have any non-whitespace children when
					 you create a new daily note. Turning this off will leave
					 all headings untouched, even if they have no contents.`)
			.addToggle(toggle => { toggle
				.setValue(this.plugin.settings.delete_empty_headings)
			    .onChange(async value => {
					this.plugin.settings.delete_empty_headings = value;
					await this.plugin.saveSettings();
			})
		})
	}
}
