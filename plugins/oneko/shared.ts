export type SkinKey =
	| 'classic'
	| 'ace'
	| 'black'
	| 'bsd'
	| 'bunny'
	| 'calico'
	| 'catppuccin'
	| 'dog'
	| 'eevee'
	| 'esmeralda'
	| 'fox'
	| 'ghost'
	| 'gray'
	| 'jess'
	| 'kina'
	| 'lucy'
	| 'maia'
	| 'maria'
	| 'mike'
	| 'sakura'
	| 'silver'
	| 'silversky'
	| 'spirit'
	| 'tomoyo'
	| 'tora-x11'
	| 'valentine'
	| 'vaporwave'

export type SizeKey = 'small' | 'medium' | 'large'

export type SpeedKey = 'slow' | 'normal' | 'fast'

export interface Settings {
	enabled: boolean
	size: SizeKey
	speed: SpeedKey
	/** Let the cat sleep after a while without touching the screen. */
	sleep: boolean
	skin: SkinKey
}

export const DefaultSettings: Settings = {
	enabled: true,
	size: 'medium',
	speed: 'normal',
	sleep: true,
	skin: 'classic',
}

export const SkinLabels: Record<SkinKey, string> = {
	classic: 'Classic',
	ace: 'Ace',
	black: 'Black',
	bsd: 'BSD',
	bunny: 'Bunny',
	calico: 'Calico',
	catppuccin: 'Catppuccin',
	dog: 'Dog',
	eevee: 'Eevee',
	esmeralda: 'Esmeralda',
	fox: 'Fox',
	ghost: 'Ghost',
	gray: 'Gray',
	jess: 'Jess',
	kina: 'Kina',
	lucy: 'Lucy',
	maia: 'Maia',
	maria: 'Maria',
	mike: 'Mike',
	sakura: 'Sakura',
	silver: 'Silver',
	silversky: 'Silver Sky',
	spirit: 'Spirit',
	tomoyo: 'Tomoyo',
	'tora-x11': 'Tora X11',
	valentine: 'Valentine',
	vaporwave: 'Vaporwave',
}

export const SkinChoices = Object.keys(SkinLabels) as SkinKey[]

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
