export type Pack = {
	id: string
	name: string
}

export const PACKS: Pack[] = [
	{ id: 'apple', name: 'Apple' },
	{ id: 'apple-hd', name: 'Apple HD' },
	{ id: 'apple-small', name: 'Apple Small' },
	{ id: 'samsung-oneui', name: 'Samsung One UI' },
	{ id: 'noto', name: 'Noto' },
	{ id: 'facebook', name: 'Facebook' },
	{ id: 'joypixels', name: 'JoyPixels' },
	{ id: 'whatsapp', name: 'WhatsApp' },
	{ id: 'openmoji', name: 'OpenMoji' },
	{ id: 'tossface', name: 'Toss Face' },
	{ id: 'blobmoji', name: 'Blobmoji' },
]

export const GroupId = 'packs'

export interface Settings {
	/** Currently selected pack id, or null when no pack is selected. */
	selected: string | null
	/** Pack ids that have been downloaded and extracted to plugin storage. */
	downloaded: string[]
}

export const DefaultSettings: Settings = {
	selected: null,
	downloaded: [],
}
