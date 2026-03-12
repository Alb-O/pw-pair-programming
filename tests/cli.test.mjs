import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const cliPath = path.join(workspaceRoot, "dist", "cli.js");
const require = createRequire(import.meta.url);
const { parseArgs } = require("../dist/cli.js");

const runCli = (args, envOverrides = {}) =>
	spawnSync(process.execPath, [cliPath, ...args], {
		cwd: workspaceRoot,
		encoding: "utf8",
		env: {
			...process.env,
			...envOverrides,
		},
	});

const withEnvVar = (key, value, run) => {
	const previous = process.env[key];
	if (value === undefined) {
		delete process.env[key];
	} else {
		process.env[key] = value;
	}
	try {
		run();
	} finally {
		if (previous === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = previous;
		}
	}
};

test("cli returns usage on unknown command", () => {
	const result = runCli(["unknown-command"]);

	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/unknown command 'unknown-command'\nusage: pp <command> \[options\]\n/,
	);
});

test("cli requires command options with values", () => {
	const result = runCli(["build-core", "--playwright-root"]);

	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/option '--playwright-root' requires a value\nusage: pp <command> \[options\]\n/,
	);
});

test("cli fails loudly when target paths are missing", () => {
	const result = runCli([
		"run-e2e",
		"--playwright-root",
		"/tmp/does-not-exist-playwright-root",
		"--chromium-bin",
		"/tmp/does-not-exist-chromium",
	]);

	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/playwright root path does not exist: \/tmp\/does-not-exist-playwright-root\n/,
	);
});

test("run-demos requires output-dir option", () => {
	const result = runCli([
		"run-demos",
		"--playwright-root",
		"/tmp/playwright-root",
		"--chromium-bin",
		"/tmp/chromium",
	]);

	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/missing required option '--output-dir'\nusage: pp <command> \[options\]\n/,
	);
});

test("parseArgs parses pp send positional message and wait flags", () => {
	const parsed = parseArgs(["send",
		"hello world",
		"--model",
		"thinking",
		"--new",
		"--force",
		"--echo-message",
		"--no-wait",
		"--timeout",
		"9000",
		"--poll-ms",
		"120",
	]);

	assert.equal(parsed.kind, "pp-send");
	assert.equal(parsed.options.message, "hello world");
	assert.equal(parsed.options.model, "thinking");
	assert.equal(parsed.options.newChat, true);
	assert.equal(parsed.options.force, true);
	assert.equal(parsed.options.echoMessage, true);
	assert.equal(parsed.options.noWait, true);
	assert.equal(parsed.options.timeoutMs, 9000);
	assert.equal(parsed.options.pollMs, 120);
});

test("parseArgs parses pp send file input", () => {
	const parsed = parseArgs(["send", "--file", "message.txt"]);

	assert.equal(parsed.kind, "pp-send");
	assert.equal(parsed.options.messageFile, "message.txt");
	assert.equal(parsed.options.message, undefined);
});

test("parseArgs rejects --new with --no-navigate", () => {
	assert.throws(
		() => parseArgs(["send", "hello", "--new", "--no-navigate"]),
		/pp send cannot combine --new with --no-navigate/,
	);
});

test("parseArgs keeps profile binding as profile name", () => {
	const parsed = parseArgs(["wait", "--profile", "team-a"]);

	assert.equal(parsed.kind, "pp-wait");
	assert.equal(parsed.options.profile, "team-a");
	assert.equal(parsed.options.userDataDir, undefined);
});

test("parseArgs rejects --profile combined with --user-data-dir", () => {
	assert.throws(
		() =>
			parseArgs(["wait",
				"--profile",
				"team-a",
				"--user-data-dir",
				"/tmp/profile",
			]),
		/cannot combine --user-data-dir and --profile/,
	);
});

test("parseArgs reads profile name from PP_PROFILE env", () => {
	withEnvVar("PP_PROFILE", "team-env", () => {
		const parsed = parseArgs(["wait"]);

		assert.equal(parsed.kind, "pp-wait");
		assert.equal(parsed.options.profile, "team-env");
		assert.equal(parsed.options.userDataDir, undefined);
	});
});

