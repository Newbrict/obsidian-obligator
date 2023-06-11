import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFolder, TFile } from 'obsidian';
import { getDailyNoteSettings } from "obsidian-daily-notes-interface"

interface ObligatorSettings {
	heading: string;
	date_format: string;
}

const DEFAULT_SETTINGS: ObligatorSettings = {
	heading: null,
	date_format: null
}

export default class Obligator extends Plugin {
	settings: ObligatorSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('carrot', 'Obligator', async (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			// Get a list of all the files in the daily notes directory
			const { folder: notes_path, format } = getDailyNoteSettings();
			const notes: TFolder[] = [];
			const notes_folder = this.app.vault.getAbstractFileByPath(notes_path);
			if (notes_folder instanceof TFolder) {
			  for (let child of notes_folder.children) {
					if(child instanceof TFile) {
						notes.push(child);
					}
				}
			}
			notes.sort(
				(a, b) =>
					window.moment(b.basename, format).valueOf()
				- window.moment(a.basename, format).valueOf()
			);

			// Get the last note that's not today's.
			let src_note = null;
			let today = moment();
			for (let i=0; i < notes.length; i++) {
				if (moment(notes[i].basename, format).isBefore(today, 'day')) {
					src_note = notes[i];
					break;
				}
			}

			if (src_note === null) {
				return;
			}

			const dst_note = this.app.workspace.getActiveFile()
			if (dst_note === null
			|| !moment(dst_note.basename, format).isSame(today, 'day')) {
				new Notice("You need to be viewing today's daily-note in order to use this");
				return;
			}

			let src_content = await this.app.vault.read(src_note);
			let src_lines = src_content.split('\n')
			const src_header_index = src_lines.indexOf(this.settings.heading);
			if (src_header_index === -1) {
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
			let dst_content = await this.app.vault.read(dst_note);
			let dst_lines = dst_content.split('\n')
			const dst_header_index = dst_lines.indexOf(this.settings.heading);
			if (dst_header_index === -1) {
				new Notice("Couldn't find the todo header in today's note");
				return;
			}

			Array.prototype.splice.apply(dst_lines, [dst_header_index+1, 0, ...copy_lines]);
			this.app.vault.modify(dst_note, dst_lines.join('\n'));
		});

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'obligator-command',
			name: 'obligator-command',
			callback: () => {
				console.log("Ran obligator-command command");
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
		const { template } = getDailyNoteSettings();
		let file = this.app.vault.getAbstractFileByPath(template);
		if (file === null) {
			file = this.app.vault.getAbstractFileByPath(`${template}.md`);
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

		containerEl.createEl('h2', {text: 'Obligator Settings'});

		new Setting(containerEl)
			.setName('Heading')
			.setDesc("The heading from the template under which todo list items belong.")
			.addDropdown(dropdown => dropdown
				.addOptions({
					...headings,
					none: "None"
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

		const make_preview_div = (format) => {
			return `Today's note would look like this: <b class="u-pop">${moment().format(format)}</b>`
		}
		const default_date_format = "YYYY-MM-DD";
		const date_format_frag = document.createDocumentFragment(), date_format_div = document.createElement("div");
		let date_preview_div = document.createElement("div");
		date_format_div.innerHTML = `For syntax information, refer to the <a href="https://momentjs.com/docs/#/displaying/format/">moment documentation</a>.`
		date_preview_div.innerHTML = make_preview_div(default_date_format);
		date_format_frag.append(date_format_div)
		date_format_frag.append(date_preview_div)
		new Setting(containerEl)
			.setName("Date format")
			.setDesc(date_format_frag)
			.addText(text => text
				.setPlaceholder(default_date_format)
				.setValue(this.plugin.settings.date_format)
				.onChange(async (value) => {
					if (value == "") {
						this.plugin.settings.date_format = default_date_format;
						date_preview_div.innerHTML = make_preview_div(default_date_format);
					} else {
						this.plugin.settings.date_format = value;
						date_preview_div.innerHTML = make_preview_div(value);
					}
					await this.plugin.saveSettings();
				})
			);
	}
}
