import { Hono } from 'hono'

// Define DB type binding based on wrangler setup
const app = new Hono<{ Bindings: { DB: D1Database } }>()

// ----------------------------------------------------
// PART 1: HOMES & MEMBERS
// ----------------------------------------------------

// 1. POST /api/homes
app.post('/api/homes', async (c) => {
  const { name } = await c.req.json<{ name: string }>()
  const id = crypto.randomUUID()

  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()

  return c.json({ id, name }, 201)
})

// 2. POST /api/homes/:homeId/members
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const { name } = await c.req.json<{ name: string }>()

  const home = await c.env.DB.prepare('SELECT * FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return c.json({ error: 'home not found' }, 404)

  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(id, homeId, name)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// ----------------------------------------------------
// PART 2: BILL SPLITTING & PAYMENTS
// ----------------------------------------------------

// 3. POST /api/homes/:homeId/bills
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const { title, totalCents } = await c.req.json<{ title: string; totalCents: number }>()

  const home = await c.env.DB.prepare('SELECT * FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return c.json({ error: 'home not found' }, 404)

  // Rule Check: positive integer value validation
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    return c.json({ error: 'total is not a positive whole number' }, 422)
  }

  // Chronological retrieval of home members
  const { results: members } = await c.env.DB.prepare(
    'SELECT * FROM members WHERE home_id = ? ORDER BY created_at ASC',
  )
    .bind(homeId)
    .all<{ id: string; name: string }>()

  if (!members || members.length === 0) {
    return c.json({ error: 'the home has no members' }, 422)
  }

  const billId = crypto.randomUUID()
  const totalMembers = members.length
  const baseShare = Math.floor(totalCents / totalMembers)
  let remainder = totalCents % totalMembers

  await c.env.DB.prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)')
    .bind(billId, homeId, title, totalCents)
    .run()

  interface ShareRecord {
    id: string
    memberId: string
    amountCents: number
    paidAt: string | null
  }

  const shares: ShareRecord[] = []

  for (const member of members) {
    // Distribute remaining odd cents one by one to chronological members
    const amountCents = baseShare + (remainder > 0 ? 1 : 0)
    remainder--

    const shareId = crypto.randomUUID()
    await c.env.DB.prepare(
      'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at) VALUES (?, ?, ?, ?, NULL)',
    )
      .bind(shareId, billId, member.id, amountCents)
      .run()

    shares.push({ id: shareId, memberId: member.id, amountCents, paidAt: null })
  }

  return c.json({ id: billId, homeId, title, totalCents, shares }, 201)
})

// 4. POST /api/bills/:billId/shares/:shareId/pay
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const { billId, shareId } = c.req.param()
  const idempotencyKey = c.req.header('Idempotency-Key')

  if (!idempotencyKey) return c.json({ error: 'key missing' }, 400)

  const share = await c.env.DB.prepare('SELECT * FROM shares WHERE id = ? AND bill_id = ?')
    .bind(shareId, billId)
    .first<{
      id: string
      member_id: string
      amount_cents: number
      paid_at: string | null
      idempotency_key: string | null
    }>()

  if (!share) return c.json({ error: 'bill or share not found' }, 404)

  // Idempotency execution check
  if (share.paid_at) {
    if (share.idempotency_key === idempotencyKey) {
      return c.json(
        {
          id: share.id,
          memberId: share.member_id,
          amountCents: share.amount_cents,
          paidAt: share.paid_at,
        },
        200,
      )
    } else {
      return c.json({ error: 'share already paid with a different key' }, 409)
    }
  }

  const now = new Date().toISOString()

  // Atomic row conditional tracking to avoid concurrency race conditions
  const result = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND paid_at IS NULL',
  )
    .bind(now, idempotencyKey, shareId)
    .run()

  if (result.meta.changes === 0) {
    const updatedShare = await c.env.DB.prepare('SELECT * FROM shares WHERE id = ?')
      .bind(shareId)
      .first<{
        id: string
        member_id: string
        amount_cents: number
        paid_at: string
        idempotency_key: string
      }>()

    if (updatedShare && updatedShare.idempotency_key === idempotencyKey) {
      return c.json(
        {
          id: updatedShare.id,
          memberId: updatedShare.member_id,
          amountCents: updatedShare.amount_cents,
          paidAt: updatedShare.paid_at,
        },
        200,
      )
    }
    return c.json({ error: 'share already paid with a different key' }, 409)
  }

  return c.json(
    { id: share.id, memberId: share.member_id, amountCents: share.amount_cents, paidAt: now },
    200,
  )
})

// 5. GET /api/homes/:homeId/balances
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT * FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return c.json({ error: 'home not found' }, 404)

  const { results: members } = await c.env.DB.prepare(
    'SELECT * FROM members WHERE home_id = ? ORDER BY created_at ASC',
  )
    .bind(homeId)
    .all<{ id: string; name: string }>()

  interface BalanceRecord {
    memberId: string
    name: string
    outstandingCents: number
  }

  const balances: BalanceRecord[] = []

  if (members) {
    for (const m of members) {
      const outstanding = await c.env.DB.prepare(
        'SELECT SUM(amount_cents) as total FROM shares WHERE member_id = ? AND paid_at IS NULL',
      )
        .bind(m.id)
        .first<{ total: number | null }>()

      balances.push({
        memberId: m.id,
        name: m.name,
        outstandingCents: outstanding?.total || 0,
      })
    }
  }

  return c.json({ balances }, 200)
})

export default app
