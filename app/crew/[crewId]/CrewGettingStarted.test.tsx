import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { CrewGettingStarted, availableCrewTasks } from "./CrewGettingStarted";

afterEach(() => vi.useRealTimers());
describe("crew participation summary", () => {
  it("only offers unclaimed current tasks, with explicit starter tasks first", () => {
    const tasks = [
      { task: 'General work', stage: 'todo', lead: '' },
      { task: 'Done', stage: 'done', lead: '' },
      { task: 'Assigned', stage: 'todo', leadId: '42', lead: '' },
      { task: 'Good first task', stage: 'todo', lead: '' },
      { task: 'Later', stage: 'later', lead: '' },
    ];
    expect(availableCrewTasks(tasks).map(t => t.task)).toEqual(['Good first task', 'General work']);
  });
  it("shows a published lead, upcoming call, calendar download and a claim action", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
    const onClaim = vi.fn();
    render(<NextIntlClientProvider locale="en" messages={en}><CrewGettingStarted crew={{ id: 'tech', label: 'Tech', sheet: 'https://docs.google.com/spreadsheets/d/test', callTime: 'Mondays 3pm ET', callTimeUrl: 'https://discord.gg/pizzadao' }} roster={[{ id: '42', name: 'Crew Lead', status: 'Lead' }]} goals={[{ description: 'Make onboarding easier' }]} tasks={[{ task: 'Good first task', stage: 'todo' }]} user claimingTask={null} onClaim={onClaim} /></NextIntlClientProvider>);
    expect(screen.getByRole('link', { name: 'Crew Lead' })).toHaveAttribute('href', '/profile/42');
    expect(screen.getByRole('link', { name: 'Add to calendar' })).toHaveAttribute('download', 'tech-call.ics');
    fireEvent.click(screen.getByRole('button', { name: 'Claim this task' }));
    expect(onClaim).toHaveBeenCalledWith('Good first task');
  });
  it("uses honest fallbacks when no meeting, lead, or task is listed", () => {
    render(<NextIntlClientProvider locale="en" messages={en}><CrewGettingStarted crew={{ id: 'tech', label: 'Tech' }} roster={[]} goals={[]} tasks={[]} user={false} claimingTask={null} onClaim={() => {}} /></NextIntlClientProvider>);
    expect(screen.getByText(en.crewGettingStarted.scheduleMissing)).toBeVisible();
    expect(screen.getByText(en.crewGettingStarted.contactFallback)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Add to calendar' })).toBeNull();
  });
});
