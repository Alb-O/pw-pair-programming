import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { parseWithCommander } from "../../ecosystem/commander_parse";
import {
	parseIntOption,
	readBooleanOption,
	readStringOption,
	requireNoPositionals,
	requireOption,
} from "../../ecosystem/argv";
import type { ModelMode } from "../../navigator/browser/session";
import {
	NAVIGATOR_BROWSER_ENV,
	resolveNavigatorBrowser,
} from "../../navigator/runtime/chatgpt_session/browser_env";
import {
	NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ENV,
	resolveNavigatorChromiumLaunchProfile,
} from "../../navigator/runtime/chatgpt_session/chromium_launch_profile_env";
import {
	NAVIGATOR_PROFILE_ENV,
	resolveNavigatorProfile,
} from "../../navigator/profile/profile_env";
import {
	NAVIGATOR_SESSION_ENV,
	resolveNavigatorSession,
} from "../../navigator/session/session_env";
import {
	NAVIGATOR_PROJECT_ENV,
	resolveNavigatorProject,
} from "../../navigator/project/project_env";
import {
	runPpAttach,
	runPpBrief,
	runPpCompose,
	runPpDownload,
	runPpGetResponse,
	runPpHistory,
	runPpIsolate,
	runPpNew,
	runPpPaste,
	runPpRefresh,
	runPpSend,
	runPpSetModel,
	runPpWait,
	type NavigatorAttachOptions,
	type NavigatorBriefOptions,
	type NavigatorComposeOptions,
	type NavigatorConnectionOptions,
	type NavigatorDownloadListItem,
	type NavigatorDownloadOptions,
	type NavigatorGetResponseOptions,
	type NavigatorHistoryOptions,
	type NavigatorNewOptions,
	type NavigatorPasteOptions,
	type NavigatorSendOptions,
	type NavigatorSetModelOptions,
	type NavigatorWaitOptions,
} from "../../navigator/runtime/cli_runner";

/**
 * PP module command surface and runtime dispatch.
 *
 * This module owns chatgpt navigation commands and runtime dispatch.
 */
export const PP_COMMAND_USAGE_LINES = [
	"  send [connection opts] [<message>] [--file <path>] [--model <mode>] [--new] [--force] [--echo-message] [--no-wait] [--timeout <int>] [--poll-ms <int>] [--json]",
	"  wait [connection opts] [--timeout <int>] [--poll-ms <int>] [--json]",
	"  get-response [connection opts] [--json]",
	"  history [connection opts] [--last <int>] [--json]",
	"  attach [connection opts] [<file>...] [--name <name>] [--prompt <text>] [--send] [--wait-for-response] [--timeout <int>] [--poll-ms <int>] [--json]",
	"  compose --preamble-file <path> [<entry>...]",
	"  brief [connection opts] --preamble-file <path> [<entry>...] [--inline-entries] [--attach <path>] [--model <mode>] [--new] [--force] [--no-wait] [--timeout <int>] [--poll-ms <int>] [--json]",
	"  download [connection opts] [--list] [--index <int>] [--output <path>] [--json]",
	"  set-model [connection opts] <auto|instant|thinking|pro> [--json]",
	"  new [connection opts] [--model <mode>] [--json]",
	"  refresh [connection opts] [--json]",
	"  paste [connection opts] [--send] [--clear] [--json]",
	"  isolate [connection opts] [--json]",
] as const;

export const CONNECTION_USAGE_LINES = [
	`  [--browser <chromium|firefox>] [--chromium-launch-profile <low-detection|strict>] [--cdp-url <url>] [--chromium-bin <path>] [--user-data-dir <path>] [--profile <name>] [--session <name>] [--chat-url <url>] [--project <g-p-id-or-url>] [--headless] [--no-navigate] [--composer-timeout-ms <int>]`,
	`  default project source: $${NAVIGATOR_PROJECT_ENV} when --project is not provided`,
	`  default profile source: $${NAVIGATOR_PROFILE_ENV} when --user-data-dir and --profile are not provided`,
	`  default session source: $${NAVIGATOR_SESSION_ENV} when --session is not provided`,
	`  default browser source: $${NAVIGATOR_BROWSER_ENV} when --browser is not provided`,
	`  default chromium launch profile source: $${NAVIGATOR_CHROMIUM_LAUNCH_PROFILE_ENV} when --chromium-launch-profile is not provided`,
] as const;

