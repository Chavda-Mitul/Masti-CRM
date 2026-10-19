import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { applyServerIssues, isStale } from '../../../../lib/apiErrors'
import { useToast } from '../../../../lib/toast'
import { MasterDrawer } from '../lists/MasterDrawer'
import { useUpdateCoveringLetter } from '../queries'
import { coveringLetterFormSchema, type CoveringLetterFormValues } from '../schemas'
import type { CoveringLetter } from '../types'
import { DETAILS_FIELDS, detailsBody, detailsDefaults } from './forms'
import { LetterDetailsFields } from './LetterDetailsFields'

/**
 * Edit details: the name, the visa type, the countries, who travels. They change at once; only the wording is dated. If
 * someone else changed the letter meanwhile, the latest is loaded, the user is told and the drawer closes.
 */
export function DetailsDrawer({ letter, onClose }: { letter: CoveringLetter; onClose: () => void }) {
  const toast = useToast()
  const save = useUpdateCoveringLetter()
  // The version this drawer opened on, even if the page reloads behind it.
  const [openedAt] = useState(letter.updatedAt)
  const form = useForm<CoveringLetterFormValues>({ resolver: zodResolver(coveringLetterFormSchema), defaultValues: detailsDefaults(letter) })

  const onSubmit = form.handleSubmit((values) =>
    save.mutate(
      { id: letter.id, body: { ...detailsBody(values), updatedAt: openedAt } },
      {
        onSuccess: (saved) => {
          toast({ tone: 'ok', message: `${saved.name} saved.` })
          onClose()
        },
        onError: (err) => {
          if (isStale(err)) return onClose()
          applyServerIssues(err, form.setError, DETAILS_FIELDS)
        },
      },
    ),
  )

  return (
    <MasterDrawer
      title={`Edit ${letter.name}`}
      intro="Which cases this letter fits. Changes apply at once; the wording keeps its own dates."
      submitLabel="Save changes"
      pending={save.isPending}
      error={save.error}
      dirty={form.formState.isDirty}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <LetterDetailsFields form={form} letter={letter} />
    </MasterDrawer>
  )
}
