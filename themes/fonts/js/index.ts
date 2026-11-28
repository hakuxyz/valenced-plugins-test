/// <reference types="@valenced/themes-api" />

import type { FontVariant } from '@valenced/themes-api/types'

const Font = 'assets/fonts/md.ttf'

const Styles = ['Normal', 'Medium', 'Semibold', 'Bold', 'ExtraBold'] as const

const families: Record<string, FontVariant[]> = {}
for (const style of Styles) {
        families[`ggsans-${style}`] = [
                { path: Font },
                { path: Font, italic: true },
        ]
}

export default plugin({
        preInit({ themes }) {
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
