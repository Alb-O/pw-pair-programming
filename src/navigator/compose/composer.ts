import fs from "node:fs";
import path from "node:path";
import { parseRangeShorthandEntry, parseSliceEntry } from "./entry_parser";

/**
 * Message composer for navigator prompts.
 * Loads a preamble file and appends file/range blocks with explicit headers.
 */
export type ComposeNavigatorMessageOptions = {
	preambleFile: string;
	entries: readonly string[];
	cwd?: string;
	onWarning?: (warning: string) => void;
};

export type ReadNavigatorPreambleOptions = {
	preambleFile: string;
	cwd?: string;
};

export type ReadSliceResult = {
	start: number;
	end: number;
	text: string;
};

export type ResolvedComposeFileEntry = {
	kind: "file";
	rawEntry: string;
	entryPath: string;
	filePath: string;
	content: string;
};

export type ResolvedComposeSliceEntry = {
	kind: "slice";
	rawEntry: string;
	entryPath: string;
	filePath: string;
	start: number;
	end: number;
	label: string;
	content: string;
};

export type ResolvedComposeEntry =
	| ResolvedComposeFileEntry
	| ResolvedComposeSliceEntry;

const normalizeLines = (content: string): string[] => {
	const lines = content.replace(/\r/g, "").split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines;
};

const pathKind = (candidatePath: string): string => {
	try {
		const stats = fs.statSync(candidatePath);
		if (stats.isFile()) {
			return "file";
		}
		if (stats.isDirectory()) {
			return "dir";
		}
		return "other";
	} catch {
		return "missing";
	}
};

const ensureFilePath = (
	filePath: string,
	entryText: string,
	context: string,
	cwd: string,
): void => {
	const kind = pathKind(filePath);
	if (kind !== "file") {
		throw new Error(
			`${context} is not a file: ${entryText} resolved=${filePath} type=${kind} cwd=${cwd}`,
		);
	}
};

const resolveEntryPath = (entryPath: string, cwd: string): string => {
	if (path.isAbsolute(entryPath)) {
		return entryPath;
	}
	return path.resolve(cwd, entryPath);
};

const resolvePreamblePath = (preambleFile: string, cwd: string): string => {
	if (preambleFile.trim() === "") {
		throw new Error("composeNavigatorMessage requires preambleFile");
	}

	const resolvedPreamble = resolveEntryPath(preambleFile, cwd);
	if (!fs.existsSync(resolvedPreamble)) {
		throw new Error(`Preamble file not found: ${preambleFile} cwd=${cwd}`);
	}
	ensureFilePath(resolvedPreamble, preambleFile, "Preamble file", cwd);
	return resolvedPreamble;
};

export const readSlice = (
	filePath: string,
	start: number,
	end: number,
): ReadSliceResult => {
	const lines = normalizeLines(fs.readFileSync(filePath, "utf8"));
	if (lines.length === 0) {
		throw new Error(`Cannot slice empty file: ${filePath}`);
	}
	if (start > lines.length) {
		throw new Error(
			`Slice start (${start}) exceeds file length (${lines.length}): ${filePath}`,
		);
	}

	const effectiveEnd = end > lines.length ? lines.length : end;
	const text = lines.slice(start - 1, effectiveEnd).join("\n");

	return {
		start,
		end: effectiveEnd,
		text,
	};
};

const appendRangeSnippet = (
	parts: string[],
	entry: ResolvedComposeSliceEntry,
): void => {
	const header =
		entry.start === entry.end
			? `[FILE: ${entry.entryPath} | line ${entry.start}]`
			: `[FILE: ${entry.entryPath} | lines ${entry.start}-${entry.end}]`;
	const finalHeader =
		entry.label === ""
			? header
			: entry.start === entry.end
				? `[FILE: ${entry.entryPath} | line ${entry.start} | ${entry.label}]`
				: `[FILE: ${entry.entryPath} | lines ${entry.start}-${entry.end} | ${entry.label}]`;
	parts.push(`\n\n${entry.label === "" ? header : finalHeader}\n${entry.content}`);
};

