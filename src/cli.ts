import {
	parseAutomationCommand,
	runAutomationCommand,
	type AutomationCommand,
} from "./modules/automation/module";
import {
	CONNECTION_USAGE_LINES,
	PP_COMMAND_USAGE_LINES,
	PP_USAGE,
	parsePpCommand,
	runPpModuleCommand,
	type PpModuleCommand,
} from "./modules/pp/module";

type Command = AutomationCommand | PpModuleCommand;

const USAGE = PP_USAGE;

const parseArgs = (argv: readonly string[]): Command => {
	if (argv.length === 0) {
		throw new Error(USAGE);
	}
	const automationCommand = parseAutomationCommand(argv, USAGE);
	if (automationCommand !== undefined) {
		return automationCommand;
	}
	const ppCommand = parsePpCommand(argv, USAGE);
	if (ppCommand !== undefined) {
		return ppCommand;
	}
	const commandName = argv[0];
	throw new Error(`unknown command '${commandName}'\n${USAGE}`);
};

const isAutomationCommand = (
	command: Command,
): command is AutomationCommand => {
	switch (command.kind) {
		case "build-core":
		case "run-e2e":
		case "build-and-e2e":
		case "run-demos":
			return true;
		default:
			return false;
	}
};

const runCli = async (argv: readonly string[]): Promise<number> => {
	const command = parseArgs(argv);
	if (isAutomationCommand(command)) {
		return runAutomationCommand(command);
	}
	return runPpModuleCommand(command);
};

if (require.main === module) {
	runCli(process.argv.slice(2))
		.then((code) => {
			process.exit(code);
		})
		.catch((error) => {
			if (error instanceof Error) {
				process.stderr.write(`${error.message}\n`);
				process.exit(1);
			}
			throw error;
		});
}

export { PP_USAGE, USAGE, parseArgs, runCli };
