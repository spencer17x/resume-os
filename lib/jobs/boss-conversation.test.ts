import { describe, expect, it } from 'vitest'
import {
  applyBossConversationSignal,
  approveBossMessage,
  assertBossMessageReadyToSend,
  createBossConversationThread,
  createBossMessageDraft,
  failBossMessage,
  markBossMessageSending,
  recordBossMessageReceipt,
  reviseBossMessageDraft,
  verifyBossConversationRecipient
} from './boss-conversation'

const now = '2026-08-19T08:00:00.000Z'

describe('BOSS conversation state', () => {
  it('advances verified inbound signals without persisting private message text', () => {
    const verified = verifyBossConversationRecipient({
      thread: createBossConversationThread({ applicationId: 'application-1', now }),
      platformRecipientId: 'boss-1', conversationId: 'conversation-1', recipientName: '招聘经理', now
    })
    const requested = applyBossConversationSignal({
      thread: { ...verified, recruitmentStage: 'awaiting-reply' },
      signal: {
        signalId: 'fnv1a64:signal-1', conversationId: 'conversation-1',
        kind: 'resume-request', observedAt: now
      },
      now
    })
    expect(requested).toMatchObject({
      recruitmentStage: 'resume-requested', lastPlatformSignalId: 'fnv1a64:signal-1'
    })
    expect(JSON.stringify(requested)).not.toContain('请发送简历')
    expect(() => applyBossConversationSignal({
      thread: requested,
      signal: { signalId: 'fnv1a64:other', conversationId: 'other', kind: 'offer', observedAt: now },
      now
    })).toThrow()
  })
  it('requires exact recipient and body approval before sending', () => {
    const thread = createBossConversationThread({ applicationId: 'application-1', now })
    const draft = createBossMessageDraft({
      threadId: thread.id, kind: 'opener', body: '您好，我对平台工程师岗位感兴趣。', evidenceFactIds: ['fact-1'], now
    })
    const approved = approveBossMessage({ message: draft, recipientFingerprint: 'recipient:one', now })
    expect(assertBossMessageReadyToSend({
      message: approved, body: draft.body, recipientFingerprint: 'recipient:one'
    }).status).toBe('approved')
    expect(() => assertBossMessageReadyToSend({
      message: approved, body: `${draft.body} changed`, recipientFingerprint: 'recipient:one'
    })).toThrow()
  })

  it('invalidates approval when a review edit changes the body', () => {
    const thread = createBossConversationThread({ applicationId: 'application-1', now })
    const draft = createBossMessageDraft({ threadId: thread.id, kind: 'opener', body: 'Hello', evidenceFactIds: [], now })
    const approved = approveBossMessage({ message: draft, recipientFingerprint: 'recipient:one', now })
    const revised = reviseBossMessageDraft({ message: approved, body: 'Hello, revised', now })
    expect(revised).toMatchObject({ status: 'awaiting-approval', recipientFingerprint: undefined, approvedAt: undefined })
    expect(revised.bodyFingerprint).not.toBe(approved.bodyFingerprint)
  })

  it('binds recipient verification to the BOSS identity and conversation', () => {
    const thread = createBossConversationThread({ applicationId: 'application-1', now })
    const verified = verifyBossConversationRecipient({
      thread,
      platformRecipientId: 'boss-user-1',
      conversationId: 'conversation-1',
      recipientName: '招聘经理',
      recipientTitle: 'HR',
      now
    })
    expect(verified).toMatchObject({ status: 'ready', recipientName: '招聘经理', recipientFingerprint: expect.any(String) })
    expect(verifyBossConversationRecipient({
      thread,
      platformRecipientId: 'boss-user-2',
      conversationId: 'conversation-1',
      recipientName: '招聘经理',
      now
    }).recipientFingerprint).not.toBe(verified.recipientFingerprint)
    expect(() => verifyBossConversationRecipient({
      thread: verified,
      platformRecipientId: 'boss-user-2',
      conversationId: 'conversation-2',
      recipientName: '其他招聘方',
      now
    })).toThrow()
  })

  it('accepts only receipts matching the approved body and recipient', () => {
    const thread = createBossConversationThread({ applicationId: 'application-1', now })
    const draft = createBossMessageDraft({ threadId: thread.id, kind: 'opener', body: 'Hello', evidenceFactIds: [], now })
    const approved = approveBossMessage({ message: draft, recipientFingerprint: 'recipient:one', now })
    const receipt = {
      conversationId: 'conversation-1', messageId: 'message-1', bodyFingerprint: approved.bodyFingerprint,
      recipientFingerprint: 'recipient:one', observedStatus: 'delivered' as const, observedAt: now
    }
    expect(recordBossMessageReceipt({ message: approved, receipt, now })).toMatchObject({
      status: 'delivered', deliveredAt: now
    })
    expect(() => recordBossMessageReceipt({
      message: approved,
      receipt: { ...receipt, bodyFingerprint: 'wrong:fingerprint' },
      now
    })).toThrow()
  })

  it('moves an approved message through sending or a safe failed state', () => {
    const thread = createBossConversationThread({ applicationId: 'application-1', now })
    const draft = createBossMessageDraft({ threadId: thread.id, kind: 'opener', body: 'Hello', evidenceFactIds: [], now })
    const approved = approveBossMessage({ message: draft, recipientFingerprint: 'recipient:one', now })
    const sending = markBossMessageSending({
      message: approved, body: approved.body, recipientFingerprint: 'recipient:one', now
    })
    expect(sending.status).toBe('sending')
    expect(failBossMessage({ message: sending, failureCode: 'BOSS_SEND_NOT_VERIFIED', now }))
      .toMatchObject({ status: 'failed', failureCode: 'BOSS_SEND_NOT_VERIFIED' })
  })
})
