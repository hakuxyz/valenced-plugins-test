export interface Settings {
	enabled: boolean
	hideClydeErrors: boolean
	hideClydeMessages: boolean
	hideGiftButton: boolean
	hideNitroPrompts: boolean
}

export const DefaultSettings: Settings = {
	enabled: true,
	hideClydeErrors: true,
	hideClydeMessages: true,
	hideGiftButton: true,
	hideNitroPrompts: true,
}

export function mergeSettings(value?: Partial<Settings> | null): Settings {
	return { ...DefaultSettings, ...(value ?? {}) }
}
