import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	clearReusableSessionState,
	loadReusableSessionState,
	saveReusableSessionLastPage,
	saveReusableSessionState,
} = require("../../dist/navigator/runtime/chatgpt_session/reusable_session_state.js");

const withTempHome = (fn) => {
	const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-session-state-"));
	try {
		fn(homeDir);
	} finally {
		fs.rmSync(homeDir, { recursive: true, force: true });
	}
};

test("reusable session state persists launch metadata and last page", () => {
	withTempHome((homeDir) => {
		const launch = {
			chromiumBin: "/usr/bin/chromium",
			userDataDir: "/tmp/pp/profile",
			headless: true,
			chromiumLaunchProfile: "low-detection",
		};

		saveReusableSessionState({
			targetUrl: "https://chatgpt.com",
			cdpUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
				chromiumBin: launch.chromiumBin,
				userDataDir: launch.userDataDir,
				headless: launch.headless,
				chromiumLaunchProfile: launch.chromiumLaunchProfile,
				env: {},
				homeDir,
			});
		saveReusableSessionLastPage({
			targetUrl: "https://chatgpt.com",
			launch,
			lastPageUrl: "https://chatgpt.com/c/abc123",
			env: {},
			homeDir,
		});

		const loaded = loadReusableSessionState({
			targetUrl: "https://chatgpt.com",
			launch,
			env: {},
			homeDir,
		});
			assert.equal(loaded?.host, "chatgpt.com");
			assert.equal(loaded?.cdpUrl, "ws://127.0.0.1:9222/devtools/browser/abc");
			assert.equal(loaded?.userDataDir, launch.userDataDir);
			assert.equal(
				loaded?.chromiumLaunchProfile,
				launch.chromiumLaunchProfile,
			);
			assert.equal(loaded?.lastPageUrl, "https://chatgpt.com/c/abc123");
			assert.equal(typeof loaded?.updatedAtIso, "string");
		});
});

test("reusable session state isolates launch identities on the same host", () => {
	withTempHome((homeDir) => {
		const launchA = {
			chromiumBin: "/usr/bin/chromium",
			userDataDir: "/tmp/pp/profile-a",
			headless: true,
			chromiumLaunchProfile: "low-detection",
		};
		const launchB = {
			chromiumBin: "/usr/bin/chromium",
			userDataDir: "/tmp/pp/profile-b",
			headless: true,
			chromiumLaunchProfile: "strict",
		};

		saveReusableSessionState({
			targetUrl: "https://chatgpt.com",
			cdpUrl: "ws://127.0.0.1:9222/devtools/browser/a",
				chromiumBin: launchA.chromiumBin,
				userDataDir: launchA.userDataDir,
				headless: launchA.headless,
				chromiumLaunchProfile: launchA.chromiumLaunchProfile,
				env: {},
				homeDir,
			});
		saveReusableSessionState({
			targetUrl: "https://chatgpt.com",
			cdpUrl: "ws://127.0.0.1:9222/devtools/browser/b",
				chromiumBin: launchB.chromiumBin,
				userDataDir: launchB.userDataDir,
				headless: launchB.headless,
				chromiumLaunchProfile: launchB.chromiumLaunchProfile,
				env: {},
				homeDir,
			});

		const loadedA = loadReusableSessionState({
			targetUrl: "https://chatgpt.com",
			launch: launchA,
			env: {},
			homeDir,
		});
		const loadedB = loadReusableSessionState({
			targetUrl: "https://chatgpt.com",
			launch: launchB,
			env: {},
			homeDir,
		});

			assert.equal(loadedA?.cdpUrl, "ws://127.0.0.1:9222/devtools/browser/a");
			assert.equal(loadedB?.cdpUrl, "ws://127.0.0.1:9222/devtools/browser/b");
			assert.equal(loadedA?.chromiumLaunchProfile, launchA.chromiumLaunchProfile);
			assert.equal(loadedB?.chromiumLaunchProfile, launchB.chromiumLaunchProfile);
		});
	});

test("loadReusableSessionState fails on corrupt json and clear removes the file", () => {
	withTempHome((homeDir) => {
		const file = path.join(
			homeDir,
			".local",
			"state",
			"pp",
			"runtime",
			"chatgpt_com.bad.session.json",
		);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, "{oops", "utf8");

		assert.throws(
			() =>
				loadReusableSessionState({
					targetUrl: "https://chatgpt.com",
					env: {},
					homeDir,
				}),
			/failed to parse reusable session state/,
		);

		clearReusableSessionState({
			targetUrl: "https://chatgpt.com",
			env: {},
			homeDir,
		});
		assert.equal(fs.existsSync(file), false);
	});
});

