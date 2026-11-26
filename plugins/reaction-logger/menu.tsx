import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { createElement } from 'react'
import { getRemovers } from './logger'
import type { FC } from 'react'
import type { ReactionEmoji } from './shared'

const { ActionSheet, ActionSheetRow } = Design

interface SheetProps {
	messageId?: string
	emoji?: ReactionEmoji
	isSelectedBurst?: boolean
}

interface UserStore {
	getUser?: (
		id: string,
	) => { username?: string; globalName?: string } | undefined
}

function RemoverSheet({ names }: { names: string[] }) {
	return createElement(
		ActionSheet,
		null,
		createElement(ActionSheetRow.Group, {
			children: names.map(name =>
				createElement(ActionSheetRow, {
					key: name,
					label: `Removed by ${name}`,
					variant: 'danger',
					onPress: () => ActionSheetActionCreators.hideActionSheet(),
				}),
			),
		}),
	)
}

export function patchReactionActionSheet(
	onError: (error: unknown) => void,
): () => void {
	const found = lookupModule(withProps('getUsers')) as unknown
	const store = (Array.isArray(found) ? found[0] : found) as
		| UserStore
		| undefined

	const Actions = ActionSheetActionCreators as unknown as Record<
		'openLazy',
		(...args: unknown[]) => unknown
	>
	return instead(Actions, 'openLazy', (args, original) => {
		const [_sheet, key, props] = args as [
			Promise<{ default: FC<SheetProps> }>,
			string,
			SheetProps,
		]
		if (
			key !== 'MessageReactions' ||
			!props?.messageId ||
			!props.emoji ||
			typeof ActionSheet !== 'function'
		)
			return original(...args)

		let names: string[]
		try {
			names = getRemovers(
				props.messageId,
				props.emoji,
				props.isSelectedBurst ? 1 : 0,
			)
				.map(entry => entry.userId)
				.filter((id): id is string => !!id)
				.map(id => {
					const user = store?.getUser?.(id)
					return user?.globalName ?? user?.username ?? id
				})
		} catch (error) {
			onError(error)
			return original(...args)
		}
		if (!names.length) return original(...args)

		console.log('[ReactionLogger] removers', JSON.stringify(names))
		const sheet = Promise.resolve({
			default: () => createElement(RemoverSheet, { names }),
		})
		return original(sheet, key, props)
	})
}
