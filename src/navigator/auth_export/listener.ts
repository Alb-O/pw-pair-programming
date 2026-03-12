import crypto from "node:crypto";
import fs from "node:fs";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { resolvePpSessionAuthDir } from "../runtime/pp_state_paths";
import {
	parseExtensionMessage,
	type DomainCookies,
	type ServerMessage,
} from "./protocol";
import { saveDomainCookies } from "./storage_state";

/**
 * Local websocket listener for auth-exporter extension sessions.
 * Authenticates clients with a one-time token and writes per-domain storage-state files.
 */
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9271;

export type CreateAuthListenerOptions = {
	host?: string;
	port?: number;
	token?: string;
	authDir?: string;
	session?: string;
	version?: string;
	logger?: (line: string) => void;
};

export type AuthListener = {
	url: string;
	token: string;
	authDir: string;
	close: () => Promise<void>;
	closed: Promise<void>;
};

export type RunAuthListenerOptions = {
	host?: string;
	port?: number;
	token?: string;
	authDir?: string;
	session?: string;
	version?: string;
};

const defaultAuthDir = (session?: string): string =>
	resolvePpSessionAuthDir({ session });

export const generateAuthToken = (): string =>
	crypto.randomBytes(16).toString("hex");

const sendMessage = (socket: WebSocket, message: ServerMessage): void => {
	socket.send(JSON.stringify(message));
};

const normalizeDomainCookies = (
	domains: readonly DomainCookies[],
): DomainCookies[] =>
	domains
		.map((domain) => ({
			domain: domain.domain,
			cookies: domain.cookies,
		}))
		.filter((domain) => domain.cookies.length > 0);

export const createAuthListener = async ({
	host = DEFAULT_HOST,
	port = DEFAULT_PORT,
	token = generateAuthToken(),
	authDir,
	session,
	version = "0.1.0",
	logger,
}: CreateAuthListenerOptions = {}): Promise<AuthListener> => {
	authDir = authDir ?? defaultAuthDir(session);
	fs.mkdirSync(authDir, { recursive: true });

	const server = new WebSocketServer({
		host,
		port,
	});

	const closed = new Promise<void>((resolve) => {
		server.once("close", () => {
			resolve();
		});
	});

	const ready = new Promise<void>((resolve, reject) => {
		server.once("listening", () => {
			resolve();
		});
		server.once("error", (error: Error) => {
			reject(error);
		});
	});

	server.on("connection", (socket: WebSocket) => {
		let authenticated = false;
		logger?.("Extension connected");

		socket.on("message", (raw: RawData) => {
			let parsed: ReturnType<typeof parseExtensionMessage>;

			try {
				const data = JSON.parse(String(raw));
				parsed = parseExtensionMessage(data);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				sendMessage(socket, {
					type: "error",
					message: `Invalid message format: ${message}`,
				});
				return;
			}

			if (parsed.type === "hello") {
				if (parsed.token === token) {
					authenticated = true;
					logger?.("Authentication successful");
					sendMessage(socket, {
						type: "welcome",
						version,
					});
				} else {
					logger?.("Authentication failed: invalid token");
					sendMessage(socket, {
						type: "rejected",
						reason: "Invalid token",
					});
				}
				return;
			}

			if (!authenticated) {
				sendMessage(socket, {
					type: "error",
					message: "Not authenticated",
				});
				return;
			}

			const domains = normalizeDomainCookies(parsed.domains);
			if (domains.length === 0) {
				sendMessage(socket, {
					type: "error",
					message: "No cookies found for any domain",
				});
				return;
			}

			const { paths, errors } = saveDomainCookies(domains, authDir);
			if (errors.length > 0) {
				sendMessage(socket, {
					type: "error",
					message: `Some domains failed: ${errors.join(", ")}`,
				});
				return;
			}

			logger?.(
				`Saved cookies for ${paths.length} domain(s): ${paths.join(", ")}`,
			);
			sendMessage(socket, {
				type: "received",
				domains_saved: paths.length,
				paths,
			});
		});

		socket.on("close", () => {
			logger?.("Extension disconnected");
		});
	});

	await ready;

	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("auth listener failed to resolve bound address");
	}

	const url = `ws://${host}:${address.port}/`;

	return {
		url,
		token,
		authDir,
		close: async () => {
			await new Promise<void>((resolve, reject) => {
				server.close((error?: Error) => {
					if (error !== undefined) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		},
		closed,
	};
};

export const runAuthListener = async ({
	host = DEFAULT_HOST,
	port = DEFAULT_PORT,
	token,
	authDir,
	session,
	version = "0.1.0",
}: RunAuthListenerOptions = {}): Promise<void> => {
	const listener = await createAuthListener({
		host,
		port,
		token,
		authDir,
		session,
		version,
		logger: (line) => {
			process.stdout.write(`${line}\n`);
		},
	});

	process.stdout.write(`Listening for browser extension on ${listener.url}\n`);
	process.stdout.write("\n");
	process.stdout.write(`Token: ${listener.token}\n`);
	process.stdout.write("\n");
	process.stdout.write(`Cookies will be saved to: ${listener.authDir}\n`);
	process.stdout.write("\n");
	process.stdout.write("Press Ctrl+C to stop.\n");

	const stop = async (): Promise<void> => {
		process.off("SIGINT", onSigInt);
		process.off("SIGTERM", onSigTerm);
		await listener.close();
	};

	const onSigInt = () => {
		void stop();
	};
	const onSigTerm = () => {
		void stop();
	};

	process.on("SIGINT", onSigInt);
	process.on("SIGTERM", onSigTerm);

	await listener.closed;
};
