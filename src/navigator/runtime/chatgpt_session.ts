import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	applyAuthCookiesToContext,
	resolveDefaultAuthFile,
} from "./chatgpt_session/auth_bootstrap";
import {
	COMPATIBLE_CHROMIUM_BINARIES,
	COMPATIBLE_FIREFOX_BINARIES,
	WSL_WINDOWS_BROWSER_CANDIDATES,
	detectChromiumBin,
	detectFirefoxBin,
	isWsl,
	isWslWindowsBrowserPath,
	requireChromiumBin,
} from "./chatgpt_session/browser_resolution";
import {
	NAVIGATOR_DEFAULT_BROWSER,
	type NavigatorBrowser,
} from "./chatgpt_session/browser_env";
import {
	NAVIGATOR_DEFAULT_CHROMIUM_LAUNCH_PROFILE,
	type NavigatorChromiumLaunchProfile,
} from "./chatgpt_session/chromium_launch_profile_env";
import {
	ensureComposerReady,
	ensureComposerStartupSettled,
	pickSessionPage,
} from "./chatgpt_session/page_selection";
import { launchDetachedBrowserViaCdp } from "./chatgpt_session/detached_cdp";
import {
	clearReusableSessionState,
	loadReusableSessionState,
	reusableSessionMatchesLaunch,
	saveReusableSessionState,
} from "./chatgpt_session/reusable_session_state";
import { launchWslWindowsBrowserViaCdp } from "./chatgpt_session/wsl_windows_host";
import { profileUserDataDir } from "../profile/profile_env";
import { parseProjectId } from "../project/project_ref";
import { resolveNavigatorManagedProfileName } from "./managed_profile";
import { resolveProfileRuntimeUserDataDir } from "./chatgpt_session/profile_runtime_partition";
import type {
	ChatgptSession,
	ChromiumLauncher,
	FirefoxLauncher,
	OpenChatgptSessionOptions,
	RuntimeBrowser,
	RuntimeContext,
	RuntimePage,
	SessionOwnership,
} from "./chatgpt_session/types";

/**
 * Browser session launcher for navigator commands.
 * Supports three auth modes: CDP attach, persistent profile, and storage-state file.
 */
const { chromium, firefox } = require("@playwright/test") as {
	chromium: ChromiumLauncher;
	firefox: FirefoxLauncher;
};

const DEFAULT_CHAT_URL = "https://chatgpt.com";
const DEFAULT_COMPOSER_SELECTOR = "#prompt-textarea";
const CONTEXT_PAGE_DISCOVERY_TIMEOUT_MS = 5_000;
const CONTEXT_PAGE_DISCOVERY_POLL_MS = 100;
const FIREFOX_LAUNCH_TIMEOUT_MS = 45_000;
const CHROMIUM_STRICT_LAUNCH_ARGS = [
	"--no-sandbox",
	"--disable-dev-shm-usage",
	"--disable-gpu",
	"--disable-software-rasterizer",
] as const;
const CHROMIUM_LOW_DETECTION_LAUNCH_ARGS = [
	"--disable-blink-features=AutomationControlled",
] as const;
const CHATGPT_HOST_RE = /^(?:www\.)?chatgpt\.com$/i;

const isNonEmpty = (value?: string): value is string =>
	value !== undefined && value.trim() !== "";

const STARTUP_JUNK_PAGE_URL_PREFIXES = [
	"about:blank",
	"about:newtab",
	"about:home",
	"about:welcome",
	"chrome://newtab",
	"chrome://new-tab-page",
	"chrome://setup",
	"chrome://welcome",
	"edge://newtab",
	"edge://new-tab-page",
	"edge://first-run",
	"edge://welcome",
] as const;

const isStartupJunkPageUrl = (url: string): boolean => {
	const normalized = url.trim().toLowerCase();
	if (normalized === "") {
		return true;
	}
	return STARTUP_JUNK_PAGE_URL_PREFIXES.some((prefix) =>
		normalized.startsWith(prefix),
	);
};

const closeNonSelectedStartupJunkPages = async ({
	context,
	selectedPage,
}: {
	context: RuntimeContext;
	selectedPage: RuntimePage;
}): Promise<void> => {
	for (const page of context.pages()) {
		if (page === selectedPage) {
			continue;
		}
		if (!isStartupJunkPageUrl(page.url())) {
			continue;
		}
		if (typeof page.close !== "function") {
			continue;
		}
		try {
			await page.close();
		} catch {}
	}
};

