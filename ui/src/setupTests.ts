import '@testing-library/jest-dom';

// jsdom has no canvas; the trend chart simply draws nothing.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null });
