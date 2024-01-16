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
	ToggleComponent,
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
	should_trigger_obligation,
	strip_frontmatter
} from "./note_utils"

interface ObligatorSettings {
	initial: string;
	terminal: string;
	date_format: string;
	template_path: string;
	note_path: string;
	archive: boolean;
	archive_path: string;
	archive_date_format: string;
	delete_empty_headings: boolean;
	keep_template_headings: boolean;
	run_on_startup: boolean;
	keep_until_parent_complete: boolean;
}

const DEFAULT_SETTINGS: ObligatorSettings = {
	initial: "",
	terminal: "",
	date_format: "YYYY-MM-DD",
	template_path: "",
	note_path: "",
	archive: false,
	archive_path: "",
	archive_date_format: "YYYY/MM-MMMM/YYYY-MM-DD",
	delete_empty_headings: true,
	keep_template_headings: true,
	run_on_startup: false,
	keep_until_parent_complete: false
}

export default class Obligator extends Plugin {
	settings: ObligatorSettings;

	async onload() {
		await this.loadSettings();

		const run_obligator = async () => {

			// ----------------------------------------------------------------
			// Basic logical overview
			// ----------------------------------------------------------------
			// 1. Check that all of the settings are correctly set, and
			//    initialize some basic values we'll need later.
			// 2. Switch to today's note if it already exists.
			// 3. Process the last note, if there is one.
			// 4. Process the template file.
			// 5. Merge the contents of the last note into the template.
			//    Do the last_note templates, archiving, and open the new file.
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

			// Read the template contents here for checking. It will primarily
			// be used in step 4, though.
			let template_contents = await this.app.vault.read(TEMPLATE_FILE);

			// Make sure the initial / terminal settings are valid.
			if (this.settings.initial === null || this.settings.initial === undefined) {
				this.settings.initial = "";
			}
			if (this.settings.terminal === null || this.settings.terminal === undefined) {
				this.settings.terminal = "";
			}
			await this.saveSettings();
			if (this.settings.terminal != "" && this.settings.initial != "") {
				const check_template_lines = template_contents.split('\n');
				const initial_index = check_template_lines.indexOf(this.settings.initial);
				const terminal_index = check_template_lines.indexOf(this.settings.terminal);
				if (terminal_index <= initial_index) {
					new Notice("The initial heading must preceed the terminal heading. Aborting.");
					return;
				}
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
			const ARCHIVE_DATE_FORMAT = this.settings.archive_date_format || DEFAULT_SETTINGS.archive_date_format;
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
			const find_all_notes = (path:string):TFile[] => {
				const abstract = this.app.vault.getAbstractFileByPath(normalizePath(path));
				let notes: TFile[] = [];
				if (abstract instanceof TFile && abstract.extension === "md") {
					notes.push(abstract);
				} else if (abstract instanceof TFolder) {
					for (let child of abstract.children) {
						notes = notes.concat(find_all_notes(`${path}/${child.name}`));
					}
				}
				return notes;
			}
			const notes = find_all_notes(this.settings.note_path);
			notes.sort((a, b) => {
				const a_name = a.path.slice(this.settings.note_path.length + 1);
				const b_name = b.path.slice(this.settings.note_path.length + 1);
				return window.moment(b_name, this.settings.date_format).valueOf()
					 - window.moment(a_name, this.settings.date_format).valueOf();
			});

			// Get the last note that's not today's.
			let last_note = null;
			for (let i=0; i < notes.length; i++) {
				// Remove the ".md" extension
				const sub_path = notes[i].path.slice(this.settings.note_path.length + 1).slice(0, -3);
				// The final boolean makes the moment parse in strict mode
				const note_moment = window.moment(sub_path, this.settings.date_format, true);
				if (note_moment.isValid() && note_moment.isBefore(NOW, 'day')) {
					last_note = notes[i];
					break;
				}
			}

			let last_note_structure = null;

			if (last_note) {
				const last_note_content = await this.app.vault.read(last_note);
				const last_note_lines = strip_frontmatter(last_note_content.split('\n'));
				let last_note_initial_index = last_note_lines.indexOf(this.settings.initial);
				if (this.settings.initial === "") {
					last_note_initial_index = 0;
				} else if (last_note_initial_index === -1) {
					new Notice(`${last_note.basename} does not contain the specified initial heading... aborting.`);
					return;
				}
				let last_note_terminal_index = last_note_lines.indexOf(this.settings.terminal);
				if (this.settings.terminal === "") {
					last_note_terminal_index = last_note_lines.length;
				} else if (last_note_terminal_index === -1) {
					new Notice(`${last_note.basename} does not contain the specified terminal heading... aborting.`);
					return;
				}
				last_note_structure = structurize(last_note_lines.slice(last_note_initial_index, last_note_terminal_index))
			}

			// ----------------------------------------------------------------
			// Step 4
			// Context: settings are valid, new note doesn't exist,
			//          last note has been processed
			// ----------------------------------------------------------------

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
						const sub_path = last_note.path.slice(this.settings.note_path.length + 1);
						let skipped_moment = window.moment(sub_path, this.settings.date_format);
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

			let processed_initial_index = processed_lines.indexOf(this.settings.initial);
			if (this.settings.initial === "") {
				processed_initial_index = 0;
			} else if (processed_initial_index === -1) {
				new Notice(`${TEMPLATE_FILE.basename} does not contain the specified initial heading... aborting.`);
				return;
			}
			let processed_terminal_index = processed_lines.indexOf(this.settings.terminal);
			if (this.settings.terminal === "") {
				processed_terminal_index = processed_lines.length;
			} else if (processed_terminal_index === -1) {
				new Notice(`${TEMPLATE_FILE.basename} does not contain the specified terminal heading... aborting.`);
				return;
			}
			let template_structure = structurize(processed_lines.slice(processed_initial_index, processed_terminal_index));
			const OUTPUT_INITIAL_LINES = processed_lines.slice(0, processed_initial_index)
			const OUTPUT_TERMINAL_LINES = processed_lines.slice(processed_terminal_index)

			// ----------------------------------------------------------------
			// Step 5
			// Context: settings are valid, new note doesn't exist,
			//          last note has been processed,
			//          template has been processed
			// ----------------------------------------------------------------
			// Delete from last_note_structure only if this setting is true
			if (last_note_structure) {
				if (this.settings.keep_template_headings) {
					filter_structure(last_note_structure,
									 this.settings.delete_empty_headings,
									 this.settings.keep_until_parent_complete);
				}
				merge_structure(
					template_structure,
					last_note_structure
				);
			}

			// Delete from the merged structure is false
			if (!this.settings.keep_template_headings) {
				filter_structure(template_structure,
								 this.settings.delete_empty_headings,
								 this.settings.keep_until_parent_complete);
			}

			let new_note_lines = OUTPUT_INITIAL_LINES.concat(destructure(template_structure)).concat(OUTPUT_TERMINAL_LINES);

			const directories = NEW_NOTE_PATH.split('/').slice(0,-1);
			for (let i = 1; i <= directories.length; i++) {
				const sub_path = directories.slice(0,i).join('/');
				const abstract = this.app.vault.getAbstractFileByPath(normalizePath(sub_path));
				if (abstract === null) {
					this.app.vault.createFolder(sub_path);
				}
			}

			output_file = await this.app.vault.create(NEW_NOTE_PATH, new_note_lines.join('\n'));

			// Open up the new file
			if (output_file != undefined && output_file instanceof TFile) {
				await ACTIVE_LEAF.openFile(output_file);
			}

			// Apply the next_note and next_note_path macros to the old file
			if (last_note instanceof TFile) {
				await this.app.vault.process(last_note, (data) => {
					if (data !== null && output_file instanceof TFile) {
						data = data.replace(/{{\s*next_note\s*}}/g, output_file.basename);
						data = data.replace(/{{\s*next_note_path\s*}}/g, output_file.path);
					}
					return data;
				});
			}

			if (this.settings.archive && last_note) {

				const last_note_name = last_note.path.slice(this.settings.note_path.length + 1);
				const last_note_moment = window.moment(last_note_name, this.settings.date_format);
				const archive_note_name = last_note_moment.format(ARCHIVE_DATE_FORMAT);
				const archive_note_path = `${this.settings.archive_path}/${archive_note_name}.md`;
				try {
					const archive_directories = archive_note_path.split('/').slice(0,-1);
					for (let i = 1; i <= archive_directories.length; i++) {
						const sub_path = archive_directories.slice(0,i).join('/');
						const abstract = this.app.vault.getAbstractFileByPath(normalizePath(sub_path));
						if (abstract === null) {
							await this.app.vault.createFolder(sub_path);
						}
					}
					await this.app.fileManager.renameFile(last_note, archive_note_path);
				} catch (error) {
					new Notice(`A file called ${archive_note_path} already exists, archival skipped.`);
				}
			}

		};

		// This creates an icon in the left ribbon.
		// This function is called when the user clicks the icon.
		const ribbonIconEl = this.addRibbonIcon('carrot', `Open today's obligator note`, run_obligator);

		// Add the command to open today's Obligator note
		this.addCommand({
			id: "obligator-run",
			name: "Open today's note",
			callback: run_obligator
		});

		this.app.workspace.onLayoutReady(async () => {
			// Run obligator if the user has enabled the startup setting.
			if (this.settings.run_on_startup) {
				run_obligator();
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
		// TODO The +1 below is a hack to insert "" at index zero. I should
		// figure out a proper approach.
		let headings: {[index:string]:any} = Array.from(content.matchAll(HEADING_REGEX_GLOBAL))
			.reduce((accumulator, [heading], index) => {
				return {...accumulator, [(index + 1).toString()]: heading};
		}, {});
		headings["0"] = "";
		return headings;
	}

	async display(): Promise<void> {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h1', {text: 'Basic Settings'});
		// --------------------------------------------------------------------
		// New note file directory
		// --------------------------------------------------------------------
		new Setting(containerEl)
			.setName("New file directory")
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
		// Create the dropdown options for the initial / terminal heading selection
		// --------------------------------------------------------------------
		const headings = await this.getHeadings(this.plugin.settings.template_path);
		const terminal_value = Object.keys(headings)
			.find(key => headings[key] === this.plugin.settings.terminal)
			|| "";
		const initial_value = Object.keys(headings)
			.find(key => headings[key] === this.plugin.settings.initial)
			|| "";
		// --------------------------------------------------------------------
		// The heading which initializes the to-do list items
		// --------------------------------------------------------------------
		new Setting(containerEl)
			.setName('Initial Heading')
			.setDesc(`(Optional) The heading from the template which begins what Obligator will copy. Everything before this heading in your note will be ignored. If left blank, Obligator will copy from the beginning of the file.`)
			.addDropdown(dropdown => dropdown
				.addOptions(headings)
				.setValue(initial_value)
				.onChange(async value => {
					this.plugin.settings.initial = headings[value] || null;
					await this.plugin.saveSettings();
				})
			);
		// --------------------------------------------------------------------
		// The heading which terminates the to-do list items
		// --------------------------------------------------------------------
		new Setting(containerEl)
			.setName('Terminal Heading')
			.setDesc(`(Optional) The heading from the template which terminates what Obligator will copy. Everything after this heading in your note will be ignored. If left blank, Obligator will copy to the end of the file.`)
			.addDropdown(dropdown => dropdown
				.addOptions(headings)
				.setValue(terminal_value)
				.onChange(async value => {
					this.plugin.settings.terminal = headings[value] || null;
					await this.plugin.saveSettings();
				})
			);

		// --------------------------------------------------------------------
		// Toggle for running obligator on startup
		// --------------------------------------------------------------------
		new Setting(containerEl)
			.setName("Open Obligator note on startup")
			.setDesc(`Open your Obligator note automatically when you open this vault.`)
			.addToggle(toggle => { toggle
				.setValue(this.plugin.settings.run_on_startup)
			    .onChange(async value => {
					this.plugin.settings.run_on_startup = value;
					await this.plugin.saveSettings();
			})
		})

		containerEl.createEl('h1', {text: 'Archive Settings'});
		// --------------------------------------------------------------------
		// Toggle the archiving function
		// --------------------------------------------------------------------
		new Setting(containerEl)
			.setName("Enable archival of old notes")
			.setDesc(`Enabling this will move the previous to-do note into the
					 directory specified when a new note is created. The note
					 will be renamed according to the date format specified.`)
			.addToggle(toggle => { toggle
				.setValue(this.plugin.settings.archive)
			    .onChange(async value => {
					this.plugin.settings.archive = value;
					await this.plugin.saveSettings();
				})
			});

		// --------------------------------------------------------------------
		// Archive note file directory
		// --------------------------------------------------------------------
		new Setting(containerEl)
			.setName("Archive directory")
			.setDesc(`Archived notes will be moved here.`)
			.addText(text => {
				new FolderSuggest(this.app, text.inputEl);
				text.setValue(this.plugin.settings.archive_path).onChange(
				async value => {
					this.plugin.settings.archive_path = value;
					await this.plugin.saveSettings();
				})
			});

		// --------------------------------------------------------------------
		// Archive note file date format (file name)
		// --------------------------------------------------------------------
		let archive_date_formatter: MomentFormatComponent;
		const setting_archive_date_format = new Setting(containerEl)
			.setName("Archive date format")
			.addMomentFormat((format: MomentFormatComponent) => {
				archive_date_formatter = format
					.setDefaultFormat(DEFAULT_SETTINGS.archive_date_format)
					.setPlaceholder(DEFAULT_SETTINGS.archive_date_format)
					.setValue(this.plugin.settings.archive_date_format)
					.onChange(async (value) => {
						this.plugin.settings.archive_date_format = value;
						await this.plugin.saveSettings();
					});
			});

		const archive_date_format_el = setting_archive_date_format.descEl.createEl("b", {
			cls: "u-pop",
			text: "test"
		});
		// @ts-ignore
		archive_date_formatter.setSampleEl(archive_date_format_el);
		setting_archive_date_format.descEl.append(
			"For syntax information, refer to the ",
			setting_archive_date_format.descEl.createEl("a", {
				href: "https://momentjs.com/docs/#/displaying/format/",
				text: "moment documentation"
			}),
			setting_archive_date_format.descEl.createEl("br"),
			"The archival path for today's note would look like this: ",
			archive_date_format_el
		);


		containerEl.createEl('h1', {text: 'Advanced Settings'});

		let setting_keep_template_headings:Setting;
		let toggle_keep_template_headings:ToggleComponent;
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
					// Make sure the element has been created before using it
					if (setting_keep_template_headings instanceof Setting) {
						if (toggle_keep_template_headings instanceof ToggleComponent) {
							setting_keep_template_headings.setDisabled(!value);
							this.plugin.settings.keep_template_headings = value;
							toggle_keep_template_headings.setValue(value);
							await this.plugin.saveSettings();
						}
					}
			})
		})
		// --------------------------------------------------------------------
		// Toggle for the setting to delete headings
		// --------------------------------------------------------------------
		setting_keep_template_headings = new Setting(containerEl)
			.setName("Don't delete headings from template")
			.setDesc(`This prevents the setting above from deleting any
					 headings which are present in the template`)
			.addToggle(toggle => {toggle
				.setValue(this.plugin.settings.keep_template_headings)
			    .onChange(async value => {
					this.plugin.settings.keep_template_headings = value;
					await this.plugin.saveSettings();
				})
				toggle_keep_template_headings = toggle;
			}).setDisabled(!this.plugin.settings.delete_empty_headings);

		// --------------------------------------------------------------------
		// Toggle for the setting to keep children if the parent isn't complete
		// --------------------------------------------------------------------
		setting_keep_template_headings = new Setting(containerEl)
			.setName("Only delete to-dos when parent is complete")
			.setDesc(`To-dos which are children of other to-dos will not be
					 deleted unless the parent is checked, and all of its
					 children are too. This setting would be used if you want
					 to retain checked to-dos until the whole structure is
					 checked.`)
			.addToggle(toggle => {toggle
				.setValue(this.plugin.settings.keep_until_parent_complete)
			    .onChange(async value => {
					this.plugin.settings.keep_until_parent_complete = value;
					await this.plugin.saveSettings();
				})
			});
	}
}
