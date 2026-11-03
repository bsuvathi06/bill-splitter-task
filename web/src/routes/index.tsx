import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createFileRoute('/')({
  component: DashboardComponent,
})

interface Share {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}

interface Bill {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}

interface Balance {
  memberId: string
  name: string
  outstandingCents: number
}

function DashboardComponent() {
  const [homeId, setHomeId] = useState<string>('')
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])

  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [homeNameInput, setHomeNameInput] = useState('')
  const [memberNameInput, setMemberNameInput] = useState('')
  const [billTitleInput, setBillTitleInput] = useState('')
  const [billAmountInput, setBillAmountInput] = useState('')

  const refreshLedgerData = async (targetHomeId: string) => {
    if (!targetHomeId) return
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const resBal = await fetch(`/api/homes/${targetHomeId}/balances`)
      if (!resBal.ok) throw new Error('Could not pull latest balances')
      const dataBal = (await resBal.json()) as { balances: Balance[] }
      setBalances(dataBal.balances)
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'A network anomaly occurred.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateHome = async (e: React.FormEvent) => {
    e.preventDefault()
    setActionError(null)
    try {
      const res = await fetch('/api/homes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: homeNameInput }),
      })
      if (!res.ok) throw new Error()
      const data = (await res.json()) as { id: string }
      setHomeId(data.id)
      setHomeNameInput('')
      refreshLedgerData(data.id)
    } catch {
      setActionError('Failed to establish a new household workspace.')
    }
  }

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!homeId) return
    setActionError(null)
    try {
      const res = await fetch(`/api/homes/${homeId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: memberNameInput }),
      })
      if (!res.ok) throw new Error()
      setMemberNameInput('')
      refreshLedgerData(homeId)
    } catch {
      setActionError('Could not append resident profiles.')
    }
  }

  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!homeId) return
    setActionError(null)
    try {
      const parsedCents = Math.round(parseFloat(billAmountInput) * 100)
      const res = await fetch(`/api/homes/${homeId}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: billTitleInput, totalCents: parsedCents }),
      })

      if (!res.ok) {
        const errorData = (await res.json()) as { error: string }
        throw new Error(errorData.error || 'Submission failed')
      }

      const newBill = (await res.json()) as Bill
      setBills((prev) => [...prev, newBill])
      setBillTitleInput('')
      setBillAmountInput('')
      refreshLedgerData(homeId)
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Invalid parameters provided.')
    }
  }

  const handlePayShare = async (billId: string, shareId: string) => {
    setActionError(null)
    try {
      const res = await fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
      })

      if (!res.ok) {
        const errorData = (await res.json()) as { error: string }
        throw new Error(errorData.error || 'Payment execution dropped')
      }

      const updatedShare = (await res.json()) as Share

      setBills((prevBills) =>
        prevBills.map((b) => {
          if (b.id !== billId) return b
          return {
            ...b,
            shares: b.shares.map((s) => (s.id === shareId ? updatedShare : s)),
          }
        }),
      )
      refreshLedgerData(homeId)
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Unable to complete network settlement.')
    }
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <h1>🏡 Shared Household Ledger</h1>

      {(errorMessage || actionError) && (
        <div
          style={{
            backgroundColor: '#fee2e2',
            color: '#dc2626',
            padding: '1rem',
            borderRadius: '6px',
            marginBottom: '1rem',
          }}
        >
          <strong>Error Status Signal:</strong> {actionError || errorMessage}
        </div>
      )}

      {!homeId ? (
        <div style={{ border: '1px solid #e5e7eb', padding: '1.5rem', borderRadius: '8px' }}>
          <h3>Initialize Shared Environment Workspace</h3>
          <form onSubmit={handleCreateHome}>
            <input
              type="text"
              placeholder="e.g., Green Valley Apartment"
              value={homeNameInput}
              onChange={(e) => setHomeNameInput(e.target.value)}
              required
              style={{ padding: '0.5rem', marginRight: '0.5rem', width: '250px' }}
            />
            <button type="submit" style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}>
              Create Space
            </button>
          </form>
        </div>
      ) : (
        <div>
          <div
            style={{
              backgroundColor: '#f3f4f6',
              padding: '1rem',
              borderRadius: '6px',
              marginBottom: '1.5rem',
            }}
          >
            <strong>Active Home Context ID:</strong>{' '}
            <code style={{ color: '#2563eb' }}>{homeId}</code>
          </div>

          <section style={{ marginBottom: '2rem' }}>
            <h3>Group Member Directory</h3>
            <form onSubmit={handleAddMember} style={{ marginBottom: '1rem' }}>
              <input
                type="text"
                placeholder="Name (e.g. Suvathi)"
                value={memberNameInput}
                onChange={(e) => setMemberNameInput(e.target.value)}
                required
                style={{ padding: '0.5rem', marginRight: '0.5rem' }}
              />
              <button type="submit" style={{ padding: '0.5rem 1rem' }}>
                Add Inhabitant
              </button>
            </form>

            <h4>Outstanding Financial Balances</h4>
            {balances.length === 0 ? (
              <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
                No registered occupants found.
              </p>
            ) : (
              <ul>
                {balances.map((b) => (
                  <li key={b.memberId}>
                    <strong>{b.name}</strong>: ${(b.outstandingCents / 100).toFixed(2)} outstanding
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            style={{ marginBottom: '2rem', borderTop: '1px solid #e5e7eb', paddingTop: '1rem' }}
          >
            <h3>Invoice Postings</h3>
            <form
              onSubmit={handleCreateBill}
              style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}
            >
              <input
                type="text"
                placeholder="Bill Title (e.g., Fiber WiFi)"
                value={billTitleInput}
                onChange={(e) => setBillTitleInput(e.target.value)}
                required
                style={{ padding: '0.5rem' }}
              />
              <input
                type="number"
                step="0.01"
                placeholder="Total Value ($)"
                value={billAmountInput}
                onChange={(e) => setBillAmountInput(e.target.value)}
                required
                style={{ padding: '0.5rem', width: '120px' }}
              />
              <button type="submit" style={{ padding: '0.5rem 1rem' }}>
                Post & Split Expense
              </button>
            </form>

            {isLoading ? (
              <div style={{ padding: '1rem', fontStyle: 'italic', color: '#4b5563' }}>
                Refreshing accounts data feed...
              </div>
            ) : bills.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  color: '#9ca3af',
                  padding: '2rem',
                  border: '2px dashed #e5e7eb',
                  borderRadius: '8px',
                }}
              >
                No active household expenditures recorded yet. Clean slate!
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '1rem' }}>
                {bills.map((bill) => (
                  <div
                    key={bill.id}
                    style={{ border: '1px solid #d1d5db', padding: '1rem', borderRadius: '6px' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontWeight: 'bold',
                      }}
                    >
                      <span>📋 {bill.title}</span>
                      <span>Total: ${(bill.totalCents / 100).toFixed(2)}</span>
                    </div>
                    <div style={{ marginTop: '0.75rem', fontSize: '0.9rem' }}>
                      <strong>Divided Breakdown Shares:</strong>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.5rem',
                          marginTop: '0.5rem',
                        }}
                      >
                        {bill.shares.map((share) => {
                          const associatedMember = balances.find(
                            (b) => b.memberId === share.memberId,
                          )
                          return (
                            <div
                              key={share.id}
                              style={{
                                padding: '0.5rem',
                                border: '1px solid',
                                borderColor: share.paidAt ? '#10b981' : '#f59e0b',
                                backgroundColor: share.paidAt ? '#ecfdf5' : '#fffbeb',
                                borderRadius: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                              }}
                            >
                              {associatedMember?.name || 'Inhabitant'}: $
                              {(share.amountCents / 100).toFixed(2)}
                              {share.paidAt ? (
                                <span style={{ color: '#10b981', fontWeight: 'bold' }}>
                                  ✓ Settled
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handlePayShare(bill.id, share.id)}
                                  style={{
                                    fontSize: '0.8rem',
                                    padding: '0.2rem 0.5rem',
                                    cursor: 'pointer',
                                    backgroundColor: '#fff',
                                    border: '1px solid #d1d5db',
                                    borderRadius: '3px',
                                  }}
                                >
                                  Mark Paid
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
