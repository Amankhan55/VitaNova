import {
  PARSE_CEILING,
  UPLOAD_CEILING,
  importParsePercent,
} from './dashboard';

/**
 * The import bar's percentage is measured during the upload and estimated
 * afterwards, because the server reports nothing between accepting the request
 * and answering it. These pin the properties that keep the estimate honest.
 */
describe('importParsePercent', () => {
  it('picks up exactly where the measured upload left off', () => {
    expect(importParsePercent(0)).toBe(UPLOAD_CEILING);
  });

  it('never claims completion, however long the wait', () => {
    // The guarantee that matters: only the real response may show 100%.
    for (const minutes of [1, 5, 60]) {
      expect(importParsePercent(minutes * 60_000)).toBeLessThan(100);
    }
  });

  it('stays under the asymptote for any wait the server can actually produce', () => {
    // Past roughly six minutes the decay term underflows to zero and the value
    // settles exactly on PARSE_CEILING. That is unreachable in practice — the
    // Gemini call carries a 60s timeout and at most one retry — but the bound
    // is stated for the range that can really happen rather than assumed.
    expect(importParsePercent(150_000)).toBeLessThan(PARSE_CEILING);
  });

  it('always moves forward, so the bar never appears to rewind', () => {
    let previous = -1;
    for (let t = 0; t <= 60_000; t += 250) {
      const percent = importParsePercent(t);
      expect(percent).toBeGreaterThan(previous);
      previous = percent;
    }
  });

  it('sits near three quarters at the measured 12–13s median import', () => {
    // Calibrated against real timings: ~36ms of PDF extraction, the rest a
    // Gemini call. If that median shifts, retune the half-life, not this test.
    expect(importParsePercent(13_000)).toBeGreaterThan(70);
    expect(importParsePercent(13_000)).toBeLessThan(82);
  });

  it('is still visibly climbing on a slow import rather than looking hung', () => {
    const at20s = importParsePercent(20_000);
    const at30s = importParsePercent(30_000);
    expect(at30s - at20s).toBeGreaterThan(2);
  });
});
