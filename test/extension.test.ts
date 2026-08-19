import type { Provider } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	VERSION,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import piBlack from "../extensions/pi-black.ts";
import {
	isSupportedPiVersion,
	SUPPORTED_PI_VERSIONS,
} from "../src/compatibility.ts";

describe("Pi Black extension", () => {
	it("registers the wrapped Anthropic provider with the installed Pi version", () => {
		expect(isSupportedPiVersion(VERSION)).toBe(true);
		if (process.env.EXPECTED_PI_VERSION)
			expect(VERSION).toBe(process.env.EXPECTED_PI_VERSION);
		const registerProvider = vi.fn<(provider: Provider) => void>();

		piBlack({ registerProvider } as unknown as ExtensionAPI);

		expect(registerProvider).toHaveBeenCalledOnce();
		expect(registerProvider.mock.calls[0][0].id).toBe("anthropic");
	});

	it("fails closed for Pi versions that have not been validated", () => {
		expect(SUPPORTED_PI_VERSIONS).toEqual(["0.84.1", "0.84.2"]);
		expect(isSupportedPiVersion("0.84.3")).toBe(false);
	});
});
