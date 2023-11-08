export const HEADING_REGEX        = /^#{1,7} +\S.*/m;
export const HEADING_REGEX_GLOBAL = /^#{1,7} +\S.*/gm;
export const CHECKBOX_REGEX = /^\s*-\s+\[[x ]\].*$/m;

export function get_heading_level(heading:string|null) {
	if (heading) {
		return heading.replace(/[^#]/g, "").length;
	}
	return 0;
}

type Heading = {
	heading: string|null;
	children: (Heading|string)[];
	total: number;
}

// Structurize takes a set of lines from a note file and structures them
// hierarchically based on fold scope.
export function structurize(lines:string[], heading:string|null=null):Heading {
	const level = get_heading_level(heading);
	let total = 0;
	let children = [];
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];
		if (HEADING_REGEX.test(line))  {
			// A lower level means a greater scope.
			// If this new heading has a lesser or equal level,
			// then there are no more children, we can return.
			if (get_heading_level(line) <= level) {
				break;
			}
			const child = structurize(lines.slice(i+1), line);
			children.push(child);
			i += child.total;
			total += child.total;
		// Since we increment the iterator above, this will always
		// be children on the same level, so they can be added.
		} else {
			children.push(line)
		}
		total += 1;
	}
	return {heading: heading, children: children, total: total};
}

// Flattens the heirarchy represented by the output of a call to structurize
export function destructure(structure:Heading):string[] {
	let lines = [];
	if (structure.heading) {
		lines.push(structure.heading);
	}
	for (let i = 0; i < structure.children.length; i++) {
		const child = structure.children[i];
		console.log(child)
		if (child instanceof Object) {
			console.log("This is an Object");
			lines.push(...destructure(child))
		} else {
			console.log("This is a String");
			lines.push(child);
		}
	}
	return lines;
}

// Merges second into first
// Limitation: Heading paths have to be unique within the structure.
export function merge_structure (first:Heading, second:Heading) {
	// If we receive structures which don't have the same heading, the only
	// thing we can do is merge them under a new parent
	if (first.heading !== second.heading) {
		return {
			heading: null,
			children: [first, second],
			total: first.total + second.total + 2
		}
	}

	// Go through each child in second, and check if it's in first
	second.children.forEach((child) => {
		if (child instanceof Object) {

			// Ignoring this type check because the code actually works fine.
			// @ts-ignore
			const first_child = first.children.find(c => c.heading === child.heading);
			if (first_child instanceof Object && first_child) {
				const old_total = first_child.total;
				merge_structure(first_child, child);
				first.total += first_child.total-old_total;
			} else {
				first.children.push(child);
				first.total += child.total + 1;
			}
		} else {
			// Add missing children
			//if (!CHECKBOX_REGEX.test(child) || !first.children.contains(child)) {
			// TODO For right now kill all duplicates
			if (!first.children.contains(child)) {
				const header_index = first.children.findIndex(c => c instanceof Object);
				if (header_index > -1) {
					first.children.splice(header_index, 0, child);
				} else {
					first.children.push(child);
				}
				// Text children must come before any headers or else they'll
				// get wrapped into other fold scopes when heading children
				// are added.
				first.total += 1;
			}
		}
	});
}

// Merge test structure
/*
			const s1 = {
				heading: null,
				children: [{
					heading: "# Something",
					children: ["test5"],
					total: 1
				}],
				total: 2
			}
			const s2 = {
				heading: null,
				children: ["test", "test2", {
					heading: "# Something",
					children: ["test3"],
					total: 1
				}, {
					heading: "# Something else",
					children: ["test4", {
						heading: "## Deeper",
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
