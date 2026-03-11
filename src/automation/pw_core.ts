import fs from "node:fs";
import path from "node:path";

type PlaywrightChromium = {
	launch: (options: {
		executablePath: string;
		headless: boolean;
		args: readonly string[];
	}) => Promise<any>;
};

type PwCliCoreModule = {
	resolvePlaywrightChromium?: (basePath?: string) => PlaywrightChromium;
};

const resolveLegacyPlaywrightCorePath = (
	playwrightRoot: string,
): string | undefined => {
	const legacyRoot = path.join(playwrightRoot, "packages/playwright-core");
	if (fs.existsSync(path.join(legacyRoot, "package.json"))) {
		return legacyRoot;
	}
	return undefined;
};

const resolvePwCliLibraryEntrypoint = (
	playwrightRoot: string,
): string | undefined => {
	const entrypoint = path.join(playwrightRoot, "dist/index.js");
	if (fs.existsSync(entrypoint)) {
		return entrypoint;
	}
	return undefined;
};

const requirePlaywrightChromium = (
	playwrightRoot: string,
): PlaywrightChromium => {
	const resolvedRoot = path.resolve(playwrightRoot);
	const pwCliEntrypoint = resolvePwCliLibraryEntrypoint(resolvedRoot);

	if (pwCliEntrypoint !== undefined) {
		const loaded = require(pwCliEntrypoint) as PwCliCoreModule;
		if (typeof loaded.resolvePlaywrightChromium === "function") {
			return loaded.resolvePlaywrightChromium(resolvedRoot);
		}
	}

	const legacyPlaywrightCore = resolveLegacyPlaywrightCorePath(resolvedRoot);
	if (legacyPlaywrightCore !== undefined) {
		const loaded = require(legacyPlaywrightCore) as {
			chromium?: PlaywrightChromium;
		};
		if (loaded.chromium !== undefined) {
			return loaded.chromium;
		}
	}

	throw new Error(`unsupported playwright runtime root: ${resolvedRoot}`);
};

export { requirePlaywrightChromium, type PlaywrightChromium };
