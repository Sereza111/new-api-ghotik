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
import { DownloadIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import type { GeneratedImage } from '../../types'

type GeneratedImageGridProps = {
  images: GeneratedImage[]
}

export function GeneratedImageGrid({ images }: GeneratedImageGridProps) {
  const { t } = useTranslation()

  return (
    <div className='grid w-full max-w-2xl gap-3 sm:grid-cols-2'>
      {images.map((image, index) => (
        <figure
          className='border-border/70 bg-muted/20 group/image relative aspect-square overflow-hidden rounded-md border'
          key={image.id}
        >
          <img
            alt={image.revisedPrompt || t('Generated image')}
            className='size-full object-contain'
            decoding='async'
            height={1024}
            src={image.src}
            width={1024}
          />
          <Button
            aria-label={t('Download image')}
            className='bg-background/85 text-foreground hover:bg-background absolute top-2 right-2 size-9 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover/image:opacity-100 focus-visible:opacity-100'
            render={
              <a
                download={`generated-image-${index + 1}.png`}
                href={image.src}
              />
            }
            size='icon'
            title={t('Download image')}
            variant='outline'
          >
            <DownloadIcon className='size-4' />
          </Button>
        </figure>
      ))}
    </div>
  )
}
