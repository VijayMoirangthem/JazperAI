import { shouldListen, type HandsFreeState } from './handsFree';

const ready: HandsFreeState = { handsFree: true, streaming: false, speaking: false, recording: false, transcribing: false, paused: false, focused: true };

describe('hands-free listening', () => {
  it('opens the microphone when it is the user\'s turn', () => {
    expect(shouldListen(ready)).toBe(true);
  });

  it.each([
    ['hands-free is off', { handsFree: false }],
    ['the reply is still being written', { streaming: true }],
    ['Jasper is speaking (it would hear itself)', { speaking: true }],
    ['already recording', { recording: true }],
    ['waiting for the transcript', { transcribing: true }],
    ['the conversation was paused', { paused: true }],
    ['the screen is not in front', { focused: false }],
  ])('stays closed when %s', (_why, change) => {
    expect(shouldListen({ ...ready, ...change })).toBe(false);
  });
});
