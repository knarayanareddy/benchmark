import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepPills } from './StepPills.jsx';
import { ChipGroup } from './ChipGroup.jsx';
import { CountryPicker } from './CountryPicker.jsx';

const STEPS = ['Invitation', 'Your expertise', 'Your visibility', 'Your rhythm'];

/** Holds the value like the real parent does, and records every change. */
function Controlled({ initial, multiple, max, options, onSeen, label = 'Choices' }) {
  const [value, setValue] = useState(initial);
  return (
    <ChipGroup
      label={label}
      options={options}
      multiple={multiple}
      max={max}
      value={value}
      onChange={(v) => { onSeen?.(v); setValue(v); }}
    />
  );
}

/** A country picker that keeps its own value and records every onChange. */
function PickerHarness({ initial = [], max = 6, log = [] }) {
  const [value, setValue] = useState(initial);
  return (
    <CountryPicker
      value={value}
      max={max}
      onChange={(v) => { log.push(v); setValue(v); }}
    />
  );
}

describe('StepPills', () => {
  /** The n-th step (1-based). listitem has no accessible name from content, so select by position. */
  const step = (n) => screen.getByRole('list', { name: 'Progress' }).querySelectorAll('li')[n - 1];

  it('is an ordered list labelled Progress with the step numbers, and marks only the current step', () => {
    render(<StepPills steps={STEPS} current={2} />);
    const list = screen.getByRole('list', { name: 'Progress' });
    expect(list.tagName).toBe('OL');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(step(1)).toHaveTextContent('1. Invitation');
    expect(step(4)).toHaveTextContent('4. Your rhythm');
    const current = items.filter((li) => li.getAttribute('aria-current') === 'step');
    expect(current).toEqual([step(2)]);
    expect(step(2)).toHaveTextContent('2. Your expertise');
    expect(step(2)).toHaveClass('now');
  });

  it('says "completed" to assistive technology for finished steps, not only by colour', () => {
    render(<StepPills steps={STEPS} current={3} />);
    expect(step(1)).toHaveTextContent('1. Invitation, completed');
    expect(step(1)).toHaveClass('done');
    expect(step(2)).toHaveTextContent('2. Your expertise, completed');
    expect(step(2).querySelector('.visually-hidden')).toHaveTextContent('completed');
    expect(step(4)).toHaveClass('todo');
    expect(step(4)).not.toHaveAttribute('aria-current');
    expect(step(4)).not.toHaveTextContent('completed');
  });

  it('shows no completed text on the current or future steps', () => {
    render(<StepPills steps={STEPS} current={1} />);
    expect(screen.queryByText('completed', { exact: false })).toBeNull();
    expect(step(1)).toHaveAttribute('aria-current', 'step');
    expect(step(1)).not.toHaveTextContent('completed');
  });
});

