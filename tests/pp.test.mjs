import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
	resolvePpCommandLockPath,
} = require("../dist/navigator/runtime/cli_runner.js");

const workspaceRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const cliPath = path.join(workspaceRoot, "dist", "cli.js");

const runCli = (args, envOverrides = {}) =>
	spawnSync(process.execPath, [cliPath, ...args], {
		cwd: workspaceRoot,
		encoding: "utf8",
		env: {
			...process.env,
			...envOverrides,
		},
	});

const withEnv = (patches, fn) => {
	const previous = new Map();
	for (const [key, value] of Object.entries(patches)) {
		previous.set(key, process.env[key]);
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	try {
		return fn();
	} finally {
		for (const [key, value] of previous.entries()) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
};

test("pp commands fail fast when another pp command lock is active", () => {
	const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pp-lock-"));
	const lockEnv = {
		XDG_STATE_HOME: stateRoot,
		PP_PROFILE: "",
		PP_CHATGPT_PROJECT: "",
	};
	const lockPath = withEnv(
		lockEnv,
		() =>
			resolvePpCommandLockPath({
				headless: false,
				chatUrl: "https://chatgpt.com",
				noNavigate: false,
				strictTabTargeting: false,
			}),
	);
	fs.mkdirSync(path.dirname(lockPath), { recursive: true });
	fs.writeFileSync(
		lockPath,
		JSON.stringify({
			pid: process.pid,
			token: "test-token",
			command: "navigator:wait",
			startedAtIso: new Date().toISOString(),
		}),
	);

	const result = runCli(["history", "--json"], lockEnv);

	assert.equal(result.status, 1);
	assert.match(result.stderr, /another pp command is running/);
});
