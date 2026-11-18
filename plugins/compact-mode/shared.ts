export interface Settings {
	enabled: boolean
	avatars: boolean
	noInline: boolean
	inlineTimestamps: boolean
	noReplyAvatars: boolean
	biggerHeader: boolean
}

export const DefaultSettings: Settings = {
	enabled: true,
	avatars: false,
	noInline: false,
	inlineTimestamps: false,
	noReplyAvatars: false,
	biggerHeader: false,
}

export function mergeSettings(value?: Partial<Settings> | null): Settings {
	return { ...DefaultSettings, ...(value ?? {}) }
}
