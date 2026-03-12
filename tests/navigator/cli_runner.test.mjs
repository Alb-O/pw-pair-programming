import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	resolveSessionNavigate,
	resolveSessionOpenTargetUrl,
	resolveSessionStrictTabTargeting,
	resolveSessionTargetUrl,
	shouldPersistReusableSessionLastPage,
	formatStrictTabTargetingError,
	resolvePpSendAction,
	resolvePpFreshSendTargetUrl,
	resolvePpCommandLockPath,
	resolvePpSendSessionMode,
	resolvePpSendStartNewChat,
	resolvePpWaitAction,
	validateNoNavigateBinding,
} = require("../../dist/navigator/runtime/cli_runner.js");

const baseConnection = {
	browser: undefined,
	chromiumLaunchProfile: undefined,
	chromiumBin: undefined,
	cdpUrl: undefined,
	userDataDir: undefined,
	authFile: undefined,
	headless: true,
	chatUrl: "https://chatgpt.com",
	project: undefined,
	projectSource: undefined,
	noNavigate: false,
	composerTimeoutMs: undefined,
};

const reusableState = (overrides = {}) => ({
	version: 1,
	host: "chatgpt.com",
	cdpUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
	chromiumBin: "/usr/bin/chromium",
	chromiumLaunchProfile: "low-detection",
	userDataDir: "/tmp/pp/profile",
	headless: true,
	lastPageUrl: "https://chatgpt.com/c/abc123",
	updatedAtIso: new Date().toISOString(),
	...overrides,
});

test("resolveSessionNavigate honors mode, project source, and overrides", () => {
	assert.equal(resolveSessionNavigate(baseConnection, "non-navigating"), false);
	assert.equal(resolveSessionNavigate(baseConnection, "navigating"), true);
	assert.equal(
		resolveSessionNavigate(baseConnection, "fresh-navigation"),
		true,
	);
	assert.equal(
		resolveSessionNavigate(
			{
				...baseConnection,
				project: "g-p-demo",
				projectSource: "option",
			},
			"non-navigating",
		),
		true,
	);
	assert.equal(
		resolveSessionNavigate(
			{
				...baseConnection,
				project: "g-p-demo",
				projectSource: "env",
			},
			"non-navigating",
		),
		false,
	);
	assert.equal(
		resolveSessionNavigate(
			{
				...baseConnection,
				project: "g-p-demo",
				noNavigate: true,
			},
			"navigating",
		),
		false,
	);
});

test("resolveSessionTargetUrl reuses persisted pages for managed profile sessions", () => {
	const target = resolveSessionTargetUrl({
		connection: baseConnection,
		mode: "navigating",
		reusableState: reusableState(),
	});
	assert.equal(target, "https://chatgpt.com/c/abc123");
});

test("resolveSessionTargetUrl ignores persisted reusable pages when browser is firefox", () => {
	const target = resolveSessionTargetUrl({
		connection: {
			...baseConnection,
			browser: "firefox",
		},
		mode: "navigating",
		reusableState: reusableState(),
	});
	assert.equal(target, "https://chatgpt.com");
});

test("resolveSessionTargetUrl reuses persisted pages when lastPageUrl is on www.chatgpt.com", () => {
	const target = resolveSessionTargetUrl({
		connection: baseConnection,
		mode: "navigating",
		reusableState: reusableState({
			lastPageUrl: "https://www.chatgpt.com/c/abc123",
		}),
	});
	assert.equal(target, "https://www.chatgpt.com/c/abc123");
});

test("resolveSessionTargetUrl prefers project root whenever project binding is present", () => {
	const inProject = resolveSessionTargetUrl({
		connection: {
			...baseConnection,
			project: "g-p-abc123",
			projectSource: "env",
		},
		mode: "navigating",
		reusableState: reusableState({
			lastPageUrl:
				"https://chatgpt.com/g/g-p-abc123-nusim/c/699bd8fb-fdc4-8399-8402-695303dfd11d",
		}),
	});
	assert.equal(inProject, "https://chatgpt.com/g/g-p-abc123/project");

	const outsideProject = resolveSessionTargetUrl({
		connection: {
			...baseConnection,
			project: "g-p-abc123",
			projectSource: "env",
		},
		mode: "navigating",
		reusableState: reusableState({
			lastPageUrl: "https://chatgpt.com/c/abc123",
		}),
	});
	assert.equal(outsideProject, "https://chatgpt.com/g/g-p-abc123/project");
});

test("resolveSessionTargetUrl skips persisted page when connection hints mismatch", () => {
	const explicitCdp = resolveSessionTargetUrl({
		connection: {
			...baseConnection,
			cdpUrl: "http://127.0.0.1:9222",
		},
		mode: "navigating",
		reusableState: reusableState(),
	});
	assert.equal(explicitCdp, "https://chatgpt.com");

	const mismatchedUserDataDir = resolveSessionTargetUrl({
		connection: {
			...baseConnection,
			userDataDir: "/tmp/pp/other-profile",
		},
		mode: "navigating",
		reusableState: reusableState(),
	});
	assert.equal(mismatchedUserDataDir, "https://chatgpt.com");
});

