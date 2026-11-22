const PACKS: Record<string, string> = {
	apple: 'Apple',
	'apple-hd': 'Apple HD',
	'apple-small': 'Apple Small',
	'samsung-oneui': 'Samsung One UI',
	noto: 'Noto',
	facebook: 'Facebook',
	joypixels: 'JoyPixels',
	whatsapp: 'WhatsApp',
	openmoji: 'OpenMoji',
	tossface: 'Toss Face',
	blobmoji: 'Blobmoji',
}

export default plugin({
	preInit({ themes }: any) {
		themes.registerGroup('packs', {
			name: 'Packs',
			description: 'Emoji packs',
		})

		for (const [id, name] of Object.entries(PACKS))
			themes.registerEmojiPack('packs', id, {
				name,
				images: `assets/emoji/${id}`,
			})
	},
})