test("reusable session state isolates launch identities by chromium launch profile", () => {
	withTempHome((homeDir) => {
		const strictLaunch = {
			chromiumBin: "/usr/bin/chromium",
			userDataDir: "/tmp/pp/profile-shared",
			headless: true,
			chromiumLaunchProfile: "strict",
		};
		const lowDetectionLaunch = {
			chromiumBin: "/usr/bin/chromium",
			userDataDir: "/tmp/pp/profile-shared",
			headless: true,
			chromiumLaunchProfile: "low-detection",
		};

		saveReusableSessionState({
			targetUrl: "https://chatgpt.com",
			cdpUrl: "ws://127.0.0.1:9222/devtools/browser/strict",
			chromiumBin: strictLaunch.chromiumBin,
			userDataDir: strictLaunch.userDataDir,
			headless: strictLaunch.headless,
			chromiumLaunchProfile: strictLaunch.chromiumLaunchProfile,
			env: {},
			homeDir,
		});
		saveReusableSessionState({
			targetUrl: "https://chatgpt.com",
			cdpUrl: "ws://127.0.0.1:9222/devtools/browser/low",
			chromiumBin: lowDetectionLaunch.chromiumBin,
			userDataDir: lowDetectionLaunch.userDataDir,
			headless: lowDetectionLaunch.headless,
			chromiumLaunchProfile: lowDetectionLaunch.chromiumLaunchProfile,
			env: {},
			homeDir,
		});

		const loadedStrict = loadReusableSessionState({
			targetUrl: "https://chatgpt.com",
			launch: strictLaunch,
			env: {},
			homeDir,
		});
		const loadedLow = loadReusableSessionState({
			targetUrl: "https://chatgpt.com",
			launch: lowDetectionLaunch,
			env: {},
			homeDir,
		});

		assert.equal(
			loadedStrict?.chromiumLaunchProfile,
			strictLaunch.chromiumLaunchProfile,
		);
		assert.equal(
			loadedLow?.chromiumLaunchProfile,
			lowDetectionLaunch.chromiumLaunchProfile,
		);
		assert.equal(
			loadedStrict?.cdpUrl,
			"ws://127.0.0.1:9222/devtools/browser/strict",
		);
		assert.equal(
			loadedLow?.cdpUrl,
			"ws://127.0.0.1:9222/devtools/browser/low",
		);
	});
});

test("reusable session state isolates named sessions on the same host", () => {
	withTempHome((homeDir) => {
		const launch = {
			chromiumBin: "/usr/bin/chromium",
			userDataDir: "/tmp/pp/profile-shared",
			headless: true,
			chromiumLaunchProfile: "low-detection",
		};

		saveReusableSessionState({
			targetUrl: "https://chatgpt.com",
			cdpUrl: "ws://127.0.0.1:9222/devtools/browser/a",
			chromiumBin: launch.chromiumBin,
			userDataDir: launch.userDataDir,
			headless: launch.headless,
			chromiumLaunchProfile: launch.chromiumLaunchProfile,
			session: "team-a",
			env: {},
			homeDir,
		});
		saveReusableSessionState({
			targetUrl: "https://chatgpt.com",
			cdpUrl: "ws://127.0.0.1:9222/devtools/browser/b",
			chromiumBin: launch.chromiumBin,
			userDataDir: launch.userDataDir,
			headless: launch.headless,
			chromiumLaunchProfile: launch.chromiumLaunchProfile,
			session: "team-b",
			env: {},
			homeDir,
		});

		const loadedA = loadReusableSessionState({
			targetUrl: "https://chatgpt.com",
			launch,
			session: "team-a",
			env: {},
			homeDir,
		});
		const loadedB = loadReusableSessionState({
			targetUrl: "https://chatgpt.com",
			launch,
			session: "team-b",
			env: {},
			homeDir,
		});
		const loadedDefault = loadReusableSessionState({
			targetUrl: "https://chatgpt.com",
			launch,
			env: {},
			homeDir,
		});

		assert.equal(loadedA?.cdpUrl, "ws://127.0.0.1:9222/devtools/browser/a");
		assert.equal(loadedB?.cdpUrl, "ws://127.0.0.1:9222/devtools/browser/b");
		assert.equal(loadedDefault, undefined);
	});
});
