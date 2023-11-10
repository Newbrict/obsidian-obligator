export const HEADING_REGEX        = /^#{1,7} +\S.*/m;
export const HEADING_REGEX_GLOBAL = /^#{1,7} +\S.*/gm;

// https://regex101.com/r/YfdnA8/1
export const CHECKBOX_REGEX = /^(\s*)-\s+\[[x \/]\].*$/m;
export const UNCHECKEDBOX_REGEX = /^\s*-\s+\[[ \/]\].*$/m;
export const CHECKEDBOX_REGEX = /^\s*-\s+\[[x]\].*$/m;

// https://regex101.com/r/adwhVh/1
export const OBLIGATION_REGEX = /^\s*{{ *obligate ([\*\-,\d]+) ([\*\-,\d]+) ([\*\-,\d]+) *}}\s*$/;

export function get_heading_level(heading:string|null) {
	if (heading && HEADING_REGEX.test(heading)) {
		return heading.replace(/[^#]/g, "").length;
	}
	return 0;
}

export function get_checkbox_level(checkbox:string|null) {
	if (checkbox && CHECKBOX_REGEX.test(checkbox)) {
		// This is offset by 1 so that the logic matches the heading logic
		return checkbox.replace(CHECKBOX_REGEX, "$1").length + 1;
	}
	return 0;
}

interface Parent {
	text: string|null;
	children: (Parent|string)[];
	total: number;
}

// Structurize takes a set of lines from a note file and structures them
// hierarchically based on fold scope.
export function structurize(lines:string[], text:string|null=null):Parent {
	const parent_heading_level = get_heading_level(text);
	const parent_checkbox_level = get_checkbox_level(text);
	let total = 0;
	let children = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const is_heading = HEADING_REGEX.test(line);
		const is_checkbox = CHECKBOX_REGEX.test(line);

		// A heading cannot be a child of a checkbox. text is checked here
		// because it can be null when invoked
		if (is_heading && text && CHECKBOX_REGEX.test(text)) {
			break;
		}

		// A lower level means a greater scope. If this new heading has a
		// lesser or equal level, then there are no more children, we can
		// stop processing.
		if (is_heading && get_heading_level(line) <= parent_heading_level) {
			break;
		}
		if (is_checkbox && get_checkbox_level(line) <= parent_checkbox_level) {
			break;
		}

		// If this is a foldable, then we do the recursive step, otherwise we
		// can simply add the child to the list of children
		if (is_heading || is_checkbox) {
			const child = structurize(lines.slice(i+1), line);
			children.push(child);
			i += child.total;
			total += child.total;
		} else {
			// Since we increment the iterator above, this will always
			// be children on the same level, so they can be added.
			children.push(line)
		}
		total += 1;
	}
	return {text: text, children: children, total: total};
}

// Flattens the heirarchy represented by the output of a call to structurize
export function destructure(structure:Parent):string[] {
	let lines = [];
	if (structure.text) {
		lines.push(structure.text);
	}
	for (let i = 0; i < structure.children.length; i++) {
		const child = structure.children[i];
		//console.log(child)
		if (child instanceof Object) {
			//console.log("This is an Object");
			lines.push(...destructure(child))
		} else {
			//console.log("This is a String");
			//TODO can probably be deleted now
			// delete'd items from the filter function will be undefined
			if (child !== undefined) {
				lines.push(child);
			}
		}
	}
	return lines;
}

// Merges second into first
// Limitation: Parent paths have to be unique within the structure.
export function merge_structure (first:Parent, second:Parent) {
	// If we receive structures which don't have the same heading, the only
	// thing we can do is merge them under a new parent
	if (first.text !== second.text) {
		return {
			text: null,
			children: [first, second],
			total: first.total + second.total + 2
		}
	}

	// Go through each child in second, and check if it's in first
	second.children.forEach((child) => {
		if (child instanceof Object) {

			// Ignoring this type check because the code actually works fine.
			// @ts-ignore
			const first_child = first.children.find(c => c.text === child.text);
			if (first_child && first_child instanceof Object) {
				const old_total = first_child.total;
				merge_structure(first_child, child);
				first.total += first_child.total-old_total;
			} else {
				if (child.text && CHECKBOX_REGEX.test(child.text)) {
					const heading_index = first.children.findIndex(c => c instanceof Object && c.text && HEADING_REGEX.test(c.text));
					if (heading_index > -1) {
						first.children.splice(heading_index, 0, child);
					} else {
						first.children.push(child);
					}
				} else {
					first.children.push(child);
					first.total += child.total + 1;
				}
			}
		} else {
			// Add missing children
			if (!first.children.contains(child)) {
				const heading_index = first.children.findIndex(c => c instanceof Object && c.text && HEADING_REGEX.test(c.text));
				if (heading_index > -1) {
					first.children.splice(heading_index, 0, child);
				} else {
					first.children.push(child);
				}
				// Text children must come before any headings or else they'll
				// get wrapped into other fold scopes when heading children
				// are added.
				first.total += 1;
			}
		}
	});
}

export function filter_structure(structure:Parent, delete_headings:boolean) {
	for (let i = 0; i < structure.children.length; i++) {
		const child = structure.children[i];
		if (typeof child === "object") {
			filter_structure(child, delete_headings)
			// child.text is checked here because it can be null when invoked.
			if (child.text) {
				if (HEADING_REGEX.test(child.text)) {
					if (delete_headings) {
						const non_empty = child.children.filter((element) =>  {
							if (typeof element === "object") {
								return true;
							} else {
								if (!/^\s*$/m.test(element)) {
									return true;
								}
							}
							return false;
						});
						if (non_empty.length === 0) {
							delete structure.children[i];
							structure.total = structure.total - child.children.length;
						}
					}
				}
				// Only delete checkedboxes if they have no unchecked children
				if (CHECKEDBOX_REGEX.test(child.text) && child.children.length === 0) {
					delete structure.children[i];
					structure.total = structure.total - 1;
				}
			}
		}
	}
	structure.children = structure.children.filter((element) => element !== undefined);
};

export function cron_segment_to_list(segment:string):number[] {
	let output:number[] = [];
	const RANGE_REGEX = /^(\d+)-(\d+)$/;
	for (let r of segment.split(',')) {
		if (RANGE_REGEX.test(r)) {
			// Non-null assertion operator in use here because it can't be null
			const start:number = parseInt(r.match(RANGE_REGEX)![1]);
			const end:number   = parseInt(r.match(RANGE_REGEX)![2]);
			const expanded_range = Array.from({length: 1+end-start}, (_, i) => start + i);
			output = output.concat(expanded_range);
		} else {
			output.push(parseInt(r));
		}
	}
	return output.sort((a,b) => a-b);
}

export function should_trigger_obligation(obligation_string:string, test_date:moment.Moment):boolean {
	// Parse the cron string
	// Non-null assertion operator in use here because it can't be null
	const day_months  = cron_segment_to_list(obligation_string.match(OBLIGATION_REGEX)![1]);
	const month_years = cron_segment_to_list(obligation_string.match(OBLIGATION_REGEX)![2]);
	const day_weeks   = cron_segment_to_list(obligation_string.match(OBLIGATION_REGEX)![3]);

	const test_day_month  = parseInt(test_date.format('D'));
	const test_month_year = parseInt(test_date.format('M'));
	const test_day_week   =          test_date.day();

	// includes(NaN) covers the * case.
	const matched_day_month  = (day_months.includes(NaN)  || (day_months.includes(test_day_month)));
	const matched_month_year = (month_years.includes(NaN) || (month_years.includes(test_month_year)));
	const matched_day_week   = (day_weeks.includes(NaN)   || (day_weeks.includes(test_day_week)))

	if (matched_day_month && matched_month_year && matched_day_week) {
		return true;
	}
	return false;
};

// Merge test structure
/*
			const s1 = {
				text: null,
				children: [{
					text: "# Something",
					children: ["test5"],
					total: 1
				}],
				total: 2
			}
			const s2 = {
				text: null,
				children: ["test", "test2", {
					text: "# Something",
					children: ["test3"],
					total: 1
				}, {
					text: "# Something else",
					children: ["test4", {
						text: "## Deeper",
						children: ["test6"],
						total: 1
					}],
					total: 2
				}],
				total: 7
			}
			//const heading_index = template_lines.indexOf(this.settings.heading);
			//const terminal_index = template_lines.indexOf(this.settings.terminal);
			//const template_structure = structurize(template_lines.slice(heading_index, terminal_index));
			//const revert = destructure(template_structure);
			//console.log(template_structure);
			//console.log(revert);
			//console.log(template_lines.slice(heading_index, terminal_index));
*/
