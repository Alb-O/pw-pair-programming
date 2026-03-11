import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
	buildNavigatorEntriesArchive,
	formatNavigatorEntriesArchiveNotice,
} from "../compose/archive";
import {
	composeNavigatorMessage,
	readNavigatorPreamble,
} from "../compose/composer";
import {
	NAVIGATOR_PROJECT_ENV,
	resolveNavigatorProject,
} from "../project/project_env";
import {
	NAVIGATOR_PROFILE_ENV,
	resolveNavigatorProfile,
} from "../profile/profile_env";
import { parseProjectRef, urlInProject } from "../project/project_ref";
import {
	attachToNavigator,
	type AttachmentPayload,
	binaryAttachment,
	collectAttachments,
} from "../browser/attachments";
import {
	downloadNavigatorArtifact,
	listNavigatorArtifacts,
} from "../browser/download";
import {
	pasteNavigatorText,
	type PasteNavigatorTextResult,
} from "../browser/paste";
import {
	getConversationHistory,
	isGenerating,
	waitForAssistantResponseOrLatest,
	waitForAssistantResponse,
	type HistoryMessage,
} from "../browser/messaging";
import { getAssistantResponseText } from "../browser/response";
import {
	sendNavigatorMessage,
	type SendNavigatorMessageResult,
} from "../browser/send";
import {
	getCurrentModel,
	conversationCharLength,
	type ModelMode,
	setModelMode,
} from "../browser/session";
import {
	conversationCapBlockedLines,
	conversationLengthState,
	conversationLengthWarningLines,
} from "../limits/conversation_limits";
import { openChatgptSession } from "./chatgpt_session";
import { requireChromiumBin } from "./chatgpt_session/browser_resolution";
import {
	NAVIGATOR_BROWSER_ENV,
	NAVIGATOR_DEFAULT_BROWSER,
	resolveNavigatorBrowser,
	type NavigatorBrowser,
} from "./chatgpt_session/browser_env";
import {
	NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ENV,
	NAVIGATOR_DEFAULT_CHROMIUM_LAUNCH_PROFILE,
	resolveNavigatorChromiumLaunchProfile,
	type NavigatorChromiumLaunchProfile,
} from "./chatgpt_session/chromium_launch_profile_env";
import { resolveProfileRuntimeUserDataDir } from "./chatgpt_session/profile_runtime_partition";
import {
	loadReusableSessionState,
	reusableSessionMatchesConnectionHints,
	saveReusableSessionLastPage,
	type ReusableSessionLaunchIdentity,
	type ReusableSessionState,
} from "./chatgpt_session/reusable_session_state";
import { acquirePpCommandLock, releasePpCommandLock } from "./command_lock";
import { PP_DEFAULT_PROFILE_NAME, resolvePpRuntimeDir } from "./pp_state_paths";

/**
 * Runtime command handlers used by the top-level CLI.
 * Keeps argument-to-action wiring separate from browser primitives.
 */
export type NavigatorConnectionOptions = {
	browser?: NavigatorBrowser;
	chromiumLaunchProfile?: NavigatorChromiumLaunchProfile;
	chromiumBin?: string;
	cdpUrl?: string;
	userDataDir?: string;
	profile?: string;
	authFile?: string;
	headless: boolean;
	chatUrl: string;
	project?: string;
	projectSource?: "option" | "env";
	noNavigate?: boolean;
	strictTabTargeting?: boolean;
	composerTimeoutMs?: number;
	onWarning?: (warning: string) => void;
};

export type NavigatorSendOptions = NavigatorConnectionOptions & {
	message?: string;
	messageFile?: string;
	model?: ModelMode;
	newChat?: boolean;
	force?: boolean;
	noWait?: boolean;
	timeoutMs?: number;
	pollMs?: number;
	echoMessage?: boolean;
};

export type NavigatorWaitOptions = NavigatorConnectionOptions & {
	timeoutMs?: number;
	pollMs?: number;
};

export type NavigatorGetResponseOptions = NavigatorConnectionOptions;

export type NavigatorHistoryOptions = NavigatorConnectionOptions & {
	last?: number;
	json?: boolean;
};

export type NavigatorAttachOptions = NavigatorConnectionOptions & {
	files?: readonly string[];
	text?: string;
	textFile?: string;
	textName?: string;
	prompt?: string;
	send?: boolean;
	waitForResponse?: boolean;
	timeoutMs?: number;
	pollMs?: number;
};

export type NavigatorPasteOptions = NavigatorConnectionOptions & {
	text?: string;
	clear?: boolean;
	send?: boolean;
};

export type NavigatorDownloadOptions = NavigatorConnectionOptions & {
	output?: string;
	index?: number;
	list?: boolean;
};

export type NavigatorDownloadListItem = {
	index: number;
	file: string;
	path: string;
	label: string;
	sandboxPath: string;
	messageId: string;
};