test("resolveSessionOpenTargetUrl does not scope tab selection under --no-navigate unless project is explicit option", () => {
	assert.equal(
		resolveSessionOpenTargetUrl({
			connection: { ...baseConnection, noNavigate: true },
			targetUrl: "https://chatgpt.com/c/abc123",
		}),
		"https://chatgpt.com",
	);

	assert.equal(
		resolveSessionOpenTargetUrl({
			connection: {
				...baseConnection,
				noNavigate: true,
				project: "g-p-demo",
				projectSource: "env",
			},
			targetUrl: "https://chatgpt.com/g/g-p-demo/project",
		}),
		"https://chatgpt.com",
	);

	assert.equal(
		resolveSessionOpenTargetUrl({
			connection: {
				...baseConnection,
				noNavigate: true,
				project: "g-p-demo",
				projectSource: "option",
			},
			targetUrl: "https://chatgpt.com/g/g-p-demo/project",
		}),
		"https://chatgpt.com/g/g-p-demo/project",
	);

	assert.equal(
		resolveSessionOpenTargetUrl({
			connection: { ...baseConnection, noNavigate: false },
			targetUrl: "https://chatgpt.com/c/abc123",
		}),
		"https://chatgpt.com/c/abc123",
	);
});

test("resolveSessionStrictTabTargeting forces strict targeting under --no-navigate", () => {
	assert.equal(resolveSessionStrictTabTargeting(baseConnection), false);
	assert.equal(
		resolveSessionStrictTabTargeting({
			...baseConnection,
			strictTabTargeting: true,
		}),
		true,
	);
	assert.equal(
		resolveSessionStrictTabTargeting({ ...baseConnection, noNavigate: true }),
		true,
	);
	assert.equal(
		resolveSessionStrictTabTargeting({
			...baseConnection,
			noNavigate: true,
			strictTabTargeting: false,
		}),
		true,
	);
});

test("resolvePpSendSessionMode forces fresh-navigation for --new", () => {
	assert.equal(resolvePpSendSessionMode(false), "navigating");
	assert.equal(resolvePpSendSessionMode(undefined), "navigating");
	assert.equal(resolvePpSendSessionMode(true), "fresh-navigation");
});

test("resolvePpSendStartNewChat starts new chat for explicit --new or fresh launch", () => {
	assert.equal(
		resolvePpSendStartNewChat({
			requestedNewChat: true,
			freshLaunch: false,
		}),
		true,
	);
	assert.equal(
		resolvePpSendStartNewChat({
			requestedNewChat: false,
			freshLaunch: true,
		}),
		true,
	);
	assert.equal(
		resolvePpSendStartNewChat({
			requestedNewChat: undefined,
			freshLaunch: false,
		}),
		false,
	);
});

test("resolvePpFreshSendTargetUrl prefers project root over cached conversation", () => {
	assert.equal(
		resolvePpFreshSendTargetUrl({
			...baseConnection,
			project: "g-p-abc123",
		}),
		"https://chatgpt.com/g/g-p-abc123/project",
	);
	assert.equal(resolvePpFreshSendTargetUrl(baseConnection), "https://chatgpt.com");
});

test("resolvePpSendAction rejects sends while response is in progress", () => {
	assert.equal(resolvePpSendAction(true), "response-in-progress");
	assert.equal(resolvePpSendAction(false), "send");
});

test("resolvePpWaitAction routes idle sessions to get-response", () => {
	assert.equal(resolvePpWaitAction(true), "wait");
	assert.equal(resolvePpWaitAction(false), "get-response");
});

