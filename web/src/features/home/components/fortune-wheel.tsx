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
import { useTranslation } from 'react-i18next'

const WHEEL_SPOKES = Array.from({ length: 12 }, (_, index) => index * 30)

export function FortuneWheel() {
  const { t } = useTranslation()

  return (
    <figure
      className='text-primary relative mx-auto aspect-[4/5] w-full max-w-[25rem]'
      aria-label={t('Gothic Wheel of Fortune')}
    >
      <svg
        aria-hidden='true'
        className='absolute inset-0 size-full overflow-visible'
        viewBox='0 0 400 500'
        fill='none'
      >
        <path
          d='M200 18 247 74h-24l-23-28-23 28h-24l47-56Z'
          fill='currentColor'
          fillOpacity='.13'
          stroke='currentColor'
          strokeWidth='1.5'
        />
        <path
          d='M200 34v44M82 403 42 450h76l-36-47Zm236 0 40 47h-76l36-47Z'
          stroke='currentColor'
          strokeWidth='2'
        />
        <path
          d='M112 93C51 141 35 226 58 303c15 49 41 84 78 112M288 93c61 48 77 133 54 210-15 49-41 84-78 112'
          stroke='currentColor'
          strokeOpacity='.65'
          strokeWidth='1.5'
        />
        <path
          d='M91 107c-18 49-20 95-7 138 11 37 30 70 57 98M309 107c18 49 20 95 7 138-11 37-30 70-57 98'
          stroke='currentColor'
          strokeOpacity='.3'
        />
        <path
          d='M66 170c-18-2-31-15-33-33 18 2 31 15 33 33Zm268 0c18-2 31-15 33-33-18 2-31 15-33 33ZM83 329c-17 5-29 21-27 39 17-5 29-21 27-39Zm234 0c17 5 29 21 27 39-17-5-29-21-27-39Z'
          fill='currentColor'
          fillOpacity='.16'
          stroke='currentColor'
        />
        <circle cx='200' cy='242' r='132' stroke='currentColor' />
        <circle
          cx='200'
          cy='242'
          r='144'
          stroke='currentColor'
          strokeDasharray='2 9'
          strokeOpacity='.48'
        />
        <path
          d='M200 82c9 8 18 12 28 12-10 7-19 11-28 20-9-9-18-13-28-20 10 0 19-4 28-12Z'
          fill='currentColor'
        />
        <path
          d='M200 402c9-8 18-12 28-12-10-7-19-11-28-20-9 9-18 13-28 20 10 0 19 4 28 12Z'
          fill='currentColor'
        />
        <text
          x='200'
          y='486'
          textAnchor='middle'
          fill='currentColor'
          fontFamily='serif'
          fontSize='13'
        >
          VL · API · FORTUNA
        </text>
      </svg>

      <div
        data-testid='fortune-wheel-rotor'
        className='fortune-wheel-rotor absolute top-[22%] left-[17.5%] aspect-square w-[65%] motion-reduce:animate-none'
      >
        <svg aria-hidden='true' className='size-full' viewBox='0 0 260 260'>
          <circle
            cx='130'
            cy='130'
            r='125'
            fill='var(--background)'
            stroke='currentColor'
            strokeWidth='2'
          />
          <circle
            cx='130'
            cy='130'
            r='105'
            fill='none'
            stroke='currentColor'
            strokeOpacity='.5'
          />
          {WHEEL_SPOKES.map((rotation) => (
            <g key={rotation} transform={`rotate(${rotation} 130 130)`}>
              <path
                d='M130 25 139 57 130 83 121 57 130 25Z'
                fill='currentColor'
                fillOpacity={rotation % 60 === 0 ? '.32' : '.12'}
                stroke='currentColor'
              />
              <circle cx='130' cy='18' r='3' fill='currentColor' />
            </g>
          ))}
          <circle
            cx='130'
            cy='130'
            r='53'
            fill='var(--background)'
            stroke='currentColor'
            strokeWidth='2'
          />
          <path
            d='m130 91 10 24 26 2-20 17 6 26-22-14-22 14 6-26-20-17 26-2 10-24Z'
            fill='currentColor'
            fillOpacity='.2'
            stroke='currentColor'
            strokeWidth='1.5'
          />
          <text
            x='130'
            y='137'
            textAnchor='middle'
            fill='currentColor'
            fontFamily='serif'
            fontSize='25'
            fontWeight='700'
          >
            VL
          </text>
        </svg>
      </div>
    </figure>
  )
}
