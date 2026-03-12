import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	resolveDefaultAuthBootstrapFile,
	resolveProfileAuthBootstrapFile,
	readAuthStorageState,
	applyAuthStorageStateToContext,
} = require("../../dist/navigator/runtime/chatgpt_session/auth_bootstrap.js");

test("resolveProfileAuthBootstrapFile installs auth per profile and host", () => {
	const file = resolveProfileAuthBootstrapFile({
		profile: "chatgpt-profile",
		targetUrl: "https://chatgpt.com",
		homeDir: "/tmp/home",
		env: {},
	});

	assert.equal(
		file,
		"/tmp/home/.local/state/pp/profiles/chatgpt-profile/auth/chatgpt_com.json",
	);
});

test("resolveDefaultAuthBootstrapFile prefers profile-scoped auth over global auth", () => {
	const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-auth-bootstrap-"));
	try {
		const profileFile = path.join(
			baseDir,
			".local",
			"state",
			"pp",
			"profiles",
			"chatgpt-profile",
			"auth",
			"chatgpt_com.json",
		);
		const globalFile = path.join(
			baseDir,
			".local",
			"state",
			"pp",
			"auth",
			"chatgpt_com.json",
		);
		fs.mkdirSync(path.dirname(profileFile), { recursive: true });
		fs.mkdirSync(path.dirname(globalFile), { recursive: true });
		fs.writeFileSync(profileFile, '{"cookies":[{"name":"a","value":"1","domain":".chatgpt.com"}]}', "utf8");
		fs.writeFileSync(globalFile, '{"cookies":[{"name":"b","value":"2","domain":".chatgpt.com"}]}', "utf8");

		const resolved = resolveDefaultAuthBootstrapFile({
			targetUrl: "https://chatgpt.com",
			profile: "chatgpt-profile",
			homeDir: baseDir,
			env: {},
		});

		assert.equal(resolved, profileFile);
	} finally {
		fs.rmSync(baseDir, { recursive: true, force: true });
	}
});

test("readAuthStorageState parses cookies and origin localStorage", () => {
	const file = path.join(os.tmpdir(), `pp-auth-state-${Date.now()}.json`);
	try {
		fs.writeFileSync(
			file,
			JSON.stringify({
				cookies: [
					{
						name: "__Secure-next-auth.session-token",
						value: "token",
						domain: ".chatgpt.com",
						path: "/",
						expires: -1,
						httpOnly: true,
						secure: true,
						sameSite: "Lax",
					},
				],
				origins: [
					{
						origin: "https://chatgpt.com",
						localStorage: [{ name: "key", value: "value" }],
					},
				],
			}),
			"utf8",
		);

		const parsed = readAuthStorageState(file);
		assert.equal(parsed.cookies.length, 1);
		assert.equal(parsed.origins.length, 1);
		assert.equal(parsed.origins[0].localStorage[0].name, "key");
	} finally {
		fs.rmSync(file, { force: true });
	}
});

test("applyAuthStorageStateToContext adds cookies and localStorage", async () => {
	const file = path.join(os.tmpdir(), `pp-auth-apply-${Date.now()}.json`);
	const addedCookies = [];
	const navigations = [];
	const localStorageWrites = [];
	try {
		fs.writeFileSync(
			file,
			JSON.stringify({
				cookies: [
					{
						name: "__Secure-next-auth.session-token",
						value: "token",
						domain: ".chatgpt.com",
						path: "/",
						expires: -1,
						httpOnly: true,
						secure: true,
						sameSite: "Lax",
					},
				],
				origins: [
					{
						origin: "https://chatgpt.com",
						localStorage: [{ name: "auth", value: "ok" }],
					},
				],
			}),
			"utf8",
		);

		await applyAuthStorageStateToContext({
			context: {
				pages: () => [],
				newPage: async () => {
					throw new Error("not used");
				},
				close: async () => {},
				addCookies: async (cookies) => {
					addedCookies.push(...cookies);
				},
			},
			page: {
				url: () => "about:blank",
				close: async () => {},
				bringToFront: async () => {},
				click: async () => {},
				waitForTimeout: async () => {},
				waitForSelector: async () => ({}),
				goto: async (url) => {
					navigations.push(url);
				},
				evaluate: async (_fn, arg) => {
					localStorageWrites.push(arg);
				},
			},
			authFile: file,
		});

		assert.equal(addedCookies.length, 1);
		assert.deepEqual(navigations, ["https://chatgpt.com"]);
		assert.equal(localStorageWrites.length, 1);
		assert.equal(localStorageWrites[0][0].name, "auth");
	} finally {
		fs.rmSync(file, { force: true });
	}
});
