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

export const SUPPORTED_PI_VERSION = "0.84.2";
export const CLAUDE_CODE_VERSION = "2.1.224";
export const CLAUDE_CODE_ENTRYPOINT = "sdk-cli";

const CCH_PLACEHOLDER = "cch=00000";
const CCH_SEED = 0x4d659218e32a3268n;
const MASK_64 = 0xffffffffffffffffn;
const PRIME64_1 = 0x9e3779b185ebca87n;
const PRIME64_2 = 0xc2b2ae3d27d4eb4fn;
const PRIME64_3 = 0x165667b19e3779f9n;
const PRIME64_4 = 0x85ebca77c2b2ae63n;
const PRIME64_5 = 0x27d4eb2f165667c5n;
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

function rotateLeft(value: bigint, bits: bigint): bigint {
	const normalized = value & MASK_64;
	return ((normalized << bits) | (normalized >> (64n - bits))) & MASK_64;
}

function readUint32LE(bytes: Uint8Array, offset: number): bigint {
	return BigInt(
		(bytes[offset] |
			(bytes[offset + 1] << 8) |
			(bytes[offset + 2] << 16) |
			(bytes[offset + 3] << 24)) >>>
			0,
	);
}

function readUint64LE(bytes: Uint8Array, offset: number): bigint {
	return readUint32LE(bytes, offset) | (readUint32LE(bytes, offset + 4) << 32n);
}

function round(accumulator: bigint, input: bigint): bigint {
	const mixed = (accumulator + input * PRIME64_2) & MASK_64;
	return (rotateLeft(mixed, 31n) * PRIME64_1) & MASK_64;
}

function mergeRound(accumulator: bigint, value: bigint): bigint {
	return ((accumulator ^ round(0n, value)) * PRIME64_1 + PRIME64_4) & MASK_64;
}

export function xxHash64(bytes: Uint8Array, seed = 0n): bigint {
	let offset = 0;
	let hash: bigint;

	if (bytes.length >= 32) {
		let v1 = (seed + PRIME64_1 + PRIME64_2) & MASK_64;
		let v2 = (seed + PRIME64_2) & MASK_64;
		let v3 = seed & MASK_64;
		let v4 = (seed - PRIME64_1) & MASK_64;
		while (offset <= bytes.length - 32) {
			v1 = round(v1, readUint64LE(bytes, offset));
			v2 = round(v2, readUint64LE(bytes, offset + 8));
			v3 = round(v3, readUint64LE(bytes, offset + 16));
			v4 = round(v4, readUint64LE(bytes, offset + 24));
			offset += 32;
		}
		hash =
			(rotateLeft(v1, 1n) +
				rotateLeft(v2, 7n) +
				rotateLeft(v3, 12n) +
				rotateLeft(v4, 18n)) &
			MASK_64;
		hash = mergeRound(hash, v1);
		hash = mergeRound(hash, v2);
		hash = mergeRound(hash, v3);
		hash = mergeRound(hash, v4);
	} else {
		hash = (seed + PRIME64_5) & MASK_64;
	}

	hash = (hash + BigInt(bytes.length)) & MASK_64;
	while (offset <= bytes.length - 8) {
		const lane = round(0n, readUint64LE(bytes, offset));
		hash = (rotateLeft(hash ^ lane, 27n) * PRIME64_1 + PRIME64_4) & MASK_64;
		offset += 8;
	}
	if (offset <= bytes.length - 4) {
		hash ^= readUint32LE(bytes, offset) * PRIME64_1;
		hash = (rotateLeft(hash, 23n) * PRIME64_2 + PRIME64_3) & MASK_64;
		offset += 4;
	}
	while (offset < bytes.length) {
		hash ^= BigInt(bytes[offset]) * PRIME64_5;
		hash = (rotateLeft(hash, 11n) * PRIME64_1) & MASK_64;
		offset++;
	}

	hash ^= hash >> 33n;
	hash = (hash * PRIME64_2) & MASK_64;
	hash ^= hash >> 29n;
	hash = (hash * PRIME64_3) & MASK_64;
	hash ^= hash >> 32n;
	return hash & MASK_64;
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
	return `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}.${fingerprint}; cc_entrypoint=${CLAUDE_CODE_ENTRYPOINT}; ${CCH_PLACEHOLDER};`;
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

export function patchClaudeCodeCch(serializedBody: string): string {
	let body: JsonObject;
	try {
		const parsed = JSON.parse(serializedBody);
		if (!isObject(parsed)) throw new Error("not an object");
		body = parsed;
	} catch {
		throw new Error(
			"Pi Black expected the Anthropic SDK to serialize a JSON object",
		);
	}
	if (
		!Array.isArray(body.system) ||
		!isObject(body.system[0]) ||
		typeof body.system[0].text !== "string"
	) {
		throw new Error(
			"Pi Black OAuth request is missing the billing system block",
		);
	}
	const billingText = body.system[0].text;
	if (!billingText.startsWith("x-anthropic-billing-header: ")) {
		throw new Error("Pi Black OAuth request has an invalid billing block");
	}
	if (!billingText.includes(CCH_PLACEHOLDER)) {
		if (/; cch=[0-9a-f]{5};$/u.test(billingText)) return serializedBody;
		throw new Error("Pi Black OAuth request has an invalid cch billing value");
	}
	if (typeof body.model !== "string" || !("max_tokens" in body)) {
		throw new Error("Pi Black OAuth request is missing model or max_tokens");
	}

	const normalized = structuredClone(body);
	normalized.model = "";
	delete normalized.max_tokens;
	const hashInput = JSON.stringify(normalized);
	const hash = xxHash64(new TextEncoder().encode(hashInput), CCH_SEED);
	const cch = (hash & 0xfffffn).toString(16).padStart(5, "0");
	body.system[0].text = billingText.replace(CCH_PLACEHOLDER, `cch=${cch}`);
	return JSON.stringify(body);
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

		if (typeof init?.body === "string") {
			return fetchImplementation(input, {
				...init,
				headers,
				body: patchClaudeCodeCch(init.body),
			});
		}
		if (input instanceof Request) {
			const body = await input.clone().text();
			const request = new Request(input, {
				headers,
				body: patchClaudeCodeCch(body),
			});
			return fetchImplementation(request);
		}
		throw new Error(
			"Pi Black OAuth request body is not available for cch patching",
		);
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
