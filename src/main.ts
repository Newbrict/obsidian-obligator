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
	structurize,
	destructure,
	merge_structure,
	HEADING_REGEX_GLOBAL
} from "./note_utils"

interface ObligatorSettings {
	terminal: string;
	date_format: string;
	template_path: string;
	note_path: string;
	archive: boolean;
	archive_path: string;
}

const DEFAULT_SETTINGS: ObligatorSettings = {
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
			const template_lines = template_contents.split('\n')

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
					const src_terminal_index = src_lines.indexOf(this.settings.terminal);
					if (src_terminal_index === -1) {
						new Notice(`${src_note.basename} does not contain the specified terminal heading... aborting.`);
						return;
					}
					for (let i = 0; i <= src_terminal_index; i++) {
						const line = src_lines[i];
						const checked = /^\s*- \[x\]/;
						// only copy over unchecked items
						if (!checked.test(line)) {
							copy_lines.push(line);
						}
					}
					const output_terminal_index = output_lines.indexOf(this.settings.terminal);
					if (output_terminal_index === -1) {
						new Notice("Your template file does not contain the specified terminal heading... aborting.");
						return;
					}
					Array.prototype.splice.apply(
						output_lines,
						[
							0,
							output_terminal_index+1,
							...copy_lines
						]
					);
				}
				// ------------------------------------------------------------
				// Recurring obligations
				// ------------------------------------------------------------
				// Before writing out the file, we need to add all of the
				// recurring obligations.
				// ------------------------------------------------------------
				const cron_segment_to_list = (segment:string):number[] => {
					let output:number[] = [];
					const range_regex = /^(\d+)-(\d+)$/;
					for (let r of segment.split(',')) {
						if (range_regex.test(r)) {
							// Non-null assertion operator in use here because it can't be null
							const start:number = parseInt(r.match(range_regex)![1]);
							const end:number   = parseInt(r.match(range_regex)![2]);
							const expanded_range = Array.from({length: 1+end-start}, (_, i) => start + i);
							output = output.concat(expanded_range);
						} else {
							output.push(parseInt(r));
						}
					}
					return output.sort((a,b) => a-b);
				}
				// https://regex101.com/r/adwhVh/1
				const obligation = /^\s*{{ *obligate ([\*\-,\d]+) ([\*\-,\d]+) ([\*\-,\d]+) *}}\s*$/;
				const should_trigger_obligation = (obligation_string:string, test_date:moment.Moment) => {
					// Parse the cron string
					// Non-null assertion operator in use here because it can't be null
					const day_months  = cron_segment_to_list(obligation_string.match(obligation)![1]);
					const month_years = cron_segment_to_list(obligation_string.match(obligation)![2]);
					const day_weeks   = cron_segment_to_list(obligation_string.match(obligation)![3]);

					const test_day_month  = parseInt(test_date.format('D'));
					const test_month_year = parseInt(test_date.format('M'));
					const test_day_week   =          test_date.day();

					// includes(NaN) covers the * case.
					const matched_day_month  = (day_months.includes(NaN)  || (day_months.includes(test_day_month)));
					const matched_month_year = (month_years.includes(NaN) || (month_years.includes(test_month_year)));
					const matched_day_week   = (day_weeks.includes(NaN)   || (day_weeks.includes(test_day_week)))

					/*
					// Debugging outputs
					console.log(`============================================`);
					console.log(`testing: ${test_date} (${test_date.day()})`);
					console.log(`against: ${obligation_string}`);

					console.log(`day_months:  ${day_months}`);
					console.log(`month_years: ${month_years}`);
					console.log(`day_weeks: ${day_weeks}`);

					console.log(`matched_day_month: ${matched_day_month}`);
					console.log(`matched_month_year: ${matched_month_year}`);
					console.log(`matched_day_week: ${matched_day_week}`);

					console.log(`test_day_month: ${test_day_month}`)
					console.log(`test_month_year: ${test_month_year}`)
					console.log(`test_day_week: ${test_day_week}`)
					*/

					if (matched_day_month && matched_month_year && matched_day_week) {
						return true;
					}
					return false;
				};
				const template_lines = template_contents.split('\n')
				let processed_lines = [];
				for (let i = 0; i < template_lines.length; i++) {
					const line = template_lines[i];
					// If this is an obligator line, then go ahead and run the
					// logic which deterimnes if we should now obligate
					if (obligation.test(line)) {
						// console.log(`Testing ${line}`);
						let should_trigger = false;
						if (should_trigger_obligation(line, now)) {
							console.log(`triggered now (${line})`);
							should_trigger = true;
						// If there is no source note, then we would only
						// trigger above.
						} else if (src_note) {
							// Walk forward from the source note date (+1) and
							// check every skipped date.
							let skipped_moment = window.moment(src_note.basename, this.settings.date_format);
							while (skipped_moment.add(1, 'd').isBefore(now) && !should_trigger) {
								should_trigger = should_trigger_obligation(line, skipped_moment);
							}
							if (should_trigger) {
								console.log(`triggered later (${line})`);
							}

						}
						// Increment the iterator so we skip over this line
						i++;
						if (should_trigger) {
							// Increment the iterator and get the next line
							try {
								processed_lines.push(template_lines[i]);
							} catch (error) {
								new Notice("Template malformed, to-do item needs to follow obligator string.");
								return;
							}
						}
					} else {
						processed_lines.push(line);
					}
				}

				const processed_ti = processed_lines.indexOf(this.settings.terminal);
				const output_ti = output_lines.indexOf(this.settings.terminal);
				let processed_obligations = structurize(processed_lines.slice(0, processed_ti));
				const output_obligations = structurize(output_lines.slice(0, output_ti));
				merge_structure(
					processed_obligations,
					output_obligations
				);
				let merged_lines = destructure(processed_obligations);

				Array.prototype.splice.apply(
					output_lines, [
						0,
						output_ti,
						...merged_lines
					]
				);
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

	}
}
