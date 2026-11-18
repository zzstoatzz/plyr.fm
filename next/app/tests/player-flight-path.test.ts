import assert from 'node:assert/strict';
import test from 'node:test';
import { artLeft, flightRanges, flightSteps, titleLeft, type Flight, type Range, type Rect } from '../src/player-flight-path.ts';

const width = 402;
const rest = 735;
const art: Flight = { from: { x: 32, y: 748, width: 40, height: 40 }, to: { x: 20, y: 132, width: 362, height: 362 } };
const title: Flight = { from: { x: 84, y: 750, width: 180, height: 18 }, to: { x: 20, y: 514, width: 230, height: 30 } };

function sample({ inputRange: input, outputRange: output }: Range, value: number) {
  if (value <= input[0]) return output[0];
  for (let i = 1; i < input.length; i++) {
    if (value <= input[i]) return output[i - 1] + (output[i] - output[i - 1]) * (value - input[i - 1]) / (input[i] - input[i - 1]);
  }
  return output[output.length - 1];
}

function drawn(flight: Flight, value: number, left?: readonly number[]): Rect {
  const ranges = flightRanges(flight, rest, left);
  const scale = sample(ranges.scale, value);
  return { x: flight.to.x + sample(ranges.translateX, value), y: flight.to.y + sample(ranges.translateY, value),
    width: flight.to.width * scale, height: flight.to.height * scale };
}

function close(actual: Rect, expected: Rect) {
  for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-6, `${key}: ${actual[key]} vs ${expected[key]}`);
}

test('a docked flight draws the art and title exactly over the mini player', () => {
  const artPath = flightSteps.map(progress => artLeft(art, width, progress));
  const titlePath = flightSteps.map(progress => titleLeft(title, art, width, progress));
  close(drawn(art, rest, artPath), art.from);
  close(drawn(title, rest, titlePath), { ...title.from, width: title.to.width * title.from.height / title.to.height });
  close(drawn(art, rest + 40, artPath), art.from);
});

test('an open flight draws the art and title over their resting places', () => {
  const artPath = flightSteps.map(progress => artLeft(art, width, progress));
  const titlePath = flightSteps.map(progress => titleLeft(title, art, width, progress));
  close(drawn(art, 0, artPath), art.to);
  close(drawn(title, 0, titlePath), title.to);
});

test('the flight moves toward the dock without reversing', () => {
  const artPath = flightSteps.map(progress => artLeft(art, width, progress));
  let previous = drawn(art, 0, artPath);
  for (let value = 15; value <= rest; value += 15) {
    const next = drawn(art, value, artPath);
    assert.ok(next.y >= previous.y - 1e-6 && next.width <= previous.width + 1e-6, `reversed at ${value}`);
    previous = next;
  }
});
