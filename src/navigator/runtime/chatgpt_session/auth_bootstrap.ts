import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvePpAuthDir, resolvePpSessionAuthDir } from "../pp_state_paths";
import {
	NAVIGATOR_DEFAULT_SESSION_NAME,
	parseNavigatorSession,
} from "../../session/session_env";
import type { RuntimeContext } from "./types";

/**
 * Discovery and loading for default auth exports under XDG state roots.
 */
const isNonEmpty = (value?: string): value is string =>
	value !== undefined && value.trim() !== "";

const sanitizeHost = (host: string): string =>
	host.trim().toLowerCase().replace(/^\./, "").replace(/\./g, "_");

const parseTargetHost = (targetUrl?: string): string | undefined => {
	if (!isNonEmpty(targetUrl)) {
		return undefined;
	}
	try {
		const parsed = new URL(targetUrl);
		return isNonEmpty(parsed.hostname) ? parsed.hostname : undefined;
	} catch {
		return undefined;
	}
};

export const resolveDefaultAuthFile = ({
	targetUrl,
	session,
	env = process.env,
	homeDir = os.homedir(),
	fileExists = fs.existsSync,
}: {
	targetUrl?: string;
	session?: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
	fileExists?: (filePath: string) => boolean;
}): string | undefined => {
	const host = parseTargetHost(targetUrl);
	if (!isNonEmpty(host)) {
		return undefined;
	}

	const filename = `${sanitizeHost(host)}.json`;
	const candidates: string[] = [];
	if (isNonEmpty(session)) {
		const parsedSession = parseNavigatorSession(session);
		if (parsedSession !== NAVIGATOR_DEFAULT_SESSION_NAME) {
			candidates.push(
				path.resolve(
					resolvePpSessionAuthDir({
						session: parsedSession,
						env,
						homeDir,
					}),
					filename,
				),
			);
		}
	}
	candidates.push(path.resolve(resolvePpAuthDir({ env, homeDir }), filename));

	for (const candidate of candidates) {
		if (fileExists(candidate)) {
			return candidate;
		}
	}
	return undefined;
};

type StorageStateCookie = {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number;
	httpOnly: boolean;
	secure: boolean;
	sameSite: "Strict" | "Lax" | "None";
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const requireString = (value: unknown, label: string): string => {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value;
};

const parseSameSite = (value: unknown): "Strict" | "Lax" | "None" => {
	switch (value) {
		case "Strict":
			return "Strict";
		case "None":
			return "None";
		case "Lax":
		default:
			return "Lax";
	}
};

const parseCookie = (value: unknown, index: number): StorageStateCookie => {
	if (!isObjectRecord(value)) {
		throw new Error(`auth cookies[${index}] must be an object`);
	}

	const expiresRaw = value.expires;
	const expires =
		typeof expiresRaw === "number" && Number.isFinite(expiresRaw)
			? expiresRaw
			: -1;

	return {
		name: requireString(value.name, `auth cookies[${index}].name`),
		value: requireString(value.value, `auth cookies[${index}].value`),
		domain: requireString(value.domain, `auth cookies[${index}].domain`),
		path:
			typeof value.path === "string" && value.path !== "" ? value.path : "/",
		expires,
		httpOnly: value.httpOnly === true,
		secure: value.secure === true,
		sameSite: parseSameSite(value.sameSite),
	};
};

export const readAuthCookies = (authFile: string): StorageStateCookie[] => {
	const resolvedAuthFile = path.resolve(authFile);
	const raw = fs.readFileSync(resolvedAuthFile, "utf8");

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`failed to parse auth file JSON: ${resolvedAuthFile}: ${message}`,
		);
	}

	if (!isObjectRecord(parsed)) {
		throw new Error(`auth file root must be an object: ${resolvedAuthFile}`);
	}
	if (!Array.isArray(parsed.cookies)) {
		throw new Error(`auth file cookies must be an array: ${resolvedAuthFile}`);
	}

	const cookies = parsed.cookies.map((cookie, index) =>
		parseCookie(cookie, index),
	);
	if (cookies.length === 0) {
		throw new Error(`auth file contains no cookies: ${resolvedAuthFile}`);
	}
	return cookies;
};

export const applyAuthCookiesToContext = async ({
	context,
	authFile,
}: {
	context: RuntimeContext;
	authFile: string;
}): Promise<void> => {
	if (context.addCookies === undefined) {
		throw new Error(
			`runtime context does not support addCookies while loading auth file: ${path.resolve(authFile)}`,
		);
	}
	const cookies = readAuthCookies(authFile);
	await context.addCookies(cookies);
};
