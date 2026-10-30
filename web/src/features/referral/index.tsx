import { Gift, Send, Share2, Users, WalletCards } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { TransferDialog } from '@/features/wallet/components/dialogs/transfer-dialog'
import { useAffiliate } from '@/features/wallet/hooks/use-affiliate'
import type { UserWalletData } from '@/features/wallet/types'
import { getSelf } from '@/lib/api'
import { formatQuota } from '@/lib/format'

export function Referral() {
  const { t } = useTranslation()
  const [user, setUser] = useState<UserWalletData | null>(null)
  const [userLoading, setUserLoading] = useState(true)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const { affiliateLink, loading, transferQuota, transferring } = useAffiliate()

  const fetchUser = useCallback(async () => {
    try {
      setUserLoading(true)
      const response = await getSelf()
      if (response.success && response.data) {
        setUser(response.data as UserWalletData)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch referral data:', error)
    } finally {
      setUserLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  const handleTransfer = async (amount: number) => {
    const success = await transferQuota(amount)
    if (success) await fetchUser()
    return success
  }

  const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(
    affiliateLink
  )}&text=${encodeURIComponent(t('Join through my referral link'))}`

  const stats = [
    {
      label: t('Invites'),
      value: String(user?.aff_count ?? 0),
      icon: Users,
    },
    {
      label: t('Pending'),
      value: formatQuota(user?.aff_quota ?? 0),
      icon: WalletCards,
    },
    {
      label: t('Total Earned'),
      value: formatQuota(user?.aff_history_quota ?? 0),
      icon: Gift,
    },
  ]

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Referral Program')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='mx-auto flex w-full max-w-6xl flex-col gap-6'>
            <div>
              <h2 className='font-serif text-2xl font-semibold'>
                {t('Invite users and earn rewards')}
              </h2>
              <p className='text-muted-foreground mt-1 max-w-2xl text-sm leading-6'>
                {t(
                  'Share your personal link. Rewards appear here automatically after invited users meet the current referral conditions.'
                )}
              </p>
            </div>

            <div className='grid gap-3 sm:grid-cols-3'>
              {stats.map((stat) => (
                <Card key={stat.label} data-card-hover='false'>
                  <CardContent className='flex items-center justify-between gap-4'>
                    <div>
                      <p className='text-muted-foreground text-xs font-medium uppercase'>
                        {stat.label}
                      </p>
                      {userLoading ? (
                        <Skeleton className='mt-2 h-7 w-20' />
                      ) : (
                        <p className='mt-1 text-2xl font-semibold tabular-nums'>
                          {stat.value}
                        </p>
                      )}
                    </div>
                    <stat.icon
                      className='text-primary size-5'
                      aria-hidden='true'
                    />
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card data-card-hover='false'>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <Share2 className='text-primary size-5' aria-hidden='true' />
                  {t('Your referral link')}
                </CardTitle>
                <CardDescription>
                  {t('Copy the link or send it directly in Telegram.')}
                </CardDescription>
              </CardHeader>
              <CardContent className='flex flex-col gap-3 sm:flex-row'>
                {loading ? (
                  <Skeleton className='h-10 flex-1' />
                ) : (
                  <Input
                    value={affiliateLink}
                    readOnly
                    aria-label={t('Your referral link')}
                    className='min-w-0 flex-1 font-mono text-xs'
                  />
                )}
                <div className='flex gap-2'>
                  <CopyButton
                    value={affiliateLink}
                    variant='outline'
                    className='h-10 flex-1 sm:flex-none'
                    tooltip={t('Copy referral link')}
                    aria-label={t('Copy referral link')}
                  />
                  <Button
                    variant='outline'
                    className='h-10 flex-1 gap-2 sm:flex-none'
                    disabled={!affiliateLink}
                    render={
                      <a
                        href={telegramShareUrl}
                        target='_blank'
                        rel='noopener noreferrer'
                      />
                    }
                  >
                    <Send aria-hidden='true' />
                    Telegram
                  </Button>
                </div>
              </CardContent>
            </Card>

            <section className='bg-border grid gap-px overflow-hidden rounded-md border sm:grid-cols-3'>
              {[
                [
                  '01',
                  t('Share your link'),
                  t('Send the personal registration link to a new user.'),
                ],
                [
                  '02',
                  t('Track invitations'),
                  t('Successful invitations and rewards update automatically.'),
                ],
                [
                  '03',
                  t('Use your rewards'),
                  t('Transfer available rewards to your main balance.'),
                ],
              ].map(([number, title, description]) => (
                <div key={number} className='bg-background min-h-36 p-5'>
                  <span className='text-primary font-mono text-xs'>
                    {number}
                  </span>
                  <h3 className='mt-5 font-serif text-base font-semibold'>
                    {title}
                  </h3>
                  <p className='text-muted-foreground mt-1 text-sm leading-6'>
                    {description}
                  </p>
                </div>
              ))}
            </section>

            {(user?.aff_quota ?? 0) > 0 ? (
              <div className='flex justify-end'>
                <Button onClick={() => setTransferDialogOpen(true)}>
                  {t('Transfer to Balance')}
                </Button>
              </div>
            ) : null}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <TransferDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        onConfirm={handleTransfer}
        availableQuota={user?.aff_quota ?? 0}
        transferring={transferring}
      />
    </>
  )
}
