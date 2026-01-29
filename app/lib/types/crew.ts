/**
 * Type definitions for crew-related entities
 * Represents data structures from Google Sheets crew data
 */

export interface CrewRosterMember {
  id: string;
  status: string;
  name: string;
  city: string;
  org: string;
  skills: string;
  turtles: string;
  telegram: string;
  attendance: string;
  notes: string;
}

export interface CrewGoal {
  priority: string;
  description: string;
}

export interface CrewTask {
  priority: string;
  stage: string;
  goal: string;
  task: string;
  url: string | null;
  dueDate: string;
  lead: string;
  leadId: string;
  notes: string;
}

export interface CrewAgendaItem {
  time: string;
  lead: string;
  step: string;
  stepUrl: string | null;
  action: string;
  notes: string;
}

export interface CrewData {
  roster: CrewRosterMember[];
  goals: CrewGoal[];
  tasks: CrewTask[];
  agenda: CrewAgendaItem[];
}