export type NavigatorDownloadResult =
	| {
			mode: "list";
			links: NavigatorDownloadListItem[];
	  }
	| Awaited<ReturnType<typeof downloadNavigatorArtifact>>;

export type NavigatorComposeOptions = {
	preambleFile: string;
	entries: readonly string[];
	onWarning?: (warning: string) => void;
};

export type NavigatorBriefOptions = NavigatorConnectionOptions & {
	preambleFile: string;
	entries: readonly string[];
	attachFiles?: readonly string[];
	inlineEntries?: boolean;
	model?: ModelMode;
	newChat?: boolean;
	force?: boolean;
	noWait?: boolean;
	timeoutMs?: number;
	pollMs?: number;
	echoMessage?: boolean;
};

export type NavigatorSetModelOptions = NavigatorConnectionOptions & {
	mode: ModelMode;
};

export type NavigatorNewOptions = NavigatorConnectionOptions & {
	model?: ModelMode;
};

export type NavigatorRefreshOptions = NavigatorConnectionOptions;

export type NavigatorIsolateOptions = NavigatorConnectionOptions;

export type PpSendResult = {
	success: boolean;
	sent: boolean;
	already_sent: boolean;
	blocked: boolean;
	must_start_new: boolean;
	reason: "conversation_cap_reached" | null;
	model: string | null;
	chars: number;
	message?: string;
	response?: Awaited<ReturnType<typeof getAssistantResponseText>>;
};

export type NavigatorPasteResult = {
	pasted: boolean;
	sent: boolean;
	blocked: boolean;
	must_start_new: boolean;
	reason: "conversation_cap_reached" | null;
	length: number;
};

type SessionPage = Awaited<ReturnType<typeof openChatgptSession>>["page"];
type SessionRuntimeInfo = Pick<
	Awaited<ReturnType<typeof openChatgptSession>>,
	"freshLaunch" | "ownership"
>;

type SessionNavigationMode =
	| "navigating"
	| "non-navigating"
	| "fresh-navigation";

const DEFAULT_COMPOSER_TIMEOUT_MS = 120_000;
const DEFAULT_NEW_MODEL: ModelMode = "thinking";

const isNonEmpty = (value?: string): value is string =>
	value !== undefined && value.trim() !== "";

const resolveConnectionBrowser = (
	connection: NavigatorConnectionOptions,
): NavigatorBrowser => connection.browser ?? NAVIGATOR_DEFAULT_BROWSER;

const resolveConnectionChromiumLaunchProfile = (
	connection: NavigatorConnectionOptions,
): NavigatorChromiumLaunchProfile =>
	connection.chromiumLaunchProfile ??
	NAVIGATOR_DEFAULT_CHROMIUM_LAUNCH_PROFILE;

const normalizeList = (items: readonly string[]): string[] =>
	items.map((value) => value.trim()).filter((value) => value !== "");

const normalizedScopeValue = (value?: string): string | null =>
	isNonEmpty(value) ? value.trim() : null;

type LockSessionKind = "managed-profile" | "cdp" | "auth-file";

const resolveLockSessionKind = (
	connection: NavigatorConnectionOptions,
): LockSessionKind => {
	if (isNonEmpty(connection.cdpUrl)) {
		return "cdp";
	}
	if (isNonEmpty(connection.authFile)) {
		return "auth-file";
	}
	return "managed-profile";
};

const canonicalProjectScope = (project?: string): string | null => {
	const normalized = normalizedScopeValue(project);
	if (normalized === null) {
		return null;
	}
	try {
		return parseProjectRef(normalized).projectId;
	} catch {
		return normalized;
	}
};

const canonicalChatScope = (chatUrl: string): string => {
	const normalized = chatUrl.trim();
	try {
		return new URL(normalized).origin;
	} catch {
		return normalized;
	}
};

const resolveLockScopeConnection = (
	connection: NavigatorConnectionOptions,
): string => {
	const sessionKind = resolveLockSessionKind(connection);
	const profile =
		sessionKind === "managed-profile"
			? normalizedScopeValue(connection.profile) ?? PP_DEFAULT_PROFILE_NAME
			: null;
	const project =
		sessionKind === "managed-profile"
			? null
			: canonicalProjectScope(connection.project);
	return JSON.stringify({
		sessionKind,
		chatUrl: canonicalChatScope(connection.chatUrl),
		chromiumLaunchProfile:
			sessionKind === "managed-profile" &&
			resolveConnectionBrowser(connection) === "chromium"
				? resolveConnectionChromiumLaunchProfile(connection)
				: null,
		cdpUrl: normalizedScopeValue(connection.cdpUrl),
		authFile: isNonEmpty(connection.authFile)
			? path.resolve(connection.authFile)
			: null,
		userDataDir: isNonEmpty(connection.userDataDir)
			? path.resolve(connection.userDataDir)
			: null,
		profile,
		project,
	});
};