test("resolvePpCommandLockPath scopes locks per project and profile context", () => {
	const defaultLockPath = resolvePpCommandLockPath(baseConnection);
	const managedProjectALockPath = resolvePpCommandLockPath({
		...baseConnection,
		project: "g-p-project-a",
		projectSource: "option",
	});
	const managedProjectBLockPath = resolvePpCommandLockPath({
		...baseConnection,
		project: "g-p-project-b",
		projectSource: "option",
	});
	const profileALockPath = resolvePpCommandLockPath({
		...baseConnection,
		profile: "team-a",
	});
	const profileBLockPath = resolvePpCommandLockPath({
		...baseConnection,
		profile: "team-b",
	});
	const sessionALockPath = resolvePpCommandLockPath({
		...baseConnection,
		session: "session-a",
	});
	const sessionBLockPath = resolvePpCommandLockPath({
		...baseConnection,
		session: "session-b",
	});
	const cdpProjectALockPath = resolvePpCommandLockPath({
		...baseConnection,
		cdpUrl: "http://127.0.0.1:9222",
		project: "g-p-project-a",
		projectSource: "option",
	});
	const cdpProjectBLockPath = resolvePpCommandLockPath({
		...baseConnection,
		cdpUrl: "http://127.0.0.1:9222",
		project: "g-p-project-b",
		projectSource: "option",
	});
	const cdpCanonicalProjectLockPath = resolvePpCommandLockPath({
		...baseConnection,
		cdpUrl: "http://127.0.0.1:9222",
		project: "https://chatgpt.com/g/g-p-project-a/project",
		projectSource: "option",
	});
	const strictChromiumProfileLockPath = resolvePpCommandLockPath({
		...baseConnection,
		chromiumLaunchProfile: "strict",
	});
	const authProjectALockPath = resolvePpCommandLockPath({
		...baseConnection,
		authFile: "/tmp/pp-auth-a.json",
		project: "g-p-project-a",
		projectSource: "option",
	});
	const authProjectBLockPath = resolvePpCommandLockPath({
		...baseConnection,
		authFile: "/tmp/pp-auth-a.json",
		project: "g-p-project-b",
		projectSource: "option",
	});

	assert.equal(
		resolvePpCommandLockPath({
			...baseConnection,
			project: "g-p-project-a",
			projectSource: "option",
		}),
		managedProjectALockPath,
	);
	assert.equal(defaultLockPath, managedProjectALockPath);
	assert.equal(managedProjectALockPath, managedProjectBLockPath);
	assert.notEqual(defaultLockPath, profileALockPath);
	assert.notEqual(profileALockPath, profileBLockPath);
	assert.notEqual(defaultLockPath, sessionALockPath);
	assert.notEqual(sessionALockPath, sessionBLockPath);
	assert.notEqual(cdpProjectALockPath, cdpProjectBLockPath);
	assert.notEqual(authProjectALockPath, authProjectBLockPath);
	assert.notEqual(defaultLockPath, strictChromiumProfileLockPath);
	assert.equal(cdpProjectALockPath, cdpCanonicalProjectLockPath);
});

test("validateNoNavigateBinding throws when --no-navigate host mismatches chatUrl", () => {
	assert.throws(
		() =>
			validateNoNavigateBinding({
				connection: { ...baseConnection, noNavigate: true },
				currentUrl: "https://example.com",
			}),
		/--no-navigate requires an existing ChatGPT tab/,
	);
});

test("validateNoNavigateBinding throws when option --project mismatches under --no-navigate", () => {
	assert.throws(
		() =>
			validateNoNavigateBinding({
				connection: {
					...baseConnection,
					noNavigate: true,
					project: "g-p-demo",
					projectSource: "option",
				},
				currentUrl: "https://chatgpt.com/g/g-p-other/c/abc123",
			}),
		/--project was provided with --no-navigate/,
	);
});

test("validateNoNavigateBinding allows option --project match under --no-navigate", () => {
	const warnings = validateNoNavigateBinding({
		connection: {
			...baseConnection,
			noNavigate: true,
			project: "g-p-demo",
			projectSource: "option",
		},
		currentUrl: "https://chatgpt.com/g/g-p-demo/c/abc123",
	});
	assert.deepEqual(warnings, []);
});

test("validateNoNavigateBinding warns (not throws) for env project mismatch under --no-navigate", () => {
	const warnings = validateNoNavigateBinding({
		connection: {
			...baseConnection,
			noNavigate: true,
			project: "g-p-demo",
			projectSource: "env",
		},
		currentUrl: "https://chatgpt.com/g/g-p-other/c/abc123",
	});
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /env project binding does not match current tab/);
});

test("validateNoNavigateBinding throws when --no-navigate currentUrl is empty", () => {
	assert.throws(
		() =>
			validateNoNavigateBinding({
				connection: { ...baseConnection, noNavigate: true },
				currentUrl: "   ",
			}),
		/Current tab URL: <empty>/,
	);
});

test("validateNoNavigateBinding is a no-op when --no-navigate is false", () => {
	const warnings = validateNoNavigateBinding({
		connection: {
			...baseConnection,
			noNavigate: false,
			project: "g-p-demo",
			projectSource: "option",
		},
		currentUrl: "https://example.com",
	});
	assert.deepEqual(warnings, []);
});

test("formatStrictTabTargetingError annotates strict targeting failures under --no-navigate", () => {
	const raw =
		"strict tab targeting matched 2 visible ChatGPT tabs: https://chatgpt.com/c/a, https://chatgpt.com/c/b";
	const formatted = formatStrictTabTargetingError({
		connection: { ...baseConnection, noNavigate: true },
		errorMessage: raw,
	});
	assert.match(formatted, /Hint:/);
	assert.match(formatted, /--no-navigate/);
	assert.match(formatted, /visible/i);
});

test("formatStrictTabTargetingError leaves unrelated errors untouched", () => {
	const raw = "some other error";
	const formatted = formatStrictTabTargetingError({
		connection: { ...baseConnection, noNavigate: true },
		errorMessage: raw,
	});
	assert.equal(formatted, raw);
});

test("shouldPersistReusableSessionLastPage only persists visible tabs", () => {
	assert.equal(shouldPersistReusableSessionLastPage("visible"), true);
	assert.equal(shouldPersistReusableSessionLastPage("hidden"), false);
	assert.equal(shouldPersistReusableSessionLastPage("prerender"), false);
	assert.equal(shouldPersistReusableSessionLastPage(""), false);
});
