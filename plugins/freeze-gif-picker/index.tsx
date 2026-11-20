import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
	withName,
} from '@valenced/modules/finders/filters'
import { afterJSX } from '@valenced/react/jsx-runtime'
import { cloneElement } from 'react'
import type { ElementType, ReactElement } from 'react'

type Cleanup = (...fns: Array<() => unknown>) => void

const ANIMATION_PROPS: Record<string, unknown> = {
	paused: true,
	autoPlay: false,
	autoplay: false,
	shouldAnimate: false,
	shouldPlay: false,
	isPlaying: false,
	playing: false,
	animate: false,
	loop: false,
}

const HOST_MEDIA_TYPES = [
	'Image',
	'RCTImageView',
	'ImageView',
	'AnimatedImage',
	'GifView',
] as const

const logged = new Set<string>()
const patchedComponents = new Set<ElementType>()

function logOnce(key: string, ...args: unknown[]): void {
	if (logged.has(key)) return
	logged.add(key)
	try {
		console.log('[freeze-gif-picker]', ...args)
	} catch {}
}

function isRecord(value: unknown): value is Record<string, any> {
	return value !== null && typeof value === 'object'
}

function isComponentValue(value: unknown): boolean {
	if (typeof value === 'function') return true
	return (
		isRecord(value) &&
		('$$typeof' in value || 'type' in value || 'render' in value)
	)
}

function componentName(value: unknown): string {
	if (typeof value !== 'function' && !isRecord(value)) return ''
	const candidate = value as Record<string, any>
	return (
		candidate.displayName ??
		candidate.name ??
		(candidate.type && componentName(candidate.type)) ??
		''
	)
}

function isGifName(name: string): boolean {
	return /gif/i.test(name)
}

function safeStringify(value: unknown, limit = 1500): string {
	try {
		const text = JSON.stringify(value)
		return text.length > limit ? `${text.slice(0, limit)}...` : text
	} catch {
		return String(value)
	}
}

function sourceInfo(props: Record<string, any>): unknown {
	const source =
		props.source ??
		props.imageSource ??
		props.imageUrl ??
		props.url ??
		props.uri

	if (typeof source === 'string') return source.slice(0, 220)

	if (Array.isArray(source)) {
		return source.slice(0, 2).map(item => sourceInfo({ source: item }))
	}

	if (isRecord(source)) {
		const uri = source.uri ?? source.url ?? source.src
		return typeof uri === 'string' ? uri.slice(0, 220) : Object.keys(source)
	}

	return undefined
}

