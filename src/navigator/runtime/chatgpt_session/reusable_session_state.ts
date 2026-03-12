import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NAVIGATOR_DEFAULT_CHROMIUM_LAUNCH_PROFILE } from "./chromium_launch_profile_env";
import type { NavigatorChromiumLaunchProfile } from "./chromium_launch_profile_env";
import { resolvePpSessionRuntimeDir } from "../pp_state_paths";

/**
 * Persisted metadata for reconnecting pp commands to a reusable browser session.
 */
export type ReusableSessionState = {
	version: 1;
	host: string;
	cdpUrl: string;
	chromiumBin: string;
	chromiumLaunchProfile: NavigatorChromiumLaunchProfile;
	userDataDir: string;
	headless: boolean;
	lastPageUrl?: string;
	updatedAtIso: string;
};

export type ReusableSessionLaunchIdentity = {
	chromiumBin: string;
	userDataDir: string;
	headless: boolean;
	chromiumLaunchProfile: NavigatorChromiumLaunchProfile;
};

const REUSABLE_SESSION_VERSION = 1;
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH = /^\\\\/;
const isNonEmpty = (value?: string): value is string =>
	value !== undefined && value.trim() !== "";

const isWindowsPath = (value: string): boolean =>
	WINDOWS_DRIVE_PATH.test(value) || WINDOWS_UNC_PATH.test(value);

const normalizeFilePath = (value: string): string => {
	const trimmed = value.trim();
	if (trimmed === "") {
		return trimmed;
	}
	return isWindowsPath(trimmed)
		? trimmed.replace(/\//g, "\\")
		: path.resolve(trimmed);
};

const normalizeLaunchIdentity = (
	launch: ReusableSessionLaunchIdentity,
): ReusableSessionLaunchIdentity => ({
	chromiumBin: normalizeFilePath(launch.chromiumBin),
	userDataDir: normalizeFilePath(launch.userDataDir),
	headless: launch.headless,
	chromiumLaunchProfile: launch.chromiumLaunchProfile,
});

const launchFingerprint = (launch: ReusableSessionLaunchIdentity): string => {
	const normalized = normalizeLaunchIdentity(launch);
	return crypto
		.createHash("sha256")
		.update(
				`${normalized.chromiumBin}\n${normalized.userDataDir}\n${
					normalized.headless ? "1" : "0"
				}\n${normalized.chromiumLaunchProfile}`,
			)
			.digest("hex")
			.slice(0, 16);
};

const resolveHost = (targetUrl: string): string => {
	let parsed: URL;
	try {
		parsed = new URL(targetUrl);
	} catch {
		throw new Error(
			`invalid chat url for reusable session state: ${targetUrl}`,
		);
	}
	const host = parsed.hostname.trim().toLowerCase();
	if (host === "") {
		throw new Error(
			`missing hostname in chat url for reusable session state: ${targetUrl}`,
		);
	}
	return host;
};

const hostFilename = (host: string): string =>
	host.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "session";

const resolveSessionRuntimeDir = ({
	session,
	env = process.env,
	homeDir = os.homedir(),
}: {
	session?: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
} = {}): string => resolvePpSessionRuntimeDir({ session, env, homeDir });

const resolveLegacySessionPath = ({
	host,
	session,
	env = process.env,
	homeDir = os.homedir(),
}: {
	host: string;
	session?: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
}): string =>
	path.resolve(
		resolveSessionRuntimeDir({ session, env, homeDir }),
		`${hostFilename(host)}.session.json`,
	);

const resolveLaunchSessionPath = ({
	host,
	launch,
	session,
	env = process.env,
	homeDir = os.homedir(),
}: {
	host: string;
	launch: ReusableSessionLaunchIdentity;
	session?: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
}): string =>
	path.resolve(
		resolveSessionRuntimeDir({ session, env, homeDir }),
		`${hostFilename(host)}.${launchFingerprint(launch)}.session.json`,
	);

const resolveSessionStatePathsForHost = ({
	host,
	session,
	env = process.env,
	homeDir = os.homedir(),
}: {
	host: string;
	session?: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
}): string[] => {
	const runtimeDir = resolveSessionRuntimeDir({ session, env, homeDir });
	if (!fs.existsSync(runtimeDir)) {
		return [];
	}
	const baseName = hostFilename(host);
	const legacyName = `${baseName}.session.json`;
	const prefix = `${baseName}.`;

	return fs
		.readdirSync(runtimeDir, {
			withFileTypes: true,
		})
		.filter((entry) => {
			if (!entry.isFile()) {
				return false;
			}
			if (entry.name === legacyName) {
				return true;
			}
			return (
				entry.name.startsWith(prefix) && entry.name.endsWith(".session.json")
			);
		})
		.map((entry) => path.resolve(runtimeDir, entry.name));
};

const parseSessionState = ({
	raw,
	filePath,
}: {
	raw: string;
	filePath: string;
}): ReusableSessionState => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "unknown JSON parse error";
		throw new Error(
			`failed to parse reusable session state at ${filePath}: ${message}`,
		);
	}

	if (typeof parsed !== "object" || parsed === null) {
		throw new Error(
			`invalid reusable session state at ${filePath}: expected object`,
		);
	}
	const record = parsed as Record<string, unknown>;
	if (record.version !== REUSABLE_SESSION_VERSION) {
		throw new Error(
			`invalid reusable session state at ${filePath}: unsupported version '${String(record.version)}'`,
		);
	}
	if (typeof record.host !== "string" || record.host.trim() === "") {
		throw new Error(
			`invalid reusable session state at ${filePath}: host is required`,
		);
	}
	if (typeof record.cdpUrl !== "string" || record.cdpUrl.trim() === "") {
		throw new Error(
			`invalid reusable session state at ${filePath}: cdpUrl is required`,
		);
	}
	if (
		typeof record.chromiumBin !== "string" ||
		record.chromiumBin.trim() === ""
	) {
		throw new Error(
			`invalid reusable session state at ${filePath}: chromiumBin is required`,
		);
	}
	if (
		typeof record.userDataDir !== "string" ||
		record.userDataDir.trim() === ""
	) {
		throw new Error(
			`invalid reusable session state at ${filePath}: userDataDir is required`,
		);
	}
	if (typeof record.headless !== "boolean") {
		throw new Error(
			`invalid reusable session state at ${filePath}: headless must be boolean`,
		);
	}
	if (
		record.lastPageUrl !== undefined &&
		(typeof record.lastPageUrl !== "string" || record.lastPageUrl.trim() === "")
	) {
		throw new Error(
			`invalid reusable session state at ${filePath}: lastPageUrl must be non-empty string`,
		);
	}
	if (
		typeof record.updatedAtIso !== "string" ||
		record.updatedAtIso.trim() === ""
	) {
		throw new Error(
			`invalid reusable session state at ${filePath}: updatedAtIso is required`,
		);
	}

	const output: ReusableSessionState = {
		version: REUSABLE_SESSION_VERSION,
		host: record.host,
		cdpUrl: record.cdpUrl,
		chromiumBin: normalizeFilePath(record.chromiumBin),
		chromiumLaunchProfile:
			record.chromiumLaunchProfile === "strict"
				? "strict"
				: NAVIGATOR_DEFAULT_CHROMIUM_LAUNCH_PROFILE,
		userDataDir: normalizeFilePath(record.userDataDir),
		headless: record.headless,
		updatedAtIso: record.updatedAtIso,
	};
	if (typeof record.lastPageUrl === "string") {
		output.lastPageUrl = record.lastPageUrl;
	}
	return output;
};

