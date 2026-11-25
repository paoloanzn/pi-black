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
		expect(MINIMUM_SUPPORTED_PI_VERSION).toBe("1.6.0");
		for (const version of ["1.6.0", "1.6.1", "1.7.0", "2.0.0"])
			expect(isSupportedPiVersion(version)).toBe(true);
	});

	it("rejects Pi versions below the minimum or with an invalid format", () => {
		for (const version of [
			"0.84.4",
			"1.5.2",
			"1.6",
			"1.6.0-beta.1",
			"invalid",
		])
			expect(isSupportedPiVersion(version)).toBe(false);
	});
});
