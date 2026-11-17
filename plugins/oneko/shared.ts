export type SizeKey = 'small' | 'medium' | 'large'

export type SpeedKey = 'slow' | 'normal' | 'fast'

export interface Settings {
	enabled: boolean
	size: SizeKey
	speed: SpeedKey
	/** Let the cat sleep after a while without touching the screen. */
	sleep: boolean
}

export const DefaultSettings: Settings = {
	enabled: true,
	size: 'medium',
	speed: 'normal',
	sleep: true,
}

export const SizeValues: Record<SizeKey, number> = {
	small: 26,
	medium: 36,
	large: 48,
}

export const SpeedMultipliers: Record<SpeedKey, number> = {
	slow: 0.55,
	normal: 1,
	fast: 1.7,
}
