import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { lookupModule, waitForModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { before, instead } from '@valenced/patcher'
import { createElement } from 'react'
import { getRemovers } from './logger'
import type { FC, ReactElement, ReactNode } from 'react'
import type { ReactionEmoji } from './shared'

const { ActionSheet, ActionSheetRow } = Design

type Element = ReactElement<{
	key?: string | null
	children?: ReactNode
	label?: unknown
}>

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

function findActionSheet(element: unknown): Element | undefined {
	if (!element || typeof element !== 'object') return
	if (Array.isArray(element)) {
		for (const child of element) {
			const found = findActionSheet(child)
			if (found) return found
		}
		return
	}
	const { type, props } = element as Element
	if (type === ActionSheet) return element as Element
	return findActionSheet(props?.children)
}

function addRemovers(tree: unknown, names: string[]): void {
	const sheet = findActionSheet(tree)
	if (!sheet) return

	const children = [sheet.props.children]
		.flat()
		.filter(Boolean)
		.filter(child => (child as Element)?.key !== 'reaction-logger-removers')
	const rows = names.map(name =>
		createElement(ActionSheetRow, {
			key: name,
			label: `Removed by ${name}`,
			variant: 'danger',
			onPress: () => ActionSheetActionCreators.hideActionSheet(),
		}),
	)
	children.splice(
		Math.max(children.length - 1, 0),
		0,
		createElement(ActionSheetRow.Group, {
			key: 'reaction-logger-removers',
			children: rows,
		}),
	)
	sheet.props.children = children
}

export function patchReactionActionSheet(
	onError: (error: unknown) => void,
): () => void {
	const found = lookupModule(withProps('getUsers')) as unknown
	const store = (Array.isArray(found) ? found[0] : found) as
		| UserStore
		| undefined
	let view: SheetProps | undefined
	let unpatchView: (() => void) | undefined

	const unsubscribeView = waitForModules(
		withProps('handleViewReactions'),
		exports => {
			unpatchView = before(
				exports as Record<
					'handleViewReactions',
					(...args: unknown[]) => unknown
				>,
				'handleViewReactions',
				args => {
					view = args[0] as SheetProps
					console.log(
						'[ReactionLogger] view',
						JSON.stringify({ messageId: view?.messageId, emoji: view?.emoji }),
					)
					return args
				},
			)
		},
	)

	const Actions = ActionSheetActionCreators as unknown as Record<
		'openLazy',
		(...args: unknown[]) => unknown
	>
	const unpatchSheet = instead(Actions, 'openLazy', (args, original) => {
		const [sheet, key, props] = args as [
			Promise<{ default: FC<SheetProps> }>,
			string,
			SheetProps,
		]
		console.log(
			'[ReactionLogger] openLazy',
			key,
			JSON.stringify({
				props: props ? Object.keys(props) : [],
				messageId: props?.messageId,
				emoji: props?.emoji,
			}),
		)
		const options =
			props?.messageId && props.emoji ? props : (view as SheetProps | undefined)
		if (
			!options?.messageId ||
			!options.emoji ||
			typeof sheet?.then !== 'function'
		)
			return original(...args)

		const messageId = options.messageId
		const emoji = options.emoji
		const type = options.isSelectedBurst ? 1 : 0
		const namesFor = (target?: SheetProps) =>
			getRemovers(target?.messageId ?? messageId, target?.emoji ?? emoji, type)
				.map(entry => entry.userId)
				.filter((id): id is string => !!id)
				.map(id => {
					const user = store?.getUser?.(id)
					return user?.globalName ?? user?.username ?? id
				})

		const names = namesFor(options)
		console.log('[ReactionLogger] removers', JSON.stringify(names))
		if (!names.length) return original(...args)

		const wrapped = sheet.then(module => ({
			default: (sheetProps: SheetProps) => {
				const tree = Reflect.apply(module.default, undefined, [sheetProps])
				console.log(
					'[ReactionLogger] sheet tree',
					findActionSheet(tree) ? 'found' : 'missing',
				)
				try {
					addRemovers(tree, namesFor(sheetProps ?? options))
				} catch (error) {
					onError(error)
				}
				return tree
			},
		}))
		return original(wrapped, key, props)
	})

	return () => {
		unsubscribeView()
		unpatchView?.()
		unpatchSheet()
	}
}
