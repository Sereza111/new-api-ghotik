/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import {
  Cloud,
  CloudOff,
  History,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import type { PlaygroundSessionSummary } from '../../types'

type SaveStatus = 'saved' | 'saving' | 'error'

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === 'saving') {
    return <Loader2 className='size-3 animate-spin' />
  }
  if (status === 'error') {
    return <CloudOff className='text-destructive size-3' />
  }
  return <Cloud className='size-3' />
}

interface PlaygroundSessionNavigationProps {
  sessions: PlaygroundSessionSummary[]
  activeSessionId: string | null
  isLoading: boolean
  isError: boolean
  busy: boolean
  generationActive: boolean
  saveStatus: SaveStatus
  onCreate: () => Promise<void>
  onSelect: (id: string) => Promise<void>
  onRename: (id: string, title: string) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
  onRetry: () => void
}

function SessionList({
  sessions,
  activeSessionId,
  isLoading,
  isError,
  busy,
  generationActive,
  onSelect,
  onRenameRequest,
  onDeleteRequest,
  onRetry,
}: Omit<
  PlaygroundSessionNavigationProps,
  'saveStatus' | 'onCreate' | 'onRename' | 'onDelete'
> & {
  onRenameRequest: (session: PlaygroundSessionSummary) => void
  onDeleteRequest: (session: PlaygroundSessionSummary) => void
}) {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className='space-y-2 p-2' aria-label={t('Loading chats')}>
        <Skeleton className='h-14 w-full' />
        <Skeleton className='h-14 w-full' />
        <Skeleton className='h-14 w-full' />
      </div>
    )
  }

  if (isError) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 px-5 text-center'>
        <CloudOff className='text-muted-foreground size-5' />
        <p className='text-muted-foreground text-sm'>
          {t('Unable to load chats')}
        </p>
        <Button type='button' variant='outline' size='sm' onClick={onRetry}>
          {t('Retry')}
        </Button>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-2 px-5 text-center'>
        <MessageSquare className='text-muted-foreground size-5' />
        <p className='text-muted-foreground text-sm'>{t('No saved chats')}</p>
      </div>
    )
  }

  return (
    <div className='space-y-1 p-2'>
      {sessions.map((session) => {
        const active = session.id === activeSessionId
        const disabled = busy || generationActive
        return (
          <div
            key={session.id}
            className={cn(
              'group flex min-h-14 items-center rounded-md border border-transparent px-1 transition-colors',
              active ? 'bg-muted border-border' : 'hover:bg-muted/60'
            )}
          >
            <button
              type='button'
              className='focus-visible:ring-ring/40 min-w-0 flex-1 px-2 py-2 text-left outline-none focus-visible:ring-2 disabled:cursor-not-allowed'
              disabled={disabled || active}
              aria-current={active ? 'page' : undefined}
              onClick={() => void onSelect(session.id)}
            >
              <span className='block truncate text-sm font-medium'>
                {session.title || t('New chat')}
              </span>
              <span className='text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1 text-xs'>
                <span className='truncate'>
                  {session.model || t('No model')}
                </span>
                <span aria-hidden='true'>·</span>
                <span className='shrink-0'>
                  {t('Messages: {{count}}', { count: session.message_count })}
                </span>
              </span>
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={disabled}
                render={
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('Chat actions')}
                    className='opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100'
                  />
                }
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-36'>
                <DropdownMenuItem onClick={() => onRenameRequest(session)}>
                  <Pencil />
                  {t('Rename')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant='destructive'
                  onClick={() => onDeleteRequest(session)}
                >
                  <Trash2 />
                  {t('Delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      })}
    </div>
  )
}

export function PlaygroundSessionNavigation({
  sessions,
  activeSessionId,
  isLoading,
  isError,
  busy,
  generationActive,
  saveStatus,
  onCreate,
  onSelect,
  onRename,
  onDelete,
  onRetry,
}: PlaygroundSessionNavigationProps) {
  const { t } = useTranslation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [renameTarget, setRenameTarget] =
    useState<PlaygroundSessionSummary | null>(null)
  const [deleteTarget, setDeleteTarget] =
    useState<PlaygroundSessionSummary | null>(null)
  const [renameTitle, setRenameTitle] = useState('')

  const actionsDisabled = busy || generationActive
  const saveLabel = useMemo(() => {
    if (saveStatus === 'saving') return t('Saving...')
    if (saveStatus === 'error') return t('Save failed')
    return t('Saved')
  }, [saveStatus, t])

  const sessionListProps = {
    sessions,
    activeSessionId,
    isLoading,
    isError,
    busy,
    generationActive,
    onSelect: async (id: string) => {
      setMobileOpen(false)
      await onSelect(id)
    },
    onRenameRequest: (session: PlaygroundSessionSummary) => {
      setRenameTarget(session)
      setRenameTitle(session.title)
    },
    onDeleteRequest: setDeleteTarget,
    onRetry,
  }

  const header = (
    <div className='flex h-12 shrink-0 items-center justify-between border-b px-3'>
      <div className='flex min-w-0 items-center gap-2'>
        <History className='text-muted-foreground size-4' />
        <span className='truncate text-sm font-medium'>{t('Chats')}</span>
      </div>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                disabled={actionsDisabled}
                aria-label={t('New chat')}
                onClick={() => {
                  setMobileOpen(false)
                  void onCreate()
                }}
              />
            }
          >
            {busy ? <Loader2 className='animate-spin' /> : <Plus />}
          </TooltipTrigger>
          <TooltipContent>{t('New chat')}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )

  return (
    <>
      <aside className='bg-background hidden h-full w-68 shrink-0 flex-col border-r md:flex'>
        {header}
        <ScrollArea className='min-h-0 flex-1'>
          <SessionList {...sessionListProps} />
        </ScrollArea>
        <div className='text-muted-foreground flex h-9 shrink-0 items-center gap-1.5 border-t px-3 text-xs'>
          <SaveStatusIndicator status={saveStatus} />
          {saveLabel}
        </div>
      </aside>

      <div className='flex h-11 shrink-0 items-center justify-between border-b px-3 md:hidden'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={() => setMobileOpen(true)}
        >
          <History data-icon='inline-start' />
          {t('Chats')}
        </Button>
        <div className='text-muted-foreground flex items-center gap-1.5 text-xs'>
          <SaveStatusIndicator status={saveStatus} />
          {saveLabel}
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side='left' className='w-[min(88vw,20rem)] gap-0'>
          <SheetHeader className='sr-only'>
            <SheetTitle>{t('Chats')}</SheetTitle>
            <SheetDescription>
              {t('Your saved playground chats')}
            </SheetDescription>
          </SheetHeader>
          {header}
          <ScrollArea className='min-h-0 flex-1'>
            <SessionList {...sessionListProps} />
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
        title={t('Rename chat')}
        contentClassName='sm:max-w-md'
        footer={
          <>
            <Button variant='outline' onClick={() => setRenameTarget(null)}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={!renameTitle.trim() || busy}
              onClick={async () => {
                if (!renameTarget) return
                if (await onRename(renameTarget.id, renameTitle)) {
                  setRenameTarget(null)
                }
              }}
            >
              {busy ? <Loader2 className='animate-spin' /> : null}
              {t('Rename')}
            </Button>
          </>
        }
      >
        <Input
          value={renameTitle}
          maxLength={120}
          autoComplete='off'
          aria-label={t('Chat name')}
          onChange={(event) => setRenameTitle(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              renameTarget &&
              renameTitle.trim() &&
              !busy
            ) {
              event.preventDefault()
              void onRename(renameTarget.id, renameTitle).then((renamed) => {
                if (renamed) setRenameTarget(null)
              })
            }
          }}
        />
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('Delete chat?')}
        desc={t('This chat and its messages will be permanently deleted.')}
        destructive
        disabled={busy}
        isLoading={busy}
        confirmText={t('Delete')}
        handleConfirm={() => {
          if (!deleteTarget) return
          void onDelete(deleteTarget.id).then((deleted) => {
            if (deleted) setDeleteTarget(null)
          })
        }}
      />
    </>
  )
}
