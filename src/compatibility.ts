export const SUPPORTED_PI_VERSIONS = ["0.84.1", "0.84.2"] as const;

export type SupportedPiVersion = (typeof SUPPORTED_PI_VERSIONS)[number];

export function isSupportedPiVersion(
	version: string,
): version is SupportedPiVersion {
	return (SUPPORTED_PI_VERSIONS as readonly string[]).includes(version);
}
