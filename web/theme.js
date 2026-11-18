/**
 * The shell's theme, when framed: DSH defines its colours as CSS variables on
 * its root, so the page copies the ones it uses and follows changes (light,
 * dark, accent). In a tab of its own the page's fallback colours apply.
 */
const TOKENS = [
  'bg-base', 'bg-layer-1', 'bg-layer-2', 'bg-layer-3', 'bg-overlay', 'bg-mask-1', 'bg-mask-2',
  'border-l1', 'border-l2', 'border-l3', 'label-primary', 'label-secondary', 'label-tertiary', 'label-caption', 'label-primary-inverted',
  'link', 'interactive-bg-hover', 'interactive-bg-active', 'interactive-bg-hover-danger', 'button-primary-fill', 'button-primary-hover',
  'state-error-primary', 'state-business-primary', 'brand-primary',
].map(name => `--dsw-alias-${name}`).concat(['--dsw-font-family'])

export function followShellTheme() {
  let shell
  try {
    shell = window.parent !== window ? window.parent.document : null
  } catch {
    shell = null
  }
  if (!shell) return false
  const copy = () => {
    const style = getComputedStyle(shell.body ?? shell.documentElement)
    for (const token of TOKENS) {
      const value = style.getPropertyValue(token).trim()
      if (value) document.documentElement.style.setProperty(token, value)
      else document.documentElement.style.removeProperty(token)
    }
    document.documentElement.style.colorScheme = getComputedStyle(shell.documentElement).colorScheme || ''
  }
  copy()
  const watch = new MutationObserver(copy)
  for (const node of [shell.documentElement, shell.body].filter(Boolean)) watch.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'] })
  shell.defaultView?.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', copy)
  return true
}
