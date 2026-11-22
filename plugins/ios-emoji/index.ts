export default plugin({
	preInit({ themes }: any) {
		themes.registerGroup('emojis', {
			name: 'Emojis',
			description: 'Emoji packs',
		})

		themes.registerEmojiPack('emojis', 'ios', {
			name: 'iOS',
			description: 'Apple iOS emoji artwork for every Unicode emoji.',
			images: 'assets/emoji',
		})
	},
})
