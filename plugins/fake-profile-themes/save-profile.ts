import { ToastActionCreators } from '@valenced/discord/actions'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { currentColors, currentProfileBio } from './colors'
import { encodeColors, withColorCode } from './shared'
import { currentSettings } from './state'
import type { AnyFunction } from '@valenced/utils/types'

type Cleanup = (...unpatches: Array<() => boolean | void>) => void

type Instead = (args: unknown[], original: AnyFunction) => unknown

const insteadLoose = instead as unknown as (
	parent: Record<string, AnyFunction>,
	key: string,
	hook: Instead,
) => () => boolean

interface SavePayload {
	bio?: string | null
	[key: string]: unknown
}

function patchSaveProfile(
	cleanup: Cleanup,
	parent: Record<string, AnyFunction>,
	key: string,
) {
	cleanup(
		insteadLoose(parent, key, (args, original) => {
			try {
				if (currentSettings().autoBio) {
					const payload = args[0]
					const colors = currentColors()

					if (colors && typeof payload === 'object' && payload !== null) {
						const record = payload as SavePayload
						const submitted = record.bio
						// When the bio was not changed, Discord leaves it out of
						// the payload. In that case use the stored bio so the
						// color code still ends up in it.
						const source =
							typeof submitted === 'string' ? submitted : currentProfileBio()

						if (typeof source === 'string') {
							const next = withColorCode(source, colors[0], colors[1])

							if (next != null) {
								record.bio = next
							} else {
								const code = encodeColors(colors[0], colors[1])
								Clipboard.setString(code)
								ToastActionCreators.open('FAKE_PROFILE_THEMES_BIO_FULL', {
									text: 'Your bio is too long for the hidden colors. The 3y3 text was copied instead.',
									variant: 'critical',
								})
							}
						}
					}
				}
			} catch {}

			return original(...args)
		}),
	)
}

function patchRecord(cleanup: Cleanup, record: unknown): boolean {
	if (typeof record !== 'object' || record === null) return false

	const parent = record as Record<string, AnyFunction>
	if (typeof parent.saveProfileChanges !== 'function') return false

	patchSaveProfile(cleanup, parent, 'saveProfileChanges')
	return true
}

export function setupSaveProfile(cleanup: Cleanup) {
	cleanup(
		getModules(
			withProps('saveProfileChanges'),
			module => {
				try {
					if (patchRecord(cleanup, module)) return

					const fallback = (module as { default?: unknown })?.default
					patchRecord(cleanup, fallback)
				} catch {}
			},
			{ max: 1, returnNamespace: true },
		),
	)
}