const bringPageToFront = async (page: RuntimePage): Promise<void> => {
	if (typeof page.bringToFront !== "function") {
		return;
	}
	try {
		await page.bringToFront();
	} catch {}
};

const resolveBrowserSelection = (
	browser?: NavigatorBrowser,
): NavigatorBrowser => browser ?? NAVIGATOR_DEFAULT_BROWSER;

const resolveChromiumLaunchProfile = (
	chromiumLaunchProfile?: NavigatorChromiumLaunchProfile,
): NavigatorChromiumLaunchProfile =>
	chromiumLaunchProfile ?? NAVIGATOR_DEFAULT_CHROMIUM_LAUNCH_PROFILE;

const resolveChromiumLaunchArgs = (
	chromiumLaunchProfile: NavigatorChromiumLaunchProfile,
): readonly string[] =>
	chromiumLaunchProfile === "strict"
		? CHROMIUM_STRICT_LAUNCH_ARGS
		: CHROMIUM_LOW_DETECTION_LAUNCH_ARGS;

const resolveFirefoxLaunchBin = (browserBin?: string): string | undefined => {
	if (isNonEmpty(browserBin)) {
		return browserBin;
	}
	return detectFirefoxBin() ?? undefined;
};

const firefoxLaunchErrorLooksRecoverable = (error: unknown): boolean => {
	if (!(error instanceof Error)) {
		return false;
	}
	if (!error.message.includes("launchPersistentContext")) {
		return false;
	}
	return (
		error.message.includes("Timeout") ||
		error.message.includes("Browser closed") ||
		error.message.includes("Target page, context or browser has been closed")
	);
};

const archiveAndResetFirefoxUserDataDir = (userDataDir: string): void => {
	if (fs.existsSync(userDataDir)) {
		const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
		const archivePath = `${userDataDir}.stale-${timestamp}`;
		try {
			fs.renameSync(userDataDir, archivePath);
		} catch {
			fs.rmSync(userDataDir, {
				recursive: true,
				force: true,
			});
		}
	}
	fs.mkdirSync(userDataDir, { recursive: true });
};

const waitForContextPages = async (
	context: RuntimeContext,
	timeoutMs: number,
): Promise<void> => {
	let elapsedMs = 0;
	while (context.pages().length === 0 && elapsedMs < timeoutMs) {
		await new Promise<void>((resolve) => {
			setTimeout(resolve, CONTEXT_PAGE_DISCOVERY_POLL_MS);
		});
		elapsedMs += CONTEXT_PAGE_DISCOVERY_POLL_MS;
	}
};

const comparableUrl = (url: string): string | undefined => {
	try {
		const parsed = new URL(url);
		parsed.hash = "";
		return parsed.href;
	} catch {
		return undefined;
	}
};

const parseProjectRoute = (
	url: string,
): {
	projectId: string;
	kind: "project" | "conversation";
} | undefined => {
	if (!isNonEmpty(url)) {
		return undefined;
	}
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}
	if (!CHATGPT_HOST_RE.test(parsed.hostname)) {
		return undefined;
	}

	const segments = parsed.pathname
		.split("/")
		.map((segment) => segment.trim())
		.filter((segment) => segment !== "");
	if (segments[0] !== "g") {
		return undefined;
	}
	const projectSegment = segments[1];
	if (projectSegment === undefined) {
		return undefined;
	}
	const isProjectRoute =
		segments.length === 2 ||
		(segments.length === 3 && segments[2] === "project");
	const isConversationRoute =
		segments.length === 4 &&
		segments[2] === "c" &&
		(segments[3] ?? "").trim() !== "";
	if (!isProjectRoute && !isConversationRoute) {
		return undefined;
	}

	try {
		return {
			projectId: parseProjectId(projectSegment),
			kind: isProjectRoute ? "project" : "conversation",
		};
	} catch {
		return undefined;
	}
};

const shouldPreserveProjectPage = (
	currentUrl: string,
	targetUrl: string,
	preserveProjectConversation: boolean,
): boolean => {
	const currentRoute = parseProjectRoute(currentUrl);
	const targetRoute = parseProjectRoute(targetUrl);
	if (currentRoute === undefined || targetRoute === undefined) {
		return false;
	}
	if (currentRoute.projectId !== targetRoute.projectId) {
		return false;
	}
	if (currentRoute.kind === "project" && targetRoute.kind === "conversation") {
		return true;
	}
	return (
		preserveProjectConversation &&
		currentRoute.kind === "conversation" &&
		targetRoute.kind === "project"
	);
};

