/**
 * Playwright CLI style named-session binding for navigator commands.
 */
export const NAVIGATOR_SESSION_ENV = "PLAYWRIGHT_CLI_SESSION";
export const NAVIGATOR_DEFAULT_SESSION_NAME = "default";

export type SessionSource = "option" | "env";

export type ResolveSessionInput = {
	session?: string;
	env?: NodeJS.ProcessEnv;
	envVar?: string;
};

export type ResolvedNavigatorSession = {
	session: string;
	source: SessionSource;
	raw: string;
	envVar: string;
};

const SESSION_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const normalize = (value?: string): string | undefined => {
	if (value === undefined) {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
};

export const parseNavigatorSession = (value: string): string => {
	const trimmed = value.trim();
	if (trimmed === "") {
		throw new Error("Session value is empty.");
	}
	if (!SESSION_NAME_RE.test(trimmed)) {
		throw new Error(
			`Invalid session reference: ${value}. Use session names like 'default' or 'team-a' (letters, numbers, ., _, -).`,
		);
	}
	return trimmed;
};

export const readNavigatorSessionValue = ({
	session,
	env = process.env,
	envVar = NAVIGATOR_SESSION_ENV,
}: ResolveSessionInput): string | undefined => {
	const fromOption = normalize(session);
	if (fromOption !== undefined) {
		return fromOption;
	}
	return normalize(env[envVar]);
};

export const resolveNavigatorSession = ({
	session,
	env = process.env,
	envVar = NAVIGATOR_SESSION_ENV,
}: ResolveSessionInput): ResolvedNavigatorSession | null => {
	const fromOption = normalize(session);
	if (fromOption !== undefined) {
		const parsed = parseNavigatorSession(fromOption);
		return {
			session: parsed,
			source: "option",
			raw: fromOption,
			envVar,
		};
	}

	const fromEnv = normalize(env[envVar]);
	if (fromEnv === undefined) {
		return null;
	}
	const parsed = parseNavigatorSession(fromEnv);
	return {
		session: parsed,
		source: "env",
		raw: fromEnv,
		envVar,
	};
};