export const PP_USAGE = [
	"usage: pp <command> [options]",
	"",
	"pair programming commands:",
	...PP_COMMAND_USAGE_LINES,
	"",
	"connection opts:",
	...CONNECTION_USAGE_LINES,
].join("\n");

export type PpSendCommand = {
	kind: "pp-send";
	options: NavigatorSendOptions;
	json: boolean;
};

export type PpWaitCommand = {
	kind: "pp-wait";
	options: NavigatorWaitOptions;
	json: boolean;
};

export type PpGetResponseCommand = {
	kind: "pp-get-response";
	options: NavigatorGetResponseOptions;
	json: boolean;
};

export type PpHistoryCommand = {
	kind: "pp-history";
	options: NavigatorHistoryOptions;
};

export type PpAttachCommand = {
	kind: "pp-attach";
	options: NavigatorAttachOptions;
	json: boolean;
};

export type PpDownloadCommand = {
	kind: "pp-download";
	options: NavigatorDownloadOptions;
	json: boolean;
};

export type PpComposeCommand = {
	kind: "pp-compose";
	options: NavigatorComposeOptions;
};

export type PpBriefCommand = {
	kind: "pp-brief";
	options: NavigatorBriefOptions;
	json: boolean;
};

export type PpSetModelCommand = {
	kind: "pp-set-model";
	options: NavigatorSetModelOptions;
	json: boolean;
};

export type PpNewCommand = {
	kind: "pp-new";
	options: NavigatorNewOptions;
	json: boolean;
};

export type PpRefreshCommand = {
	kind: "pp-refresh";
	options: NavigatorConnectionOptions;
	json: boolean;
};

export type PpPasteCommand = {
	kind: "pp-paste";
	options: NavigatorPasteOptions;
	json: boolean;
};

export type PpIsolateCommand = {
	kind: "pp-isolate";
	options: NavigatorConnectionOptions;
	json: boolean;
};

export type PpSubcommand =
	| PpSendCommand
	| PpWaitCommand
	| PpGetResponseCommand
	| PpHistoryCommand
	| PpAttachCommand
	| PpDownloadCommand
	| PpComposeCommand
	| PpBriefCommand
	| PpSetModelCommand
	| PpNewCommand
	| PpRefreshCommand
	| PpPasteCommand
	| PpIsolateCommand;

export type PpModuleCommand = PpSubcommand;

const applyConnectionOptions = (command: Command): void => {
	command.option("--browser <chromium|firefox>");
	command.option("--chromium-launch-profile <low-detection|strict>");
	command.option("--cdp-url <url>");
	command.option("--chromium-bin <path>");
	command.option("--user-data-dir <path>");
	command.option("--profile <name>");
	command.option("--session <name>");
	command.option("--chat-url <url>");
	command.option("--project <g-p-id-or-url>");
	command.option("--headless");
	command.option("--no-navigate");
	command.option("--strict-tab-targeting");
	command.option("--composer-timeout-ms <int>");
};

const parseTimeoutOption = ({
	options,
	usage,
}: {
	options: Record<string, unknown>;
	usage: string;
}): number | undefined =>
	parseIntOption({
		options,
		key: "timeout",
		flag: "--timeout",
		usage,
	}) ??
	parseIntOption({
		options,
		key: "timeoutMs",
		flag: "--timeout-ms",
		usage,
	});

const parseCsvList = (value?: string): string[] => {
	if (value === undefined || value.trim() === "") {
		return [];
	}
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
};

