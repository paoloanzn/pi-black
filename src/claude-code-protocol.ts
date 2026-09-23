import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	Context,
	FetchFunction,
	Message,
	ProviderHeaders,
	StreamOptions,
} from "@earendil-works/pi-ai";

export const CLAUDE_CODE_VERSION = "2.1.280";
export const CLAUDE_CODE_ENTRYPOINT = "sdk-cli";

// Claude Code 2.1.280 computes the real cch checksum in native code outside its
// JavaScript bundle, so it cannot be reproduced here. The Anthropic API accepts
// the well-formed zero value (verified against api.anthropic.com on 2026-09-23:
// cch=00000 with cc_version=2.1.280 returns 200), so Pi Black emits it directly
// and no longer rewrites the serialized request body.
const CCH_VALUE = "00000";
const AGENT_SDK_SYSTEM_PROMPT =
	"You are a Claude agent, built on Anthropic's Claude Agent SDK.";
const LEGACY_PI_OAUTH_SYSTEM_PROMPT =
	"You are Claude Code, Anthropic's official CLI for Claude.";

export interface ClaudeCodeIdentity {
	deviceId: string;
	accountUuid: string;
}

interface JsonObject {
	[key: string]: unknown;
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstUserPrompt(messages: Message[]): string {
	for (const message of messages) {
		if (message.role !== "user") continue;
		if (typeof message.content === "string") return message.content;
		return message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("");
	}
	return "";
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

export async function claudeCodeVersionFingerprint(
	messages: Message[],
): Promise<string> {
	const prompt = firstUserPrompt(messages);
	const selected = [4, 7, 20].map((index) => prompt[index] || "0").join("");
	const input = new TextEncoder().encode(
		`59cf53e54c78${selected}${CLAUDE_CODE_VERSION}`,
	);
	const digest = await crypto.subtle.digest("SHA-256", input);
	return bytesToHex(new Uint8Array(digest)).slice(0, 3);
}

export async function buildClaudeCodeBillingHeader(
	messages: Message[],
): Promise<string> {
	const fingerprint = await claudeCodeVersionFingerprint(messages);
	return `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}.${fingerprint}; cc_entrypoint=${CLAUDE_CODE_ENTRYPOINT}; cch=${CCH_VALUE};`;
}

export function parseClaudeCodeIdentity(
	value: unknown,
): ClaudeCodeIdentity | undefined {
	if (
		!isObject(value) ||
		typeof value.userID !== "string" ||
		!isObject(value.oauthAccount)
	)
		return undefined;
	const accountUuid = value.oauthAccount.accountUuid;
	if (!/^[0-9a-f]{64}$/u.test(value.userID) || typeof accountUuid !== "string")
		return undefined;
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
			accountUuid,
		)
	) {
		return undefined;
	}
	return { deviceId: value.userID, accountUuid };
}

export async function discoverClaudeCodeIdentity(
	env: NodeJS.ProcessEnv = process.env,
	configPath?: string,
): Promise<ClaudeCodeIdentity | undefined> {
	const deviceId = env.CLAUDE_CODE_DEVICE_ID;
	const accountUuid = env.CLAUDE_CODE_ACCOUNT_UUID;
	if (deviceId && accountUuid) {
		const fromEnvironment = parseClaudeCodeIdentity({
			userID: deviceId,
			oauthAccount: { accountUuid },
		});
		if (fromEnvironment) return fromEnvironment;
	}

	const path =
		configPath ?? join(env.CLAUDE_CONFIG_DIR || homedir(), ".claude.json");
	try {
		return parseClaudeCodeIdentity(JSON.parse(await readFile(path, "utf8")));
	} catch {
		return undefined;
	}
}

export async function transformClaudeCodePayload(
	payload: unknown,
	context: Context,
	sessionId: string | undefined,
	identity: ClaudeCodeIdentity | undefined,
): Promise<JsonObject> {
	if (!isObject(payload))
		throw new Error("Pi Black expected an Anthropic JSON request object");
	const existingSystem = Array.isArray(payload.system) ? payload.system : [];
	const firstSystemText = isObject(existingSystem[0])
		? existingSystem[0].text
		: undefined;
	const secondSystemText = isObject(existingSystem[1])
		? existingSystem[1].text
		: undefined;
	const remainingSystem =
		typeof firstSystemText === "string" &&
		firstSystemText.startsWith("x-anthropic-billing-header: ") &&
		secondSystemText === AGENT_SDK_SYSTEM_PROMPT
			? existingSystem.slice(2)
			: firstSystemText === LEGACY_PI_OAUTH_SYSTEM_PROMPT
				? existingSystem.slice(1)
				: existingSystem;
	const billingHeader = await buildClaudeCodeBillingHeader(context.messages);
	const transformed: JsonObject = {
		...payload,
		system: [
			{ type: "text", text: billingHeader },
			{ type: "text", text: AGENT_SDK_SYSTEM_PROMPT },
			...remainingSystem,
		],
	};
	if (identity && sessionId) {
		transformed.metadata = {
			user_id: JSON.stringify({
				device_id: identity.deviceId,
				account_uuid: identity.accountUuid,
				session_id: sessionId,
			}),
		};
	}
	return transformed;
}

function requestHeaders(
	input: Parameters<FetchFunction>[0],
	init?: RequestInit,
): Headers {
	const headers = new Headers(
		input instanceof Request ? input.headers : undefined,
	);
	if (init?.headers) {
		for (const [name, value] of new Headers(init.headers))
			headers.set(name, value);
	}
	return headers;
}

export function createClaudeCodeFetch(
	fetchImplementation: FetchFunction,
): FetchFunction {
	return async (input, init) => {
		const headers = requestHeaders(input, init);
		if (!headers.has("x-client-request-id"))
			headers.set("x-client-request-id", crypto.randomUUID());
		return fetchImplementation(input, { ...init, headers });
	};
}

export function claudeCodeHeaders(
	sessionId: string | undefined,
): ProviderHeaders {
	return {
		"user-agent": `claude-cli/${CLAUDE_CODE_VERSION} (external, ${CLAUDE_CODE_ENTRYPOINT})`,
		"x-app": "cli",
		...(sessionId ? { "x-claude-code-session-id": sessionId } : {}),
	};
}

export function isAnthropicOAuthToken(apiKey: string | undefined): boolean {
	return apiKey?.includes("sk-ant-oat") === true;
}

export function mergeClaudeCodeOptions<T extends StreamOptions>(
	options: T,
	context: Context,
	identity:
		| ClaudeCodeIdentity
		| undefined
		| Promise<ClaudeCodeIdentity | undefined>,
): T {
	const originalOnPayload = options.onPayload;
	const transport = options.fetch ?? globalThis.fetch;
	return {
		...options,
		headers: { ...options.headers, ...claudeCodeHeaders(options.sessionId) },
		fetch: createClaudeCodeFetch(transport),
		onPayload: async (payload, model) => {
			const prior = await originalOnPayload?.(payload, model);
			return transformClaudeCodePayload(
				prior ?? payload,
				context,
				options.sessionId,
				await identity,
			);
		},
	};
}
