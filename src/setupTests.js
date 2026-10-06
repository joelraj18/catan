// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// jsdom lacks a few Web APIs every real browser has, which the Claude SDK uses.
const { TextEncoder, TextDecoder } = require('util');
const { ReadableStream } = require('stream/web');

global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;
global.ReadableStream = global.ReadableStream || ReadableStream;

// The browser's secure random generator, for dice, islands and room codes.
if (!global.crypto?.getRandomValues) {
  Object.defineProperty(global, 'crypto', { value: require('crypto').webcrypto, configurable: true });
}