const parseStringListOption = ({
	options,
	key,
}: {
	options: Record<string, unknown>;
	key: string;
}): string[] => {
	const value = options[key];
	if (typeof value === "string") {
		return parseCsvList(value);
	}
	if (!Array.isArray(value)) {
		return [];
	}
	const out: string[] = [];
	for (const entry of value) {
		if (typeof entry === "string") {
			out.push(...parseCsvList(entry));
		}
	}
	return out;
};

const parseEntries = ({
	options,
	positionals,
}: {
	options: Record<string, unknown>;
	positionals: readonly string[];
}): string[] => {
	const fromInline = parseCsvList(
		readStringOption({
			options,
			key: "entries",
		}),
	);
	const fromFile = (() => {
		const entriesFile = readStringOption({
			options,
			key: "entriesFile",
		});
		if (entriesFile === undefined || entriesFile === "") {
			return [] as string[];
		}
		return fs
			.readFileSync(path.resolve(entriesFile), "utf8")
			.split(/\r?\n/)
			.map((entry) => entry.trim())
			.filter((entry) => entry !== "");
	})();

	return [
		...positionals.map((entry) => entry.trim()).filter((entry) => entry !== ""),
		...fromInline,
		...fromFile,
	];
};

const parseModel = (value?: string): ModelMode | undefined => {
	if (value === undefined || value === "") {
		return undefined;
	}
	const normalized = value.toLowerCase();
	switch (normalized) {
		case "auto":
		case "instant":
		case "thinking":
		case "pro":
			return normalized;
		default:
			throw new Error(
				`Unknown mode: ${value}. Use auto, instant, thinking, or pro.`,
			);
	}
};

const parseNavigatorConnection = ({
	options,
	argv,
	usage,
}: {
	options: Record<string, unknown>;
	argv: readonly string[];
	usage: string;
}): NavigatorConnectionOptions => {
	const explicitUserDataDir = readStringOption({
		options,
		key: "userDataDir",
	});
	if (
		explicitUserDataDir !== undefined &&
		readStringOption({
			options,
			key: "profile",
		}) !== undefined
	) {
		throw new Error(`cannot combine --user-data-dir and --profile\n${usage}`);
	}

	const profileBinding =
		explicitUserDataDir === undefined
			? resolveNavigatorProfile({
					profile: readStringOption({
						options,
						key: "profile",
					}),
				})
			: null;
	const sessionBinding = resolveNavigatorSession({
		session: readStringOption({
			options,
			key: "session",
		}),
	});
	const projectBinding = resolveNavigatorProject({
		project: readStringOption({
			options,
			key: "project",
		}),
	});
	const browserBinding = resolveNavigatorBrowser({
		browser: readStringOption({
			options,
			key: "browser",
		}),
	});
	const chromiumLaunchProfileBinding = resolveNavigatorChromiumLaunchProfile({
		chromiumLaunchProfile: readStringOption({
			options,
			key: "chromiumLaunchProfile",
		}),
	});

	return {
		browser: browserBinding?.browser,
		chromiumLaunchProfile:
			chromiumLaunchProfileBinding?.chromiumLaunchProfile,
		chromiumBin: readStringOption({
			options,
			key: "chromiumBin",
		}),
		cdpUrl: readStringOption({
			options,
			key: "cdpUrl",
		}),
		userDataDir: explicitUserDataDir,
		profile: profileBinding?.profile,
		session: sessionBinding?.session,
		headless: readBooleanOption({
			options,
			key: "headless",
		}),
		chatUrl:
			readStringOption({
				options,
				key: "chatUrl",
			}) ?? "https://chatgpt.com",
		project: projectBinding?.raw,
		projectSource: projectBinding?.source,
		noNavigate: argv.includes("--no-navigate"),
		strictTabTargeting: readBooleanOption({
			options,
			key: "strictTabTargeting",
		}),
		composerTimeoutMs: parseIntOption({
			options,
			key: "composerTimeoutMs",
			flag: "--composer-timeout-ms",
			usage,
		}),
	};
};

