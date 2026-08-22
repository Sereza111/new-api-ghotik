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

const WHEEL_SPOKES = Array.from({ length: 16 }, (_, index) => index * 22.5)

export function FortuneWheel() {
  const { t } = useTranslation()

  return (
    <figure
      className='text-foreground relative mx-auto aspect-[4/5] w-full max-w-[25rem]'
      aria-label={t('Gothic Wheel of Fortune')}
    >
      <svg
        data-testid='fortune-wheel-frame'
        aria-hidden='true'
        className='absolute inset-0 size-full overflow-visible'
        viewBox='0 0 400 500'
        fill='none'
      >
        <g stroke='currentColor' strokeLinecap='round' strokeLinejoin='round'>
          <path
            d='M54 420c-4-86 3-186 28-257C106 95 146 52 200 16c54 36 94 79 118 147 25 71 32 171 28 257'
            strokeOpacity='.72'
            strokeWidth='1.5'
          />
          <path
            d='M72 418c-2-85 6-173 28-236 21-59 54-100 100-135 46 35 79 76 100 135 22 63 30 151 28 236'
            strokeOpacity='.25'
          />
          <path
            d='M200 29v61m-13-46 13-17 13 17m-25 17 12-13 12 13M200 410v48m-10-19 10 21 10-21'
            strokeWidth='1.5'
          />
          <path
            d='M173 91 200 69l27 22-13-3-14 14-14-14-13 3ZM171 395l29 21 29-21-15 3-14-13-14 13-15-3Z'
            fill='currentColor'
            fillOpacity='.12'
          />
          <path
            d='M94 121c-31 19-48 47-46 76 2 24 16 43 40 55-13-22-12-44 4-65 9-12 22-20 39-25-16-3-29-11-37-23-4-6-4-12 0-18Z'
            fill='currentColor'
            fillOpacity='.035'
          />
          <path
            d='M306 121c31 19 48 47 46 76-2 24-16 43-40 55 13-22 12-44-4-65-9-12-22-20-39-25 16-3 29-11 37-23 4-6 4-12 0-18Z'
            fill='currentColor'
            fillOpacity='.035'
          />
          <path
            d='M91 146c-19-3-35-16-43-35 20 1 37 10 50 27m-7 8c-16 7-29 20-37 39 21-2 38-12 51-29M309 146c19-3 35-16 43-35-20 1-37 10-50 27m7 8c16 7 29 20 37 39-21-2-38-12-51-29'
            strokeOpacity='.58'
          />
          <path
            d='M78 280c-27 7-45 27-48 53 16-7 27-18 34-33-1 18 4 34 15 48 13-21 15-44 6-68m237 0c27 7 45 27 48 53-16-7-27-18-34-33 1 18-4 34-15 48-13-21-15-44-6-68'
            fill='currentColor'
            fillOpacity='.04'
            strokeOpacity='.58'
          />
          <path
            d='M112 374c-24 20-38 45-40 74h53l-17-12 17-10-21-13 19-10-11-29Zm176 0c24 20 38 45 40 74h-53l17-12-17-10 21-13-19-10 11-29Z'
            strokeOpacity='.5'
          />
          <path
            d='M121 452c23 15 49 22 79 22s56-7 79-22c-10 29-36 43-79 43s-69-14-79-43Z'
            fill='var(--background)'
            strokeWidth='1.5'
          />
          <path d='M136 466c20 9 41 13 64 13s44-4 64-13' strokeOpacity='.45' />
          <circle cx='200' cy='239' r='143' strokeOpacity='.5' />
          <circle
            cx='200'
            cy='239'
            r='151'
            strokeDasharray='1 8'
            strokeOpacity='.35'
          />
        </g>

        <g className='text-primary' stroke='currentColor'>
          <path
            d='M200 10 229 52h-17l-12-17-12 17h-17l29-42ZM200 401c8 8 17 13 27 15-10 3-19 8-27 17-8-9-17-14-27-17 10-2 19-7 27-15Z'
            fill='currentColor'
            fillOpacity='.16'
          />
          <path
            d='M200 83c8 7 16 11 25 12-9 4-17 9-25 18-8-9-16-14-25-18 9-1 17-5 25-12Z'
            fill='currentColor'
          />
          <circle cx='200' cy='239' r='136' strokeWidth='1.5' />
          <path d='M51 239h20m258 0h20M200 88v18m0 266v18' />
        </g>

        <path
          d='M68 226c-19 2-32 12-39 30 16-3 29 0 39 10M332 226c19 2 32 12 39 30-16-3-29 0-39 10'
          stroke='currentColor'
          strokeOpacity='.45'
        />
        <text
          x='200'
          y='489'
          textAnchor='middle'
          fill='currentColor'
          fontFamily='serif'
          fontSize='11'
          letterSpacing='3'
        >
          VL · FORTUNA
        </text>
      </svg>

      <div
        data-testid='fortune-wheel-rotor'
        className='fortune-wheel-rotor absolute top-[21.5%] left-[17.5%] aspect-square w-[65%] motion-reduce:animate-none'
      >
        <svg aria-hidden='true' className='size-full' viewBox='0 0 260 260'>
          <circle
            cx='130'
            cy='130'
            r='125'
            fill='var(--background)'
            stroke='currentColor'
            strokeWidth='1.5'
          />
          <circle
            cx='130'
            cy='130'
            r='116'
            fill='none'
            stroke='currentColor'
            strokeDasharray='2 5'
            strokeOpacity='.32'
          />
          <circle
            cx='130'
            cy='130'
            r='101'
            fill='none'
            stroke='currentColor'
            strokeOpacity='.5'
          />
          {WHEEL_SPOKES.map((rotation) => (
            <g key={rotation} transform={`rotate(${rotation} 130 130)`}>
              <path
                d='M130 26 138 55 130 82 122 55 130 26Z'
                fill='currentColor'
                fillOpacity={rotation % 45 === 0 ? '.22' : '.06'}
                stroke='currentColor'
              />
              <path
                d='M130 17c3 4 6 6 10 7-4 1-7 3-10 7-3-4-6-6-10-7 4-1 7-3 10-7Z'
                className='text-primary'
                fill='currentColor'
                stroke='none'
              />
            </g>
          ))}
          <circle
            cx='130'
            cy='130'
            r='74'
            fill='none'
            stroke='currentColor'
            strokeOpacity='.35'
          />
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
            fillOpacity='.08'
            stroke='currentColor'
            strokeWidth='1.5'
          />
          <path
            d='M112 130c0-10 8-18 18-18s18 8 18 18-8 18-18 18-18-8-18-18Zm3-3h30m-15-15v36'
            className='text-primary'
            stroke='currentColor'
            strokeOpacity='.55'
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
