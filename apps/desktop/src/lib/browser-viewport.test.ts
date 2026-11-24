import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installBrowserViewport } from './browser-viewport'

let dispose: (() => void) | undefined
let root: HTMLDivElement
let viewport: EventTarget & { height: number; offsetTop: number; scale: number }
let frames: Map<number, FrameRequestCallback>
let nextFrame: number

const flush = () => {
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach(callback => callback(0))
}

const resize = (height: number, offsetTop = 0, scale = 1) => {
  Object.assign(viewport, { height, offsetTop, scale })
  viewport.dispatchEvent(new Event('resize'))
  viewport.dispatchEvent(new Event('scroll'))
  flush()
}

beforeEach(() => {
  root = document.createElement('div')
  root.id = 'root'
  document.body.append(root)
  document.documentElement.dataset.hermesDesktopHost = 'browser'
  viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 })
  frames = new Map()
  nextFrame = 0
  vi.stubGlobal('innerHeight', 800)
  vi.stubGlobal('visualViewport', viewport)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrame
    frames.set(id, callback)

    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  root.remove()
  document.documentElement.removeAttribute('data-hermes-desktop-host')
  document.documentElement.style.removeProperty('zoom')
  document.documentElement.style.removeProperty('--browser-visible-height')
  document.documentElement.style.removeProperty('--browser-visible-top')
  document.documentElement.removeAttribute('data-browser-visible')
  vi.unstubAllGlobals()
})

describe('browser visible viewport', () => {
  it('fits a keyboard and its pan at UI scale, without changing focus, pinch layout, or closed-keyboard layout', () => {
    const editor = document.createElement('textarea')
    editor.value = 'first line\nsecond line'
    root.append(editor)
    editor.focus()
    dispose = installBrowserViewport()
    expect(root.hasAttribute('data-browser-viewport')).toBe(false)

    resize(460, 25)
    expect(root.style.getPropertyValue('--browser-viewport-height')).toBe('460px')
    expect(root.style.getPropertyValue('--browser-viewport-top')).toBe('25px')
    expect(document.activeElement).toBe(editor)
    expect(editor.value).toBe('first line\nsecond line')

    resize(230, 90, 2)
    expect(root.style.getPropertyValue('--browser-viewport-height')).toBe('460px')
    expect(root.style.getPropertyValue('--browser-viewport-top')).toBe('25px')
    // Closing/reopening the keyboard while still pinched changes available
    // space, not the user's zoom. It must not leave the old keyboard inset.
    resize(400, 90, 2)
    expect(root.hasAttribute('data-browser-viewport')).toBe(false)
    resize(230, 90, 2)
    expect(root.style.getPropertyValue('--browser-viewport-height')).toBe('460px')
    expect(root.style.getPropertyValue('--browser-viewport-top')).toBe('0px')

    document.documentElement.style.zoom = '1.25'
    resize(460, 25)
    expect(root.style.getPropertyValue('--browser-viewport-height')).toBe('368px')
    expect(root.style.getPropertyValue('--browser-viewport-top')).toBe('20px')
    editor.blur()
    resize(500, 0)
    expect(document.activeElement).not.toBe(editor)
    expect(root.hasAttribute('data-browser-viewport')).toBe(true)

    // Rotation/layout-resizing browsers already made room for the keyboard.
    vi.stubGlobal('innerHeight', 500)
    window.dispatchEvent(new Event('resize'))
    flush()
    expect(root.hasAttribute('data-browser-viewport')).toBe(false)
    expect(root.style.getPropertyValue('--browser-viewport-height')).toBe('')
    vi.stubGlobal('innerHeight', 800)
    resize(800)
    expect(root.hasAttribute('data-browser-viewport')).toBe(false)
    expect(editor.value).toBe('first line\nsecond line')
  })

  it('leaves a focus-zoomed iOS keyboard to Safari, whose innerHeight is the visible area', () => {
    vi.stubGlobal('innerHeight', 714)
    viewport.height = 714
    dispose = installBrowserViewport()

    // Measured in iOS 26.5 Safari: focusing a 14.3px field zooms 402/359 and
    // Safari scrolls 353px to it; innerHeight follows the visible height.
    vi.stubGlobal('innerHeight', 361)
    resize(361, 353, 402 / 359)
    expect(root.hasAttribute('data-browser-viewport')).toBe(false)

    // Keyboard dismissed while the zoom remains.
    vi.stubGlobal('innerHeight', 638)
    resize(638, 76, 402 / 359)
    expect(root.hasAttribute('data-browser-viewport')).toBe(false)
  })

  it('publishes the measured visible area on <html> for portalled overlays, including when the shell is left alone', () => {
    dispose = installBrowserViewport()

    // At rest the visible area is the layout viewport; the metric still names
    // it, so a dialog can size itself from one source on every host.
    expect(document.documentElement.hasAttribute('data-browser-visible')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--browser-visible-height')).toBe('800px')

    resize(460, 25)
    expect(document.documentElement.style.getPropertyValue('--browser-visible-height')).toBe('460px')
    expect(document.documentElement.style.getPropertyValue('--browser-visible-top')).toBe('25px')

    // iOS Safari reports the visible height as innerHeight, so the shell fit
    // stands down — but a dialog that sized itself from #root would still sit
    // under the keyboard. The published metric must not stand down with it.
    vi.stubGlobal('innerHeight', 460)
    resize(460, 25)
    expect(root.hasAttribute('data-browser-viewport')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--browser-visible-height')).toBe('460px')

    dispose()
    dispose = undefined
    expect(document.documentElement.hasAttribute('data-browser-visible')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--browser-visible-height')).toBe('')
  })

  it('leaves native/missing-API hosts alone and releases coalesced listeners and layout on teardown', () => {
    document.documentElement.removeAttribute('data-hermes-desktop-host')
    installBrowserViewport()()
    resize(400)
    expect(root.hasAttribute('data-browser-viewport')).toBe(false)
    expect(frames.size).toBe(0)

    document.documentElement.dataset.hermesDesktopHost = 'browser'
    vi.stubGlobal('visualViewport', null)
    installBrowserViewport()()
    expect(root.hasAttribute('data-browser-viewport')).toBe(false)
    vi.stubGlobal('visualViewport', viewport)
    dispose = installBrowserViewport()
    expect(root.hasAttribute('data-browser-viewport')).toBe(true)
    viewport.dispatchEvent(new Event('resize'))
    viewport.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
    expect(frames.size).toBe(1)
    dispose()
    expect(frames.size).toBe(0)
    resize(300)
    window.dispatchEvent(new Event('resize'))
    flush()
    expect(root.hasAttribute('data-browser-viewport')).toBe(false)
    expect(root.style.getPropertyValue('--browser-viewport-top')).toBe('')
    expect(frames.size).toBe(0)
  })
})
