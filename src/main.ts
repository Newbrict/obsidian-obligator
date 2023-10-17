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
	date_format: string;
	template_path: string;
	note_path: string;
}

const DEFAULT_SETTINGS: ObligatorSettings = {
	heading: "",
	date_format: "YYYY-MM-DD",
	template_path: "",
	note_path: ""
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


			const new_note_path = `${this.settings.note_path}/${note_name}.md`
			let output_file = this.app.vault.getAbstractFileByPath(new_note_path);
			// This runs when we're creating the file for the first time.
			// This is the only time that we should be moving items over from
			// the obligation list, otherwise we'll keep duplicating content
			if (output_file == undefined) {
				let copy_lines = []
				if (src_note != null) {
					let src_content = await this.app.vault.read(src_note);
					let src_lines = src_content.split('\n')
					const src_header_index = src_lines.indexOf(this.settings.heading);
					if (src_header_index === -1) {
						new Notice("Couldn't find the obligation header in the last note");
						return;
					}
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
				}
				let output_lines = template_contents.split('\n')
				if (this.settings.heading == null) {
					new Notice("You must specify the obligation header in the settings.");
					return;
				}
				const output_header_index = output_lines.indexOf(this.settings.heading);
				if (output_header_index === -1) {
					new Notice("Couldn't find the obligation header in today's note, check your template");
					return;
				}
				Array.prototype.splice.apply(output_lines, [output_header_index+1, 0, ...copy_lines]);
				output_file = await this.app.vault.create(new_note_path, output_lines.join('\n'));
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
		const headings = await this.getHeadings();
		const {containerEl} = this;

		containerEl.empty();

		//containerEl.createEl('h2', {text: 'Daily Note Settings'});

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

		//containerEl.createEl('h2', {text: 'Obligator Settings'});
		// Which heading contains obligations?

		const heading_value = Object.keys(headings).find(key => headings[key] === this.plugin.settings.heading) || "";

		new Setting(containerEl)
			.setName('Obligation Heading')
			.setDesc("The heading from the template under which obligator list items belong.")
			.addDropdown(dropdown => dropdown
				.addOptions(headings)
				.setValue(heading_value)
				.onChange(async value => {
					this.plugin.settings.heading = headings[value] || null;
					await this.plugin.saveSettings();
				})
			);

	}
}