const parsePpSendCommand = (
	subArgs: readonly string[],
	usage: string,
): PpSendCommand => {
	const { options, positionals } = parseWithCommander({
		argv: subArgs,
		binaryName: "pp send",
		usage,
		configure: (command) => {
			applyConnectionOptions(command);
			command.option("--message <text>");
			command.option("--file <path>");
			command.option("--message-file <path>");
			command.option("--model <mode>");
			command.option("--new");
			command.option("--force");
			command.option("--echo-message");
			command.option("--no-wait");
			command.option("--timeout <int>");
			command.option("--timeout-ms <int>");
			command.option("--poll-ms <int>");
			command.option("--json");
		},
	});
	if (positionals.length > 1) {
		throw new Error(`pp send accepts at most one positional message\n${usage}`);
	}
	if (
		readBooleanOption({
			options,
			key: "new",
		}) &&
		subArgs.includes("--no-navigate")
	) {
		throw new Error(
			`pp send cannot combine --new with --no-navigate\n${usage}`,
		);
	}
	return {
		kind: "pp-send",
		options: {
			...parseNavigatorConnection({ options, argv: subArgs, usage }),
			message:
				positionals[0] ??
				readStringOption({
					options,
					key: "message",
				}),
			messageFile:
				readStringOption({
					options,
					key: "file",
				}) ??
				readStringOption({
					options,
					key: "messageFile",
				}),
			model: parseModel(
				readStringOption({
					options,
					key: "model",
				}),
			),
			newChat: readBooleanOption({
				options,
				key: "new",
			}),
			force: readBooleanOption({
				options,
				key: "force",
			}),
			noWait: subArgs.includes("--no-wait"),
			timeoutMs: parseTimeoutOption({ options, usage }),
			pollMs: parseIntOption({
				options,
				key: "pollMs",
				flag: "--poll-ms",
				usage,
			}),
			echoMessage: readBooleanOption({
				options,
				key: "echoMessage",
			}),
		},
		json: readBooleanOption({
			options,
			key: "json",
		}),
	};
};

const parsePpWaitCommand = (
	subArgs: readonly string[],
	usage: string,
): PpWaitCommand => {
	const { options, positionals } = parseWithCommander({
		argv: subArgs,
		binaryName: "pp wait",
		usage,
		configure: (command) => {
			applyConnectionOptions(command);
			command.option("--timeout <int>");
			command.option("--timeout-ms <int>");
			command.option("--poll-ms <int>");
			command.option("--json");
		},
	});
	requireNoPositionals({
		positionals,
		context: "pp wait",
		usage,
	});
	return {
		kind: "pp-wait",
		options: {
			...parseNavigatorConnection({ options, argv: subArgs, usage }),
			timeoutMs: parseTimeoutOption({ options, usage }),
			pollMs: parseIntOption({
				options,
				key: "pollMs",
				flag: "--poll-ms",
				usage,
			}),
		},
		json: readBooleanOption({
			options,
			key: "json",
		}),
	};
};

const parsePpGetResponseCommand = (
	subArgs: readonly string[],
	usage: string,
): PpGetResponseCommand => {
	const { options, positionals } = parseWithCommander({
		argv: subArgs,
		binaryName: "pp get-response",
		usage,
		configure: (command) => {
			applyConnectionOptions(command);
			command.option("--json");
		},
	});
	requireNoPositionals({
		positionals,
		context: "pp get-response",
		usage,
	});
	return {
		kind: "pp-get-response",
		options: parseNavigatorConnection({ options, argv: subArgs, usage }),
		json: readBooleanOption({
			options,
			key: "json",
		}),
	};
};

