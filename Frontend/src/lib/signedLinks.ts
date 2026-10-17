import { api } from './api'
import { useToast } from './toast'

/**
 * Opens a stored file (a case file, a client's scan) in a new tab, through a link that works for a few minutes
 * (CLAUDE.md rule 4). `path` is the API call that makes the link. The tab is opened on the click itself, so popup
 * blockers allow it, and pointed at the file once the link arrives; if that fails, the blank tab closes again.
 */
export function useOpenSignedLink() {
  const toast = useToast()
  return (path: string) => {
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    api<{ url: string }>(path)
      .then(({ url }) => {
        if (tab) tab.location.href = url
        else window.location.href = url
      })
      .catch((err: unknown) => {
        tab?.close()
        toast({ tone: 'bad', message: err instanceof Error ? err.message : 'Couldn’t open the file. Please try again.' })
      })
  }
}
