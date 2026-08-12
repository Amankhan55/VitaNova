import { aiErrorMessage, scoreBand } from './ai.model';

/**
 * The two pure decisions the AI surfaces share.
 *
 * Both are centralised precisely so they can be pinned here: a band decided at
 * each call site would let the ATS ring and the category bars disagree about
 * what 80 means, and error copy written inline would let one panel say "try
 * again" where another says "come back later" for the same failure.
 */

describe('scoreBand', () => {
  it('places a score in the band its colour implies', () => {
    expect(scoreBand(100)).toBe('strong');
    expect(scoreBand(84)).toBe('strong');
    expect(scoreBand(72)).toBe('fair');
    expect(scoreBand(41)).toBe('weak');
    expect(scoreBand(0)).toBe('weak');
  });

  it('puts the boundaries where the labels claim they are', () => {
    expect(scoreBand(80)).toBe('strong');
    expect(scoreBand(79)).toBe('fair');
    expect(scoreBand(60)).toBe('fair');
    expect(scoreBand(59)).toBe('weak');
  });
});

describe('aiErrorMessage', () => {
  it('prefers the server’s wording, which is more specific than ours', () => {
    expect(aiErrorMessage(503, 'The AI service is busy right now.')).toBe(
      'The AI service is busy right now.',
    );
  });

  it('distinguishes a quota exhaustion from an outage', () => {
    // Different advice: one means wait a while, the other means try again now.
    expect(aiErrorMessage(429)).toContain('usage limit');
    expect(aiErrorMessage(503)).toContain('temporarily unavailable');
  });

  it('names a lost connection rather than blaming the AI for it', () => {
    expect(aiErrorMessage(0)).toContain('No connection');
  });

  it('falls back when the server sent no usable detail', () => {
    for (const detail of [undefined, '', '   ', {}, 42]) {
      expect(aiErrorMessage(500, detail)).toBe('AI is temporarily unavailable. Please try again.');
    }
  });

  it('never surfaces a raw object as the message', () => {
    // FastAPI's 422 body is `detail: [...]`, which would render as "[object Object]".
    const message = aiErrorMessage(422, [{ loc: ['body'], msg: 'field required' }]);
    expect(message).not.toContain('object');
  });
});