describe('ChipGroup', () => {
  const OPTIONS = [
    { value: 'a', label: 'Alpha', hint: 'first one' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma' },
  ];

  it('is a group labelled by its label, each chip a button with aria-pressed reflecting the value', () => {
    render(<Controlled initial="b" options={OPTIONS} onSeen={() => {}} label="Weekly cap" />);
    const group = screen.getByRole('group', { name: 'Weekly cap' });
    expect(within(group).getAllByRole('button').map((b) => b.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('title', 'first one');
  });

  it('links describedBy to the group', () => {
    render(<ChipGroup label="Role" options={OPTIONS} value="" onChange={() => {}} describedBy="role-help" />);
    expect(screen.getByRole('group', { name: 'Role' })).toHaveAttribute('aria-describedby', 'role-help');
  });

  it('single select: choosing picks the option, choosing the chosen one again clears it', async () => {
    const seen = [];
    render(<Controlled initial="" options={OPTIONS} onSeen={(v) => seen.push(v)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Gamma' }));
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Gamma' }));
    expect(seen).toEqual(['a', 'c', '']);
    expect(screen.getByRole('button', { name: 'Gamma' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('multi toggle: adds and removes values in an array, keeping order of choice', async () => {
    const seen = [];
    render(<Controlled initial={[]} multiple options={OPTIONS} onSeen={(v) => seen.push(v)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Gamma' }));
    await userEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    await userEvent.click(screen.getByRole('button', { name: 'Gamma' }));
    expect(seen).toEqual([['c'], ['c', 'a'], ['a']]);
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Gamma' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('multi with max: unselected chips are disabled at the cap, selected ones stay enabled, and a note says the limit', async () => {
    const seen = [];
    render(<Controlled initial={['a']} multiple max={2} options={OPTIONS} onSeen={(v) => seen.push(v)} />);
    expect(screen.getByText('You can choose up to 2.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Beta' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(screen.getByRole('button', { name: 'Gamma' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Gamma' }));
    expect(seen).toEqual([['a', 'b']]);
    await userEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(seen).toEqual([['a', 'b'], ['b']]);
    expect(screen.getByRole('button', { name: 'Gamma' })).toBeEnabled();
  });

  it('the max note is linked to the group for assistive technology', () => {
    render(<ChipGroup label="Themes" options={OPTIONS} value={[]} multiple max={2} onChange={() => {}} describedBy="themes-help" />);
    const describedBy = screen.getByRole('group', { name: 'Themes' }).getAttribute('aria-describedby');
    expect(describedBy).toMatch(/^themes-help /);
    const noteId = describedBy.split(' ')[1];
    expect(document.getElementById(noteId)).toHaveTextContent('You can choose up to 2.');
  });

  it('keyboard: Tab reaches the chips in order, Enter and Space toggle them', async () => {
    const user = userEvent.setup();
    const seen = [];
    render(<Controlled initial="" options={OPTIONS} onSeen={(v) => seen.push(v)} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-pressed', 'true');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-pressed', 'true');
    expect(seen).toEqual(['a', 'b']);
  });

  it('keyboard: a disabled chip at the cap cannot be reached or toggled', async () => {
    const user = userEvent.setup();
    const seen = [];
    render(<Controlled initial={['a', 'b']} multiple max={2} options={OPTIONS} onSeen={(v) => seen.push(v)} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Gamma' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Gamma' })).not.toHaveFocus();
    await user.keyboard('{Enter}');
    expect(seen).toEqual([]);
  });
});

describe('CountryPicker', () => {
  it('labels every chip by country name, never by ISO code, and puts the code in the title', async () => {
    render(<PickerHarness />);
    await userEvent.type(screen.getByLabelText('Search countries'), 'bra');
    expect(screen.getByRole('button', { name: 'Brazil' })).toHaveAttribute('title', 'BRA');
    expect(screen.queryByRole('button', { name: 'BRA' })).toBeNull();
    expect(screen.queryByText('BRA')).toBeNull();
  });

  it('search filters by name, and is accent-insensitive', async () => {
    render(<PickerHarness />);
    const input = screen.getByLabelText('Search countries');
    await userEvent.type(input, 'bur');
    const region = screen.getByRole('region', { name: 'Countries' });
    expect(within(region).getByRole('button', { name: 'Burundi' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Burkina Faso' })).toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: 'Brazil' })).toBeNull();

    await userEvent.clear(input);
    await userEvent.type(input, 'SAO TOME');
    expect(within(region).getByRole('button', { name: 'São Tomé and Príncipe' })).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'principe');
    expect(within(region).getByRole('button', { name: 'São Tomé and Príncipe' })).toBeInTheDocument();
  });

  it('a selected country stays pinned in the Chosen row even when the search hides it', async () => {
    render(<PickerHarness initial={['BRA']} />);
    const chosen = screen.getByRole('group', { name: 'Chosen' });
    expect(within(chosen).getByRole('button', { name: 'Brazil' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.type(screen.getByLabelText('Search countries'), 'burundi');
    expect(within(chosen).getByRole('button', { name: 'Brazil' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Countries' })).not.toHaveTextContent('Brazil');
    expect(screen.getAllByRole('button', { name: 'Brazil' })).toHaveLength(1);
  });

  it('the count reads "N of max chosen" and is announced politely', async () => {
    render(<PickerHarness initial={['BRA', 'BDI']} max={6} />);
    const count = screen.getByText('2 of 6 chosen');
    expect(count).toHaveAttribute('aria-live', 'polite');
  });

  it('at max, every unselected country is disabled and the selected ones can still be removed', async () => {
    const log = [];
    render(<PickerHarness initial={['BRA', 'BDI']} max={2} log={log} />);
    expect(screen.getByText('2 of 2 chosen')).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Countries' });
    expect(within(region).getByRole('button', { name: 'Benin' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Benin' }));
    expect(log).toEqual([]);
    await userEvent.click(within(screen.getByRole('group', { name: 'Chosen' })).getByRole('button', { name: 'Brazil' }));
    expect(log).toEqual([['BDI']]);
    expect(screen.getByText('1 of 2 chosen')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Benin' })).toBeEnabled();
  });

  it('clicking a selected country in Chosen removes it', async () => {
    const log = [];
    render(<PickerHarness initial={['BRA', 'BDI']} log={log} />);
    await userEvent.click(within(screen.getByRole('group', { name: 'Chosen' })).getByRole('button', { name: 'Burundi' }));
    expect(log).toEqual([['BRA']]);
    expect(screen.getByText('1 of 6 chosen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Burundi' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('onChange receives ISO codes in selection order', async () => {
    const log = [];
    render(<PickerHarness log={log} />);
    await userEvent.type(screen.getByLabelText('Search countries'), 'b');
    const region = screen.getByRole('region', { name: 'Countries' });
    await userEvent.click(within(region).getByRole('button', { name: 'Brazil' }));
    await userEvent.click(within(region).getByRole('button', { name: 'Benin' }));
    await userEvent.click(within(region).getByRole('button', { name: 'Burundi' }));
    expect(log).toEqual([['BRA'], ['BRA', 'BEN'], ['BRA', 'BEN', 'BDI']]);
    expect(screen.getByText('3 of 6 chosen')).toBeInTheDocument();
  });

  it('shows "No country matches" with the query when nothing matches', async () => {
    render(<PickerHarness />);
    await userEvent.type(screen.getByLabelText('Search countries'), 'zzqx');
    expect(screen.getByText('No country matches “zzqx”.')).toBeInTheDocument();
  });

  it('the scrolling list is a focusable region', () => {
    render(<PickerHarness />);
    const region = screen.getByRole('region', { name: 'Countries' });
    expect(region).toHaveAttribute('tabindex', '0');
  });
});