export const shouldNavigateToTargetUrl = ({
	navigate,
	currentUrl,
	targetUrl,
	preserveProjectConversation = false,
}: {
	navigate: boolean;
	currentUrl: string;
	targetUrl: string;
	preserveProjectConversation?: boolean;
}): boolean => {
	if (!navigate) {
		return false;
	}
	if (!isNonEmpty(currentUrl)) {
		return true;
	}
	const currentComparable = comparableUrl(currentUrl);
	const targetComparable = comparableUrl(targetUrl);
	if (
		currentComparable !== undefined &&
		targetComparable !== undefined &&
		currentComparable === targetComparable
	) {
		return false;
	}
	if (
		shouldPreserveProjectPage(
			currentUrl,
			targetUrl,
			preserveProjectConversation,
		)
	) {
		return false;
	}
	if (currentComparable !== undefined && targetComparable !== undefined) {
		return true;
	}
	return currentUrl !== targetUrl;
};

export const shouldReloadTargetAfterAuthBootstrap = ({
	navigate,
	currentUrl,
	targetUrl,
	authBootstrapApplied,
}: {
	navigate: boolean;
	currentUrl: string;
	targetUrl: string;
	authBootstrapApplied: boolean;
}): boolean => {
	if (!navigate || !authBootstrapApplied || !isNonEmpty(currentUrl)) {
		return false;
	}
	const currentComparable = comparableUrl(currentUrl);
	const targetComparable = comparableUrl(targetUrl);
	if (currentComparable !== undefined && targetComparable !== undefined) {
		return currentComparable === targetComparable;
	}
	return currentUrl === targetUrl;
};

type SessionSource =
	| {
			kind: "cdp";
			cdpUrl: string;
	  }
	| {
			kind: "auth-file";
			authFile: string;
	  }
	| {
			kind: "profile";
			userDataDir: string;
			profileName?: string;
	  };

const resolveSessionSource = ({
	cdpUrl,
	userDataDir,
	profile,
	session,
	authFile,
}: {
	cdpUrl?: string;
	userDataDir?: string;
	profile?: string;
	session?: string;
	authFile?: string;
}): SessionSource => {
	const hasCdp = isNonEmpty(cdpUrl);
	const hasAuthFile = isNonEmpty(authFile);
	const hasUserDataDir = isNonEmpty(userDataDir);
	const hasProfile = isNonEmpty(profile);

	if (hasCdp && hasAuthFile) {
		throw new Error(
			"auth file cannot be used with cdpUrl; use userDataDir/profile or remove cdpUrl",
		);
	}
	if (hasAuthFile && (hasUserDataDir || hasProfile)) {
		throw new Error(
			"auth file cannot be combined with userDataDir; choose exactly one auth source",
		);
	}
	if (hasProfile && hasUserDataDir) {
		throw new Error(
			"profile cannot be combined with userDataDir; choose exactly one profile source",
		);
	}
	if (hasCdp) {
		return { kind: "cdp", cdpUrl };
	}

	if (hasAuthFile) {
		const resolvedAuthFile = path.resolve(authFile);
		if (!fs.existsSync(resolvedAuthFile)) {
			throw new Error(`auth file does not exist: ${resolvedAuthFile}`);
		}
		return { kind: "auth-file", authFile: resolvedAuthFile };
	}

	if (hasProfile) {
		const profileName = resolveNavigatorManagedProfileName({
			profile,
			session,
		});
		return {
			kind: "profile",
			userDataDir: path.resolve(
				hasUserDataDir
					? userDataDir
					: profileUserDataDir({
							profile: profileName,
						}),
			),
			profileName,
		};
	}

	return {
		kind: "profile",
		userDataDir: path.resolve(
			hasUserDataDir
				? userDataDir
				: profileUserDataDir({
					profile: resolveNavigatorManagedProfileName({
						session,
					}),
				}),
		),
		profileName: hasUserDataDir
			? undefined
			: resolveNavigatorManagedProfileName({
				session,
			}),
	};
};

