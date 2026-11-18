/**
 * The person's devices: this one (rename, remove), the others, and devices
 * waiting to be added, which an added device can approve after comparing the
 * code the new one shows.
 */
import { t, when } from './i18n.js'
import { ask, confirmed, el, icon, sheet } from './ui.js'
import { forgetDevice } from './device.js'

export function openDevices(app) {
  const s = sheet({ title: t('devices'), small: true })
  const list = el('ul', { class: 'devices' })
  s.body.append(list)

  async function draw() {
    const devices = await app.op('devices')
    devices.sort((a, b) => Number(b.current) - Number(a.current) || (a.status === 'pending' ? -1 : 1) || b.created - a.created)
    list.replaceChildren(...devices.map(device => el('li', {},
      el('div', { class: 'what' },
        el('div', { text: device.current ? `${device.name} (${t('devices.this')})` : device.name }),
        el('div', { class: 'sub', text: device.status === 'pending' ? `${t('devices.pending')} · ${t('devices.code', { code: device.code })}` : (device.seenAt ? t('devices.seen', { when: when(device.seenAt) }) : t('devices.added', { when: when(device.created) })) })),
      device.status === 'pending' && el('button', { class: 'btn primary', onclick: async () => {
        if (!(await confirmed(t('devices.approveCheck', { name: device.name, code: device.code }), t('devices.approve')))) return
        await app.op('device.approve', { id: device.id })
        draw()
      } }, t('devices.approve')),
      device.current && el('button', { class: 'btn icon', title: t('rename'), 'aria-label': t('rename'), onclick: async () => {
        const name = await ask({ title: t('rename'), label: t('name'), value: device.name })
        if (name) { await app.op('device.rename', { id: device.id, name }); draw() }
      } }, icon('edit')),
      el('button', { class: 'btn icon danger', title: t('devices.remove'), 'aria-label': t('devices.remove'), onclick: async () => {
        if (!(await confirmed(t('devices.confirmRemove', { name: device.name }), t('devices.remove')))) return
        await app.op('device.remove', { id: device.id })
        if (device.current) { await forgetDevice(); location.reload(); return }
        draw()
      } }, icon('trash')))))
  }
  draw().catch(() => {})
}
