import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { type ExtensionAPI, VERSION } from "@earendil-works/pi-coding-agent";
import { wrapAnthropicProvider } from "../src/anthropic-provider.ts";
import { discoverClaudeCodeIdentity } from "../src/claude-code-protocol.ts";
import {
	isSupportedPiVersion,
	SUPPORTED_PI_VERSIONS,
} from "../src/compatibility.ts";

export default function piBlack(pi: ExtensionAPI): void {
	if (!isSupportedPiVersion(VERSION)) {
		throw new Error(
			`Pi Black supports Pi ${SUPPORTED_PI_VERSIONS.join(", ")}; running Pi is ${VERSION}`,
		);
	}
	const anthropic = builtinProviders().find(
		(provider) => provider.id === "anthropic",
	);
	if (!anthropic)
		throw new Error("Pi Black could not load Pi's built-in Anthropic provider");
	pi.registerProvider(
		wrapAnthropicProvider(anthropic, discoverClaudeCodeIdentity()),
	);
}