const openViaContext = async ({
	context,
	targetUrl,
	strictTabTargeting,
	authBootstrapFile,
	ownership,
	freshLaunch,
	close,
}: {
	context: RuntimeContext;
	targetUrl?: string;
	strictTabTargeting?: boolean;
	authBootstrapFile?: string;
	ownership: SessionOwnership;
	freshLaunch: boolean;
	close: () => Promise<void>;
}): Promise<ChatgptSession> => {
	if (isNonEmpty(authBootstrapFile)) {
		await applyAuthCookiesToContext({
			context,
			authFile: authBootstrapFile,
		});
	}

	let page = await pickSessionPage({
		context,
		targetUrl,
		strictTabTargeting,
	});
	if (page === undefined) {
		await waitForContextPages(context, CONTEXT_PAGE_DISCOVERY_TIMEOUT_MS);
		page = await pickSessionPage({
			context,
			targetUrl,
			strictTabTargeting,
		});
	}
	if (page === undefined) {
		page = await context.newPage();
	}
	if (freshLaunch) {
		await closeNonSelectedStartupJunkPages({
			context,
			selectedPage: page,
		});
	}

	return {
		page,
		ownership,
		freshLaunch,
		close,
	};
};

const openViaBrowser = async ({
	browser,
	targetUrl,
	strictTabTargeting,
	authBootstrapFile,
	ownership,
	freshLaunch,
	close,
}: {
	browser: RuntimeBrowser;
	targetUrl?: string;
	strictTabTargeting?: boolean;
	authBootstrapFile?: string;
	ownership: SessionOwnership;
	freshLaunch: boolean;
	close: () => Promise<void>;
}): Promise<ChatgptSession> => {
	let context = browser.contexts()[0];
	if (context === undefined) {
		context = await browser.newContext();
	}
	return openViaContext({
		context,
		targetUrl,
		strictTabTargeting,
		authBootstrapFile,
		ownership,
		freshLaunch,
		close,
	});
};

const openViaCdp = async ({
	cdpUrl,
	targetUrl,
	strictTabTargeting,
	authBootstrapFile,
}: {
	cdpUrl: string;
	targetUrl?: string;
	strictTabTargeting?: boolean;
	authBootstrapFile?: string;
}): Promise<ChatgptSession> => {
	const browser = await chromium.connectOverCDP(cdpUrl);
	return openViaBrowser({
		browser,
		targetUrl,
		strictTabTargeting,
		authBootstrapFile,
		ownership: "external",
		freshLaunch: false,
		close: async () => {},
	});
};

const openViaReusableProfile = async ({
	chromiumBin,
	chromiumLaunchProfile,
	chromiumLaunchArgs,
	userDataDir,
	session,
	headless,
	targetUrl,
	strictTabTargeting,
	authBootstrapFile,
}: {
	chromiumBin: string;
	chromiumLaunchProfile: NavigatorChromiumLaunchProfile;
	chromiumLaunchArgs: readonly string[];
	userDataDir: string;
	session?: string;
	headless: boolean;
	targetUrl?: string;
	strictTabTargeting?: boolean;
	authBootstrapFile?: string;
}): Promise<ChatgptSession> => {
	const stateTargetUrl = targetUrl ?? DEFAULT_CHAT_URL;
	const launchIdentity = {
		chromiumBin,
		userDataDir,
		headless,
		chromiumLaunchProfile,
	};
	const persisted = loadReusableSessionState({
		targetUrl: stateTargetUrl,
		launch: launchIdentity,
		session,
	});

	if (
		persisted !== undefined &&
		reusableSessionMatchesLaunch(persisted, launchIdentity)
	) {
		try {
			return await openViaCdp({
				cdpUrl: persisted.cdpUrl,
				targetUrl,
				strictTabTargeting,
				authBootstrapFile,
			});
		} catch {
			clearReusableSessionState({
				targetUrl: stateTargetUrl,
				launch: launchIdentity,
				session,
			});
		}
	}

	const launched = await launchDetachedBrowserViaCdp({
		chromiumBin,
		userDataDir,
		headless,
		browserLaunchArgs: chromiumLaunchArgs,
		connectOverCDP: (cdpUrl) => chromium.connectOverCDP(cdpUrl),
	});
	try {
		saveReusableSessionState({
			targetUrl: stateTargetUrl,
			cdpUrl: launched.cdpUrl,
			chromiumBin,
			userDataDir,
			headless,
			chromiumLaunchProfile,
			session,
		});
		return await openViaBrowser({
			browser: launched.browser,
			targetUrl,
			strictTabTargeting,
			authBootstrapFile,
			ownership: "external",
			freshLaunch: true,
			close: async () => {},
		});
	} catch (error) {
		clearReusableSessionState({
			targetUrl: stateTargetUrl,
			launch: launchIdentity,
			session,
		});
		try {
			await launched.browser.close();
		} catch {}
		throw error;
	}
};