test("parseArgs keeps session binding as session name", () => {
	const parsed = parseArgs(["wait", "--session", "team-a"]);

	assert.equal(parsed.kind, "pp-wait");
	assert.equal(parsed.options.session, "team-a");
});

test("parseArgs reads session name from PLAYWRIGHT_CLI_SESSION env", () => {
	withEnvVar("PLAYWRIGHT_CLI_SESSION", "team-env", () => {
		const parsed = parseArgs(["wait"]);

		assert.equal(parsed.kind, "pp-wait");
		assert.equal(parsed.options.session, "team-env");
	});
});

test("parseArgs reads browser from PP_BROWSER env", () => {
	withEnvVar("PP_BROWSER", "firefox", () => {
		const parsed = parseArgs(["wait"]);

		assert.equal(parsed.kind, "pp-wait");
		assert.equal(parsed.options.browser, "firefox");
	});
});

test("parseArgs reads chromium launch profile from PP_CHROMIUM_LAUNCH_PROFILE env", () => {
	withEnvVar("PP_CHROMIUM_LAUNCH_PROFILE", "strict", () => {
		const parsed = parseArgs(["wait"]);

		assert.equal(parsed.kind, "pp-wait");
		assert.equal(parsed.options.chromiumLaunchProfile, "strict");
	});
});

test("parseArgs profile option overrides invalid profile env", () => {
	withEnvVar("PP_PROFILE", "bad/name", () => {
		const parsed = parseArgs(["wait", "--profile", "team-ok"]);

		assert.equal(parsed.kind, "pp-wait");
		assert.equal(parsed.options.profile, "team-ok");
		assert.equal(parsed.options.userDataDir, undefined);
	});
});

test("parseArgs session option overrides invalid session env", () => {
	withEnvVar("PLAYWRIGHT_CLI_SESSION", "bad/name", () => {
		const parsed = parseArgs(["wait", "--session", "team-ok"]);

		assert.equal(parsed.kind, "pp-wait");
		assert.equal(parsed.options.session, "team-ok");
	});
});

test("parseArgs browser option overrides invalid browser env", () => {
	withEnvVar("PP_BROWSER", "netscape", () => {
		const parsed = parseArgs(["wait", "--browser", "chromium"]);

		assert.equal(parsed.kind, "pp-wait");
		assert.equal(parsed.options.browser, "chromium");
	});
});

test("parseArgs chromium launch profile option overrides invalid env", () => {
	withEnvVar("PP_CHROMIUM_LAUNCH_PROFILE", "aggressive", () => {
		const parsed = parseArgs(["wait",
			"--chromium-launch-profile",
			"low-detection",
		]);

		assert.equal(parsed.kind, "pp-wait");
		assert.equal(parsed.options.chromiumLaunchProfile, "low-detection");
	});
});

test("parseArgs user-data-dir option overrides invalid profile env", () => {
	withEnvVar("PP_PROFILE", "bad/name", () => {
		const parsed = parseArgs(["wait", "--user-data-dir", "/tmp/profile"]);
		assert.equal(parsed.kind, "pp-wait");
		assert.equal(parsed.options.userDataDir, "/tmp/profile");
	});
});

test("parseArgs fails loudly on invalid PP_PROFILE env value", () => {
	withEnvVar("PP_PROFILE", "bad/name", () => {
		assert.throws(() => parseArgs(["wait"]), /Invalid profile reference/);
	});
});

test("parseArgs fails loudly on invalid PLAYWRIGHT_CLI_SESSION env value", () => {
	withEnvVar("PLAYWRIGHT_CLI_SESSION", "bad/name", () => {
		assert.throws(() => parseArgs(["wait"]), /Invalid session reference/);
	});
});

test("parseArgs fails loudly on invalid PP_BROWSER env value", () => {
	withEnvVar("PP_BROWSER", "netscape", () => {
		assert.throws(
			() => parseArgs(["wait"]),
			/Invalid browser selection/,
		);
	});
});

