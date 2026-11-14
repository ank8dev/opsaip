// Opsy's answers to the Live suggestions: "Brief me", "What needs me?" and
// "What’s not done?". They are built from the server's tasks with the same
// widgets as Demo, by the same code, and never go through an AI model: a
// count must not depend on a model's mood. Only a free question goes to Ask.
// Pure: no React, no network.

import { LIVE_CHIP_IDS, demoAnswer, matchQuestion, type AnswerContext } from './demoAnswers';
import type { Widget } from './types';

export const LIVE_SOURCE = 'From your server’s tasks';

/** True if `question` is one of the three Live suggestions (typing their words works too). */
export function isLiveChip(question: string): boolean {
  const m = matchQuestion(question);
  return m !== null && m.kind === 'chip' && (LIVE_CHIP_IDS as readonly string[]).includes(m.id);
}

/** The answer to a Live suggestion, or null for a free question (that one goes to Ask). */
export function liveChipAnswer(question: string, ctx: Omit<AnswerContext, 'source'>): Widget | null {
  if (!isLiveChip(question)) return null;
  return demoAnswer(question, { ...ctx, source: LIVE_SOURCE });
}
