import { DefaultSettings, mergeSettings, rewriteContent } from './shared'
import type { Settings } from './shared'

const settings: Settings = { ...DefaultSettings }

function check(name: string, actual: string, expected: string): void {
	if (actual !== expected)
		throw new Error(`${name}:\n  got  ${actual}\n  want ${expected}`)
}

check(
	'vxtwitter drops query',
	rewriteContent(
		'<https://vxtwitter.com/2_min_utes/status/2124791408368525640?a=9jjE5SBkDo23Aca9RE8&s=20>',
		settings,
	),
	'<https://vxtwitter.com/2_min_utes/status/2124791408368525640>',
)

check(
	'twitter rewrites and drops query',
	rewriteContent('https://twitter.com/user/status/1?s=20', settings),
	'https://fxtwitter.com/user/status/1',
)

check(
	'x drops query',
	rewriteContent('https://x.com/user/status/2?t=abc', settings),
	'https://fixupx.com/user/status/2',
)

check(
	'instagram uses the new default',
	rewriteContent('https://instagram.com/p/abc', settings),
	'https://oginstagram.com/p/abc',
)

check(
	'saved retired instagram domain migrates',
	mergeSettings({
		...DefaultSettings,
		platforms: {
			...DefaultSettings.platforms,
			instagram: {
				...DefaultSettings.platforms.instagram,
				domain: 'ddinstagram.com',
			},
		},
	}).platforms.instagram.domain,
	'oginstagram.com',
)

check(
	'already fixed link keeps host, drops query',
	rewriteContent('https://fxtwitter.com/user/status/3?s=20', settings),
	'https://fxtwitter.com/user/status/3',
)

check(
	'trailing punctuation kept',
	rewriteContent('see https://twitter.com/user/status/4?s=20.', settings),
	'see https://fxtwitter.com/user/status/4.',
)

check(
	'other platforms keep their query',
	rewriteContent(
		'https://redditez.com/r/discordapps/comments/123/title/?utm_source=share',
		settings,
	),
	'https://redditez.com/r/discordapps/comments/123/title/?utm_source=share',
)

check(
	'disabled platform untouched',
	rewriteContent('https://twitter.com/user/status/5?s=20', {
		...settings,
		platforms: {
			...settings.platforms,
			twitter: { ...settings.platforms.twitter, enabled: false },
		},
	}),
	'https://twitter.com/user/status/5?s=20',
)

check(
	'plain text untouched',
	rewriteContent('no links here', settings),
	'no links here',
)