test("parseArgs fails loudly on invalid PP_CHROMIUM_LAUNCH_PROFILE env value", () => {
	withEnvVar("PP_CHROMIUM_LAUNCH_PROFILE", "aggressive", () => {
		assert.throws(
			() => parseArgs(["wait"]),
			/Invalid chromium launch profile/,
		);
	});
});

test("parseArgs parses pp compose positional entries", () => {
	const parsed = parseArgs(["compose",
		"--preamble-file",
		"docs/preamble.md",
		"src/cli.ts",
		"src/navigator/runtime/cli_runner.ts:1-50",
	]);

	assert.equal(parsed.kind, "pp-compose");
	assert.deepEqual(parsed.options.entries, [
		"src/cli.ts",
		"src/navigator/runtime/cli_runner.ts:1-50",
	]);
});

test("parseArgs parses pp brief positional entries and flags", () => {
	const parsed = parseArgs(["brief",
		"--preamble-file",
		"docs/preamble.md",
		"src/cli.ts",
		"--inline-entries",
		"--attach",
		"a.png",
		"--attach",
		"b.jpg",
		"--model",
		"pro",
		"--new",
		"--force",
		"--timeout",
		"45000",
	]);

	assert.equal(parsed.kind, "pp-brief");
	assert.deepEqual(parsed.options.entries, ["src/cli.ts"]);
	assert.equal(parsed.options.inlineEntries, true);
	assert.deepEqual(parsed.options.attachFiles, ["a.png", "b.jpg"]);
	assert.equal(parsed.options.model, "pro");
	assert.equal(parsed.options.newChat, true);
	assert.equal(parsed.options.force, true);
	assert.equal(parsed.options.timeoutMs, 45000);
});

test("parseArgs rejects conflicting pp brief entry mode flags", () => {
	assert.throws(
		() =>
			parseArgs([
				"brief",
				"--preamble-file",
				"docs/preamble.md",
				"--inline-entries",
				"--archive-entries",
				"src/cli.ts",
			]),
		/cannot combine --inline-entries with --archive-entries/,
	);
});

test("parseArgs parses pp attach positional files and stdin naming", () => {
	const parsed = parseArgs(["attach",
		"a.png",
		"b.txt",
		"--name",
		"note.md",
		"--prompt",
		"summarize",
		"--send",
		"--wait-for-response",
		"--timeout",
		"1000",
		"--poll-ms",
		"55",
	]);

	assert.equal(parsed.kind, "pp-attach");
	assert.deepEqual(parsed.options.files, ["a.png", "b.txt"]);
	assert.equal(parsed.options.textName, "note.md");
	assert.equal(parsed.options.prompt, "summarize");
	assert.equal(parsed.options.send, true);
	assert.equal(parsed.options.waitForResponse, true);
	assert.equal(parsed.options.timeoutMs, 1000);
	assert.equal(parsed.options.pollMs, 55);
});

test("parseArgs parses pp paste flags", () => {
	const parsed = parseArgs(["paste", "--send", "--clear"]);

	assert.equal(parsed.kind, "pp-paste");
	assert.equal(parsed.options.send, true);
	assert.equal(parsed.options.clear, true);
});

test("parseArgs parses pp history format flags", () => {
	const parsedJson = parseArgs(["history", "--last", "4", "--json"]);

	assert.equal(parsedJson.kind, "pp-history");
	assert.equal(parsedJson.options.json, true);
});

test("parseArgs rejects pp history raw flag", () => {
	assert.throws(
		() => parseArgs(["history", "--raw"]),
		/unknown option '--raw'/,
	);
});

test("parseArgs parses pp download options", () => {
	const parsed = parseArgs(["download",
		"--list",
		"--index",
		"1",
		"--output",
		"out.txt",
	]);

	assert.equal(parsed.kind, "pp-download");
	assert.equal(parsed.options.list, true);
	assert.equal(parsed.options.index, 1);
	assert.equal(parsed.options.output, "out.txt");
});

