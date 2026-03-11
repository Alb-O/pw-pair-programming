import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	buildNavigatorEntriesArchive,
	formatNavigatorEntriesArchiveNotice,
} = require("../../dist/navigator/compose/archive.js");

const createFixture = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-archive-"));
	const prompt = path.join(dir, "prompt.txt");
	const code = path.join(dir, "code.rs");
	fs.writeFileSync(prompt, "review this carefully", "utf8");
	fs.writeFileSync(code, "line1\nline2\nline3\nline4\n", "utf8");
	return { dir, prompt, code };
};

const withFixture = (fn) => {
	const fixture = createFixture();
	try {
		fn(fixture);
	} finally {
		fs.rmSync(fixture.dir, { recursive: true, force: true });
	}
};

const writeArchiveFile = (dir, bytes) => {
	const archivePath = path.join(dir, "selected-files.tar.gz");
	fs.writeFileSync(archivePath, bytes);
	return archivePath;
};

test("buildNavigatorEntriesArchive packages files and ranges into tar.gz", () => {
	withFixture((fixture) => {
		const archive = buildNavigatorEntriesArchive({
			cwd: fixture.dir,
			entries: [
				"code.rs",
				"code.rs:2-3",
				"slice:code.rs:4:4:focus area",
			],
		});
		const archivePath = writeArchiveFile(fixture.dir, archive.bytes);
		const listing = execFileSync("tar", ["-tzf", archivePath], {
			encoding: "utf8",
		})
			.trim()
			.split("\n");
		const manifestText = execFileSync(
			"tar",
			["-xOzf", archivePath, "selected-files/manifest.json"],
			{ encoding: "utf8" },
		);
		const manifest = JSON.parse(manifestText);

		assert.equal(archive.name, "pp-selected-files.tar.gz");
		assert.deepEqual(listing, [
			"selected-files/manifest.json",
			"selected-files/files/code.rs",
			"selected-files/ranges/code.lines-2-3.rs",
			"selected-files/ranges/code.lines-4-4.rs",
		]);
		assert.deepEqual(
			manifest.entries.map((entry) => ({
				kind: entry.kind,
				entry: entry.entry,
				sourcePath: entry.sourcePath,
				archivePath: entry.archivePath,
				start: entry.start,
				end: entry.end,
				label: entry.label,
			})),
			[
				{
					kind: "file",
					entry: "code.rs",
					sourcePath: "code.rs",
					archivePath: "files/code.rs",
					start: undefined,
					end: undefined,
					label: undefined,
				},
				{
					kind: "slice",
					entry: "code.rs:2-3",
					sourcePath: "code.rs",
					archivePath: "ranges/code.lines-2-3.rs",
					start: 2,
					end: 3,
					label: "",
				},
				{
					kind: "slice",
					entry: "slice:code.rs:4:4:focus area",
					sourcePath: "code.rs",
					archivePath: "ranges/code.lines-4-4.rs",
					start: 4,
					end: 4,
					label: "focus area",
				},
			],
		);
		assert.match(
			formatNavigatorEntriesArchiveNotice(archive),
			/Contains 3 archived entries from --entries as a tar\.gz attachment\./,
		);
	});
});

test("buildNavigatorEntriesArchive preserves compose warnings", () => {
	withFixture((fixture) => {
		const warnings = [];
		const archive = buildNavigatorEntriesArchive({
			cwd: fixture.dir,
			entries: ["\\", "code.rs"],
			onWarning: (warning) => {
				warnings.push(warning);
			},
		});
		const archivePath = writeArchiveFile(fixture.dir, archive.bytes);
		const listing = execFileSync("tar", ["-tzf", archivePath], {
			encoding: "utf8",
		})
			.trim()
			.split("\n");

		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /ignoring standalone '\\\\' entry/i);
		assert.deepEqual(listing, [
			"selected-files/manifest.json",
			"selected-files/files/code.rs",
		]);
	});
});
