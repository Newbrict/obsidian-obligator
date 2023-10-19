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

interface ObligatorSettings {
	heading: string;
	terminal: string;
	date_format: string;
	template_path: string;
	note_path: string;
	archive: boolean;
	archive_path: string;
}

const DEFAULT_SETTINGS: ObligatorSettings = {
	heading: "",
	terminal: "",
	date_format: "YYYY-MM-DD",
	template_path: "",
	note_path: "",
	archive: false,
	archive_path: ""
}

export default class Obligator extends Plugin {
	settings: ObligatorSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon. This function is called
		// when the user clicks the icon.
		const ribbonIconEl = this.addRibbonIcon('carrot', `Open today's obligator note`, async (evt: MouseEvent) => {

			const template_file = this.app.vault.getAbstractFileByPath(`${this.settings.template_path}.md`);
			if (template_file == undefined) {
				if (["", null].includes(this.settings.template_path)) {
					new Notice(`You must specify a template file in the settings.`);
				} else {
					new Notice(`The template file "${this.settings.template_path}" specified in the settings does not exist.`);
				}
				return;
			}
			if (!(template_file instanceof TFile)) {
				new Notice(`A file error occurred, please report this to the GitHub.`);
				return;
			}
			let template_contents = await this.app.vault.read(template_file);
			// -----------------------------------------------------------------
			// Fill the template. This isn't done in a separate function because
			// I use a bunch of variables from this function to fill it.
			// Other template variables will be filled in later
			// -----------------------------------------------------------------
			const now = window.moment();
			template_contents = template_contents.replace(/{{date:?(.*?)}}/g, (_, format) => {
				if (format) {
					return now.format(format)
				} else {
					// default format
					return now.format("YYYY-MM-DD")
				}
			});
			template_contents = template_contents.replace(/{{time:?(.*?)}}/g, (_, format) => {
				if (format) {
					return now.format(format)
				} else {
					// default format
					return now.format("HH:mm")
				}
			});

			// Make sure the default value is applied if it's left blank
			let date_format = this.settings.date_format;
			if (date_format == "") {
				date_format = DEFAULT_SETTINGS.date_format;
			}
			const note_name = now.format(date_format);
			template_contents = template_contents.replace(/{{title}}/g, note_name);

			// Get a list of all the files in the daily notes directory
			const notes: TFile[] = [];
			if (["", null].includes(this.settings.note_path)) {
				new Notice(`You must specify a note path in the settings.`);
				return;
			}
			const notes_folder = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.note_path));
			if (notes_folder == undefined) {
				new Notice(`The note path "${this.settings.note_path}" specified in the settings does not exist.`);
				return;
			}
			if (notes_folder instanceof TFolder) {
			  for (let child of notes_folder.children) {
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
			let src_note = null;
			let today = window.moment();
			for (let i=0; i < notes.length; i++) {
				if (window.moment(notes[i].basename, this.settings.date_format).isBefore(today, 'day')) {
					src_note = notes[i];
					break;
				}
			}

			if (src_note === null) {
				template_contents = template_contents.replace(/{{previous_note}}/g, "");
				template_contents = template_contents.replace(/{{previous_note_path}}/g, "");
			} else {
				template_contents = template_contents.replace(/{{previous_note}}/g, src_note.basename);
				template_contents = template_contents.replace(/{{previous_note_path}}/g, src_note.path);
			}

			if (this.settings.heading === "") {
				new Notice("You must specify the obligation heading in the settings.");
				return;
			}
			if (this.settings.terminal === "") {
				new Notice("You must specify the terminal heading in the settings.");
				return;
			}

			const new_note_path = `${this.settings.note_path}/${note_name}.md`
			let output_file = this.app.vault.getAbstractFileByPath(new_note_path);
			let output_lines = template_contents.split('\n')
			// This runs when we're creating the daily note, it should only run
			// once per day, and this is the only time that we should be moving
			// items over from the obligation list, otherwise we'll keep
			// duplicating content.
			if (output_file == undefined) {
				let copy_lines = []
				if (src_note) {
					let src_content = await this.app.vault.read(src_note);
					let src_lines = src_content.split('\n')
					const src_heading_index = src_lines.indexOf(this.settings.heading);
					const src_terminal_index = src_lines.indexOf(this.settings.terminal);
					if (src_heading_index === -1) {
						new Notice("Couldn't find the obligation heading in the last note, aborting.");
						return;
					}
					if (src_terminal_index === -1) {
						new Notice("Couldn't find the terminal heading in the last note, aborting.");
						return;
					}
					for (let i = src_heading_index+1; i <= src_terminal_index; i++) {
						const line = src_lines[i];
						const checked = /^\s*- \[x\]/;
						// only copy over unchecked items
						if (!checked.test(line)) {
							copy_lines.push(line);
						}
					}
					const output_heading_index = output_lines.indexOf(this.settings.heading);
					if (output_heading_index === -1) {
						new Notice("Couldn't find the obligation heading in today's note, check your template");
						return;
					}
					const output_terminal_index = output_lines.indexOf(this.settings.terminal);
					if (output_terminal_index === -1) {
						new Notice("Couldn't find the terminal heading in today's note, check your template");
						return;
					}
					Array.prototype.splice.apply(
						output_lines,
						[
							output_heading_index+1,
							output_terminal_index - output_heading_index,
							...copy_lines
						]
					);
				}
				output_file = await this.app.vault.create(new_note_path, output_lines.join('\n'));
				if (this.settings.archive && src_note) {
					if (this.settings.archive_path === "") {
						new Notice("The archive path must be specified when the archive option is turned on, aborting.");
						return;
					}
					const archived_note_path = `${this.settings.archive_path}/${src_note.basename}.md`;
					try {
						await this.app.fileManager.renameFile(src_note, archived_note_path);
					} catch (error) {
						new Notice(`A file called ${archived_note_path} already exists, archival skipped.`);
					}
				}
			}
			const active_leaf = this.app.workspace.getLeaf();
			if (output_file instanceof TFile) {
				await active_leaf.openFile(output_file);
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

	async getHeadings() {
		let file = this.app.vault.getAbstractFileByPath(this.plugin.settings.template_path);
		if (file === null) {
			file = this.app.vault.getAbstractFileByPath(`${this.plugin.settings.template_path}.md`);
		}
		if (file === null || !(file instanceof TFile)) {
			return []
		}
		const content = await this.app.vault.read(file);
		const headings: {[index:string]:any} = Array.from(content.matchAll(/#{1,} .*/g))
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
					this.plugin.settings.template_path = value;
					await this.plugin.saveSettings();
					this.display();
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
		// Create the dropdown options for the two heading selections
		// --------------------------------------------------------------------
		const level = (str: string) => {
			return str.split("#").length - 1;
		};
		const all_headings = await this.getHeadings();
		const heading_value = Object.keys(all_headings)
			.find(key => all_headings[key] === this.plugin.settings.heading) || "";
		const terminal_value = Object.keys(all_headings)
			.find(key => all_headings[key] === this.plugin.settings.terminal) || "";
		const headings = Object.fromEntries(
			Object.entries(all_headings).filter(([k, v]) =>
				terminal_value == ""
				|| (terminal_value > k && level(v) <= level(all_headings[terminal_value]))
			)
		);
		const terminal_headings = Object.fromEntries(
			Object.entries(all_headings).filter(([k, v]) => k>heading_value)
		);
		// --------------------------------------------------------------------
		// The heading which contains the to-do list items
		// --------------------------------------------------------------------
		new Setting(containerEl)
			.setName('Obligation Heading')
			.setDesc("The heading from the template which will contain all of your to-do list items")
			.addDropdown(dropdown => dropdown
				.addOptions(headings)
				.setValue(heading_value)
				.onChange(async value => {
					this.plugin.settings.heading = headings[value] || null;
					await this.plugin.saveSettings();
					this.display();
				})
			);
		// --------------------------------------------------------------------
		// The heading which terminates the to-do list items
		// --------------------------------------------------------------------
		new Setting(containerEl)
			.setName('Terminal Heading')
			.setDesc(`The heading from the template which terminates the to-do list items. Everything between the "Obligation Heading" and this heading in your daily note will be copied over. The terminal heading must be at a level greater or equal to the "Obligation Heading" option, i.e. you can't terminate an H2 (##) with an H3 (###) but you can with another H2 or an H1 (#).`)
			.addDropdown(dropdown => dropdown
				.addOptions(terminal_headings)
				.setValue(terminal_value)
				.onChange(async value => {
					this.plugin.settings.terminal = terminal_headings[value] || null;
					await this.plugin.saveSettings();
					this.display();
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

	}
}
