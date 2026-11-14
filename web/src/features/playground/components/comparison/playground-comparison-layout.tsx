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
import { Columns2Icon, SquareIcon, XIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ModelGroupSelector } from '@/components/model-group-selector'
import { Button } from '@/components/ui/button'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'

import type { GroupOption, ModelOption } from '../../types'

type ComparisonLaneOptions = {
  title: string
  content: ReactNode
  model: string
  group: string
  models: ModelOption[]
  groups: GroupOption[]
  isLoading: boolean
  isGenerating: boolean
  onModelChange: (value: string) => void
  onGroupChange: (value: string) => void
  onStop: () => void
}

type PlaygroundComparisonLayoutProps = {
  enabled: boolean
  disabled?: boolean
  primary: ComparisonLaneOptions
  secondary: ComparisonLaneOptions
  onEnabledChange: (enabled: boolean) => void
  composer?: ReactNode
  empty?: boolean
}

function ComparisonLaneHeader({ lane }: { lane: ComparisonLaneOptions }) {
  const { t } = useTranslation()

  return (
    <div className='border-border/70 bg-background/85 flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3 backdrop-blur'>
      <span className='text-muted-foreground min-w-0 truncate text-xs font-medium'>
        {lane.title}
      </span>
      <div className='flex min-w-0 items-center gap-1.5'>
        <ModelGroupSelector
          selectedModel={lane.model}
          models={lane.models}
          onModelChange={lane.onModelChange}
          selectedGroup={lane.group}
          groups={lane.groups}
          onGroupChange={lane.onGroupChange}
          disabled={lane.isLoading || lane.isGenerating}
        />
        {lane.isGenerating && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={t('Stop')}
                    size='icon-sm'
                    variant='destructive'
                    onClick={lane.onStop}
                  >
                    <SquareIcon className='fill-current' />
                  </Button>
                }
              />
              <TooltipContent>{t('Stop')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  )
}

function ComparisonLane({ lane }: { lane: ComparisonLaneOptions }) {
  return (
    <div className='flex size-full min-h-0 flex-col overflow-hidden'>
      <ComparisonLaneHeader lane={lane} />
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        {lane.content}
      </div>
    </div>
  )
}

export function PlaygroundComparisonLayout({
  enabled,
  disabled = false,
  primary,
  secondary,
  onEnabledChange,
  composer,
  empty = false,
}: PlaygroundComparisonLayoutProps) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  let comparisonContent = primary.content

  if (enabled && isMobile) {
    comparisonContent = (
      <Tabs
        defaultValue='primary'
        className='min-h-0 flex-1 gap-0 overflow-hidden'
      >
        <TabsList className='mx-3 my-2 grid w-auto grid-cols-2'>
          <TabsTrigger value='primary'>{primary.title}</TabsTrigger>
          <TabsTrigger value='secondary'>{secondary.title}</TabsTrigger>
        </TabsList>
        <TabsContent
          value='primary'
          className='min-h-0 overflow-hidden data-[hidden]:hidden'
        >
          <ComparisonLane lane={primary} />
        </TabsContent>
        <TabsContent
          value='secondary'
          className='min-h-0 overflow-hidden data-[hidden]:hidden'
        >
          <ComparisonLane lane={secondary} />
        </TabsContent>
      </Tabs>
    )
  } else if (enabled) {
    comparisonContent = (
      <ResizablePanelGroup orientation='horizontal' className='min-h-0 flex-1'>
        <ResizablePanel defaultSize='50%' minSize='28%'>
          <ComparisonLane lane={primary} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize='50%' minSize='28%'>
          <ComparisonLane lane={secondary} />
        </ResizablePanel>
      </ResizablePanelGroup>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='playground-topbar flex h-12 shrink-0 items-center justify-end px-4'>
        <Button
          size='sm'
          variant={enabled ? 'secondary' : 'ghost'}
          className='rounded-full text-xs'
          disabled={disabled}
          onClick={() => onEnabledChange(!enabled)}
        >
          {enabled ? <XIcon /> : <Columns2Icon />}
          {enabled ? t('Exit comparison') : t('Compare models')}
        </Button>
      </div>

      <div
        className={
          empty && !enabled
            ? 'playground-empty-stage flex min-h-0 flex-1 flex-col justify-center overflow-y-auto'
            : 'flex min-h-0 flex-1 flex-col overflow-hidden'
        }
      >
        <div
          className={
            empty && !enabled
              ? 'min-h-0 shrink-0'
              : 'flex min-h-0 flex-1 flex-col overflow-hidden'
          }
        >
          {comparisonContent}
        </div>
        <div className='mx-auto w-full max-w-[56rem] shrink-0'>{composer}</div>
      </div>
    </div>
  )
}