const openViaPersistentProfileFirefox = async ({
	firefoxBin,
	userDataDir,
	headless,
	targetUrl,
	strictTabTargeting,
	authBootstrapFile,
	allowProfileResetOnLaunchFailure = false,
}: {
	firefoxBin?: string;
	userDataDir: string;
	headless: boolean;
	targetUrl?: string;
	strictTabTargeting?: boolean;
	authBootstrapFile?: string;
	allowProfileResetOnLaunchFailure?: boolean;
}): Promise<ChatgptSession> => {
	const launchContext = async (): Promise<RuntimeContext> =>
		firefox.launchPersistentContext(userDataDir, {
			...(isNonEmpty(firefoxBin) ? { executablePath: firefoxBin } : {}),
			headless,
			viewport: null,
			timeout: FIREFOX_LAUNCH_TIMEOUT_MS,
		});
	let context: RuntimeContext;
	try {
		context = await launchContext();
	} catch (error) {
		if (
			!allowProfileResetOnLaunchFailure ||
			!firefoxLaunchErrorLooksRecoverable(error)
		) {
			throw error;
		}
		archiveAndResetFirefoxUserDataDir(userDataDir);
		context = await launchContext();
	}
	try {
		return await openViaContext({
			context,
			targetUrl,
			strictTabTargeting,
			authBootstrapFile,
			ownership: "managed",
			freshLaunch: true,
			close: async () => {
				await context.close();
			},
		});
	} catch (error) {
		await context.close();
		throw error;
	}
};

const openViaStorageStateChromium = async (
	chromiumBin: string,
	chromiumLaunchArgs: readonly string[],
	authFile: string,
	headless: boolean,
	targetUrl?: string,
	strictTabTargeting?: boolean,
): Promise<ChatgptSession> => {
	if (isWslWindowsBrowserPath({ chromiumBin })) {
		const ephemeralProfile = fs.mkdtempSync(
			path.join(os.tmpdir(), "pp-wsl-windows-profile-"),
		);
		const launched = await launchWslWindowsBrowserViaCdp({
			chromiumBin,
			userDataDir: ephemeralProfile,
			headless,
			browserLaunchArgs: chromiumLaunchArgs,
			connectOverCDP: (cdpUrl) => chromium.connectOverCDP(cdpUrl),
		});
		try {
			const context = await launched.browser.newContext({
				storageState: authFile,
			});
			return await openViaContext({
				context,
				targetUrl,
				strictTabTargeting,
				ownership: "managed",
				freshLaunch: true,
				close: async () => {
					await context.close();
					await launched.close();
					fs.rmSync(ephemeralProfile, {
						recursive: true,
						force: true,
					});
				},
			});
		} catch (error) {
			await launched.close();
			fs.rmSync(ephemeralProfile, {
				recursive: true,
				force: true,
			});
			throw error;
		}
	}

	const browser = await chromium.launch({
		executablePath: chromiumBin,
		headless,
		viewport: null,
		args: [...chromiumLaunchArgs],
	});

	const context = await browser.newContext({
		storageState: authFile,
	});
	return openViaContext({
		context,
		targetUrl,
		strictTabTargeting,
		ownership: "managed",
		freshLaunch: true,
		close: async () => {
			await context.close();
			await browser.close();
		},
	});
};

const openViaStorageStateFirefox = async (
	firefoxBin: string | undefined,
	authFile: string,
	headless: boolean,
	targetUrl?: string,
	strictTabTargeting?: boolean,
): Promise<ChatgptSession> => {
	const browser = await firefox.launch({
		...(isNonEmpty(firefoxBin) ? { executablePath: firefoxBin } : {}),
		headless,
		viewport: null,
		timeout: FIREFOX_LAUNCH_TIMEOUT_MS,
	});
	const context = await browser.newContext({
		storageState: authFile,
	});
	return openViaContext({
		context,
		targetUrl,
		strictTabTargeting,
		ownership: "managed",
		freshLaunch: true,
		close: async () => {
			await context.close();
			await browser.close();
		},
	});
};

