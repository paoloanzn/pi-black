import type { Provider } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	VERSION,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import piBlack from "../extensions/pi-black.ts";
import {
	isSupportedPiVersion,
	MINIMUM_SUPPORTED_PI_VERSION,
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

	it("supports the minimum Pi version and newer stable versions", () => {
		expect(MINIMUM_SUPPORTED_PI_VERSION).toBe("0.84.1");
		for (const version of ["0.84.1", "0.84.4", "0.85.0", "1.0.0"])
			expect(isSupportedPiVersion(version)).toBe(true);
	});

	it("rejects Pi versions below the minimum or with an invalid format", () => {
		for (const version of [
			"0.83.999",
			"0.84.0",
			"0.84",
			"0.84.1-beta.1",
			"invalid",
		])
			expect(isSupportedPiVersion(version)).toBe(false);
	});
});
