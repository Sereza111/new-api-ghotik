import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  BookOpen,
  Braces,
  CheckCircle2,
  Code2,
  KeyRound,
  MonitorCog,
  Terminal,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { PublicLayout } from '@/components/layout/components/public-layout'
import { PageTransition } from '@/components/page-transition'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const CLIENTS = ['codex', 'cursor', 'openai-sdk', 'curl'] as const

type Client = (typeof CLIENTS)[number]

const CLIENT_LABELS: Record<Client, string> = {
  codex: 'Codex CLI',
  cursor: 'Cursor',
  'openai-sdk': 'OpenAI SDK',
  curl: 'cURL',
}

export function Docs() {
  const { t } = useTranslation()
  const [client, setClient] = useState<Client>('codex')
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const baseUrl = `${origin}/v1`

  const clientGuides: Record<
    Client,
    { steps: string[]; filename: string; snippet: string }
  > = {
    codex: {
      filename: '~/.codex/config.toml',
      steps: [
        t('Create an API key in the console.'),
        t('Set the VL_API_KEY environment variable to your key.'),
        t('Add the provider configuration to ~/.codex/config.toml.'),
        t('Start Codex and send a test prompt.'),
      ],
      snippet: `model = "gpt-5.6-sol"
model_provider = "vl"

[model_providers.vl]
name = "VL API"
base_url = "${baseUrl}"
env_key = "VL_API_KEY"
wire_api = "responses"`,
    },
    cursor: {
      filename: 'Cursor Settings',
      steps: [
        t('Create an API key in the console.'),
        t('Open the model provider settings in Cursor.'),
        t('Enter the API key and the base URL shown below.'),
        t('Select an available model and send a test prompt.'),
      ],
      snippet: `${t('Base URL')}: ${baseUrl}
${t('API key')}: sk-your-key
${t('Model')}: gpt-5.6-sol`,
    },
    'openai-sdk': {
      filename: 'example.py',
      steps: [
        t('Install the official OpenAI SDK.'),
        t('Create an API key in the console.'),
        t('Use the key and base URL in the client configuration.'),
        t('Run the example and verify the response.'),
      ],
      snippet: `from openai import OpenAI

client = OpenAI(
    api_key="sk-your-key",
    base_url="${baseUrl}",
)

response = client.responses.create(
    model="gpt-5.6-sol",
    input="Hello",
)
print(response.output_text)`,
    },
    curl: {
      filename: 'Terminal',
      steps: [
        t('Create an API key in the console.'),
        t('Replace sk-your-key in the request below.'),
        t('Choose a model from the model catalog.'),
        t('Run the command in your terminal.'),
      ],
      snippet: `curl ${baseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-key" \\
  -d '{"model":"gpt-5.6-sol","messages":[{"role":"user","content":"Hello"}]}'`,
    },
  }

  const selectedGuide = clientGuides[client]

  return (
    <PublicLayout showMainContainer={false}>
      <PageTransition className='mx-auto flex w-full max-w-7xl flex-col px-4 pt-24 pb-16 sm:px-6 lg:px-8'>
        <header className='max-w-3xl border-b pb-10'>
          <Badge variant='outline' className='gap-1.5'>
            <BookOpen data-icon='inline-start' />
            {t('API Documentation')}
          </Badge>
          <h1 className='mt-5 font-serif text-4xl font-semibold sm:text-5xl'>
            {t('Connect your application')}
          </h1>
          <p className='text-muted-foreground mt-4 max-w-2xl text-base leading-7'>
            {t(
              'Choose your client and follow a short setup path with the correct base URL and a ready-to-use example.'
            )}
          </p>
        </header>

        <section className='grid border-b py-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12'>
          <nav aria-label={t('Applications')} className='mb-6 lg:mb-0'>
            <p className='text-muted-foreground mb-3 text-xs font-medium uppercase'>
              {t('Applications')}
            </p>
            <div className='flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible'>
              {CLIENTS.map((item) => (
                <button
                  key={item}
                  type='button'
                  onClick={() => setClient(item)}
                  aria-pressed={client === item}
                  className={cn(
                    'hover:bg-muted focus-visible:ring-ring flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none lg:w-full',
                    client === item
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground'
                  )}
                >
                  <Terminal className='size-4' aria-hidden='true' />
                  {CLIENT_LABELS[item]}
                </button>
              ))}
            </div>
          </nav>

          <div className='min-w-0'>
            <div className='flex flex-col justify-between gap-3 sm:flex-row sm:items-end'>
              <div>
                <h2 className='font-serif text-2xl font-semibold'>
                  {CLIENT_LABELS[client]}
                </h2>
                <p className='text-muted-foreground mt-1 text-sm'>
                  {t(
                    'Use the OpenAI-compatible endpoint with your VL API key.'
                  )}
                </p>
              </div>
              <Badge variant='outline' className='w-fit font-mono font-normal'>
                {baseUrl}
              </Badge>
            </div>

            <div className='mt-7 grid gap-8 xl:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.3fr)]'>
              <div>
                <h3 className='text-sm font-semibold'>{t('Setup steps')}</h3>
                <ol className='mt-4 space-y-4'>
                  {selectedGuide.steps.map((step, index) => (
                    <li key={step} className='flex gap-3 text-sm leading-6'>
                      <span className='border-border text-primary grid size-7 shrink-0 place-items-center rounded-full border font-mono text-xs'>
                        {index + 1}
                      </span>
                      <span className='pt-0.5'>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className='min-w-0'>
                <div className='bg-card flex items-center justify-between rounded-t-md border border-b-0 px-4 py-2.5'>
                  <span className='text-muted-foreground font-mono text-xs'>
                    {selectedGuide.filename}
                  </span>
                  <CopyButton
                    value={selectedGuide.snippet}
                    tooltip={t('Copy configuration')}
                    aria-label={t('Copy configuration')}
                  />
                </div>
                <div className='bg-card overflow-x-auto rounded-b-md border p-4'>
                  <pre className='min-h-52 font-mono text-xs leading-6 whitespace-pre'>
                    <code>{selectedGuide.snippet}</code>
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className='py-10'>
          <p className='text-primary text-xs font-medium uppercase'>
            {t('Configuration')}
          </p>
          <h2 className='mt-3 max-w-2xl font-serif text-3xl font-semibold'>
            {t('One endpoint, a predictable setup')}
          </h2>
          <div className='mt-8 divide-y border-y'>
            {[
              {
                icon: KeyRound,
                title: t('One key for all models'),
                description: t(
                  'Create one key and use it with every model allowed for its group.'
                ),
              },
              {
                icon: Braces,
                title: t('Compatible API formats'),
                description: t(
                  'Use Chat Completions, Responses, embeddings, and image generation endpoints.'
                ),
              },
              {
                icon: CheckCircle2,
                title: t('Verify before launch'),
                description: t(
                  'Check the model catalog and run a small test request before production traffic.'
                ),
              },
            ].map((item) => (
              <div
                key={item.title}
                className='grid gap-4 py-6 md:grid-cols-[3rem_18rem_minmax(0,1fr)] md:items-center'
              >
                <div className='border-border grid size-10 place-items-center rounded-md border'>
                  <item.icon className='size-4' aria-hidden='true' />
                </div>
                <h3 className='font-serif text-lg font-semibold'>
                  {item.title}
                </h3>
                <p className='text-muted-foreground max-w-2xl text-sm leading-6'>
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className='flex flex-col items-start justify-between gap-5 border-t pt-8 sm:flex-row sm:items-center'>
          <div>
            <h2 className='font-serif text-xl font-semibold'>
              {t('Ready to connect?')}
            </h2>
            <p className='text-muted-foreground mt-1 text-sm'>
              {t('Create a key, choose a model, and start sending requests.')}
            </p>
          </div>
          <div className='flex gap-2'>
            <Button variant='outline' render={<Link to='/pricing' />}>
              <MonitorCog data-icon='inline-start' />
              {t('Models')}
            </Button>
            <Button render={<Link to='/keys' />}>
              <Code2 data-icon='inline-start' />
              {t('Create API Key')}
              <ArrowRight data-icon='inline-end' />
            </Button>
          </div>
        </section>
      </PageTransition>
    </PublicLayout>
  )
}