const readSessionState = (filePath: string): ReusableSessionState =>
	parseSessionState({
		raw: fs.readFileSync(filePath, "utf8"),
		filePath,
	});

const writeSessionState = ({
	targetUrl,
	launch,
	state,
	session,
	env = process.env,
	homeDir = os.homedir(),
}: {
	targetUrl: string;
	launch: ReusableSessionLaunchIdentity;
	state: ReusableSessionState;
	session?: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
}): void => {
	const host = resolveHost(targetUrl);
	const filePath = resolveLaunchSessionPath({
		host,
		launch,
		session,
		env,
		homeDir,
	});
	fs.mkdirSync(path.dirname(filePath), {
		recursive: true,
	});
	fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const updatedAtMillis = (state: ReusableSessionState): number => {
	const parsed = Date.parse(state.updatedAtIso);
	return Number.isFinite(parsed) ? parsed : 0;
};

export const loadReusableSessionState = ({
	targetUrl,
	launch,
	session,
	env = process.env,
	homeDir = os.homedir(),
}: {
	targetUrl: string;
	launch?: ReusableSessionLaunchIdentity;
	session?: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
}): ReusableSessionState | undefined => {
	const host = resolveHost(targetUrl);

	if (launch !== undefined) {
		const normalizedLaunch = normalizeLaunchIdentity(launch);
		const launchPath = resolveLaunchSessionPath({
			host,
			launch: normalizedLaunch,
			session,
			env,
			homeDir,
		});
		if (fs.existsSync(launchPath)) {
			return readSessionState(launchPath);
		}
		const legacyPath = resolveLegacySessionPath({
			host,
			session,
			env,
			homeDir,
		});
		if (fs.existsSync(legacyPath)) {
			const legacy = readSessionState(legacyPath);
			if (reusableSessionMatchesLaunch(legacy, normalizedLaunch)) {
				return legacy;
			}
		}
		return undefined;
	}

	const states = resolveSessionStatePathsForHost({
		host,
		session,
		env,
		homeDir,
	})
		.map(readSessionState)
		.sort((left, right) => updatedAtMillis(right) - updatedAtMillis(left));
	return states[0];
};

export const saveReusableSessionState = ({
	targetUrl,
	cdpUrl,
	chromiumBin,
	userDataDir,
	headless,
	chromiumLaunchProfile = NAVIGATOR_DEFAULT_CHROMIUM_LAUNCH_PROFILE,
	lastPageUrl,
	session,
	env = process.env,
	homeDir = os.homedir(),
}: {
	targetUrl: string;
	cdpUrl: string;
	chromiumBin: string;
	userDataDir: string;
	headless: boolean;
	chromiumLaunchProfile?: NavigatorChromiumLaunchProfile;
	lastPageUrl?: string;
	session?: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
}): ReusableSessionState => {
	const host = resolveHost(targetUrl);
	const launch = normalizeLaunchIdentity({
		chromiumBin,
		userDataDir,
		headless,
		chromiumLaunchProfile,
	});
	const output: ReusableSessionState = {
		version: REUSABLE_SESSION_VERSION,
		host,
		cdpUrl,
		chromiumBin: launch.chromiumBin,
		chromiumLaunchProfile: launch.chromiumLaunchProfile,
		userDataDir: launch.userDataDir,
		headless: launch.headless,
		updatedAtIso: new Date().toISOString(),
	};
	if (typeof lastPageUrl === "string" && lastPageUrl.trim() !== "") {
		output.lastPageUrl = lastPageUrl;
	}
	writeSessionState({
		targetUrl,
		launch,
		state: output,
		session,
		env,
		homeDir,
	});
	return output;
};

export const saveReusableSessionLastPage = ({
	targetUrl,
	lastPageUrl,
	launch,
	session,
	env = process.env,
	homeDir = os.homedir(),
}: {
	targetUrl: string;
	lastPageUrl: string;
	launch?: ReusableSessionLaunchIdentity;
	session?: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
}): void => {
	const existing = loadReusableSessionState({
		targetUrl,
		launch,
		session,
		env,
		homeDir,
	});
	if (existing === undefined) {
		return;
	}
	const resolvedLaunch =
		launch === undefined
				? {
						chromiumBin: existing.chromiumBin,
						userDataDir: existing.userDataDir,
						headless: existing.headless,
						chromiumLaunchProfile: existing.chromiumLaunchProfile,
					}
				: launch;
	writeSessionState({
		targetUrl,
		launch: resolvedLaunch,
		session,
		env,
		homeDir,
		state: {
			...existing,
			lastPageUrl,
			updatedAtIso: new Date().toISOString(),
		},
	});
};

export const clearReusableSessionState = ({
	targetUrl,
	launch,
	session,
	env = process.env,
	homeDir = os.homedir(),
}: {
	targetUrl: string;
	launch?: ReusableSessionLaunchIdentity;
	session?: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
}): void => {
	const host = resolveHost(targetUrl);
	if (launch !== undefined) {
		const launchPath = resolveLaunchSessionPath({
			host,
			launch: normalizeLaunchIdentity(launch),
			session,
			env,
			homeDir,
		});
		if (fs.existsSync(launchPath)) {
			fs.rmSync(launchPath, {
				force: true,
			});
		}
		return;
	}

	for (const filePath of resolveSessionStatePathsForHost({
		host,
		session,
		env,
		homeDir,
	})) {
		fs.rmSync(filePath, {
			force: true,
		});
	}
};

export const reusableSessionMatchesLaunch = (
	state: ReusableSessionState,
	launch: ReusableSessionLaunchIdentity,
): boolean => {
	const normalizedLaunch = normalizeLaunchIdentity(launch);
	return (
		state.chromiumBin === normalizedLaunch.chromiumBin &&
		state.chromiumLaunchProfile === normalizedLaunch.chromiumLaunchProfile &&
		state.userDataDir === normalizedLaunch.userDataDir &&
		state.headless === normalizedLaunch.headless
	);
};

export const reusableSessionMatchesConnectionHints = (
	state: ReusableSessionState,
	hints: {
		chromiumBin?: string;
		userDataDir?: string;
		headless: boolean;
		chromiumLaunchProfile?: NavigatorChromiumLaunchProfile;
	},
): boolean => {
	if (state.headless !== hints.headless) {
		return false;
	}
	if (
		isNonEmpty(hints.chromiumBin) &&
		normalizeFilePath(hints.chromiumBin) !== state.chromiumBin
	) {
		return false;
	}
	if (
		isNonEmpty(hints.userDataDir) &&
		normalizeFilePath(hints.userDataDir) !== state.userDataDir
	) {
		return false;
	}
	if (
		hints.chromiumLaunchProfile !== undefined &&
		hints.chromiumLaunchProfile !== state.chromiumLaunchProfile
	) {
		return false;
	}
	return true;
};
