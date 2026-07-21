/**
 * POST /api/submit-lead
 *
 * Receives the Westchester buyer-form submission and creates the lead
 * directly in Follow Up Boss — no Make.com in the middle.
 *
 * Uses POST /v1/events (not /v1/people) because that endpoint:
 * - Deduplicates contacts by phone/email automatically
 * - Triggers Follow Up Boss action plans / automations
 * - Triggers agent notifications
 * - Assigns the lead per your configured Lead Flow rules
 *
 * Setup required in the Vercel project settings for THIS repo
 * (Project -> Settings -> Environment Variables):
 *   FOLLOWUPBOSS_API_KEY = <your Follow Up Boss API key>
 *
 * Docs: https://docs.followupboss.com/reference/events-post
 */

const FUB_API_BASE = 'https://api.followupboss.com/v1'

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const API_KEY = process.env.FOLLOWUPBOSS_API_KEY
  if (!API_KEY) {
    console.error('FOLLOWUPBOSS_API_KEY is not set for this Vercel project.')
    return res.status(500).json({ error: 'This form is not fully configured yet. Please call or email directly.' })
  }

  let data
  try {
    data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    return res.status(400).json({ error: 'Invalid request body' })
  }

  if (!data || !data.name || !data.phone) {
    return res.status(400).json({ error: 'Name and phone are required' })
  }

  // Defense in depth — the client already strips a filled honeypot before
  // sending, but reject here too if it somehow arrives non-empty.
  if (data.hp_confirm && String(data.hp_confirm).trim() !== '') {
    return res.status(200).json({ success: true }) // pretend success to the bot, do nothing
  }

  const nameParts = String(data.name).trim().split(/\s+/)
  const firstName = nameParts[0] || 'Unknown'
  const lastName = nameParts.slice(1).join(' ') || ''

  const person = { firstName, lastName }
  if (data.email) person.emails = [{ value: data.email }]
  if (data.phone) person.phones = [{ value: data.phone }]

  const notesParts = []
  if (data.timeline) notesParts.push(`Buying timeframe: ${data.timeline}`)
  if (data.relocating_from) notesParts.push(`Relocating from: ${data.relocating_from}`)
  const areaValue = data.area_display || data.area
  if (areaValue) notesParts.push(`Towns considering: ${areaValue}`)
  if (data.price) notesParts.push(`Price range: ${data.price}`)
  if (data.type) notesParts.push(`Property type: ${data.type}`)
  if (data.priority) notesParts.push(`Top priority: ${data.priority}`)
  if (data.preapproved) notesParts.push(`Preapproval status: ${data.preapproved}`)
  if (data.other_agent) notesParts.push(`Working with another agent: ${data.other_agent}`)
  if (data.need_to_sell) notesParts.push(`Needs to sell first: ${data.need_to_sell}`)
  if (data.help_needed) notesParts.push(`Most wants help with: ${data.help_needed}`)
  if (data.lead_intent_tier) notesParts.push(`Lead intent tier: ${data.lead_intent_tier}`)
  if (data.utm_source || data.utm_medium || data.utm_campaign || data.utm_term || data.utm_content) {
    notesParts.push(
      `UTM: source=${data.utm_source || ''} medium=${data.utm_medium || ''} campaign=${data.utm_campaign || ''} term=${data.utm_term || ''} content=${data.utm_content || ''}`
    )
  }
  if (data.gclid) notesParts.push(`Google Click ID: ${data.gclid}`)
  if (data.landing_page_version) notesParts.push(`Landing page version: ${data.landing_page_version}`)

  const eventPayload = {
    type: 'Property Inquiry',
    source: 'Westchester Buyer Landing Page',
    person,
    ...(notesParts.length > 0 && { description: notesParts.join('\n') }),
  }

  try {
    const authHeader = `Basic ${Buffer.from(`${API_KEY}:`).toString('base64')}`

    const fubResponse = await fetch(`${FUB_API_BASE}/events`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(eventPayload),
    })

    // FUB returns 200 (contact updated), 201 (contact created), or
    // 204 (lead source archived — request still succeeded, nothing to read back)
    if (!fubResponse.ok && fubResponse.status !== 204) {
      const errorBody = await fubResponse.json().catch(() => ({}))
      console.error('Follow Up Boss API error:', errorBody)
      return res.status(502).json({ error: 'Follow Up Boss rejected the submission' })
    }

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('Error submitting lead to Follow Up Boss:', err)
    return res.status(500).json({ error: 'Unexpected error submitting the lead' })
  }
}
