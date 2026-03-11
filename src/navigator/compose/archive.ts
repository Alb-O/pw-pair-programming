import path from "node:path";
import zlib from "node:zlib";
import { resolveComposeEntries, type ResolvedComposeEntry } from "./composer";

export type BuildNavigatorEntriesArchiveOptions = {
	entries: readonly string[];
	cwd?: string;
	onWarning?: (warning: string) => void;
	name?: string;
};

export type NavigatorEntriesArchiveManifestEntry = {
	kind: "file" | "slice";
	entry: string;
	sourcePath: string;
	archivePath: string;
	start?: number;
	end?: number;
	label?: string;
	size: number;
};

export type NavigatorEntriesArchive = {
	name: string;
	bytes: Buffer;
	manifest: {
		version: 1;
		entries: NavigatorEntriesArchiveManifestEntry[];
	};
};

const TAR_BLOCK_BYTES = 512;
const DEFAULT_ARCHIVE_NAME = "pp-selected-files.tar.gz";
const ARCHIVE_ROOT = "selected-files";

const posixify = (value: string): string => value.replace(/\\/g, "/");

const sanitizePathSegment = (value: string): string => {
	const trimmed = value.trim();
	if (trimmed === "" || trimmed === "." || trimmed === "..") {
		return "_";
	}
	return trimmed.replace(/[:\0]/g, "_");
};

const splitSanitizedSegments = (value: string): string[] =>
	posixify(value)
		.split("/")
		.filter((segment) => segment !== "")
		.map(sanitizePathSegment);

const archiveSourcePath = (filePath: string, cwd: string): string => {
	const relative = path.relative(cwd, filePath);
	if (
		relative !== "" &&
		!relative.startsWith("..") &&
		!path.isAbsolute(relative)
	) {
		return splitSanitizedSegments(relative).join("/");
	}

	const driveNormalized = filePath.replace(
		/^(?<drive>[a-zA-Z]):/,
		(_, drive: string) => drive.toLowerCase(),
	);
	const rootless = driveNormalized.replace(/^[\\/]+/, "");
	return ["external", ...splitSanitizedSegments(rootless)].join("/");
};

const insertPathSuffix = (value: string, suffix: string): string => {
	const normalized = posixify(value);
	const extension = path.posix.extname(normalized);
	const basename = path.posix.basename(normalized, extension);
	const dirname = path.posix.dirname(normalized);
	const nextBase = `${basename}${suffix}${extension}`;
	return dirname === "." ? nextBase : `${dirname}/${nextBase}`;
};

const ensureUniqueArchivePath = (
	candidate: string,
	used: Set<string>,
): string => {
	if (!used.has(candidate)) {
		used.add(candidate);
		return candidate;
	}

	let index = 2;
	while (true) {
		const nextCandidate = insertPathSuffix(candidate, `.${index}`);
		if (!used.has(nextCandidate)) {
			used.add(nextCandidate);
			return nextCandidate;
		}
		index += 1;
	}
};

const splitTarPath = (value: string): { name: string; prefix: string } => {
	const normalized = posixify(value);
	if (Buffer.byteLength(normalized, "utf8") <= 100) {
		return { name: normalized, prefix: "" };
	}

	const segments = normalized.split("/");
	for (let index = 1; index < segments.length; index += 1) {
		const prefix = segments.slice(0, index).join("/");
		const name = segments.slice(index).join("/");
		if (
			Buffer.byteLength(prefix, "utf8") <= 155 &&
			Buffer.byteLength(name, "utf8") <= 100
		) {
			return { name, prefix };
		}
	}

	throw new Error(`tar path exceeds ustar limits: ${value}`);
};

const encodeField = (value: string, bytes: number): Buffer => {
	const buffer = Buffer.alloc(bytes, 0);
	Buffer.from(value, "utf8").copy(buffer, 0, 0, bytes);
	return buffer;
};

const encodeOctal = (value: number, bytes: number): Buffer => {
	const out = Buffer.alloc(bytes, 0);
	const raw = value.toString(8);
	if (raw.length > bytes - 1) {
		throw new Error(`octal value ${value} does not fit in ${bytes} bytes`);
	}
	Buffer.from(raw.padStart(bytes - 1, "0"), "ascii").copy(out);
	return out;
};