export const openChatgptSession = async ({
	browser,
	chromiumLaunchProfile,
	chromiumBin,
	cdpUrl,
	userDataDir,
	profile,
	session: sessionName,
	authFile,
	headless = false,
	targetUrl = DEFAULT_CHAT_URL,
	navigate = true,
	preserveProjectConversation = false,
	strictTabTargeting = false,
	ensureComposer = true,
	composerSelector = DEFAULT_COMPOSER_SELECTOR,
	composerTimeoutMs = 120_000,
}: OpenChatgptSessionOptions): Promise<ChatgptSession> => {
	const selectedBrowser = resolveBrowserSelection(browser);
	const selectedChromiumLaunchProfile =
		resolveChromiumLaunchProfile(chromiumLaunchProfile);
	const selectedChromiumLaunchArgs = resolveChromiumLaunchArgs(
		selectedChromiumLaunchProfile,
	);
	if (selectedBrowser !== "chromium" && isNonEmpty(cdpUrl)) {
		throw new Error("cdpUrl is only supported when browser=chromium");
	}

	const discoveredAuthFile =
		!isNonEmpty(authFile) && !isNonEmpty(cdpUrl)
			? resolveDefaultAuthFile({ targetUrl, session: sessionName })
			: undefined;
	const authBootstrapApplied = isNonEmpty(discoveredAuthFile);
	const sessionSource = resolveSessionSource({
		cdpUrl,
		userDataDir,
		profile,
		session: sessionName,
		authFile,
	});
	const session = await (() => {
		switch (sessionSource.kind) {
			case "cdp":
				return openViaCdp({
					cdpUrl: sessionSource.cdpUrl,
					targetUrl,
					strictTabTargeting,
					authBootstrapFile: discoveredAuthFile,
				});
			case "auth-file": {
				return selectedBrowser === "chromium"
					? openViaStorageStateChromium(
						requireChromiumBin(chromiumBin),
						selectedChromiumLaunchArgs,
						sessionSource.authFile,
						headless,
						targetUrl,
						strictTabTargeting,
					)
					: openViaStorageStateFirefox(
						resolveFirefoxLaunchBin(chromiumBin),
						sessionSource.authFile,
						headless,
						targetUrl,
						strictTabTargeting,
					);
			}
			case "profile": {
				const profileChromiumBin =
					selectedBrowser === "chromium"
						? requireChromiumBin(chromiumBin)
						: undefined;
				const profileFirefoxBin =
					selectedBrowser === "firefox"
						? resolveFirefoxLaunchBin(chromiumBin)
						: undefined;
				const profileUserDataDir =
					sessionSource.profileName === undefined
						? sessionSource.userDataDir
						: resolveProfileRuntimeUserDataDir({
							browser: selectedBrowser,
							profile: sessionSource.profileName,
							chromiumBin:
								selectedBrowser === "chromium"
									? profileChromiumBin
									: profileFirefoxBin,
						});
				return selectedBrowser === "chromium"
					? openViaReusableProfile({
						chromiumBin: profileChromiumBin as string,
						chromiumLaunchProfile: selectedChromiumLaunchProfile,
						chromiumLaunchArgs: selectedChromiumLaunchArgs,
						userDataDir: profileUserDataDir,
						session: sessionName,
						headless,
						targetUrl,
						strictTabTargeting,
						authBootstrapFile: discoveredAuthFile,
					})
					: openViaPersistentProfileFirefox({
						firefoxBin: profileFirefoxBin,
						userDataDir: profileUserDataDir,
						headless,
						targetUrl,
						strictTabTargeting,
						authBootstrapFile: discoveredAuthFile,
						allowProfileResetOnLaunchFailure:
							sessionSource.profileName !== undefined,
					});
			}
		}
	})();
	try {
		if (
			shouldNavigateToTargetUrl({
				navigate,
				currentUrl: session.page.url(),
				targetUrl,
				preserveProjectConversation,
			}) ||
			shouldReloadTargetAfterAuthBootstrap({
				navigate,
				currentUrl: session.page.url(),
				targetUrl,
				authBootstrapApplied,
			})
		) {
			await session.page.goto(targetUrl, { waitUntil: "domcontentloaded" });
		}

		if (ensureComposer) {
			await ensureComposerReady(
				session.page,
				composerSelector,
				composerTimeoutMs,
			);
			if (session.freshLaunch) {
				await ensureComposerStartupSettled(
					session.page,
					composerSelector,
					composerTimeoutMs,
				);
			}
		}
		await bringPageToFront(session.page);

		return session;
	} catch (error) {
		try {
			await session.close();
		} catch {}
		throw error;
	}
};

export {
	COMPATIBLE_CHROMIUM_BINARIES,
	COMPATIBLE_FIREFOX_BINARIES,
	WSL_WINDOWS_BROWSER_CANDIDATES,
	detectChromiumBin,
	detectFirefoxBin,
	isWsl,
	isWslWindowsBrowserPath,
	pickSessionPage,
};

export type { ChatgptSession, OpenChatgptSessionOptions };
