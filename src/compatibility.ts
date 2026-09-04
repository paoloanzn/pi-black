export const MINIMUM_SUPPORTED_PI_VERSION = "0.84.1";

type StableVersion = readonly [number, number, number];

function parseStableVersion(version: string): StableVersion | undefined {
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
	if (!match) return undefined;

	const parsed = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
	return parsed.every(Number.isSafeInteger) ? parsed : undefined;
}

export function isSupportedPiVersion(version: string): boolean {
	const candidate = parseStableVersion(version);
	const minimum = parseStableVersion(MINIMUM_SUPPORTED_PI_VERSION);
	if (!candidate || !minimum) return false;

	for (let index = 0; index < candidate.length; index++) {
		if (candidate[index] > minimum[index]) return true;
		if (candidate[index] < minimum[index]) return false;
	}
	return true;
}
