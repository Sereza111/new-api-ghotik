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
  CodeIcon,
  DollarCircleIcon,
  GaugeIcon,
  GlobalIcon,
  HandshakeIcon,
  SecurityCheckIcon,
  UserGroupIcon,
  ZapIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'

interface FeaturesProps {
  className?: string
}

export function Features(_props: FeaturesProps) {
  const { t } = useTranslation()

  const features = [
    {
      id: 'fast',
      num: '01',
      title: t('Lightning Fast'),
      desc: t(
        'Optimized network architecture ensures millisecond response times'
      ),
      span: 'md:col-span-2',
      icon: <HugeiconsIcon icon={ZapIcon} className='text-primary size-4' />,
      visual: (
        <div className='mt-4 grid grid-cols-3 gap-2'>
          {['OpenAI', 'Claude', 'Gemini', 'DeepSeek', 'Qwen', 'Llama'].map(
            (name) => (
              <div
                key={name}
                className='border-border/50 bg-muted/20 text-muted-foreground hover:text-foreground hover:bg-muted/60 flex items-center justify-center border px-3 py-2 text-xs transition-colors duration-300'
              >
                {name}
              </div>
            )
          )}
        </div>
      ),
    },
    {
      id: 'secure',
      num: '02',
      title: t('Secure & Reliable'),
      desc: t(
        'Enterprise-grade security with comprehensive permission management'
      ),
      span: 'md:col-span-1',
      icon: (
        <HugeiconsIcon
          icon={SecurityCheckIcon}
          className='text-primary size-4'
        />
      ),
      visual: (
        <div className='mt-4 flex items-center justify-center'>
          <div className='relative'>
            <div className='border-border bg-muted/40 flex size-16 items-center justify-center border'>
              <HugeiconsIcon
                icon={SecurityCheckIcon}
                className='text-primary size-7'
              />
            </div>
            <div className='bg-primary text-primary-foreground absolute -top-1 -right-1 flex size-4 items-center justify-center'>
              <svg
                className='size-2.5 text-white'
                fill='none'
                viewBox='0 0 24 24'
                stroke='currentColor'
                strokeWidth={3}
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  d='m4.5 12.75 6 6 9-13.5'
                />
              </svg>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'global',
      num: '03',
      title: t('Global Coverage'),
      desc: t('Multi-region deployment for stable global access'),
      span: 'md:col-span-1',
      icon: <HugeiconsIcon icon={GlobalIcon} className='text-primary size-4' />,
      visual: (
        <div className='mt-4 space-y-2'>
          {[t('Load Balancing'), t('Rate Limiting'), t('Cost Tracking')].map(
            (step, i) => (
              <div key={step} className='flex items-center gap-2'>
                <div
                  className={`flex size-6 items-center justify-center rounded-full text-[10px] font-bold ${
                    i === 1
                      ? 'border-primary/30 bg-primary/10 text-primary border'
                      : 'border-border/40 bg-muted text-muted-foreground border'
                  }`}
                >
                  {i + 1}
                </div>
                <div className='bg-border/40 h-px flex-1' />
                <span className='text-muted-foreground text-xs'>{step}</span>
              </div>
            )
          )}
        </div>
      ),
    },
    {
      id: 'developer',
      num: '04',
      title: t('Developer Friendly'),
      desc: t('Compatible API routes for common AI application workflows'),
      span: 'md:col-span-2',
      icon: <HugeiconsIcon icon={CodeIcon} className='text-primary size-4' />,
      visual: (
        <div className='mt-4 flex items-center gap-3'>
          <div className='flex -space-x-2'>
            {['API', 'SDK', 'CLI', 'Docs'].map((n) => (
              <div
                key={n}
                className='border-background bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-full border-2 text-[9px] font-bold'
              >
                {n}
              </div>
            ))}
          </div>
          <div className='text-muted-foreground flex items-center gap-1.5 text-xs'>
            <HugeiconsIcon icon={CodeIcon} className='text-primary size-3.5' />
            {t('Multi-protocol Compatible')}
          </div>
        </div>
      ),
    },
  ]

  const additionalFeatures = [
    {
      icon: <HugeiconsIcon icon={GaugeIcon} className='size-5' />,
      title: t('High Performance'),
      desc: t('Support for high concurrency with automatic load balancing'),
    },
    {
      icon: <HugeiconsIcon icon={DollarCircleIcon} className='size-5' />,
      title: t('Transparent Billing'),
      desc: t('Pay-as-you-go with real-time usage monitoring'),
    },
    {
      icon: <HugeiconsIcon icon={UserGroupIcon} className='size-5' />,
      title: t('Team Collaboration'),
      desc: t('Multi-user management with flexible permission allocation'),
    },
    {
      icon: <HugeiconsIcon icon={HandshakeIcon} className='size-5' />,
      title: t('Open Source'),
      desc: t('Community driven, self-hosted, and extensible'),
    },
  ]

  return (
    <section className='relative z-10 px-6 py-24 md:py-32'>
      <div className='mx-auto max-w-6xl'>
        <AnimateInView className='mb-16 grid gap-4 md:grid-cols-[0.7fr_1.3fr] md:items-end'>
          <p className='text-muted-foreground mb-3 text-xs font-medium tracking-widest uppercase'>
            {t('Core Features')}
          </p>
          <h2 className='font-serif text-3xl leading-none font-semibold tracking-normal md:text-5xl'>
            {t('Built for developers,')} {t('designed for scale')}
          </h2>
        </AnimateInView>

        {/* Bento grid */}
        <div className='border-border/60 bg-border/60 grid gap-px overflow-hidden border md:grid-cols-3'>
          {features.map((f, i) => (
            <AnimateInView
              key={f.id}
              delay={i * 100}
              animation='scale-in'
              className={`bg-background group hover:bg-muted/20 p-7 transition-colors duration-300 md:p-8 ${f.span}`}
            >
              <div className='mb-3 flex items-center gap-3'>
                <span className='border-border bg-muted text-muted-foreground flex size-7 items-center justify-center border font-mono text-[10px] font-semibold tabular-nums'>
                  {f.num}
                </span>
                <h3 className='text-sm font-semibold'>{f.title}</h3>
              </div>
              <p className='text-muted-foreground text-sm leading-relaxed'>
                {f.desc}
              </p>
              {f.visual}
            </AnimateInView>
          ))}
        </div>

        {/* Additional features row */}
        <div className='border-border/60 mt-12 grid grid-cols-2 border-y md:grid-cols-4'>
          {additionalFeatures.map((f, i) => (
            <AnimateInView
              key={f.title}
              delay={i * 100}
              animation='fade-up'
              className='border-border/60 flex flex-col border-r p-6 text-left last:border-r-0 md:p-8'
            >
              <div className='text-muted-foreground mb-5 flex size-10 items-center justify-center'>
                {f.icon}
              </div>
              <h3 className='mb-1.5 text-sm font-semibold'>{f.title}</h3>
              <p className='text-muted-foreground mt-1.5 max-w-[200px] text-xs leading-relaxed'>
                {f.desc}
              </p>
            </AnimateInView>
          ))}
        </div>
      </div>
    </section>
  )
}
