import type {
	Api,
	ApiStreamOptions,
	AssistantMessageEventStream,
	Context,
	Model,
	Provider,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { wrapAnthropicProvider } from "../src/anthropic-provider.ts";
import { CLAUDE_CODE_VERSION } from "../src/claude-code-protocol.ts";

const context: Context = {
	systemPrompt: "Pi system",
	messages: [
		{ role: "user", content: "Reply with exactly: PROBE_OK", timestamp: 1 },
	],
};
const model = {
	id: "claude-test",
	provider: "anthropic",
	api: "anthropic-messages",
} as Model<Api>;
const streamResult = {} as AssistantMessageEventStream;

function fakeProvider() {
	let streamOptions: ApiStreamOptions<Api> | undefined;
	let simpleOptions: SimpleStreamOptions | undefined;
	const provider = {
		id: "anthropic",
		name: "Anthropic",
		stream<T extends Api>(
			_model: Model<T>,
			_context: Context,
			options?: ApiStreamOptions<T>,
		) {
			streamOptions = options;
			return streamResult;
		},
		streamSimple(
			_model: Model<Api>,
			_context: Context,
			options?: SimpleStreamOptions,
		) {
			simpleOptions = options;
			return streamResult;
		},
	} as Provider;
	return {
		provider,
		getStreamOptions: () => streamOptions,
		getSimpleOptions: () => simpleOptions,
	};
}

describe("Anthropic provider wrapper", () => {
	it("passes API-key requests through without changing options", () => {
		const fake = fakeProvider();
		const wrapped = wrapAnthropicProvider(fake.provider, undefined);
		const options: SimpleStreamOptions = {
			apiKey: "sk-ant-api-key",
			headers: { "x-test": "yes" },
		};
		wrapped.streamSimple(model, context, options);
		expect(fake.getSimpleOptions()).toBe(options);
	});

	it("applies existing payload transforms before the final Pi Black transform", async () => {
		const fake = fakeProvider();
		const wrapped = wrapAnthropicProvider(fake.provider, {
			deviceId: "f".repeat(64),
			accountUuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
		});
		const priorTransform = vi.fn(async (payload: unknown) => ({
			...(payload as object),
			later_extension: true,
		}));
		wrapped.streamSimple(model, context, {
			apiKey: "sk-ant-oat-test",
			sessionId: "11111111-2222-4333-8444-555555555555",
			onPayload: priorTransform,
		});
		const options = fake.getSimpleOptions();
		const payload = await options?.onPayload?.(
			{
				model: "claude-test",
				messages: [],
				max_tokens: 1,
				stream: true,
				system: [
					{
						type: "text",
						text: "You are Claude Code, Anthropic's official CLI for Claude.",
					},
				],
			},
			model,
		);
		expect(priorTransform).toHaveBeenCalledOnce();
		expect(payload).toMatchObject({ later_extension: true });
		const system = (payload as { system: Array<{ text: string }> }).system;
		expect(system[0].text).toMatch(/^x-anthropic-billing-header:/u);
		expect(system[1].text).toBe(
			"You are a Claude agent, built on Anthropic's Claude Agent SDK.",
		);
		expect(options?.headers).toMatchObject({
			"user-agent": `claude-cli/${CLAUDE_CODE_VERSION} (external, sdk-cli)`,
			"x-app": "cli",
			"x-claude-code-session-id": "11111111-2222-4333-8444-555555555555",
		});
	});
});
