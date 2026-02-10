import { createClient } from '@/utils/supabase/server'

export default async function TestPage() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('profiles').select('*')

  return (
    <div style={{ padding: '50px', fontFamily: 'sans-serif' }}>
      <h1>🤖 Supabase Connection Test (Next.js 15)</h1>
      {error ? (
        <div style={{ color: 'red', border: '1px solid red', padding: '20px', borderRadius: '8px', background: '#fff0f0' }}>
          <h3>Error Message:</h3>
          <code style={{ fontSize: '1.2em' }}>{error.message}</code>
          <p style={{ marginTop: '15px' }}>
            ℹ️ If the message says <strong>relation &quot;public.profiles&quot; does not exist</strong> — CONGRATS! 
            It means the connection is PERFECT, we just haven&apos;t created the table yet.
          </p>
        </div>
      ) : (
        <div style={{ color: 'green', border: '1px solid green', padding: '20px', borderRadius: '8px', background: '#f0fff4' }}>
          <h2>✅ Success! Connected to Database.</h2>
          <p>Rows found: {data?.length}</p>
        </div>
      )}
    </div>
  )
}