const parsePpHistoryCommand = (
	subArgs: readonly string[],
	usage: string,
): PpHistoryCommand => {
	const { options, positionals } = parseWithCommander({
		argv: subArgs,
		binaryName: "pp history",
		usage,
		configure: (command) => {
			applyConnectionOptions(command);
			command.option("--last <int>");
			command.option("--json");
		},
	});
	requireNoPositionals({
		positionals,
		context: "pp history",
		usage,
	});
	const json = readBooleanOption({
		options,
		key: "json",
	});
	return {
		kind: "pp-history",
		options: {
			...parseNavigatorConnection({ options, argv: subArgs, usage }),
			last: parseIntOption({
				options,
				key: "last",
				flag: "--last",
				usage,
			}),
			json,
		},
	};
};

const parsePpAttachCommand = (
	subArgs: readonly string[],
	usage: string,
): PpAttachCommand => {
	const { options, positionals } = parseWithCommander({
		argv: subArgs,
		binaryName: "pp attach",
		usage,
		configure: (command) => {
			applyConnectionOptions(command);
			command.option("--text <text>");
			command.option("--text-file <path>");
			command.option("--name <name>");
			command.option("--text-name <name>");
			command.option("--prompt <text>");
			command.option("--send");
			command.option("--wait-for-response");
			command.option("--timeout <int>");
			command.option("--timeout-ms <int>");
			command.option("--poll-ms <int>");
			command.option("--json");
		},
	});
	return {
		kind: "pp-attach",
		options: {
			...parseNavigatorConnection({ options, argv: subArgs, usage }),
			files: positionals,
			text: readStringOption({
				options,
				key: "text",
			}),
			textFile: readStringOption({
				options,
				key: "textFile",
			}),
			textName:
				readStringOption({
					options,
					key: "name",
				}) ??
				readStringOption({
					options,
					key: "textName",
				}),
			prompt: readStringOption({
				options,
				key: "prompt",
			}),
			send: readBooleanOption({
				options,
				key: "send",
			}),
			waitForResponse: readBooleanOption({
				options,
				key: "waitForResponse",
			}),
			timeoutMs: parseTimeoutOption({ options, usage }),
			pollMs: parseIntOption({
				options,
				key: "pollMs",
				flag: "--poll-ms",
				usage,
			}),
		},
		json: readBooleanOption({
			options,
			key: "json",
		}),
	};
};

const parsePpComposeCommand = (
	subArgs: readonly string[],
	usage: string,
): PpComposeCommand => {
	const { options, positionals } = parseWithCommander({
		argv: subArgs,
		binaryName: "pp compose",
		usage,
		configure: (command) => {
			command.option("--preamble-file <path>");
			command.option("--entries <csv>");
			command.option("--entries-file <path>");
		},
	});
	return {
		kind: "pp-compose",
		options: {
			preambleFile: requireOption({
				options,
				key: "preambleFile",
				flag: "--preamble-file",
				usage,
			}),
			entries: parseEntries({ options, positionals }),
		},
	};
};

