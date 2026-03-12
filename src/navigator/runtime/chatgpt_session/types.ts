import type { NavigatorBrowser } from "./browser_env";
import type { NavigatorChromiumLaunchProfile } from "./chromium_launch_profile_env";

/**
 * Shared runtime contracts for browser/session orchestration.
 */
export type RuntimePage = {
	evaluate: {
		<T>(pageFunction: () => T | Promise<T>): Promise<T>;
		<T, A>(pageFunction: (arg: A) => T | Promise<T>, arg: A): Promise<T>;
	};
	url: () => string;
	close?: () => Promise<void>;
	bringToFront?: () => Promise<void>;
	click: (selector: string) => Promise<void>;
	waitForTimeout: (timeout: number) => Promise<void>;
	goto: (
		url: string,
		options: {
			waitUntil: "domcontentloaded";
		},
	) => Promise<void>;
	waitForSelector: (
		selector: string,
		options: {
			timeout: number;
		},
	) => Promise<unknown>;
};

export type RuntimeContext = {
	pages: () => RuntimePage[];
	newPage: () => Promise<RuntimePage>;
	close: () => Promise<void>;
};

export type RuntimeBrowser = {
	contexts: () => RuntimeContext[];
	newContext: () => Promise<RuntimeContext>;
	close: () => Promise<void>;
	newBrowserCDPSession?: () => Promise<{
		send: (
			method: string,
			params?: Record<string, unknown>,
		) => Promise<unknown>;
	}>;
};

export type ChromiumLauncher = {
	connectOverCDP: (cdpUrl: string) => Promise<RuntimeBrowser>;
	launch: (options: {
		executablePath: string;
		headless: boolean;
		viewport: null;
		args: string[];
		timeout?: number;
	}) => Promise<RuntimeBrowser>;
	launchPersistentContext: (
		userDataDir: string,
		options: {
			executablePath: string;
			headless: boolean;
			viewport: null;
			args: string[];
			timeout?: number;
		},
	) => Promise<RuntimeContext>;
};

export type FirefoxLauncher = {
	launch: (options: {
		executablePath?: string;
		headless: boolean;
		viewport: null;
		args?: string[];
		timeout?: number;
	}) => Promise<RuntimeBrowser>;
	launchPersistentContext: (
		userDataDir: string,
		options: {
			executablePath?: string;
			headless: boolean;
			viewport: null;
			args?: string[];
			timeout?: number;
		},
	) => Promise<RuntimeContext>;
};

export type OpenChatgptSessionOptions = {
	browser?: NavigatorBrowser;
	chromiumLaunchProfile?: NavigatorChromiumLaunchProfile;
	chromiumBin?: string;
	cdpUrl?: string;
	userDataDir?: string;
	profile?: string;
	session?: string;
	headless?: boolean;
	targetUrl?: string;
	navigate?: boolean;
	preserveProjectConversation?: boolean;
	strictTabTargeting?: boolean;
	ensureComposer?: boolean;
	composerSelector?: string;
	composerTimeoutMs?: number;
};

export type SessionOwnership = "managed" | "external";

export type ChatgptSession = {
	page: RuntimePage;
	ownership: SessionOwnership;
	freshLaunch: boolean;
	close: () => Promise<void>;
};
