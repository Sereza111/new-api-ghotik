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

import { useEffect, useState } from 'react'

export function useVisualEffectsReady() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (ready) return

    const enable = () => setReady(true)
    const passiveOptions: AddEventListenerOptions = {
      once: true,
      passive: true,
    }
    window.addEventListener('pointerdown', enable, passiveOptions)
    window.addEventListener('touchstart', enable, passiveOptions)
    window.addEventListener('wheel', enable, passiveOptions)
    window.addEventListener('keydown', enable, { once: true })

    return () => {
      window.removeEventListener('pointerdown', enable)
      window.removeEventListener('touchstart', enable)
      window.removeEventListener('wheel', enable)
      window.removeEventListener('keydown', enable)
    }
  }, [ready])

  return ready
}