const createTarHeader = (
	entryPath: string,
	size: number,
): Buffer => {
	const header = Buffer.alloc(TAR_BLOCK_BYTES, 0);
	const { name, prefix } = splitTarPath(entryPath);

	encodeField(name, 100).copy(header, 0);
	encodeOctal(0o644, 8).copy(header, 100);
	encodeOctal(0, 8).copy(header, 108);
	encodeOctal(0, 8).copy(header, 116);
	encodeOctal(size, 12).copy(header, 124);
	encodeOctal(0, 12).copy(header, 136);
	Buffer.from("        ", "ascii").copy(header, 148);
	encodeField("0", 1).copy(header, 156);
	encodeField("ustar", 6).copy(header, 257);
	encodeField("00", 2).copy(header, 263);
	encodeField(prefix, 155).copy(header, 345);

	let checksum = 0;
	for (const byte of header) {
		checksum += byte;
	}
	Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `, "ascii").copy(
		header,
		148,
	);
	return header;
};

const tarFileBuffer = (
	entryPath: string,
	content: Buffer,
): Buffer => {
	const header = createTarHeader(entryPath, content.length);
	const remainder = content.length % TAR_BLOCK_BYTES;
	const padding =
		remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(TAR_BLOCK_BYTES - remainder, 0);
	return Buffer.concat([header, content, padding]);
};

const buildArchiveEntries = (
	resolvedEntries: readonly ResolvedComposeEntry[],
	cwd: string,
): Array<{
	archivePath: string;
	content: Buffer;
	manifestEntry: NavigatorEntriesArchiveManifestEntry;
}> => {
	const used = new Set<string>();
	return resolvedEntries.map((entry) => {
		const sourcePath = archiveSourcePath(entry.filePath, cwd);
		const basePath =
			entry.kind === "file"
				? `files/${sourcePath}`
				: `ranges/${insertPathSuffix(
						sourcePath,
						`.lines-${entry.start}-${entry.end}`,
					)}`;
		const archivePath = ensureUniqueArchivePath(basePath, used);
		const content = Buffer.from(entry.content, "utf8");
		return {
			archivePath,
			content,
			manifestEntry: {
				kind: entry.kind,
				entry: entry.rawEntry,
				sourcePath: entry.entryPath,
				archivePath,
				start: entry.kind === "slice" ? entry.start : undefined,
				end: entry.kind === "slice" ? entry.end : undefined,
				label: entry.kind === "slice" ? entry.label : undefined,
				size: content.length,
			},
		};
	});
};

export const buildNavigatorEntriesArchive = ({
	entries,
	cwd = process.cwd(),
	onWarning,
	name = DEFAULT_ARCHIVE_NAME,
}: BuildNavigatorEntriesArchiveOptions): NavigatorEntriesArchive => {
	const resolvedEntries = resolveComposeEntries({ entries, cwd, onWarning });
	if (resolvedEntries.length === 0) {
		throw new Error("entry archiving requires at least one valid entry");
	}

	const archiveEntries = buildArchiveEntries(resolvedEntries, cwd);
	const manifest = {
		version: 1 as const,
		entries: archiveEntries.map((entry) => entry.manifestEntry),
	};
	const tarParts = [
		tarFileBuffer(
			`${ARCHIVE_ROOT}/manifest.json`,
			Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
		),
		...archiveEntries.map((entry) =>
			tarFileBuffer(`${ARCHIVE_ROOT}/${entry.archivePath}`, entry.content),
		),
		Buffer.alloc(TAR_BLOCK_BYTES * 2, 0),
	];
	return {
		name,
		bytes: zlib.gzipSync(Buffer.concat(tarParts), {
			level: zlib.constants.Z_BEST_COMPRESSION,
		}),
		manifest,
	};
};

export const formatNavigatorEntriesArchiveNotice = (
	archive: NavigatorEntriesArchive,
): string => {
	const entryLabel = archive.manifest.entries.length === 1 ? "entry" : "entries";
	return `\n\n[ATTACHMENT: ${archive.name}]\nContains ${archive.manifest.entries.length} archived ${entryLabel} from --entries as a tar.gz attachment.`;
};
