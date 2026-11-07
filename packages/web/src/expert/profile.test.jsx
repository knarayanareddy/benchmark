import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profile, ProfileFields, profileProblem, profileBody, PROFILE_DEFAULTS } from './Profile.jsx';
import { routes, fail } from '../test-helpers.js';
import { THEMES, ROLE_TYPES } from '@benchmark/core/taxonomy';

const VOCAB = { themes: THEMES, roleTypes: ROLE_TYPES };
const REGION = 'Sahel & West/Central Africa';

/** What GET /api/me/profile answers for a person who has already set up. The stored regions and the old minMatch are still in the payload; the form must ignore them. */
const PROFILE = {
  name: 'Ana', level: 'pseudonymous', mode: 'server', organisation: 'Acme', roleType: 'researcher',
  declaration: { countries: ['TCD'], regions: [REGION], themes: ['conflict'] },
  weeklyCap: 3, minMatch: 30, needsSetup: false, vocab: VOCAB,
};

const puts = (a) => a.mock.calls.filter((c) => c[0] === 'PUT');

describe('Profile', () => {
  it('shows the values the server holds, and no minimum-match control or region checkbox', async () => {
    render(<Profile api={routes({ 'GET /api/me/profile': PROFILE })} />);
    expect(await screen.findByLabelText('Countries you cover')).toHaveValue('TCD');
    expect(screen.getByRole('heading', { name: 'My profile' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Countries chosen' })).toHaveTextContent('TCD');
    expect(screen.getByLabelText('Conflict & security')).toBeChecked();
    expect(screen.getByLabelText('Food security & livelihoods')).not.toBeChecked();
    expect(screen.getByLabelText('Role type')).toHaveValue('researcher');
    expect(screen.getByLabelText(/Organisation/)).toHaveValue('Acme');
    expect(screen.getByLabelText(/Weekly cap/)).toHaveValue(3);
    expect(screen.queryByLabelText(/Minimum match/)).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByLabelText(REGION)).toBeNull();
    expect(screen.queryByText(/Regions you know well/)).toBeNull();
  });

  it('sends exactly the contract body, with the edits made', async () => {
    const a = routes({ 'GET /api/me/profile': PROFILE, 'PUT /api/me/profile': () => PROFILE });
    render(<Profile api={a} />);
    await screen.findByLabelText('Countries you cover');
    const countries = screen.getByLabelText('Countries you cover');
    await userEvent.clear(countries);
    await userEvent.type(countries, 'sdn, yem  sdn');
    await userEvent.click(screen.getByLabelText('Food security & livelihoods'));
    await userEvent.selectOptions(screen.getByLabelText('Role type'), 'local_ngo');
    await userEvent.clear(screen.getByLabelText(/Organisation/));
    await userEvent.clear(screen.getByLabelText(/Weekly cap/));
    await userEvent.type(screen.getByLabelText(/Weekly cap/), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(puts(a)).toHaveLength(1));
    expect(puts(a)[0]).toEqual(['PUT', '/api/me/profile', {
      organisation: null, roleType: 'local_ngo', countries: ['SDN', 'YEM'], themes: ['conflict', 'food'], weeklyCap: 5,
    }]);
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });

  it('blocks a save with no country, a bad country code, or a cap of 0 or 8, and sends nothing', async () => {
    const cases = [
      { edit: () => userEvent.clear(screen.getByLabelText('Countries you cover')), message: /at least one country/ },
      { edit: () => userEvent.type(screen.getByLabelText('Countries you cover'), ', TCDX'), message: /"TCDX" is not a 3-letter country code/ },
      { edit: () => userEvent.type(screen.getByLabelText(/Weekly cap/), '{Backspace}0'), message: /weekly cap must be a whole number from 1 to 7/ },
      { edit: () => userEvent.type(screen.getByLabelText(/Weekly cap/), '{Backspace}8'), message: /weekly cap must be a whole number from 1 to 7/ },
    ];
    for (const { edit, message } of cases) {
      const a = routes({ 'GET /api/me/profile': PROFILE, 'PUT /api/me/profile': () => PROFILE });
      const { unmount } = render(<Profile api={a} />);
      await screen.findByLabelText('Countries you cover');
      await edit();
      await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(puts(a)).toHaveLength(0);
      unmount();
    }
  });

  it('ignores a stored minMatch and regions in the payload without error, and does not send them back', async () => {
    const a = routes({ 'GET /api/me/profile': { ...PROFILE, minMatch: 101 }, 'PUT /api/me/profile': () => PROFILE });
    render(<Profile api={a} />);
    await screen.findByLabelText('Countries you cover');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(puts(a)).toHaveLength(1));
    const body = puts(a)[0][2];
    expect(Object.keys(body).sort()).toEqual(['countries', 'organisation', 'roleType', 'themes', 'weeklyCap']);
    expect(body).not.toHaveProperty('minMatch');
    expect(body).not.toHaveProperty('regions');
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });

  it('shows the server error text and does not say Saved', async () => {
    const a = routes({ 'GET /api/me/profile': PROFILE, 'PUT /api/me/profile': fail(422, 'countries: at least one is needed') });
    render(<Profile api={a} />);
    await screen.findByLabelText('Countries you cover');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('countries: at least one is needed');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says plainly that only the person sees the organisation', async () => {
    render(<Profile api={routes({ 'GET /api/me/profile': PROFILE })} />);
    await screen.findByLabelText('Countries you cover');
    expect(screen.getByText('Only you see this.')).toBeInTheDocument();
  });

  it('in setup, asks what they cover, saves with "Save and continue", and calls onSaved without a Saved note', async () => {
    const done = vi.fn();
    const a = routes({ 'GET /api/me/profile': { ...PROFILE, needsSetup: true }, 'PUT /api/me/profile': () => PROFILE });
    render(<Profile api={a} setup onSaved={done} />);
    await screen.findByRole('button', { name: 'Save and continue' });
    expect(screen.getByRole('heading', { name: 'Tell us what you cover' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(puts(a)).toHaveLength(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a failed load shows an error and never a crash', async () => {
    render(<Profile api={routes({ 'GET /api/me/profile': fail(500, 'database unavailable') })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.getByRole('alert')).toHaveTextContent('database unavailable');
    expect(screen.queryByRole('button', { name: 'Save profile' })).toBeNull();
  });
});

describe('profile helpers (the same rules the server applies)', () => {
  it('the defaults are a valid profile only once a country is given', () => {
    expect(profileProblem(PROFILE_DEFAULTS)).toMatch(/at least one country/);
    expect(profileProblem({ ...PROFILE_DEFAULTS, countries: ['TCD'] })).toBeNull();
  });

  it('a long organisation is refused, and blank organisation is sent as null', () => {
    expect(profileProblem({ ...PROFILE_DEFAULTS, countries: ['TCD'], organisation: 'x'.repeat(121) })).toMatch(/120/);
    expect(profileBody({ ...PROFILE_DEFAULTS, countries: ['TCD'], organisation: '   ' }).organisation).toBeNull();
  });

  it('the body carries exactly the five edited fields', () => {
    expect(Object.keys(profileBody(PROFILE_DEFAULTS)).sort()).toEqual(['countries', 'organisation', 'roleType', 'themes', 'weeklyCap']);
  });

  it('ProfileFields reports each change as a whole new value', () => {
    const onChange = vi.fn();
    render(<ProfileFields value={PROFILE_DEFAULTS} onChange={onChange} vocab={VOCAB} />);
    fireEvent.click(screen.getByLabelText('Climate & natural hazards'));
    expect(onChange).toHaveBeenLastCalledWith({ ...PROFILE_DEFAULTS, themes: ['climate'] });
  });
});
