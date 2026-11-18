import { Stores } from '@valenced/discord/flux'
import { DefaultSettings } from './shared'
import type { Settings } from './shared'

interface History {
	/** Older text states, newest last. */
	past: string[]
	/** Text states that were undone. */
	future: string[]
	/** Text we last saw for this channel. */
	current: string
	seeded: boolean
	/** Timestamp of the last recorded change, for grouping bursts. */
	lastChange: number
}

/** Milliseconds of silence that start a new undo step. */
const GROUP_MS = 700
const MAX_STEPS = 200

const histories = new Map<string, History>()
const listeners = new Set<() => void>()

/** Set while history text is pushed into the input, to avoid recording it. */
let suppress = false
let settingsGetter: () => Settings = () => DefaultSettings
let applier: ((text: string) => void) | undefined
/** Text the last undo or redo tried to write back. */
let applied: string | undefined

type Reporter = (
	action: string,
	channelId: string,
	ok: boolean,
	expected?: string,
) => void

let reporter: Reporter | undefined

export function setSettingsGetter(fn: () => Settings) {
	settingsGetter = fn
}

/** Called whenever the plugin settings changed, so the pill re-reads them. */
export function settingsChanged() {
	notify()
}

/** Registers the diagnostic callback used after undo and redo. */
export function setReporter(fn: Reporter) {
	reporter = fn
}

/** Reports what an undo or redo attempt did. */
export function report(
	action: string,
	channelId: string,
	ok: boolean,
	expected?: string,
) {
	try {
		reporter?.(action, channelId, ok, expected)
	} catch {}
}

/** Text the last undo or redo tried to write back. */
export function lastApplied(): string | undefined {
	return applied
}

/** History counters, used by the diagnostic toast. */
export function debugHistory(channelId: string): {
	past: number
	future: number
	current: string
} {
	const h = history(channelId)
	return { past: h.past.length, future: h.future.length, current: h.current }
}

/** Draft Discord stored for the channel, used by the diagnostic toast. */
export function readDraft(channelId: string): unknown {
	try {
		return store('DraftStore')?.getDraft?.(channelId, 0)
	} catch {
		return undefined
	}
}

export function currentSettings(): Settings {
	try {
		return { ...DefaultSettings, ...settingsGetter() }
	} catch {
		return DefaultSettings
	}
}

/** Sets the function that writes text back into the message box. */
export function setApplier(fn: (text: string) => void) {
	applier = fn
}

export function subscribe(fn: () => void): () => void {
	listeners.add(fn)
	return () => {
		listeners.delete(fn)
	}
}

function notify() {
	for (const fn of Array.from(listeners)) {
		try {
			fn()
		} catch {}
	}
}

function history(channelId: string): History {
	let h = histories.get(channelId)
	if (!h) {
		h = { past: [], future: [], current: '', seeded: false, lastChange: 0 }
		histories.set(channelId, h)
	}
	return h
}

export function store(name: string): Record<string, any> | undefined {
	try {
		return (Stores as unknown as Record<string, Record<string, any>>)[name]
	} catch {
		return undefined
	}
}

export function selectedChannelId(): string {
	try {
		return store('SelectedChannelStore')?.getChannelId?.() ?? ''
	} catch {
		return ''
	}
}

/** Resolves the channel a history entry belongs to. */
export function channelFor(explicit?: string): string {
	if (explicit) return explicit
	return selectedChannelId() || 'unknown'
}

/** Captures the text that was already in the box before any typing. */
export function seed(channelId: string, value: unknown) {
	const h = history(channelId)
	if (h.seeded) return
	h.seeded = true

	if (typeof value === 'string' && value) {
		h.current = value
		return
	}

	try {
		const draft = store('DraftStore')?.getDraft?.(channelId, 0)
		if (typeof draft === 'string' && draft) h.current = draft
	} catch {}
}

/** Records a text change made by the user. */
export function record(channelId: string, text: string) {
	if (suppress) return

	const h = history(channelId)
	if (text === h.current) return

	const now = Date.now()
	if (now - h.lastChange > GROUP_MS) {
		h.past.push(h.current)
		if (h.past.length > MAX_STEPS) h.past.shift()
	}

	h.current = text
	h.future = []
	h.lastChange = now
	notify()
}

function commit(channelId: string, text: string) {
	const h = history(channelId)
	h.current = text
	h.lastChange = 0
	applied = text

	suppress = true
	try {
		applier?.(text)
	} finally {
		suppress = false
	}

	notify()
}

/** Steps one undo back. Returns false when there is nothing to undo. */
export function undo(channelId: string): boolean {
	const h = history(channelId)
	if (h.past.length === 0) return false

	const previous = h.past.pop() as string
	h.future.push(h.current)
	commit(channelId, previous)
	return true
}

/** Steps one redo forward. Returns false when there is nothing to redo. */
export function redo(channelId: string): boolean {
	const h = history(channelId)
	if (h.future.length === 0) return false

	const next = h.future.pop() as string
	h.past.push(h.current)
	commit(channelId, next)
	return true
}

export function canUndo(channelId: string): boolean {
	return history(channelId).past.length > 0
}

export function canRedo(channelId: string): boolean {
	return history(channelId).future.length > 0
}