const resolveCommandLockPath = (
	connection: NavigatorConnectionOptions,
): string => {
	const scopeHash = crypto
		.createHash("sha256")
		.update(resolveLockScopeConnection(connection))
		.digest("hex")
		.slice(0, 16);
	return path.resolve(resolvePpRuntimeDir(), `pp-command.${scopeHash}.lock`);
};

export const resolvePpCommandLockPath = resolveCommandLockPath;

const normalizeHostname = (url: string): string | null => {
	try {
		return new URL(url).hostname.trim().toLowerCase().replace(/^www\./, "");
	} catch {
		return null;
	}
};

const sameHostUrl = (baseUrl: string, candidateUrl: string): boolean => {
	const baseHost = normalizeHostname(baseUrl);
	const candidateHost = normalizeHostname(candidateUrl);
	if (baseHost === null || candidateHost === null) {
		return false;
	}
	return baseHost === candidateHost;
};

const readSessionPageVisibilityState = async (
	page: SessionPage,
): Promise<string> => {
	try {
		const state = await page.evaluate(() => {
			const browserGlobal = globalThis as unknown as {
				document?: {
					visibilityState?: string;
				};
			};
			const visibilityState = browserGlobal.document?.visibilityState;
			return typeof visibilityState === "string" ? visibilityState : "";
		});
		return typeof state === "string" ? state : "";
	} catch {
		return "";
	}
};

export const shouldPersistReusableSessionLastPage = (
	visibilityState: string,
): boolean => visibilityState === "visible";

const connectionUsesManagedProfile = (
	connection: NavigatorConnectionOptions,
): boolean =>
	resolveConnectionBrowser(connection) === "chromium" &&
	!isNonEmpty(connection.cdpUrl) &&
	!isNonEmpty(connection.authFile);

const resolveManagedLaunchIdentity = (
	connection: NavigatorConnectionOptions,
): ReusableSessionLaunchIdentity | undefined => {
	if (!connectionUsesManagedProfile(connection)) {
		return undefined;
	}
	const resolvedChromiumBin = requireChromiumBin(connection.chromiumBin);
	if (isNonEmpty(connection.userDataDir)) {
		return {
			chromiumBin: resolvedChromiumBin,
			userDataDir: path.resolve(connection.userDataDir),
			headless: connection.headless,
			chromiumLaunchProfile: resolveConnectionChromiumLaunchProfile(connection),
		};
	}
	const profile = isNonEmpty(connection.profile)
		? connection.profile
		: PP_DEFAULT_PROFILE_NAME;
	return {
		chromiumBin: resolvedChromiumBin,
		userDataDir: resolveProfileRuntimeUserDataDir({
			profile,
			chromiumBin: resolvedChromiumBin,
		}),
		headless: connection.headless,
		chromiumLaunchProfile: resolveConnectionChromiumLaunchProfile(connection),
	};
};

const resolveTargetUrl = ({
	connection,
	mode,
	reusableState,
}: {
	connection: NavigatorConnectionOptions;
	mode: SessionNavigationMode;
	reusableState?: ReusableSessionState;
}): string => {
	const projectBinding = isNonEmpty(connection.project)
		? connection.project
		: undefined;
	if (projectBinding !== undefined) {
		return parseProjectRef(projectBinding).projectUrl;
	}
	const persistedLastPageUrl =
		mode !== "fresh-navigation" &&
		connectionUsesManagedProfile(connection) &&
		reusableState !== undefined &&
			reusableSessionMatchesConnectionHints(reusableState, {
				chromiumBin: connection.chromiumBin,
				userDataDir: connection.userDataDir,
				headless: connection.headless,
				chromiumLaunchProfile: resolveConnectionChromiumLaunchProfile(connection),
			})
			? reusableState.lastPageUrl
			: undefined;
	if (
		isNonEmpty(persistedLastPageUrl) &&
		sameHostUrl(connection.chatUrl, persistedLastPageUrl)
	) {
		return persistedLastPageUrl;
	}
	return connection.chatUrl;
};

const shouldNavigate = (
	connection: NavigatorConnectionOptions,
	mode: SessionNavigationMode,
): boolean => {
	if (connection.noNavigate === true) {
		return false;
	}
	if (mode === "navigating" || mode === "fresh-navigation") {
		return true;
	}
	return connection.projectSource === "option";
};

export const resolveSessionNavigate = shouldNavigate;
export const resolveSessionTargetUrl = resolveTargetUrl;

const resolveOpenSessionTargetUrl = ({
	connection,
	targetUrl,
}: {
	connection: NavigatorConnectionOptions;
	targetUrl: string;
}): string => {
	if (connection.noNavigate === true && connection.projectSource !== "option") {
		return connection.chatUrl;
	}
	return targetUrl;
};

export const resolveSessionOpenTargetUrl = resolveOpenSessionTargetUrl;

