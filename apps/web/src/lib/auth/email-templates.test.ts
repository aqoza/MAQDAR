import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '../../../../..')
const directory = path.join(root, 'supabase/templates')
const config = await readFile(path.join(root, 'supabase/config.toml'), 'utf8')
const content = JSON.parse(await readFile(path.join(directory, 'content.en.json'), 'utf8')) as {
  templates: { file: string; slots?: string[]; notification?: string; subject: string }[]
}

describe('transactional email delivery contracts', () => {
  it('keeps all generated emails in sync with the shared shell and copy', async () => {
    await promisify(execFile)(process.execPath, ['scripts/render-email-templates.mjs', '--check'], {
      cwd: root,
    })
  }, 15_000)

  it('covers every Auth slot and preserves disabled security notifications', async () => {
    expect(content.templates.flatMap((email) => email.slots ?? []).sort()).toEqual(
      [
        'confirmation',
        'email_change',
        'invite',
        'magic_link',
        'reauthentication',
        'recovery',
      ].sort(),
    )
    expect(content.templates.filter((email) => email.notification)).toHaveLength(7)
    for (const email of content.templates) {
      for (const slot of email.slots ?? [email.notification!]) {
        const section = `auth.email.${email.notification ? 'notification' : 'template'}.${slot}`
        const block = config.split(`[${section}]`)[1]?.split('\n[')[0]
        expect(block, section).toContain(`content_path = "./supabase/templates/${email.file}"`)
        expect(block, section).toContain(`subject = "${email.subject}"`)
        if (email.notification) expect(block).toContain('enabled = false')
      }
      const html = await readFile(path.join(directory, email.file), 'utf8')
      // Auth placeholders may only appear in the expected link, code or public logo contexts.
      expect(html).not.toMatch(/<script|<iframe|<form|\.Data\b|data:image|<svg/i)
      expect([...html.matchAll(/src="([^"]+)"/g)].map((match) => match[1])).toEqual([
        '{{ .SiteURL }}/images/email/zeespare-precision-reversed.png',
      ])
    }
  })

  it.each([
    ['invite.html', '{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=invite'],
    ['sign-in-link.html', '{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=email'],
    ['recovery.html', '{{ .RedirectTo }}?token_hash={{ .TokenHash }}'],
    ['email-change.html', '{{ .ConfirmationURL }}'],
  ])('preserves the primary and fallback security link in %s', async (file, href) => {
    const html = await readFile(path.join(directory, file), 'utf8')
    expect([...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1])).toEqual([href, href])
  })

  it('keeps verification codes in text, outside links and image URLs', async () => {
    const html = await readFile(path.join(directory, 'reauthentication.html'), 'utf8')
    expect(html).toContain('{{ .Token }}')
    expect(html).not.toContain('href=')
    expect(html).not.toMatch(/(?:src|href)="[^"]*\.Token/)
    expect(config).toContain('double_confirm_changes = true')
    expect(config).toContain('secure_password_change = false')
  })
})
