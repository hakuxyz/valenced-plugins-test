export type ImageScope = 'small' | 'all'
export type SmallImageLimit = 128 | 256 | 512

export interface Settings {
	enabled: boolean
	imageScope: ImageScope
	smallImageLimit: SmallImageLimit
	renderAsLinks: boolean
	useOriginalUrls: boolean
}

export const DefaultSettings: Settings = {
	enabled: true,
	imageScope: 'small',
	smallImageLimit: 256,
	renderAsLinks: true,
	useOriginalUrls: true,
}

export function mergeSettings(value?: Partial<Settings> | null): Settings {
	return { ...DefaultSettings, ...(value ?? {}) }
}