function deanimateUri(uri: unknown): string | undefined {
	if (typeof uri !== 'string' || !/^https?:\/\//i.test(uri)) return undefined

	try {
		const url = new URL(uri)
		let changed = false

		if (url.searchParams.get('animated')?.toLowerCase() === 'true') {
			url.searchParams.set('animated', 'false')
			changed = true
		}

		const format = url.searchParams.get('format')?.toLowerCase()
		if (format === 'gif' || format === 'apng') {
			url.searchParams.set('format', 'png')
			changed = true
		}

		if (/\.gif(?:[?#]|$)/i.test(url.pathname)) {
			url.pathname = url.pathname.replace(/\.gif$/i, '.png')
			changed = true
		}

		return changed ? url.toString() : undefined
	} catch {
		if (/\.gif(?:[?#]|$)/i.test(uri)) {
			return uri.replace(/\.gif(?=[?#]|$)/i, '.png')
		}
		return undefined
	}
}

function freezeUri(value: unknown): unknown {
	if (typeof value === 'string') return deanimateUri(value) ?? value

	if (Array.isArray(value)) return value.map(item => freezeUri(item))

	if (isRecord(value)) {
		const uri = value.uri ?? value.url ?? value.src
		const next = deanimateUri(uri)
		if (!next || next === uri) return value

		const updated = { ...value }
		if ('uri' in updated) updated.uri = next
		if ('url' in updated) updated.url = next
		if ('src' in updated) updated.src = next
		return updated
	}

	return value
}

function freezeElement(
	element: ReactElement<Record<string, any>>,
	tag: string,
): ReactElement<Record<string, any>> {
	const props = element.props ?? {}
	const nextProps: Record<string, any> = { ...props }

	for (const [key, value] of Object.entries(ANIMATION_PROPS)) {
		if (key in nextProps && nextProps[key] !== value) nextProps[key] = value
	}

	for (const key of ['source', 'imageSource'] as const) {
		if (key in nextProps) {
			const frozen = freezeUri(nextProps[key])
			if (frozen !== nextProps[key]) nextProps[key] = frozen
		}
	}

	const originalSource = sourceInfo(props)
	const frozenSource = sourceInfo(nextProps)
	if (originalSource !== frozenSource) {
		logOnce(
			`${tag}:source`,
			`${tag} deanimated source`,
			originalSource,
			'->',
			frozenSource,
		)
	}

	return cloneElement(element, nextProps)
}

function installJsxHook(
	type: ElementType,
	tag: string,
	cleanup: Cleanup,
): void {
	if (patchedComponents.has(type)) return
	patchedComponents.add(type)

	try {
		const unpatch = afterJSX(type, element => {
			try {
				const props = (element as ReactElement<Record<string, any>>).props ?? {}
				logOnce(
					`${tag}:props`,
					`${tag} props`,
					Object.keys(props).sort(),
					sourceInfo(props),
				)
				if (tag === 'GIFPickerItemView') {
					logOnce(
						'item:diag',
						'GIFPickerItemView item',
						safeStringify(props.item),
					)
				}
				return freezeElement(element as ReactElement<Record<string, any>>, tag)
			} catch {
				return element
			}
		})

		cleanup(() => {
			patchedComponents.delete(type)
			unpatch()
		})
	} catch {
		patchedComponents.delete(type)
	}
}

function collectComponents(
	value: unknown,
	output: Set<ElementType>,
	force: boolean,
	depth = 0,
): void {
	if (depth > 3 || (!isRecord(value) && typeof value !== 'function')) return

	const name = componentName(value)
	if (isComponentValue(value) && (force || isGifName(name))) {
		output.add(value as ElementType)
	}

	if (!isRecord(value) || depth >= 3) return
	const record = value as Record<string, any>
	for (const key of Object.keys(record)) {
		if (key === '_owner' || key === '_store' || key === '_self') continue
		try {
			collectComponents(record[key], output, force, depth + 1)
		} catch {}
	}
}

const gifComponentsFilter = createFilterGenerator<[]>(
	(_args, id, exports) => {
		try {
			if (typeof id === 'string' && isGifName(id)) return true
		} catch {}
		return hasGifHint(exports)
	},
	() => 'freezeGifPicker.gifComponents',
	FilterScopes.Initialized,
)

function hasGifHint(value: unknown, depth = 0): boolean {
	if (depth > 2 || (!isRecord(value) && typeof value !== 'function'))
		return false
	if (isGifName(componentName(value))) return true
	if (!isRecord(value)) return false
	const record = value as Record<string, any>

	return Object.keys(record).some(key => {
		if (key === '_owner' || key === '_store' || key === '_self') return false
		if (isGifName(key)) return true
		try {
			return hasGifHint(record[key], depth + 1)
		} catch {
			return false
		}
	})
}

function patchGifComponents(cleanup: Cleanup): void {
	try {
		cleanup(
			getModules(
				gifComponentsFilter(),
				(exports: unknown) => {
					const found = new Set<ElementType>()
					collectComponents(exports, found, true)
					for (const component of found) {
						const name = componentName(component) || 'GIFComponent'
						logOnce(`found:${name}`, 'found gif component', name)
						installJsxHook(component, name, cleanup)
					}
				},
				{ returnNamespace: true },
			),
		)
	} catch {}
}

function resolveNamedComponents(exports: unknown, name: string): ElementType[] {
	if (!isRecord(exports) && typeof exports !== 'function') return []
	const namespace = exports as Record<string, any>
	const candidates = [
		namespace[name]?.type,
		namespace[name],
		namespace.default?.[name]?.type,
		namespace.default?.[name],
		namespace.default?.type,
		namespace.default,
		namespace,
	]

	const resolved: ElementType[] = []
	for (const candidate of candidates) {
		if (!isComponentValue(candidate)) continue
		const candidateName = componentName(candidate)
		if (candidateName && candidateName !== name) continue
		if (!patchedComponents.has(candidate as ElementType)) {
			resolved.push(candidate as ElementType)
		}
	}
	return resolved
}

const autoplayModuleFilter = createFilterGenerator<[]>(
	(_args, _id, exports) => {
		try {
			if (!isRecord(exports)) return false
			const keys = Object.keys(exports)
			if (keys.some(key => /autoplay|autoPlay|AutoPlay/i.test(key))) return true
			const nested = (exports as Record<string, any>).default
			return (
				isRecord(nested) &&
				Object.keys(nested).some(key => /autoplay|autoPlay|AutoPlay/i.test(key))
			)
		} catch {
			return false
		}
	},
	() => 'freezeGifPicker.autoplayModules',
	FilterScopes.Initialized,
)

function patchImageComponent(
	name: 'Image' | 'ImageBackground',
	cleanup: Cleanup,
): void {
	try {
		cleanup(
			getModules(
				withName(name),
				(exports: unknown) => {
					for (const component of resolveNamedComponents(exports, name)) {
						installJsxHook(component, `react-native:${name}`, cleanup)
					}
				},
				{ returnNamespace: true },
			),
		)
	} catch {}
}

export default plugin({
	start({ cleanup }) {
		for (const type of HOST_MEDIA_TYPES) {
			installJsxHook(type as ElementType, `host:${type}`, cleanup)
		}
		patchImageComponent('Image', cleanup)
		patchImageComponent('ImageBackground', cleanup)
		patchGifComponents(cleanup)
		cleanup(
			getModules(
				autoplayModuleFilter(),
				(exports: unknown, id) => {
					const keys = isRecord(exports)
						? Object.keys(exports).filter(key =>
								/autoplay|autoPlay|AutoPlay/i.test(key),
							)
						: []
					logOnce(`autoplay:${id}`, 'autoplay module', String(id), keys)
				},
				{ returnNamespace: true },
			),
		)
		logOnce('started', 'freeze-gif-picker active (afterJSX diagnostics)')
	},
})