const parsePpBriefCommand = (
	subArgs: readonly string[],
	usage: string,
): PpBriefCommand => {
	const { options, positionals } = parseWithCommander({
		argv: subArgs,
		binaryName: "pp brief",
		usage,
			configure: (command) => {
				applyConnectionOptions(command);
				command.option("--preamble-file <path>");
				command.option("--entries <csv>");
				command.option("--entries-file <path>");
				command.option("--inline-entries");
				command.option("--archive-entries");
				command.option(
					"--attach <path>",
					"attachment file path (repeatable)",
					(value: string, previous: string[]) => [...previous, value],
					[],
				);
				command.option("--model <mode>");
			command.option("--new");
			command.option("--force");
			command.option("--no-wait");
			command.option("--echo-message");
			command.option("--timeout <int>");
			command.option("--timeout-ms <int>");
			command.option("--poll-ms <int>");
			command.option("--json");
		},
	});
	if (
		readBooleanOption({
			options,
			key: "new",
		}) &&
		subArgs.includes("--no-navigate")
	) {
		throw new Error(
			`pp brief cannot combine --new with --no-navigate\n${usage}`,
		);
	}
	if (
		readBooleanOption({
			options,
			key: "inlineEntries",
		}) &&
		readBooleanOption({
			options,
			key: "archiveEntries",
		})
	) {
		throw new Error(
			`pp brief cannot combine --inline-entries with --archive-entries\n${usage}`,
		);
	}
	return {
		kind: "pp-brief",
		options: {
			...parseNavigatorConnection({ options, argv: subArgs, usage }),
			preambleFile: requireOption({
				options,
				key: "preambleFile",
				flag: "--preamble-file",
				usage,
			}),
			entries: parseEntries({ options, positionals }),
			inlineEntries: readBooleanOption({
				options,
				key: "inlineEntries",
			}),
			attachFiles: parseStringListOption({
				options,
				key: "attach",
			}),
			model: parseModel(
				readStringOption({
					options,
					key: "model",
				}),
			),
			newChat: readBooleanOption({
				options,
				key: "new",
			}),
			force: readBooleanOption({
				options,
				key: "force",
			}),
			noWait: subArgs.includes("--no-wait"),
			timeoutMs: parseTimeoutOption({ options, usage }),
			pollMs: parseIntOption({
				options,
				key: "pollMs",
				flag: "--poll-ms",
				usage,
			}),
			echoMessage: readBooleanOption({
				options,
				key: "echoMessage",
			}),
		},
		json: readBooleanOption({
			options,
			key: "json",
		}),
	};
};

const parsePpDownloadCommand = (
	subArgs: readonly string[],
	usage: string,
): PpDownloadCommand => {
	const { options, positionals } = parseWithCommander({
		argv: subArgs,
		binaryName: "pp download",
		usage,
		configure: (command) => {
			applyConnectionOptions(command);
			command.option("--list");
			command.option("--index <int>");
			command.option("--output <path>");
			command.option("--json");
		},
	});
	requireNoPositionals({
		positionals,
		context: "pp download",
		usage,
	});
	return {
		kind: "pp-download",
		options: {
			...parseNavigatorConnection({ options, argv: subArgs, usage }),
			list: readBooleanOption({
				options,
				key: "list",
			}),
			index: parseIntOption({
				options,
				key: "index",
				flag: "--index",
				usage,
			}),
			output: readStringOption({
				options,
				key: "output",
			}),
		},
		json: readBooleanOption({
			options,
			key: "json",
		}),
	};
};

const parsePpSetModelCommand = (
	subArgs: readonly string[],
	usage: string,
): PpSetModelCommand => {
	const { options, positionals } = parseWithCommander({
		argv: subArgs,
		binaryName: "pp set-model",
		usage,
		configure: (command) => {
			applyConnectionOptions(command);
			command.option("--mode <mode>");
			command.option("--json");
		},
	});
	if (positionals.length > 1) {
		throw new Error(`pp set-model accepts one positional mode\n${usage}`);
	}
	const mode = parseModel(
		positionals[0] ??
			readStringOption({
				options,
				key: "mode",
			}),
	);
	if (mode === undefined) {
		throw new Error(`missing required mode for pp set-model\n${usage}`);
	}
	return {
		kind: "pp-set-model",
		options: {
			...parseNavigatorConnection({ options, argv: subArgs, usage }),
			mode,
		},
		json: readBooleanOption({
			options,
			key: "json",
		}),
	};
};

const parsePpNewCommand = (
	subArgs: readonly string[],
	usage: string,
): PpNewCommand => {
	const { options, positionals } = parseWithCommander({
		argv: subArgs,
		binaryName: "pp new",
		usage,
		configure: (command) => {
			applyConnectionOptions(command);
			command.option("--model <mode>");
			command.option("--json");
		},
	});
	requireNoPositionals({
		positionals,
		context: "pp new",
		usage,
	});
	return {
		kind: "pp-new",
		options: {
			...parseNavigatorConnection({ options, argv: subArgs, usage }),
			model: parseModel(
				readStringOption({
					options,
					key: "model",
				}),
			),
		},
		json: readBooleanOption({
			options,
			key: "json",
		}),
	};
};

