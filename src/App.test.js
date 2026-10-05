import { render, screen } from '@testing-library/react';
import Game from './Game';

beforeAll(() => {
  window.scrollTo = jest.fn();
  window.HTMLMediaElement.prototype.pause = jest.fn();
});

test('the home page renders the hero and the way into a room', () => {
  render(<Game />);

  expect(screen.getByRole('heading', { level: 1, name: 'Manapally' })).toBeInTheDocument();
  expect(screen.getByText('Premium South Indian Strategy Board Game')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /start game/i }).length).toBeGreaterThan(0);
  expect(screen.getByRole('heading', { name: /district families/i })).toBeInTheDocument();
});
