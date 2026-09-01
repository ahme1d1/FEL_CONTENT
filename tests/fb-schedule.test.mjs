import { test } from 'node:test'
import assert from 'node:assert/strict'
import { epochSeconds, scheduleFacebookPhoto, scheduleFacebookText } from '../publish/platforms/fb-schedule.mjs'

const post = (over = {}) => ({
  id: 'gw04-d1-2000-fb-feed',
  publishAt: '2026-09-04T17:00:00Z',
  caption: 'الجولة الجاية فتحت 🔜',
  link: null,
  ...over,
})

function recorder(reply = { id: '123', post_id: '456_789' }) {
  const calls = []
  return { calls, http: async (call) => (calls.push(call), reply) }
}

// Cairo is UTC+3, so a local-time constructor puts every post three hours out. publishAt is
// absolute for exactly this reason; the conversion happened once, at authoring time.
test('the time is a Unix epoch in seconds, read from the absolute instant', () => {
  assert.equal(epochSeconds('2026-09-04T17:00:00Z'), 1788541200)
  assert.equal(epochSeconds('2026-09-04T17:00:00Z') * 1000, Date.parse('2026-09-04T17:00:00Z'))
})

test('a card is scheduled, not published, and Meta pulls the bytes itself', async () => {
  const { calls, http } = recorder()
  await scheduleFacebookPhoto({ http, pageId: 'PAGE', post: post(), mediaUrl: 'https://m/x.jpg' })

  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].path, '/PAGE/photos')
  assert.deepEqual(calls[0].form, {
    message: 'الجولة الجاية فتحت 🔜',
    published: 'false',
    scheduled_publish_time: '1788541200',
    url: 'https://m/x.jpg',
  })
})

test('a photo answers with the post id, not the photo id', async () => {
  const { http } = recorder({ id: 'PHOTO', post_id: 'POST' })
  const out = await scheduleFacebookPhoto({ http, pageId: 'P', post: post(), mediaUrl: 'https://m/x.jpg' })
  assert.equal(out.remoteId, 'POST')
})

test('a photo endpoint that returns only an id is still recorded', async () => {
  const { http } = recorder({ id: 'PHOTO' })
  const out = await scheduleFacebookPhoto({ http, pageId: 'P', post: post(), mediaUrl: 'https://m/x.jpg' })
  assert.equal(out.remoteId, 'PHOTO')
})

test('a reply with no id at all is a failure, not a silent success', async () => {
  const { http } = recorder({})
  await assert.rejects(
    () => scheduleFacebookPhoto({ http, pageId: 'P', post: post(), mediaUrl: 'https://m/x.jpg' }),
    /returned no id/,
  )
})

test('a text post goes to the feed, and carries its link as a link', async () => {
  const { calls, http } = recorder({ id: 'FEED' })
  await scheduleFacebookText({ http, pageId: 'PAGE', post: post({ link: 'https://fantasyeg.com/' }) })

  assert.equal(calls[0].path, '/PAGE/feed')
  assert.equal(calls[0].form.link, 'https://fantasyeg.com/')
  assert.equal(calls[0].form.published, 'false')
})

test('a text post with no link sends none, rather than an empty one', async () => {
  const { calls, http } = recorder({ id: 'FEED' })
  await scheduleFacebookText({ http, pageId: 'P', post: post() })
  assert.equal('link' in calls[0].form, false)
})

// The author leaves a null caption on the posts a human must write. Facebook would take it.
test('a post with no caption is refused before the request, not published wordless', async () => {
  const { calls, http } = recorder()
  await assert.rejects(
    () => scheduleFacebookPhoto({ http, pageId: 'P', post: post({ caption: null }), mediaUrl: 'https://m/x.jpg' }),
    /wordless/,
  )
  await assert.rejects(
    () => scheduleFacebookText({ http, pageId: 'P', post: post({ caption: '   ' }) }),
    /wordless/,
  )
  assert.deepEqual(calls, [], 'nothing may reach the Page')
})

test('an unusable publish time is refused before the request', async () => {
  const { http } = recorder()
  await assert.rejects(
    () => scheduleFacebookText({ http, pageId: 'P', post: post({ publishAt: 'sometime' }) }),
    /no usable publishAt/,
  )
})
