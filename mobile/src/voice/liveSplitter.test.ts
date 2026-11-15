import { LiveSplitter, cleanForSpeech } from './liveSplitter';

// Feeds the text a few characters at a time, the way a model streams it, and collects what would be spoken.
function stream(full: string, step = 7, splitter = new LiveSplitter()): string[] {
  const out: string[] = [];
  for (let i = step; i < full.length + step; i += step) out.push(...splitter.push(full.slice(0, Math.min(i, full.length))));
  out.push(...splitter.flush(full));
  return out;
}

describe('LiveSplitter', () => {
  const reply = 'I route every request to the right specialist. You get quick answers without lifting a finger. I also keep your services linked and healthy.';

  it('hands out the first sentence as soon as it is complete, long before the reply ends', () => {
    const s = new LiveSplitter();
    expect(s.push('I route every request to the right')).toEqual([]);
    expect(s.push('I route every request to the right specialist.')).toEqual([]);          // the full stop is not confirmed until a space follows
    expect(s.push('I route every request to the right specialist. You')).toEqual(['I route every request to the right specialist.']);
  });

  it('never loses or reorders text, however the stream is cut up', () => {
    for (const step of [1, 3, 7, 20, 200]) {
      expect(stream(reply, step).join(' ')).toBe(reply);
    }
  });

  it('does not cut inside a number or an abbreviation that is still arriving', () => {
    const out = stream('The price is 3.5 dollars for each item you order today. Thanks a lot for asking, that is all.', 4);
    expect(out[0]).toBe('The price is 3.5 dollars for each item you order today.');
  });

  it('merges very short sentences instead of speaking fragments', () => {
    const out = stream('Sure. Okay. Done. I have updated the file and sent the summary to the team lead for review.', 5);
    expect(out[0].length).toBeGreaterThanOrEqual(40);
    expect(out.join(' ')).toBe('Sure. Okay. Done. I have updated the file and sent the summary to the team lead for review.');
  });

  it('speaks what is left when the reply ends without a full stop', () => {
    const s = new LiveSplitter();
    s.push('First sentence is nice and long enough here. And then');
    expect(s.flush('First sentence is nice and long enough here. And then some words')).toEqual(['And then some words']);
  });

  it('understands the Hindi full stop and new lines', () => {
    const out = stream('आज का दिन बहुत अच्छा चल रहा है और सब कुछ ठीक है। कोई समस्या नहीं है, आप चिंता न करें।', 6);
    expect(out.length).toBe(2);
    expect(out[0].endsWith('।')).toBe(true);
    expect(stream('The first line is definitely long enough to speak now.\nThe second line is also long enough to be its own part.', 5)).toHaveLength(2);
  });

  it('hands out several chunks at once when the model is fast', () => {
    const s = new LiveSplitter(10, 10);
    expect(s.push('This is one sentence. This is another one. This is the third one. And')).toEqual(['This is one sentence.', 'This is another one. This is the third one.']);
  });

  it('can be reset for the next reply', () => {
    const s = new LiveSplitter();
    s.push('A long first sentence to speak right now. More');
    s.reset();
    expect(s.push('Fresh reply starts here and is long enough. Next')).toEqual(['Fresh reply starts here and is long enough.']);
  });
});

describe('cleanForSpeech', () => {
  it('removes markdown, code, links and emoji but keeps the words', () => {
    expect(cleanForSpeech('**Done!** See `config.ts` and https://example.com/x for more \u{1F680}')).toBe('Done! See config.ts and link for more');
    expect(cleanForSpeech('Steps:\n- first thing\n- second thing')).toBe('Steps: first thing second thing');
    expect(cleanForSpeech('```js\nconsole.log(1)\n``` after the code')).toBe('after the code');
    expect(cleanForSpeech('[the docs](https://x.y/z) are here')).toBe('the docs are here');
  });
});