const resolveStrictTabTargeting = (
	connection: NavigatorConnectionOptions,
): boolean =>
	connection.noNavigate === true || connection.strictTabTargeting === true;

export const resolveSessionStrictTabTargeting = resolveStrictTabTargeting;

export const formatStrictTabTargetingError = ({
	connection,
	errorMessage,
}: {
	connection: NavigatorConnectionOptions;
	errorMessage: string;
}): string => {
	if (!errorMessage.includes("strict tab targeting")) {
		return errorMessage;
	}

	const lines: string[] = [errorMessage, "", "Hint:"];

	if (connection.noNavigate === true) {
		lines.push(
			"  - This run is using --no-navigate, so pp must bind to an existing *visible* ChatGPT tab.",
		);
		lines.push(
			"  - Bring the intended ChatGPT tab to the foreground (visible), and close/hide other ChatGPT windows/tabs.",
		);
		lines.push(
			"  - If you want pp to switch tabs/pages for you, rerun without --no-navigate.",
		);
		lines.push(
			"  - If you need to scope selection to a specific project under --no-navigate, pass --project explicitly (option source).",
		);
	} else {
		lines.push(
			"  - Strict tab targeting requires exactly one matching visible tab; close/hide extras or disable strict tab targeting.",
		);
	}

	return lines.join("\n");
};

const resolveSendSessionMode = (newChat?: boolean): SessionNavigationMode =>
	newChat === true ? "fresh-navigation" : "navigating";

export const resolvePpSendSessionMode = resolveSendSessionMode;

const resolveSendStartNewChat = ({
	requestedNewChat,
	freshLaunch,
}: {
	requestedNewChat?: boolean;
	freshLaunch: boolean;
}): boolean => requestedNewChat === true || freshLaunch;

export const resolvePpSendStartNewChat = resolveSendStartNewChat;

const resolveFreshSendTargetUrl = (
	connection: NavigatorConnectionOptions,
): string => {
	if (isNonEmpty(connection.project)) {
		return parseProjectRef(connection.project).projectUrl;
	}
	return connection.chatUrl;
};

export const resolvePpFreshSendTargetUrl = resolveFreshSendTargetUrl;

const resolveSendAction = (
	isGeneratingNow: boolean,
): "send" | "response-in-progress" =>
	isGeneratingNow ? "response-in-progress" : "send";

export const resolvePpSendAction = resolveSendAction;

const buildResponseInProgressMessage = (
	commandName: string,
): string =>
	[
		"=== NAVIGATOR RESPONSE IN PROGRESS ===",
		"",
		`cannot run ${commandName} while the current navigator reply is still streaming`,
		"wait for this reply to finish before sending or mutating session state",
		"",
		"next step:",
		"  pp wait",
		"",
		"or, work on codebase, run tests/checks/lints etc. while waiting",
	].join("\n");

export const formatPpResponseInProgressMessage = buildResponseInProgressMessage;

const ensureNavigatorResponseNotInProgress = async ({
	page,
	commandName,
}: {
	page: SessionPage;
	commandName: string;
}): Promise<void> => {
	if (await isGenerating(page)) {
		throw new Error(buildResponseInProgressMessage(commandName));
	}
};

const resolveWaitAction = (
	isGeneratingNow: boolean,
): "wait" | "get-response" => (isGeneratingNow ? "wait" : "get-response");

export const resolvePpWaitAction = resolveWaitAction;

export const validateNoNavigateBinding = ({
	connection,
	currentUrl,
}: {
	connection: NavigatorConnectionOptions;
	currentUrl: string;
}): string[] => {
	const warnings: string[] = [];
	if (connection.noNavigate !== true) {
		return warnings;
	}

	const current = currentUrl.trim();
	if (!isNonEmpty(current) || !sameHostUrl(connection.chatUrl, current)) {
		throw new Error(
			`--no-navigate requires an existing ChatGPT tab matching --chat-url. Current tab URL: ${current === "" ? "<empty>" : current}`,
		);
	}

	const project = isNonEmpty(connection.project)
		? connection.project
		: undefined;
	if (project !== undefined) {
		if (connection.projectSource === "option") {
			if (!urlInProject(current, project)) {
				throw new Error(
					`--project was provided with --no-navigate but the selected tab is not in that project (project: ${project}, current: ${current}). Switch to a tab in that project or omit --no-navigate.`,
				);
			}
		} else if (connection.projectSource === "env") {
			if (!urlInProject(current, project)) {
				warnings.push(
					`env project binding does not match current tab (project: ${project}, current: ${current})`,
				);
			}
		}
	}

	return warnings;
};

const readStdinText = (): string | undefined => {
	if (process.stdin.isTTY) {
		return undefined;
	}
	return fs.readFileSync(0, "utf8");
};

