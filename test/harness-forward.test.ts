import type {
	Api,
	Context,
	Model,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { wrapAnthropicProvider } from "../src/anthropic-provider.ts";

// Integration test against the claude-harness native proxy (pi -> harness -> mock
// Anthropic via mitmproxy). Skips automatically when the harness is not running.
const HARNESS_URL =
	process.env.PI_BLACK_HARNESS_URL ?? "http://127.0.0.1:8321";

async function harnessUp(): Promise<boolean> {
	try {
		const res = await fetch(`${HARNESS_URL}/health`);
		return res.ok;
	} catch {
		return false;
	}
}

const up = await harnessUp();

const context: Context = {
	systemPrompt: "Pi system",
	messages: [
		{
			role: "user",
			content: [{ type: "text", text: "Reply with exactly: PROBE_OK" }],
			timestamp: 1,
		},
	],
};

const model = (() => {
	const provider = builtinProviders().find((p) => p.id === "anthropic");
	const m = provider?.getModels().find((x) => x.id === "claude-sonnet-4-5");
	return m as Model<Api>;
})();

describe.runIf(up)("claude-harness forward integration", () => {
	it("streams anthropic SSE through the native harness", async () => {
		process.env.PI_BLACK_HARNESS_URL = HARNESS_URL;
		const anthropic = builtinProviders().find((p) => p.id === "anthropic");
		expect(anthropic).toBeDefined();
		const wrapped = wrapAnthropicProvider(anthropic!);

		const stream = wrapped.streamSimple(model, context, {
			apiKey: "sk-ant-oat01-harnessprobe",
			sessionId: "pi-black-harness-test",
			maxTokens: 32,
		});

		let text = "";
		const types: string[] = [];
		for await (const event of stream) {
			types.push(event.type);
			if (event.type === "text_delta") text += event.delta;
		}
		expect(types).toContain("text_delta");
		expect(text).toContain("pong");
	}, 30_000);
});
