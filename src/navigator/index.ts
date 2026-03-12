/**
 * Public navigator API surface.
 * Re-exports compose, browser runtime, auth export, and limit utilities.
 */
export {
	composeNavigatorMessage,
	readNavigatorPreamble,
	resolveComposeEntries,
	readSlice,
	type ComposeNavigatorMessageOptions,
	type ReadNavigatorPreambleOptions,
	type ReadSliceResult,
	type ResolvedComposeEntry,
	type ResolvedComposeFileEntry,
	type ResolvedComposeSliceEntry,
} from "./compose/composer";
export {
	buildNavigatorEntriesArchive,
	formatNavigatorEntriesArchiveNotice,
	type BuildNavigatorEntriesArchiveOptions,
	type NavigatorEntriesArchive,
	type NavigatorEntriesArchiveManifestEntry,
} from "./compose/archive";
export {
	parseRangeShorthandEntry,
	parseSliceEntry,
	type LineRange,
	type RangeShorthandEntry,
	type SliceEntry,
} from "./compose/entry_parser";
export {
	CHATGPT_BASE_URL,
	parseProjectId,
	parseProjectRef,
	projectUrls,
	urlInProject,
	type ParsedProjectRef,
	type ProjectUrls,
} from "./project/project_ref";
export {
	NAVIGATOR_DEFAULT_SESSION_NAME,
	NAVIGATOR_SESSION_ENV,
	parseNavigatorSession,
	readNavigatorSessionValue,
	resolveNavigatorSession,
	type ResolvedNavigatorSession,
	type ResolveSessionInput,
	type SessionSource,
} from "./session/session_env";
export {
	NAVIGATOR_PROJECT_ENV,
	readNavigatorProjectValue,
	resolveNavigatorProject,
	type ProjectSource,
	type ResolvedNavigatorProject,
	type ResolveProjectInput,
} from "./project/project_env";
export {
	NAVIGATOR_PROFILE_ENV,
	parseNavigatorProfile,
	profileUserDataDir,
	readNavigatorProfileValue,
	resolveNavigatorProfile,
	type ProfileSource,
	type ResolvedNavigatorProfile,
	type ResolveProfileInput,
} from "./profile/profile_env";
export {
	CONVERSATION_CHAR_LIMIT,
	CONVERSATION_CRITICAL_PCT,
	CONVERSATION_HARD_CAP_PCT,
	CONVERSATION_START_FRESH_NOW_MESSAGE,
	CONVERSATION_START_FRESH_SOON_MESSAGE,
	CONVERSATION_WARN_PCT,
	conversationCapBlockedLines,
	conversationLengthState,
	conversationLengthWarningLines,
	sendGate,
	type ConversationLengthLevel,
	type ConversationLengthState,
	type SendGate,
} from "./limits/conversation_limits";
export {
	insertComposerText,
	type BrowserPage,
	type InsertComposerTextOptions,
	type InsertComposerTextResult,
} from "./browser/composer";
export {
	attachmentMime,
	attachToNavigator,
	binaryAttachment,
	collectAttachments,
	fileAttachment,
	pasteAttachments,
	textAttachment,
	type AttachmentMeta,
	type AttachmentPayload,
	type AttachNavigatorOptions,
	type AttachNavigatorResult,
	type PasteAttachmentsResult,
} from "./browser/attachments";
export {
	downloadNavigatorArtifact,
	listNavigatorArtifacts,
	type DownloadNavigatorArtifactContentResult,
	type DownloadNavigatorArtifactOptions,
	type DownloadNavigatorArtifactResult,
	type DownloadNavigatorArtifactSavedResult,
	type NavigatorArtifactLink,
} from "./browser/download";
export {
	cleanResponseText,
	getAssistantResponseText,
	getLastAssistantMarkdownViaConversationApi,
	getLastAssistantMarkdownViaReact,
	getLastAssistantRenderedText,
	type AssistantResponse,
	type AssistantResponseSource,
} from "./browser/response";
export {
	assistantMessageCount,
	getConversationHistory,
	isGenerating,
	waitForAssistantResponse,
	waitForAssistantResponseOrLatest,
	type HistoryMessage,
	type WaitForAssistantResponseOptions,
	type WaitForAssistantResponseOrLatestOptions,
} from "./browser/messaging";
export {
	conversationCharLength,
	getCurrentModel,
	getLastDriverMessage,
	setModelMode,
	type ModelMenuItem,
	type ModelMode,
	type SetModelResult,
} from "./browser/session";
export {
	clickSendButton,
	sendNavigatorMessage,
	type SendNavigatorMessageOptions,
	type SendNavigatorMessageResult,
} from "./browser/send";
export {
	pasteNavigatorText,
	type PasteNavigatorTextOptions,
	type PasteNavigatorTextResult,
} from "./browser/paste";
export {
	openChatgptSession,
	type ChatgptSession,
	type OpenChatgptSessionOptions,
} from "./runtime/chatgpt_session";
export {
	createAuthListener,
	generateAuthToken,
	runAuthListener,
	type AuthListener,
	type CreateAuthListenerOptions,
	type RunAuthListenerOptions,
} from "./auth_export/listener";
export {
	domainCookiesToStorageState,
	extensionCookieToStorageStateCookie,
	sanitizeDomain,
	saveDomainCookies,
	type StorageState,
} from "./auth_export/storage_state";
export {
	parseExtensionMessage,
	type DomainCookies,
	type ExtensionCookie,
	type ExtensionMessage,
	type ServerMessage,
} from "./auth_export/protocol";