export const readNavigatorPreamble = ({
	preambleFile,
	cwd = process.cwd(),
}: ReadNavigatorPreambleOptions): string =>
	fs.readFileSync(resolvePreamblePath(preambleFile, cwd), "utf8");

export const resolveComposeEntries = ({
	entries,
	cwd = process.cwd(),
	onWarning,
}: Omit<ComposeNavigatorMessageOptions, "preambleFile">): ResolvedComposeEntry[] => {
	const resolvedEntries: ResolvedComposeEntry[] = [];

	for (const rawEntry of entries) {
		const entry = rawEntry.trim();
		if (entry === "") {
			continue;
		}
		if (entry === "\\") {
			onWarning?.(
				"[pp compose] Warning: ignoring standalone '\\\\' entry. Bash-style line continuation is not valid here; pass entries directly as separate arguments.",
			);
			continue;
		}

		if (entry.startsWith("slice:")) {
			const parsed = parseSliceEntry(entry.slice("slice:".length));
			const filePath = resolveEntryPath(parsed.path, cwd);
			if (!fs.existsSync(filePath)) {
				throw new Error(
					`Slice file not found: ${parsed.pathText} cwd=${cwd}. Run from your project root or use absolute paths.`,
				);
			}
			ensureFilePath(filePath, parsed.pathText, "Slice file", cwd);

			const slice = readSlice(filePath, parsed.start, parsed.end);
			resolvedEntries.push({
				kind: "slice",
				rawEntry,
				entryPath: parsed.pathText,
				filePath,
				start: slice.start,
				end: slice.end,
				label: parsed.label,
				content: slice.text,
			});
			continue;
		}

		const fileText = entry.startsWith("file:")
			? entry.slice("file:".length)
			: entry;
		const filePath = resolveEntryPath(fileText, cwd);

		if (fs.existsSync(filePath)) {
			ensureFilePath(filePath, fileText, "File entry", cwd);
			resolvedEntries.push({
				kind: "file",
				rawEntry,
				entryPath: fileText,
				filePath,
				content: fs.readFileSync(filePath, "utf8"),
			});
			continue;
		}

		const shorthand = parseRangeShorthandEntry(fileText);
		if (shorthand !== null) {
			const shorthandPath = resolveEntryPath(shorthand.path, cwd);
			if (!fs.existsSync(shorthandPath)) {
				throw new Error(
					`Range entry file not found: ${shorthand.pathText} cwd=${cwd}. Parsed from '${fileText}'. Run from your project root or use absolute paths.`,
				);
			}
			ensureFilePath(
				shorthandPath,
				shorthand.pathText,
				"Range entry file",
				cwd,
			);

			for (const range of shorthand.ranges) {
				const slice = readSlice(shorthandPath, range.start, range.end);
				resolvedEntries.push({
					kind: "slice",
					rawEntry,
					entryPath: shorthand.pathText,
					filePath: shorthandPath,
					start: slice.start,
					end: slice.end,
					label: "",
					content: slice.text,
				});
			}
			continue;
		}

		throw new Error(
			`File not found: ${fileText} cwd=${cwd}. If this was intended as a line range, use 'slice:path:start:end' or shorthand 'path:start-end[,start-end...]'.`,
		);
	}

	return resolvedEntries;
};

export const composeNavigatorMessage = ({
	preambleFile,
	entries,
	cwd = process.cwd(),
	onWarning,
}: ComposeNavigatorMessageOptions): string => {
	const parts: string[] = [readNavigatorPreamble({ preambleFile, cwd })];

	for (const entry of resolveComposeEntries({
		entries,
		cwd,
		onWarning,
	})) {
		if (entry.kind === "file") {
			parts.push(`\n\n[FILE: ${entry.entryPath}]\n${entry.content}`);
			continue;
		}
		appendRangeSnippet(parts, entry);
	}

	return parts.join("");
};