const parsePpRefreshCommand = (
	subArgs: readonly string[],
	usage: string,
): PpRefreshCommand => {
	const { options, positionals } = parseWithCommander({
		argv: subArgs,
		binaryName: "pp refresh",
		usage,
		configure: (command) => {
			applyConnectionOptions(command);
			command.option("--json");
		},
	});
	requireNoPositionals({
		positionals,
		context: "pp refresh",
		usage,
	});
	return {
		kind: "pp-refresh",
		options: parseNavigatorConnection({ options, argv: subArgs, usage }),
		json: readBooleanOption({
			options,
			key: "json",
		}),
	};
};

const parsePpPasteCommand = (
	subArgs: readonly string[],
	usage: string,
): PpPasteCommand => {
	const { options, positionals } = parseWithCommander({
		argv: subArgs,
		binaryName: "pp paste",
		usage,
		configure: (command) => {
			applyConnectionOptions(command);
			command.option("--text <text>");
			command.option("--send");
			command.option("--clear");
			command.option("--json");
		},
	});
	requireNoPositionals({
		positionals,
		context: "pp paste",
		usage,
	});
	return {
		kind: "pp-paste",
		options: {
			...parseNavigatorConnection({ options, argv: subArgs, usage }),
			text: readStringOption({
				options,
				key: "text",
			}),
			clear: readBooleanOption({
				options,
				key: "clear",
			}),
			send: readBooleanOption({
				options,
				key: "send",
			}),
		},
		json: readBooleanOption({
			options,
			key: "json",
		}),
	};
};

const parsePpIsolateCommand = (
	subArgs: readonly string[],
	usage: string,
): PpIsolateCommand => {
	const { options, positionals } = parseWithCommander({
		argv: subArgs,
		binaryName: "pp isolate",
		usage,
		configure: (command) => {
			applyConnectionOptions(command);
			command.option("--json");
		},
	});
	requireNoPositionals({
		positionals,
		context: "pp isolate",
		usage,
	});
	return {
		kind: "pp-isolate",
		options: parseNavigatorConnection({ options, argv: subArgs, usage }),
		json: readBooleanOption({
			options,
			key: "json",
		}),
	};
};

const parsePpSubcommand = (
	argv: readonly string[],
	usage: string,
): PpSubcommand => {
	if (argv.length === 0) {
		throw new Error(`pp requires a subcommand\n${usage}`);
	}
	const subcommand = argv[0];
	const subArgs = argv.slice(1);

	switch (subcommand) {
		case "send":
			return parsePpSendCommand(subArgs, usage);
		case "wait":
			return parsePpWaitCommand(subArgs, usage);
		case "get-response":
			return parsePpGetResponseCommand(subArgs, usage);
		case "history":
			return parsePpHistoryCommand(subArgs, usage);
		case "attach":
			return parsePpAttachCommand(subArgs, usage);
		case "compose":
			return parsePpComposeCommand(subArgs, usage);
		case "brief":
			return parsePpBriefCommand(subArgs, usage);
		case "download":
			return parsePpDownloadCommand(subArgs, usage);
		case "set-model":
			return parsePpSetModelCommand(subArgs, usage);
		case "new":
			return parsePpNewCommand(subArgs, usage);
		case "refresh":
			return parsePpRefreshCommand(subArgs, usage);
		case "paste":
			return parsePpPasteCommand(subArgs, usage);
		case "isolate":
			return parsePpIsolateCommand(subArgs, usage);
		default:
			throw new Error(`unknown pp subcommand '${subcommand}'\n${usage}`);
	}
};

