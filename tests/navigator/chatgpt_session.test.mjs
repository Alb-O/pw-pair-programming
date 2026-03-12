import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	openChatgptSession,
	pickSessionPage,
	detectChromiumBin,
	detectFirefoxBin,
	shouldReloadTargetAfterAuthBootstrap,
	shouldNavigateToTargetUrl,
} = require("../../dist/navigator/runtime/chatgpt_session.js");
const {
	resolveDefaultAuthFile,
} = require("../../dist/navigator/runtime/chatgpt_session/auth_bootstrap.js");
const {
	ensureComposerStartupSettled,
} = require("../../dist/navigator/runtime/chatgpt_session/page_selection.js");

const page = (url, focusedOrState = false, visibilityState) => {
	const focused =
		typeof focusedOrState === "boolean"
			? focusedOrState
			: focusedOrState?.focused === true;

	const requestedVisibility =
		typeof focusedOrState === "object" && focusedOrState !== null
			? focusedOrState.visibilityState
			: visibilityState;

	const resolvedVisibility =
		typeof requestedVisibility === "string"
			? requestedVisibility
			: focused
				? "visible"
				: "hidden";

	return {
		url: () => url,
		evaluate: async () => ({
			hasFocus: focused,
			visibilityState: resolvedVisibility,
		}),
	};
};

const context = (...pages) => ({
	pages: () => pages,
});

const withTempBinDir = (fn) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-browser-bin-"));
	try {
		fn(dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
};

const createExecutable = (dir, name) => {
	const file = path.join(dir, name);
	fs.writeFileSync(file, "#!/bin/sh\nexit 0\n", "utf8");
	fs.chmodSync(file, 0o755);
	return file;
};

const startupPage = ({
	states,
	waits,
	url = "https://chatgpt.com/g/g-p-demo/project",
}) => {
	let index = 0;
	return {
		url: () => url,
		evaluate: async () => {
			const current = states[Math.min(index, states.length - 1)];
			index += 1;
			return current;
		},
		waitForTimeout: async (timeout) => {
			waits.push(timeout);
		},
	};
};

test("pickSessionPage prefers focused project conversation tabs", async () => {
	const older = page("https://chatgpt.com/g/g-p-aaa/project", true);
	const newer = page("https://chatgpt.com/g/g-p-aaa/c/123", true);
	const selected = await pickSessionPage({
		context: context(page("https://chatgpt.com", true), older, newer),
	});

	assert.equal(selected, newer);
});

test("pickSessionPage prefers visible project conversation tabs even when not focused", async () => {
	const outside = page("https://chatgpt.com/c/outside", {
		focused: false,
		visibilityState: "visible",
	});
	const older = page("https://chatgpt.com/g/g-p-aaa/c/old", {
		focused: false,
		visibilityState: "hidden",
	});
	const newer = page("https://chatgpt.com/g/g-p-aaa/c/new", {
		focused: false,
		visibilityState: "visible",
	});

	const selected = await pickSessionPage({
		context: context(outside, older, newer),
		targetUrl: "https://chatgpt.com/g/g-p-aaa/project",
	});

	assert.equal(selected, newer);
});

test("pickSessionPage strict mode fails on ambiguous active project tabs", async () => {
	await assert.rejects(
		() =>
			pickSessionPage({
				context: context(
					page("https://chatgpt.com/g/g-p-aaa/project", true),
					page("https://chatgpt.com/g/g-p-aaa/c/123", true),
				),
				strictTabTargeting: true,
			}),
		/strict tab targeting matched 2 visible project\/conversation tabs/,
	);
});

test("pickSessionPage strict mode fails when target project matches exist but all are hidden", async () => {
	await assert.rejects(
		() =>
			pickSessionPage({
				context: context(
					page("https://chatgpt.com/g/g-p-aaa/c/123", {
						focused: false,
						visibilityState: "hidden",
					}),
				),
				targetUrl: "https://chatgpt.com/g/g-p-aaa/project",
				strictTabTargeting: true,
			}),
		(error) => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /did not find a visible tab in target project/);
			assert.match(error.message, /\[hidden/);
			return true;
		},
	);
});

test("pickSessionPage treats www.chatgpt.com project routes as project/conversation tabs", async () => {
	const outside = page("https://chatgpt.com/c/outside", {
		focused: false,
		visibilityState: "visible",
	});
	const wwwProjectConversation = page("https://www.chatgpt.com/g/g-p-aaa/c/new", {
		focused: false,
		visibilityState: "visible",
	});

	const selected = await pickSessionPage({
		context: context(outside, wwwProjectConversation),
	});

	assert.equal(selected, wwwProjectConversation);
});

