import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context, Message } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildClaudeCodeBillingHeader,
	CLAUDE_CODE_VERSION,
	claudeCodeVersionFingerprint,
	createClaudeCodeFetch,
	discoverClaudeCodeIdentity,
	parseClaudeCodeIdentity,
	patchClaudeCodeCch,
	transformClaudeCodePayload,
	xxHash64,
} from "../src/claude-code-protocol.ts";

const encoder = new TextEncoder();
const temporaryDirectories: string[] = [];
const promptMessages = (prompt: string): Message[] => [
	{ role: "user", content: prompt, timestamp: 1 },
];
const context = (prompt: string): Context => ({
	messages: promptMessages(prompt),
});
const deviceId = "f".repeat(64);
const accountUuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("Claude Code protocol", () => {
	it("implements standard XXH64 vectors", () => {
		expect(xxHash64(encoder.encode("")).toString(16)).toBe("ef46db3751d8e999");
		expect(xxHash64(encoder.encode("hello")).toString(16)).toBe(
			"26c7827d889f6da3",
		);
	});

	it("reproduces the recovered cc_version prompt fingerprint", async () => {
		expect(
			await claudeCodeVersionFingerprint(
				promptMessages("Reply with exactly: PROBE_OK"),
			),
		).toBe("01c");
		expect(
			await buildClaudeCodeBillingHeader(
				promptMessages("Reply with exactly: PROBE_OK"),
			),
		).toBe(
			`x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}.01c; cc_entrypoint=sdk-cli; cch=00000;`,
		);
	});

	it("discovers and validates identity from Claude Code state without exposing it", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-black-"));
		temporaryDirectories.push(root);
		const path = join(root, ".claude.json");
		await writeFile(
			path,
			JSON.stringify({ userID: deviceId, oauthAccount: { accountUuid } }),
		);

		expect(await discoverClaudeCodeIdentity({}, path)).toEqual({
			deviceId,
			accountUuid,
		});
		expect(
			parseClaudeCodeIdentity({ userID: "bad", oauthAccount: { accountUuid } }),
		).toBeUndefined();
	});

	it("builds billing and Agent SDK blocks first and adds discovered identity", async () => {
		const payload = await transformClaudeCodePayload(
			{
				model: "claude-opus-5",
				messages: [],
				max_tokens: 64000,
				stream: true,
				system: [
					{
						type: "text",
						text: "You are Claude Code, Anthropic's official CLI for Claude.",
					},
					{
						type: "text",
						text: "Pi system",
						cache_control: { type: "ephemeral" },
					},
				],
			},
			context("Reply with exactly: PROBE_OK"),
			"11111111-2222-4333-8444-555555555555",
			{ deviceId, accountUuid },
		);
		const system = payload.system as Array<Record<string, unknown>>;
		expect(system[0]).toEqual({
			type: "text",
			text: `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}.01c; cc_entrypoint=sdk-cli; cch=00000;`,
		});
		expect(system[1]).toEqual({
			type: "text",
			text: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
		});
		expect(system[2]).toEqual({
			type: "text",
			text: "Pi system",
			cache_control: { type: "ephemeral" },
		});
		expect(payload.metadata).toEqual({
			user_id: JSON.stringify({
				device_id: deviceId,
				account_uuid: accountUuid,
				session_id: "11111111-2222-4333-8444-555555555555",
			}),
		});
	});

	it("does not duplicate blocks when the retained source patch is also present", async () => {
		const first = await transformClaudeCodePayload(
			{
				model: "claude-opus-5",
				messages: [],
				max_tokens: 1,
				stream: true,
				system: [{ type: "text", text: "Pi system" }],
			},
			context("hello"),
			undefined,
			undefined,
		);
		const second = await transformClaudeCodePayload(
			first,
			context("hello"),
			undefined,
			undefined,
		);
		expect(second.system).toEqual(first.system);
	});

	it("omits identity metadata when Claude Code state is unavailable", async () => {
		const payload = await transformClaudeCodePayload(
			{ model: "claude-opus-5", messages: [], max_tokens: 1, stream: true },
			context("hello"),
			"11111111-2222-4333-8444-555555555555",
			undefined,
		);
		expect(payload).not.toHaveProperty("metadata");
	});

	it("reproduces the recovered normalized-body checksum", () => {
		const body =
			'{"model":"claude-opus-5","messages":[{"role":"user","content":"A"}],"max_tokens":64000,"stream":true,"system":[{"type":"text","text":"x-anthropic-billing-header: cc_version=2.1.224.000; cc_entrypoint=sdk-cli; cch=00000;"}]}';
		expect(patchClaudeCodeCch(body)).toContain("cch=7ba34");
	});

	it("patches only the first billing block despite placeholder and nested-field collisions", () => {
		const body = {
			model: "claude-opus-5",
			messages: [
				{
					role: "user",
					content: "cch=00000",
					model: "nested-model",
					max_tokens: 7,
				},
			],
			max_tokens: 64000,
			stream: true,
			system: [
				{
					type: "text",
					text: "x-anthropic-billing-header: cc_version=2.1.224.000; cc_entrypoint=sdk-cli; cch=00000;",
				},
				{ type: "text", text: "fake cch=00000" },
			],
			tools: [
				{
					name: "probe",
					description: "model max_tokens cch=00000",
					input_schema: { type: "object" },
				},
			],
		};
		const patched = JSON.parse(
			patchClaudeCodeCch(JSON.stringify(body)),
		) as typeof body;
		expect(patched.system[0].text).toMatch(/cch=[0-9a-f]{5};$/u);
		expect(patched.system[0].text).not.toContain("cch=00000");
		expect(patched.messages[0]).toEqual(body.messages[0]);
		expect(patched.system[1]).toEqual(body.system[1]);
		expect(patched.tools).toEqual(body.tools);
	});

	it("leaves an already patched billing value unchanged", () => {
		const body = JSON.stringify({
			model: "claude-opus-5",
			messages: [],
			max_tokens: 1,
			stream: true,
			system: [
				{
					type: "text",
					text: "x-anthropic-billing-header: cc_version=2.1.224.000; cc_entrypoint=sdk-cli; cch=abc12;",
				},
			],
		});
		expect(patchClaudeCodeCch(body)).toBe(body);
	});

	it("patches the final SDK body and generates a request UUID", async () => {
		const body = JSON.stringify({
			model: "claude-opus-5",
			messages: [],
			max_tokens: 1,
			stream: true,
			system: [
				{
					type: "text",
					text: "x-anthropic-billing-header: cc_version=2.1.224.000; cc_entrypoint=sdk-cli; cch=00000;",
				},
			],
		});
		const transport = vi.fn<typeof fetch>(
			async () => new Response(null, { status: 200 }),
		);
		await createClaudeCodeFetch(transport)(
			"https://api.anthropic.com/v1/messages",
			{
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body,
			},
		);

		const [, init] = transport.mock.calls[0];
		expect(String(init?.body)).toMatch(/cch=[0-9a-f]{5}/u);
		const headers = new Headers(init?.headers);
		expect(headers.get("x-client-request-id")).toMatch(/^[0-9a-f-]{36}$/u);
		expect(headers.get("authorization")).toBe("Bearer secret");
	});
});