export const parsePpModuleCommand = (
	argv: readonly string[],
	usage: string,
): PpModuleCommand | undefined => {
	const commandName = argv[0];
	if (commandName !== undefined && commandName !== "") {
		try {
			return parsePpSubcommand(argv, usage);
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.startsWith("unknown pp subcommand")
			) {
				return undefined;
			}
			throw error;
		}
	}
	return undefined;
};

const printJson = (value: unknown): void => {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const printText = (text: string): void => {
	process.stdout.write(`${text}\n`);
};

const printNavigatorWarning = (warning: string): void => {
	process.stderr.write(`${warning}\n`);
};

const formatNavigatorDownloadList = (
	links: readonly NavigatorDownloadListItem[],
): string =>
	links
		.map((link) => {
			const label = link.label === "" ? "" : ` | ${link.label}`;
			return `[${link.index}] ${link.file} | ${link.path}${label}`;
		})
		.join("\n");

const runPpSubcommand = async (command: PpSubcommand): Promise<number> => {
	switch (command.kind) {
		case "pp-send": {
			const result = await runPpSend({
				...command.options,
				onWarning: printNavigatorWarning,
			});
			if (command.json) {
				printJson(result);
			} else if (result.response !== undefined) {
				printText(result.response.text);
			} else {
				printJson(result);
			}
			return 0;
		}

		case "pp-wait": {
			const result = await runPpWait(command.options);
			if (command.json) {
				printJson(result);
			} else {
				printText(result.text);
			}
			return 0;
		}

		case "pp-get-response": {
			const result = await runPpGetResponse({
				...command.options,
				onWarning: printNavigatorWarning,
			});
			if (command.json) {
				printJson(result);
			} else {
				printText(result.text);
			}
			return 0;
		}

		case "pp-history": {
			const result = await runPpHistory({
				...command.options,
				onWarning: printNavigatorWarning,
			});
			if (typeof result === "string") {
				printText(result);
			} else {
				printJson(result);
			}
			return 0;
		}

		case "pp-attach": {
			const result = await runPpAttach({
				...command.options,
				onWarning: printNavigatorWarning,
			});
			if (command.json) {
				printJson(result);
			} else if (result.response !== undefined) {
				printText(result.response.text);
			} else {
				printJson(result);
			}
			return 0;
		}

		case "pp-download": {
			const result = await runPpDownload(command.options);
			if (command.json) {
				printJson(result);
				return 0;
			}
			if (result.mode === "list") {
				printText(formatNavigatorDownloadList(result.links));
				return 0;
			}
			if (result.mode === "content") {
				printText(result.text);
				return 0;
			}
			printJson(result);
			return 0;
		}

		case "pp-compose": {
			const message = runPpCompose({
				...command.options,
				onWarning: (warning) => {
					process.stderr.write(`${warning}\n`);
				},
			});
			printText(message);
			return 0;
		}

		case "pp-brief": {
			const result = await runPpBrief({
				...command.options,
				onWarning: printNavigatorWarning,
			});
			if (command.json) {
				printJson(result);
			} else if (result.response !== undefined) {
				printText(result.response.text);
			} else {
				printJson(result);
			}
			return 0;
		}

		case "pp-set-model": {
			const result = await runPpSetModel(command.options);
			printJson(result);
			return 0;
		}

		case "pp-new": {
			const result = await runPpNew(command.options);
			printJson(result);
			return 0;
		}

		case "pp-refresh": {
			const result = await runPpRefresh(command.options);
			printJson(result);
			return 0;
		}

		case "pp-paste": {
			const result = await runPpPaste({
				...command.options,
				onWarning: printNavigatorWarning,
			});
			printJson(result);
			return 0;
		}

		case "pp-isolate": {
			const result = await runPpIsolate(command.options);
			printJson(result);
			return 0;
		}
	}
};

export const runPpModuleCommand = async (
	command: PpModuleCommand,
): Promise<number> => runPpSubcommand(command);

export const parsePpCommand = parsePpModuleCommand;
