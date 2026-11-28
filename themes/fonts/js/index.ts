interface FontVariant {
	path: string
	weight?: number
	italic?: boolean
	axes?: Record<string, number>
}

interface ThemesApi {
	registerGroup(id: string, group: { name: string; description?: string }): void
	registerFontPack(
		groupId: string,
		packId: string,
		pack: {
			name: string
			description?: string
			families: Record<string, FontVariant[]>
		},
	): void
}

const Font = 'assets/fonts/md.ttf'

/** Discord asks for these family names. The style is part of the name. */
const Weights: Record<string, number> = {
	Normal: 400,
	Medium: 500,
	Semibold: 600,
	Bold: 700,
	ExtraBold: 800,
}

const families: Record<string, FontVariant[]> = {}
for (const [style, weight] of Object.entries(Weights))
	families[`ggsans-${style}`] = [
		{ path: Font, weight },
		{ path: Font, weight, italic: true },
	]

export default plugin({
	preInit(api) {
		const themes = (api as { themes?: ThemesApi }).themes
		if (!themes) return

		themes.registerGroup('custom', {
			name: 'Custom',
			description: 'Custom font packs',
		})
		themes.registerFontPack('custom', 'my-diary', {
			name: 'My diary',
			description: 'Replaces gg sans with My diary',
			families,
		})
	},
})