const readMessageInput = ({
	message,
	messageFile,
}: {
	message?: string;
	messageFile?: string;
}): string => {
	if (isNonEmpty(messageFile) && isNonEmpty(message)) {
		throw new Error("Use either positional message text or --file, not both");
	}

	if (isNonEmpty(messageFile)) {
		return fs.readFileSync(path.resolve(messageFile), "utf8");
	}

	if (isNonEmpty(message)) {
		return message;
	}

	const fromStdin = readStdinText();
	if (isNonEmpty(fromStdin)) {
		return fromStdin;
	}

	throw new Error("No message provided (use positional arg, --file, or stdin)");
};

const readAttachText = ({
	text,
	textFile,
}: {
	text?: string;
	textFile?: string;
}): string | undefined => {
	if (isNonEmpty(textFile) && isNonEmpty(text)) {
		throw new Error("Use either --text or --text-file, not both");
	}

	if (isNonEmpty(textFile)) {
		return fs.readFileSync(path.resolve(textFile), "utf8");
	}

	if (isNonEmpty(text)) {
		return text;
	}

	const fromStdin = readStdinText();
	if (!isNonEmpty(fromStdin)) {
		return undefined;
	}

	return fromStdin;
};

const formatHistory = (messages: readonly HistoryMessage[]): string =>
	messages
		.map((message) => {
			const label = message.role === "user" ? "DRIVER" : "NAVIGATOR";
			return `--- ${label} ---\n${message.text}`;
		})
		.join("\n");

const emitWarningBlock = (
	onWarning: ((warning: string) => void) | undefined,
	lines: readonly string[],
): void => {
	if (onWarning === undefined || lines.length === 0) {
		return;
	}
	onWarning("");
	for (const line of lines) {
		onWarning(line);
	}
	onWarning("");
};

const readConversationState = async (page: SessionPage) => {
	const chars = await conversationCharLength(page);
	return conversationLengthState(chars);
};

const maybeWarnConversationLength = async ({
	page,
	onWarning,
}: {
	page: SessionPage;
	onWarning?: (warning: string) => void;
}): Promise<void> => {
	const state = await readConversationState(page);
	emitWarningBlock(onWarning, conversationLengthWarningLines(state));
};

const maybeWarnBlockedConversationSend = async ({
	page,
	onWarning,
}: {
	page: SessionPage;
	onWarning?: (warning: string) => void;
}): Promise<void> => {
	const state = await readConversationState(page);
	emitWarningBlock(onWarning, conversationCapBlockedLines(state));
};

const toPpSendResult = (result: SendNavigatorMessageResult): PpSendResult => {
	const output: PpSendResult = {
		success: result.success,
		sent: result.sent,
		already_sent: result.alreadySent,
		blocked: result.blocked,
		must_start_new: result.mustStartNew,
		reason: result.reason,
		model: result.model,
		chars: result.chars,
	};

	if (result.message !== undefined) {
		output.message = result.message;
	}
	if (result.response !== undefined) {
		output.response = result.response;
	}
	return output;
};

const withCommandLock = async <T>(
	command: string,
	lockPath: string,
	handler: () => Promise<T>,
): Promise<T> => {
	const lock = acquirePpCommandLock({
		command,
		lockPath,
	});
	try {
		return await handler();
	} finally {
		releasePpCommandLock(lock);
	}
};