test("pickSessionPage prefers visible non-chatgpt tabs over hidden newer tabs", async () => {
	const visibleNewTab = page("about:newtab", {
		focused: false,
		visibilityState: "visible",
	});
	const hiddenBlank = page("about:blank", {
		focused: false,
		visibilityState: "hidden",
	});

	const selected = await pickSessionPage({
		context: context(visibleNewTab, hiddenBlank),
		targetUrl: "https://chatgpt.com/g/g-p-aaa/project",
	});

	assert.equal(selected, visibleNewTab);
});

test("detectChromiumBin prefers Windows-host candidates on WSL", () => {
	withTempBinDir((dir) => {
		const linuxChromium = createExecutable(dir, "chromium");
		const windowsHostChrome = path.join(dir, "windows-host", "chrome.exe");
		fs.mkdirSync(path.dirname(windowsHostChrome), { recursive: true });
		fs.writeFileSync(windowsHostChrome, "not-executable-on-linux", "utf8");

		const detected = detectChromiumBin({
			envPath: dir,
			candidates: ["chromium"],
			isWsl: true,
			wslWindowsCandidates: [windowsHostChrome],
		});

		assert.equal(detected, windowsHostChrome);
		assert.notEqual(detected, linuxChromium);
	});
});

test("detectFirefoxBin resolves firefox executable from PATH candidates", () => {
	withTempBinDir((dir) => {
		const firefox = createExecutable(dir, "firefox");
		const detected = detectFirefoxBin({
			envPath: dir,
			candidates: ["firefox"],
			nixPlaywrightBrowserRoots: [],
		});
		assert.equal(detected, firefox);
	});
});

test("detectFirefoxBin prefers nix playwright firefox browser root when present", () => {
	withTempBinDir((dir) => {
		const fromPath = createExecutable(dir, "firefox");
		const browserRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "pp-playwright-browsers-"),
		);
		try {
			const firefoxFromPlaywrightRoot = path.join(
				browserRoot,
				"firefox-1497",
				"firefox",
				"firefox",
			);
			fs.mkdirSync(path.dirname(firefoxFromPlaywrightRoot), {
				recursive: true,
			});
			fs.writeFileSync(firefoxFromPlaywrightRoot, "#!/bin/sh\nexit 0\n", "utf8");
			fs.chmodSync(firefoxFromPlaywrightRoot, 0o755);

			const detected = detectFirefoxBin({
				envPath: dir,
				candidates: ["firefox"],
				nixPlaywrightBrowserRoots: [browserRoot],
			});

			assert.equal(detected, firefoxFromPlaywrightRoot);
			assert.notEqual(detected, fromPath);
		} finally {
			fs.rmSync(browserRoot, {
				recursive: true,
				force: true,
			});
		}
	});
});

test("openChatgptSession rejects cdpUrl when browser is firefox", async () => {
	await assert.rejects(
		() =>
			openChatgptSession({
				browser: "firefox",
				cdpUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
				ensureComposer: false,
			}),
		/cdpUrl is only supported when browser=chromium/,
	);
});

test("resolveDefaultAuthFile resolves host auth file in state root", () => {
	withTempBinDir((dir) => {
		const file = path.join(dir, "xdg-state", "pp", "auth", "chatgpt_com.json");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, '{"cookies":[]}', "utf8");

		const resolved = resolveDefaultAuthFile({
			targetUrl: "https://chatgpt.com/g/g-p-abc/project",
			homeDir: dir,
			env: {
				XDG_STATE_HOME: path.join(dir, "xdg-state"),
			},
		});

		assert.equal(resolved, file);
	});
});

test("resolveDefaultAuthFile prefers session-scoped auth file before legacy root", () => {
	withTempBinDir((dir) => {
		const stateRoot = path.join(dir, "xdg-state");
		const legacyFile = path.join(stateRoot, "pp", "auth", "chatgpt_com.json");
		const sessionFile = path.join(
			stateRoot,
			"pp",
			"auth",
			"sessions",
			"team-a",
			"chatgpt_com.json",
		);
		fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
		fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
		fs.writeFileSync(legacyFile, '{"cookies":[{"name":"legacy"}]}', "utf8");
		fs.writeFileSync(sessionFile, '{"cookies":[{"name":"session"}]}', "utf8");

		const resolved = resolveDefaultAuthFile({
			targetUrl: "https://chatgpt.com/g/g-p-abc/project",
			session: "team-a",
			homeDir: dir,
			env: {
				XDG_STATE_HOME: stateRoot,
			},
		});

		assert.equal(resolved, sessionFile);
	});
});

test("shouldNavigateToTargetUrl suppresses redundant navigation", () => {
	assert.equal(
		shouldNavigateToTargetUrl({
			navigate: true,
			currentUrl: "https://chatgpt.com/g/g-p-demo/c/abc123",
			targetUrl: "https://chatgpt.com/g/g-p-demo/c/abc123",
		}),
		false,
	);
	assert.equal(
		shouldNavigateToTargetUrl({
			navigate: true,
			currentUrl: "https://chatgpt.com",
			targetUrl: "https://chatgpt.com/",
		}),
		false,
	);
});

