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

interface Remover {
	name: string
	time: string
}

function RemoverSheet({ removers }: { removers: Remover[] }) {
	return createElement(
		ActionSheet,
		null,
		createElement(ActionSheetRow.Group, {
			children: removers.map(({ name, time }) =>
				createElement(ActionSheetRow, {
					key: `${name}:${time}`,
					label: `Removed by ${name}`,
					subLabel: time,
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

		let removers: Remover[]
		try {
			removers = getRemovers(
				props.messageId,
				props.emoji,
				props.isSelectedBurst ? 1 : 0,
			)
				.filter(entry => !!entry.userId)
				.map(entry => {
					const id = entry.userId as string
					const user = store?.getUser?.(id)
					return {
						name: user?.globalName ?? user?.username ?? id,
						time: new Date(entry.deletedAt).toLocaleTimeString([], {
							hour: '2-digit',
							minute: '2-digit',
						}),
					}
				})
		} catch (error) {
			onError(error)
			return original(...args)
		}
		if (!removers.length) return original(...args)

		const sheet = Promise.resolve({
			default: () => createElement(RemoverSheet, { removers }),
		})
		return original(sheet, key, props)
	})
}