test("parseArgs parses pp set-model/new/refresh/isolate", () => {
	const setModel = parseArgs(["set-model", "instant"]);
	const startNew = parseArgs(["new", "--model", "auto"]);
	const refresh = parseArgs(["refresh"]);
	const isolate = parseArgs(["isolate"]);

	assert.equal(setModel.kind, "pp-set-model");
	assert.equal(setModel.options.mode, "instant");
	assert.equal(startNew.kind, "pp-new");
	assert.equal(startNew.options.model, "auto");
	assert.equal(refresh.kind, "pp-refresh");
	assert.equal(isolate.kind, "pp-isolate");
});

test("navigator aliases are removed from parseArgs surface", () => {
	assert.throws(
		() => parseArgs(["navigator-send", "--message", "hello"]),
		/unknown command 'navigator-send'/,
	);
});

test("pp compose requires preamble-file option", () => {
	const result = runCli(["compose", "src/cli.ts"]);

	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/missing required option '--preamble-file'\nusage: pp <command> \[options\]\n/,
	);
});

test("pp send rejects unknown model values", () => {
	const result = runCli(["send", "--model", "turbo", "hello"]);

	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/Unknown mode: turbo\. Use auto, instant, thinking, or pro\./,
	);
});

test("pp send fails before browser launch when message is missing", () => {
	const result = runCli(["send",
		"--chromium-bin",
		"/tmp/does-not-matter",
		"--user-data-dir",
		"/tmp/does-not-matter",
	]);

	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/No message provided \(use positional arg, --file, or stdin\)/,
	);
});

test("auth-listen validates integer port", () => {
	const result = runCli(["auth-listen", "--port", "not-a-number"]);

	assert.equal(result.status, 1);
	assert.match(result.stderr, /option '--port' must be an integer/);
});

test("parseArgs parses auth-listen session binding", () => {
	const parsed = parseArgs(["auth-listen", "--session", "team-a"]);

	assert.equal(parsed.kind, "auth-listen");
	assert.equal(parsed.session, "team-a");
});

test("pp send rejects auth-file with user-data-dir", () => {
	const result = runCli(["send",
		"hello",
		"--auth-file",
		"/tmp/auth.json",
		"--user-data-dir",
		"/tmp/profile",
	]);

	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/auth file cannot be combined with userDataDir; choose exactly one auth source/,
	);
});

test("pp send fails when auth-file path is missing", () => {
	const result = runCli(["send",
		"hello",
		"--auth-file",
		"/tmp/definitely-missing-auth-file.json",
	]);

	assert.equal(result.status, 1);
	assert.match(result.stderr, /auth file does not exist:/);
});

test("pp send rejects auth-file with cdp-url", () => {
	const result = runCli(["send",
		"hello",
		"--auth-file",
		"/tmp/auth.json",
		"--cdp-url",
		"http://127.0.0.1:9222",
	]);

	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/auth file cannot be used with cdpUrl; use userDataDir\/profile or remove cdpUrl/,
	);
});

test("pp send reads project from PP_CHATGPT_PROJECT", () => {
	const result = runCli(
		["send", "hello", "--cdp-url", "http://127.0.0.1:9"],
		{
			PP_CHATGPT_PROJECT: "not-a-project",
		},
	);

	assert.equal(result.status, 1);
	assert.match(result.stderr, /Invalid project reference: not-a-project/);
});

test("pp send option project overrides invalid env project", () => {
	const result = runCli(["send", "--project", "g-p-from-option"], {
		PP_CHATGPT_PROJECT: "not-a-project",
	});

	assert.equal(result.status, 1);
	assert.doesNotMatch(
		result.stderr,
		/Invalid project reference: not-a-project/,
	);
	assert.match(
		result.stderr,
		/No message provided \(use positional arg, --file, or stdin\)/,
	);
});

test("pp download validates integer index option", () => {
	const result = runCli(["download", "--index", "not-a-number"]);

	assert.equal(result.status, 1);
	assert.match(result.stderr, /option '--index' must be an integer/);
});

test("navigator alias commands are rejected after cleanup", () => {
	const result = runCli(["navigator-send"]);

	assert.equal(result.status, 1);
	assert.match(result.stderr, /unknown command 'navigator-send'/);
});