test("shouldNavigateToTargetUrl preserves project page when target is cached same-project conversation", () => {
	assert.equal(
		shouldNavigateToTargetUrl({
			navigate: true,
			currentUrl: "https://chatgpt.com/g/g-p-demo/project",
			targetUrl: "https://chatgpt.com/g/g-p-demo/c/abc123",
		}),
		false,
	);
	assert.equal(
		shouldNavigateToTargetUrl({
			navigate: true,
			currentUrl: "https://chatgpt.com/g/g-p-demo/c/old",
			targetUrl: "https://chatgpt.com/g/g-p-demo/c/new",
		}),
		true,
	);
	assert.equal(
		shouldNavigateToTargetUrl({
			navigate: true,
			currentUrl: "https://chatgpt.com/g/g-p-demo/c/old",
			targetUrl: "https://chatgpt.com/g/g-p-demo/project",
		}),
		true,
	);
	assert.equal(
		shouldNavigateToTargetUrl({
			navigate: true,
			currentUrl: "https://chatgpt.com/g/g-p-demo/project",
			targetUrl: "https://chatgpt.com/g/g-p-other/c/abc123",
		}),
		true,
	);
});

test("shouldNavigateToTargetUrl can preserve same-project conversation when target is project root", () => {
	assert.equal(
		shouldNavigateToTargetUrl({
			navigate: true,
			currentUrl: "https://chatgpt.com/g/g-p-demo/c/old",
			targetUrl: "https://chatgpt.com/g/g-p-demo/project",
			preserveProjectConversation: false,
		}),
		true,
	);
	assert.equal(
		shouldNavigateToTargetUrl({
			navigate: true,
			currentUrl: "https://chatgpt.com/g/g-p-demo/c/old",
			targetUrl: "https://chatgpt.com/g/g-p-demo/project",
			preserveProjectConversation: true,
		}),
		false,
	);
});

test("shouldNavigateToTargetUrl still navigates across different non-project urls", () => {
	assert.equal(
		shouldNavigateToTargetUrl({
			navigate: true,
			currentUrl: "https://chatgpt.com/c/old",
			targetUrl: "https://chatgpt.com/c/new",
		}),
		true,
	);
	assert.equal(
		shouldNavigateToTargetUrl({
			navigate: false,
			currentUrl: "https://chatgpt.com/g/g-p-demo/c/old",
			targetUrl: "https://chatgpt.com/g/g-p-demo/c/new",
		}),
		false,
	);
});

test("shouldReloadTargetAfterAuthBootstrap only reloads same target url when auth cookies were applied", () => {
	assert.equal(
		shouldReloadTargetAfterAuthBootstrap({
			navigate: true,
			currentUrl: "https://chatgpt.com/g/g-p-demo/project",
			targetUrl: "https://chatgpt.com/g/g-p-demo/project",
			authBootstrapApplied: true,
		}),
		true,
	);
	assert.equal(
		shouldReloadTargetAfterAuthBootstrap({
			navigate: true,
			currentUrl: "https://chatgpt.com/g/g-p-demo/c/abc123",
			targetUrl: "https://chatgpt.com/g/g-p-demo/project",
			authBootstrapApplied: true,
		}),
		false,
	);
	assert.equal(
		shouldReloadTargetAfterAuthBootstrap({
			navigate: false,
			currentUrl: "https://chatgpt.com/g/g-p-demo/project",
			targetUrl: "https://chatgpt.com/g/g-p-demo/project",
			authBootstrapApplied: true,
		}),
		false,
	);
	assert.equal(
		shouldReloadTargetAfterAuthBootstrap({
			navigate: true,
			currentUrl: "https://chatgpt.com/g/g-p-demo/project",
			targetUrl: "https://chatgpt.com/g/g-p-demo/project",
			authBootstrapApplied: false,
		}),
		false,
	);
});

test("ensureComposerStartupSettled waits for stable startup readiness", async () => {
	const waits = [];
	const pageDouble = startupPage({
		states: [
			{
				hasComposer: true,
				readyState: "loading",
				hasSendButton: false,
			},
			{
				hasComposer: true,
				readyState: "interactive",
				hasSendButton: true,
			},
			{
				hasComposer: true,
				readyState: "interactive",
				hasSendButton: true,
			},
		],
		waits,
	});

	await ensureComposerStartupSettled(pageDouble, "#prompt-textarea", 1_200);
	assert.equal(waits.includes(150), true);
	assert.equal(waits.at(-1), 450);
});

test("ensureComposerStartupSettled fails after timeout when startup never settles", async () => {
	const waits = [];
	const pageDouble = startupPage({
		states: [
			{
				hasComposer: false,
				readyState: "loading",
				hasSendButton: false,
			},
		],
		waits,
	});

	await assert.rejects(
		() => ensureComposerStartupSettled(pageDouble, "#prompt-textarea", 300),
		/did not settle within 300ms/,
	);
	assert.equal(waits.length > 0, true);
});
