import type {
	Api,
	ApiStreamOptions,
	Model,
	Provider,
	SimpleStreamOptions,
	TranscriptContext,
} from "@earendil-works/pi-ai";
import {
	type ClaudeCodeIdentity,
	discoverClaudeCodeIdentity,
	isAnthropicOAuthToken,
	mergeClaudeCodeOptions,
} from "./claude-code-protocol.ts";

// Pi's message threads (pi-ai 1.5+) strip `system` and `tools` from continued
// requests after `onPayload`, dropping the billing block, and add a `thread`
// field and beta header that Claude Code never sends. OAuth requests always
// go out as full, thread-less requests instead.
// The cast is needed because `compat` is typed per API and `T` stays generic.
function withoutMessageThreads<T extends Api>(model: Model<T>): Model<T> {
	const compat: object = { ...model.compat, supportsMessageThreads: false };
	return { ...model, compat } as Model<T>;
}

export function wrapAnthropicProvider(
	provider: Provider,
	identity:
		| ClaudeCodeIdentity
		| undefined
		| Promise<ClaudeCodeIdentity | undefined> = discoverClaudeCodeIdentity(),
): Provider {
	if (provider.id !== "anthropic")
		throw new Error(`Pi Black cannot wrap provider "${provider.id}"`);

	return {
		...provider,
		stream<T extends Api>(
			model: Model<T>,
			context: TranscriptContext,
			options?: ApiStreamOptions<T>,
		) {
			if (!options || !isAnthropicOAuthToken(options.apiKey))
				return provider.stream(model, context, options);
			const transformed = mergeClaudeCodeOptions(options, context, identity);
			return provider.stream(withoutMessageThreads(model), context, transformed);
		},
		streamSimple(
			model: Model<Api>,
			context: TranscriptContext,
			options?: SimpleStreamOptions,
		) {
			if (!options || !isAnthropicOAuthToken(options.apiKey))
				return provider.streamSimple(model, context, options);
			return provider.streamSimple(
				withoutMessageThreads(model),
				context,
				mergeClaudeCodeOptions(options, context, identity),
			);
		},
	};
}