const withNavigatorSession = async <T>(
	connection: NavigatorConnectionOptions,
	mode: SessionNavigationMode,
	handler: (
		page: SessionPage,
		targetUrl: string,
		session: SessionRuntimeInfo,
	) => Promise<T>,
	{
		ensureComposer = true,
	}: {
		ensureComposer?: boolean;
	} = {},
): Promise<T> =>
	withCommandLock(
		`navigator:${mode}`,
		resolveCommandLockPath(connection),
		async () => {
		const managedLaunch = resolveManagedLaunchIdentity(connection);
		const reusableState =
			managedLaunch !== undefined
				? loadReusableSessionState({
						targetUrl: connection.chatUrl,
						launch: managedLaunch,
					})
				: undefined;
		const targetUrl = resolveTargetUrl({
			connection,
			mode,
			reusableState,
		});
		const openTargetUrl = resolveOpenSessionTargetUrl({
			connection,
			targetUrl,
		});
		let session: Awaited<ReturnType<typeof openChatgptSession>>;
		try {
			session = await openChatgptSession({
				browser: connection.browser,
				chromiumLaunchProfile: connection.chromiumLaunchProfile,
				chromiumBin: connection.chromiumBin,
				cdpUrl: connection.cdpUrl,
				userDataDir: connection.userDataDir,
				profile: connection.profile,
				authFile: connection.authFile,
				headless: connection.headless,
				targetUrl: openTargetUrl,
				navigate: shouldNavigate(connection, mode),
				preserveProjectConversation: mode !== "fresh-navigation",
				strictTabTargeting: resolveStrictTabTargeting(connection),
				ensureComposer,
				composerTimeoutMs: connection.composerTimeoutMs,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const formatted = formatStrictTabTargetingError({
				connection,
				errorMessage: message,
			});
			if (formatted !== message) {
				const wrapped = new Error(formatted);
				(wrapped as Error & { cause?: unknown }).cause = error;
				throw wrapped;
			}
			throw error;
		}

		let result: T | undefined;
		let commandError: unknown;
		try {
			const warnings = validateNoNavigateBinding({
				connection,
				currentUrl: session.page.url(),
			});
			if (warnings.length > 0 && typeof connection.onWarning === "function") {
				for (const warning of warnings) {
					connection.onWarning(warning);
				}
			}
			result = await handler(session.page, targetUrl, {
				ownership: session.ownership,
				freshLaunch: session.freshLaunch,
			});
		} catch (error) {
			commandError = error;
		}

		try {
			if (managedLaunch !== undefined) {
				const currentPageUrl = session.page.url();
				if (
					isNonEmpty(currentPageUrl) &&
					sameHostUrl(connection.chatUrl, currentPageUrl)
				) {
					const visibilityState = await readSessionPageVisibilityState(
						session.page,
					);
					if (shouldPersistReusableSessionLastPage(visibilityState)) {
						saveReusableSessionLastPage({
							targetUrl: connection.chatUrl,
							launch: managedLaunch,
							lastPageUrl: currentPageUrl,
						});
					}
				}
			}
		} catch (error) {
			if (commandError === undefined) {
				commandError = error;
			}
		}

		try {
			if (session.ownership === "managed") {
				await session.close();
			}
		} catch (error) {
			if (commandError === undefined) {
				commandError = error;
			}
		}

		if (commandError !== undefined) {
			throw commandError;
		}
		return result as T;
	},
	);

export const runPpSend = async (options: NavigatorSendOptions) => {
	const message = readMessageInput({
		message: options.message,
		messageFile: options.messageFile,
	});

	return withNavigatorSession(
		options,
		resolveSendSessionMode(options.newChat),
		async (page, targetUrl, session) => {
			await ensureNavigatorResponseNotInProgress({
				page,
				commandName: "pp send",
			});
			const explicitNewChat = options.newChat === true;
			const startNewChat = resolveSendStartNewChat({
				requestedNewChat: options.newChat,
				freshLaunch: session.freshLaunch,
			});
			if (startNewChat) {
				const newChatUrl = explicitNewChat
					? targetUrl
					: resolveFreshSendTargetUrl(options);
				await page.goto(newChatUrl, {
					waitUntil: "domcontentloaded",
				});
				await page.waitForSelector("#prompt-textarea", {
					timeout: options.composerTimeoutMs ?? DEFAULT_COMPOSER_TIMEOUT_MS,
				});
			}

			const modelToApply =
				options.model ?? (explicitNewChat ? DEFAULT_NEW_MODEL : undefined);
			if (modelToApply !== undefined) {
				await setModelMode(page, modelToApply);
			}

			const sent = await sendNavigatorMessage(page, message, {
				force: options.force,
				waitForResponse: options.noWait !== true,
				timeoutMs: options.timeoutMs,
				pollMs: options.pollMs,
				echoMessage: options.echoMessage,
			});

			if (sent.blocked) {
				await maybeWarnBlockedConversationSend({
					page,
					onWarning: options.onWarning,
				});
			} else if (sent.sent || sent.alreadySent) {
				await maybeWarnConversationLength({
					page,
					onWarning: options.onWarning,
				});
			}

			return toPpSendResult(sent);
		},
	);
};

export const runPpWait = async (options: NavigatorWaitOptions) =>
	withNavigatorSession(options, "non-navigating", async (page) => {
		if (resolveWaitAction(await isGenerating(page)) === "wait") {
			return waitForAssistantResponse(page, {
				timeoutMs: options.timeoutMs,
				pollMs: options.pollMs,
			});
		}
		return waitForAssistantResponseOrLatest(page, {
			timeoutMs: options.timeoutMs,
			pollMs: options.pollMs,
		});
	});

export const runPpGetResponse = async (options: NavigatorGetResponseOptions) =>
	withNavigatorSession(options, "non-navigating", async (page) => {
		const response = await getAssistantResponseText(page);
		await maybeWarnConversationLength({
			page,
			onWarning: options.onWarning,
		});
		return response;
	});

export const runPpHistory = async (options: NavigatorHistoryOptions) =>
	withNavigatorSession(options, "non-navigating", async (page) => {
		await maybeWarnConversationLength({
			page,
			onWarning: options.onWarning,
		});
		const history = await getConversationHistory(page, options.last);
		if (options.json === true) {
			return history;
		}
		return formatHistory(history);
	});

export const runPpAttach = async (options: NavigatorAttachOptions) =>
	withNavigatorSession(options, "navigating", async (page) => {
		await ensureNavigatorResponseNotInProgress({
			page,
			commandName: "pp attach",
		});
		const files = normalizeList(options.files ?? []);
		const pipelineText = readAttachText({
			text: options.text,
			textFile: options.textFile,
		});
		const attachments = collectAttachments(
			files,
			pipelineText,
			options.textName,
		);
		const result = await attachToNavigator(page, attachments, {
			prompt: options.prompt,
			send: options.send,
			waitForResponse: options.waitForResponse,
			timeoutMs: options.timeoutMs,
			pollMs: options.pollMs,
		});
		if (options.send === true) {
			if (result.blocked) {
				await maybeWarnBlockedConversationSend({
					page,
					onWarning: options.onWarning,
				});
			} else if (result.sent) {
				await maybeWarnConversationLength({
					page,
					onWarning: options.onWarning,
				});
			}
		}
		return result;
	});

export const runPpDownload = async (
	options: NavigatorDownloadOptions,
): Promise<NavigatorDownloadResult> =>
	withNavigatorSession(options, "non-navigating", async (page) => {
		if (options.list === true) {
			const links = await listNavigatorArtifacts(page);
			return {
				mode: "list" as const,
				links: links.map((link) => ({
					index: link.index,
					file: link.file,
					path: link.sandboxPath,
					label: link.label,
					sandboxPath: link.sandboxPath,
					messageId: link.messageId,
				})),
			};
		}
		return downloadNavigatorArtifact(page, {
			index: options.index,
			outputPath: options.output,
		});
	});

export const runPpCompose = ({
	preambleFile,
	entries,
	onWarning,
}: NavigatorComposeOptions): string =>
	composeNavigatorMessage({
		preambleFile,
		entries,
		onWarning,
	});

export const runPpBrief = async (options: NavigatorBriefOptions) => {
	const shouldArchiveEntries =
		options.inlineEntries !== true && options.entries.length > 0;
	let message = shouldArchiveEntries
		? readNavigatorPreamble({
				preambleFile: options.preambleFile,
			})
		: runPpCompose({
				preambleFile: options.preambleFile,
				entries: options.entries,
				onWarning: options.onWarning,
			});
	const attachFiles = normalizeList(options.attachFiles ?? []);
	const attachments: AttachmentPayload[] = [];

	if (shouldArchiveEntries) {
		const archive = buildNavigatorEntriesArchive({
			entries: options.entries,
			onWarning: options.onWarning,
		});
		attachments.push(
			binaryAttachment(archive.name, archive.bytes, "application/gzip"),
		);
		message = `${message}${formatNavigatorEntriesArchiveNotice(archive)}`;
	}

	if (attachFiles.length > 0) {
		attachments.push(...collectAttachments(attachFiles));
	}

	if (attachments.length === 0) {
		return runPpSend({
			...options,
			message,
		});
	}

	if (attachments.length > 10) {
		throw new Error("Maximum 10 attachments allowed per command");
	}

	return withNavigatorSession(options, resolveSendSessionMode(options.newChat), async (page, targetUrl, session) => {
		await ensureNavigatorResponseNotInProgress({
			page,
			commandName: "pp brief",
		});
		const explicitNewChat = options.newChat === true;
		const startNewChat = resolveSendStartNewChat({
			requestedNewChat: options.newChat,
			freshLaunch: session.freshLaunch,
		});
		if (startNewChat) {
			const newChatUrl = explicitNewChat
				? targetUrl
				: resolveFreshSendTargetUrl(options);
			await page.goto(newChatUrl, {
				waitUntil: "domcontentloaded",
			});
			await page.waitForSelector("#prompt-textarea", {
				timeout: options.composerTimeoutMs ?? DEFAULT_COMPOSER_TIMEOUT_MS,
			});
		}

		const modelToApply =
			options.model ?? (explicitNewChat ? DEFAULT_NEW_MODEL : undefined);
		if (modelToApply !== undefined) {
			await setModelMode(page, modelToApply);
		}

		const sent = await attachToNavigator(page, attachments, {
			prompt: message,
			send: true,
			waitForResponse: options.noWait !== true,
			timeoutMs: options.timeoutMs,
			pollMs: options.pollMs,
		});

		if (sent.blocked) {
			await maybeWarnBlockedConversationSend({
				page,
				onWarning: options.onWarning,
			});
		} else if (sent.sent) {
			await maybeWarnConversationLength({
				page,
				onWarning: options.onWarning,
			});
		}

		return sent;
	});
};

export const runPpSetModel = async (options: NavigatorSetModelOptions) =>
	withNavigatorSession(options, "navigating", async (page) => {
		await ensureNavigatorResponseNotInProgress({
			page,
			commandName: "pp set-model",
		});
		return setModelMode(page, options.mode);
	});

export const runPpNew = async (options: NavigatorNewOptions) =>
	withNavigatorSession(options, "fresh-navigation", async (page) => {
		await ensureNavigatorResponseNotInProgress({
			page,
			commandName: "pp new",
		});
		const mode = options.model ?? DEFAULT_NEW_MODEL;
		const model = await setModelMode(page, mode);
		return {
			new_chat: true,
			model: model.current ?? mode,
		};
	});

export const runPpRefresh = async (options: NavigatorRefreshOptions) =>
	withNavigatorSession(options, "navigating", async (page) => {
		await ensureNavigatorResponseNotInProgress({
			page,
			commandName: "pp refresh",
		});
		await page.evaluate(() => {
			const browserGlobal = globalThis as unknown as {
				location: {
					reload: () => void;
				};
			};
			browserGlobal.location.reload();
		});
		await page.waitForSelector("#prompt-textarea", {
			timeout: options.composerTimeoutMs ?? DEFAULT_COMPOSER_TIMEOUT_MS,
		});
		return {
			refreshed: true,
			url: page.url(),
		};
	});

export const runPpPaste = async (
	options: NavigatorPasteOptions,
): Promise<NavigatorPasteResult> =>
	withNavigatorSession(options, "non-navigating", async (page) => {
		await ensureNavigatorResponseNotInProgress({
			page,
			commandName: "pp paste",
		});
		const text = options.text ?? readStdinText() ?? "";
		const result: PasteNavigatorTextResult = await pasteNavigatorText(
			page,
			text,
			{
				clear: options.clear === true,
				send: options.send === true,
			},
		);
		if (options.send === true) {
			if (result.blocked) {
				await maybeWarnBlockedConversationSend({
					page,
					onWarning: options.onWarning,
				});
			} else if (result.sent) {
				await maybeWarnConversationLength({
					page,
					onWarning: options.onWarning,
				});
			}
		}
		return result;
	});

export const runPpIsolate = async (options: NavigatorIsolateOptions) =>
	withNavigatorSession(options, "navigating", async (page, targetUrl) => {
		const project = resolveNavigatorProject({
			project: options.project,
		});
		const profile = resolveNavigatorProfile({
			profile: options.profile,
		});
		const browser = resolveNavigatorBrowser({
			browser: options.browser,
		});
		const chromiumLaunchProfile = resolveNavigatorChromiumLaunchProfile({
			chromiumLaunchProfile: options.chromiumLaunchProfile,
		});
		return {
			workspace: process.cwd(),
			env_project_var: NAVIGATOR_PROJECT_ENV,
			env_project_value: process.env[NAVIGATOR_PROJECT_ENV] ?? null,
			env_profile_var: NAVIGATOR_PROFILE_ENV,
			env_profile_value: process.env[NAVIGATOR_PROFILE_ENV] ?? null,
			env_browser_var: NAVIGATOR_BROWSER_ENV,
			env_browser_value: process.env[NAVIGATOR_BROWSER_ENV] ?? null,
			env_chromium_launch_profile_var: NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ENV,
			env_chromium_launch_profile_value:
				process.env[NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ENV] ?? null,
			project_binding:
				project === null
					? null
					: {
							source: project.source,
							raw: project.raw,
							project_id: project.projectId,
							project_url: project.projectUrl,
							project_root_url: project.projectRootUrl,
							env_var: project.envVar,
						},
			profile_binding:
				profile === null
					? null
					: {
							source: profile.source,
							raw: profile.raw,
							profile: profile.profile,
							user_data_dir: profile.userDataDir,
							env_var: profile.envVar,
						},
			browser_binding:
				browser === null
					? null
					: {
							source: browser.source,
							raw: browser.raw,
							browser: browser.browser,
							env_var: browser.envVar,
						},
			chromium_launch_profile_binding:
				chromiumLaunchProfile === null
					? null
					: {
							source: chromiumLaunchProfile.source,
							raw: chromiumLaunchProfile.raw,
							chromium_launch_profile:
								chromiumLaunchProfile.chromiumLaunchProfile,
							env_var: chromiumLaunchProfile.envVar,
						},
			connection: {
				browser: options.browser ?? NAVIGATOR_DEFAULT_BROWSER,
				chromium_launch_profile:
					options.chromiumLaunchProfile ??
					NAVIGATOR_DEFAULT_CHROMIUM_LAUNCH_PROFILE,
				cdp_url: options.cdpUrl ?? null,
				user_data_dir: options.userDataDir ?? null,
				profile: options.profile ?? null,
				auth_file: options.authFile ?? null,
				headless: options.headless,
				chat_url: options.chatUrl,
				target_url: targetUrl,
				no_navigate: options.noNavigate === true,
				strict_tab_targeting: options.strictTabTargeting === true,
			},
			current_url: page.url(),
			model: await getCurrentModel(page),
		};
	}, {
		ensureComposer: false,
	});
