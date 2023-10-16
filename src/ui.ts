// Originally from https://github.com/mirnovov/obsidian-homepage/blob/main/src/ui.ts
import { App, FuzzySuggestModal, Notice, TAbstractFile, TFile, TFolder } from "obsidian";
import { TextInputSuggest } from "./suggest";
import { trimFile } from "./utils";

export class FileSuggest extends TextInputSuggest<TFile> {
	getSuggestions(inputStr: string): TFile[] {
		const abstractFiles = this.app.vault.getAllLoadedFiles();
		const files: TFile[] = [];
		const inputLower = inputStr.toLowerCase();

		abstractFiles.forEach((file: TAbstractFile) => {
			if (
				file instanceof TFile && "md" == file.extension &&
				file.path.toLowerCase().contains(inputLower)
			) {
				files.push(file);
			}
		});

		return files;
	}

	renderSuggestion(file: TFile, el: HTMLElement) {
		if (file.extension == "md") {
			el.setText(trimFile(file));
		}
		else {
			//we don't use trimFile here as the extension isn't displayed here
			el.setText(file.path.slice(0, -7))
			el.insertAdjacentHTML(
				"beforeend",
				`<div class="nav-file-tag" style="display:inline-block;vertical-align:middle">canvas</div>`
			);
		}
	}

	selectSuggestion(file: TFile) {
		this.inputEl.value = trimFile(file);
		this.inputEl.trigger("input");
		this.close();
	}
}

export class FolderSuggest extends TextInputSuggest<TFolder> {
	getSuggestions(inputStr: string): TFolder[] {
		const abstractFiles = this.app.vault.getAllLoadedFiles();
		const folders: TFolder[] = [];
		const inputLower = inputStr.toLowerCase();

		abstractFiles.forEach((file: TAbstractFile) => {
			if (file instanceof TFolder
			&& file.path.toLowerCase().contains(inputLower)) {
				folders.push(file);
			}
		});

		return folders;
	}

	renderSuggestion(folder: TFolder, el: HTMLElement) {
		el.setText(trimFile(folder));
	}

	selectSuggestion(folder: TFolder) {
		this.inputEl.value = trimFile(folder);
		this.inputEl.trigger("input");
		this.close();
	}
}
