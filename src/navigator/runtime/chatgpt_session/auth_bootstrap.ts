import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	resolvePpAuthDir,
	resolvePpProfileAuthDir,
} from "../pp_state_paths";
import type { RuntimeContext, RuntimePage } from "./types";

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

const resolveAuthBootstrapFilename = (targetUrl?: string): string | undefined => {
	const host = parseTargetHost(targetUrl);
	if (!isNonEmpty(host)) {
		return undefined;
	}
	return `${sanitizeHost(host)}.json`;
};

export const resolveProfileAuthBootstrapFile = ({
	profile,
	targetUrl,
	env = process.env,
	homeDir = os.homedir(),
}: {
	profile: string;
	targetUrl?: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
}): string | undefined => {
	const filename = resolveAuthBootstrapFilename(targetUrl);
	if (!isNonEmpty(filename)) {
		return undefined;
	}
	return path.resolve(
		resolvePpProfileAuthDir({
			profile,
			env,
			homeDir,
		}),
		filename,
	);
};

export const resolveDefaultAuthBootstrapFile = ({
	targetUrl,
	profile,
	env = process.env,
	homeDir = os.homedir(),
	fileExists = fs.existsSync,
}: {
	targetUrl?: string;
	profile?: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
	fileExists?: (filePath: string) => boolean;
}): string | undefined => {
	const filename = resolveAuthBootstrapFilename(targetUrl);
	if (!isNonEmpty(filename)) {
		return undefined;
	}

	const candidates = [
		isNonEmpty(profile)
			? path.resolve(
					resolvePpProfileAuthDir({
						profile,
						env,
						homeDir,
					}),
					filename,
				)
			: undefined,
		path.resolve(resolvePpAuthDir({ env, homeDir }), filename),
	].filter(isNonEmpty);

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

type StorageStateOriginLocalStorageEntry = {
	name: string;
	value: string;
};

type StorageStateOrigin = {
	origin: string;
	localStorage: StorageStateOriginLocalStorageEntry[];
};

export type ParsedAuthStorageState = {
	cookies: StorageStateCookie[];
	origins: StorageStateOrigin[];
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

const parseOriginLocalStorageEntry = (
	value: unknown,
	index: number,
): StorageStateOriginLocalStorageEntry => {
	if (!isObjectRecord(value)) {
		throw new Error(`auth origins[].localStorage[${index}] must be an object`);
	}
	return {
		name: requireString(
			value.name,
			`auth origins[].localStorage[${index}].name`,
		),
		value: requireString(
			value.value,
			`auth origins[].localStorage[${index}].value`,
		),
	};
};

const parseOrigin = (value: unknown, index: number): StorageStateOrigin => {
	if (!isObjectRecord(value)) {
		throw new Error(`auth origins[${index}] must be an object`);
	}
	return {
		origin: requireString(value.origin, `auth origins[${index}].origin`),
		localStorage: Array.isArray(value.localStorage)
			? value.localStorage.map((entry, entryIndex) =>
					parseOriginLocalStorageEntry(entry, entryIndex),
				)
			: [],
	};
};

export const readAuthStorageState = (
	authFile: string,
): ParsedAuthStorageState => {
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

	const cookies = Array.isArray(parsed.cookies)
		? parsed.cookies.map((cookie, index) => parseCookie(cookie, index))
		: [];
	const origins = Array.isArray(parsed.origins)
		? parsed.origins.map((origin, index) => parseOrigin(origin, index))
		: [];

	if (cookies.length === 0 && origins.every((origin) => origin.localStorage.length === 0)) {
		throw new Error(`auth file contains no cookies or localStorage: ${resolvedAuthFile}`);
	}

	return {
		cookies,
		origins,
	};
};

const applyLocalStorage = async ({
	page,
	origins,
}: {
	page: RuntimePage;
	origins: readonly StorageStateOrigin[];
}): Promise<void> => {
	for (const origin of origins) {
		if (origin.localStorage.length === 0) {
			continue;
		}
		await page.goto(origin.origin, { waitUntil: "domcontentloaded" });
		await page.evaluate((items) => {
			for (const item of items) {
				localStorage.setItem(item.name, item.value);
			}
		}, origin.localStorage);
	}
};

export const applyAuthStorageStateToContext = async ({
	context,
	page,
	authFile,
}: {
	context: RuntimeContext;
	page: RuntimePage;
	authFile: string;
}): Promise<void> => {
	const storageState = readAuthStorageState(authFile);
	if (storageState.cookies.length > 0) {
		if (context.addCookies === undefined) {
			throw new Error(
				`runtime context does not support addCookies while loading auth file: ${path.resolve(authFile)}`,
			);
		}
		await context.addCookies(storageState.cookies);
	}
	await applyLocalStorage({
		page,
		origins: storageState.origins,
	});
};
