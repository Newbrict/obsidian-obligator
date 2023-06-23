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
	MomentFormatComponent
} from 'obsidian';

import {
	FileSuggest,
	FolderSuggest
} from "./ui";

interface ObligatorSettings {
	heading: string;
	date_format: string;
	template_path: string;
	note_path: string;
}

const DEFAULT_SETTINGS: ObligatorSettings = {
	heading: null,
	date_format: "YYYY-MM-DD",
	template_path: null,
	note_path: null
}

export default class Obligator extends Plugin {
	settings: ObligatorSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('carrot', `Open today's obligator note`, async (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			// Get a list of all the files in the daily notes directory
			const notes: TFolder[] = [];
			const notes_folder = this.app.vault.getAbstractFileByPath(this.settings.note_path);
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
			let today = moment();
			for (let i=0; i < notes.length; i++) {
				if (moment(notes[i].basename, this.settings.date_format).isBefore(today, 'day')) {
					src_note = notes[i];
					break;
				}
			}

			if (src_note === null) {
				return;
			}

			// Make sure the default value is applied if it's left blank
			let date_format = this.settings.date_format;
			if (date_format == "") {
				date_format = DEFAULT_SETTINGS.date_format;
			}
			const note_name = moment().format(date_format);

			const template_file = this.app.vault.getAbstractFileByPath(`${this.settings.template_path}.md`);
			if (template_file == undefined) {
				if (template_path == "") {
					new Notice(`You must specify a template file in the settings.`);
				} else {
					new Notice(`Your template file "${this.settings.template_path}" does not exist.`);
				}
				return;
			}
			const template_contents = await this.app.vault.read(template_file);
			//TODO replace the template variables in the file
			const new_note_path = `${this.settings.note_path}/${note_name}.md`
			let output_file = this.app.vault.getAbstractFileByPath(new_note_path);
			// This runs when we're creating the file for the first time.
			// This is the only time that we should be moving items over from
			// the todo list, otherwise we'll keep duplicating content
			if (output_file == undefined) {
				// TODO more parts of this can be moved in this if statement.
				let src_content = await this.app.vault.read(src_note);
				let src_lines = src_content.split('\n')
				const src_header_index = src_lines.indexOf(this.settings.heading);
				if (src_header_index === -1) {
					//TODO what about a fresh install with no previous note?
					new Notice("Couldn't find the todo header in the last note");
					return;
				}
				let copy_lines = []
				for (let i = src_header_index+1; i < src_lines.length; i++) {
					const line = src_lines[i];
					//TODO make this more robust later, it shouldn't just terminate with --
					const terminal = /^----/;
					if (terminal.test(line)) {
						break;
					}
					const checked = /^\s*- \[x\]/;
					// only copy over unchecked items
					if (!checked.test(line)) {
		 				copy_lines.push(line);
					}
				}
				let output_lines = template_contents.split('\n')
				const output_header_index = output_lines.indexOf(this.settings.heading);
				if (output_header_index === -1) {
					new Notice("Couldn't find the todo header in today's note");
					return;
				}

				Array.prototype.splice.apply(output_lines, [output_header_index+1, 0, ...copy_lines]);
				output_file = await this.app.vault.create(new_note_path, output_lines.join('\n'));
			}
			const active_leaf = this.app.workspace.getLeaf();
			await active_leaf.openFile(output_file);

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
		if (file === null) {
			return []
		}
		const content = await this.app.vault.read(file);
		const headings = Array.from(content.matchAll(/#{1,} .*/g)).map(
			([heading]) => heading
		);
		return headings;
	}

	async display(): void {
		const headings = await this.getHeadings();
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Daily Note Settings'});

		// New File Location
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

		// Template File
		new Setting(containerEl)
			.setName("Template file")
			.setDesc("New daily notes will utilize the template file specified.")
			.addText(text => {
				new FileSuggest(this.app, text.inputEl);
				text.setValue(this.plugin.settings.template_path)
				    .onChange(async value => {
					this.plugin.settings.template_path = value;
					await this.plugin.saveSettings();
				})
			});

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

		containerEl.createEl('h2', {text: 'Obligator Settings'});
		// Which heading contains obligations?
		new Setting(containerEl)
			.setName('Heading')
			.setDesc("The heading from the template under which todo list items belong.")
			.addDropdown(dropdown => dropdown
				.addOptions({
					none: "None",
					...headings
				})
				.onChange(async value => {
					if (value < headings.length) {
						this.plugin.settings.heading = headings[value];
					} else {
						this.plugin.settings.heading = null;
					}
					await this.plugin.saveSettings();
				})
			);

	}
}
