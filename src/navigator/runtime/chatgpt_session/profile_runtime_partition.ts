import os from "node:os";
import {
	NAVIGATOR_DEFAULT_BROWSER,
	type NavigatorBrowser,
} from "./browser_env";
import { isWslWindowsBrowserPath } from "./browser_resolution";
import { resolvePpProfileBrowserRuntimeDir } from "../pp_state_paths";
import { resolveNavigatorManagedProfileName } from "../managed_profile";

const normalizePlatform = (platform: NodeJS.Platform): string => {
	switch (platform) {
		case "win32":
			return "windows";
		case "darwin":
			return "darwin";
		case "linux":
			return "linux";
		default: {
			const normalized = platform
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "");
			return normalized === "" ? "unknown" : normalized;
		}
	}
};

const isNonEmpty = (value?: string): value is string =>
	value !== undefined && value.trim() !== "";

export const resolveProfileRuntimePartition = ({
	browser = NAVIGATOR_DEFAULT_BROWSER,
	chromiumBin,
	platform = process.platform,
}: {
	browser?: NavigatorBrowser;
	chromiumBin?: string;
	platform?: NodeJS.Platform;
}): string => {
	const platformPartition =
		isNonEmpty(chromiumBin) && isWslWindowsBrowserPath({ chromiumBin })
		? "windows"
		: normalizePlatform(platform);
	if (browser === "chromium") {
		return platformPartition;
	}
	return `${browser}-${platformPartition}`;
};

export const resolveProfileRuntimeUserDataDir = ({
	browser = NAVIGATOR_DEFAULT_BROWSER,
	profile,
	chromiumBin,
	env = process.env,
	homeDir = os.homedir(),
	platform = process.platform,
}: {
	browser?: NavigatorBrowser;
	profile: string;
	chromiumBin?: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
	platform?: NodeJS.Platform;
}): string =>
	resolvePpProfileBrowserRuntimeDir({
		profile,
		runtimePartition: resolveProfileRuntimePartition({
			browser,
			chromiumBin,
			platform,
		}),
		env,
		homeDir,
	});

export const resolveDefaultProfileRuntimeUserDataDir = ({
	browser = NAVIGATOR_DEFAULT_BROWSER,
	chromiumBin,
	session,
	env = process.env,
	homeDir = os.homedir(),
	platform = process.platform,
}: {
	browser?: NavigatorBrowser;
	chromiumBin?: string;
	session?: string;
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
	platform?: NodeJS.Platform;
}): string =>
	resolveProfileRuntimeUserDataDir({
		browser,
		profile: resolveNavigatorManagedProfileName({
			session,
		}),
		chromiumBin,
		env,
		homeDir,
		platform,
	});
