export type Pack = {
	id: string
	name: string
}

export type Category = {
	id: string
	name: string
	packs: Pack[]
}

/** Representative emoji used as preview image for each pack. */
export const PreviewEmoji = 'emoji-1f600.png'

export const CATEGORIES: Category[] = [
	{
		id: 'apple',
		name: 'Apple',
		packs: [
			{ id: 'apple', name: 'Apple' },
			{ id: 'apple-hd', name: 'Apple HD' },
			{ id: 'apple-small', name: 'Apple Small' },
		],
	},
	{
		id: 'samsung',
		name: 'Samsung',
		packs: [{ id: 'samsung-oneui', name: 'One UI' }],
	},
	{
		id: 'google',
		name: 'Google',
		packs: [{ id: 'noto', name: 'Noto' }],
	},
	{
		id: 'meta',
		name: 'Meta',
		packs: [
			{ id: 'facebook', name: 'Facebook' },
			{ id: 'whatsapp', name: 'WhatsApp' },
		],
	},
	{
		id: 'joypixels',
		name: 'JoyPixels',
		packs: [{ id: 'joypixels', name: 'JoyPixels' }],
	},
	{
		id: 'openmoji',
		name: 'OpenMoji',
		packs: [{ id: 'openmoji', name: 'OpenMoji' }],
	},
	{
		id: 'tossface',
		name: 'Toss Face',
		packs: [{ id: 'tossface', name: 'Toss Face' }],
	},
	{
		id: 'blobmoji',
		name: 'Blobmoji',
		packs: [{ id: 'blobmoji', name: 'Blobmoji' }],
	},
]

export const PACKS: Pack[] = CATEGORIES.flatMap(category => category.packs)

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
