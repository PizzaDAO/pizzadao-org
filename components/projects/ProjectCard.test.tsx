import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProjectCard } from './ProjectCard'
import type { Project } from '@/app/lib/projects/types'

const mockProject: Project = {
  name: 'onboarding',
  slug: 'onboarding',
  description: 'PizzaDAO onboarding application',
  githubUrl: 'https://github.com/PizzaDAO/onboarding',
  defaultBranch: 'main',
  createdAt: '2023-01-01T00:00:00Z',
  updatedAt: '2024-01-15T00:00:00Z',
  pushedAt: '2024-01-15T00:00:00Z',
  techStack: ['TypeScript', 'Next.js', 'Tailwind CSS'],
  activityLevel: 'active',
  status: 'active',
  liveUrl: 'https://pizzadao.org',
  openPRs: 3,
  openIssues: 5,
  contributors: [
    {
      login: 'contributor1',
      avatarUrl: 'https://avatar.com/1',
      contributions: 50,
      profileUrl: 'https://github.com/contributor1',
    },
  ],
  recentCommits: [
    {
      sha: 'abc123',
      message: 'Initial commit',
      author: 'contributor1',
      authorAvatarUrl: 'https://avatar.com/1',
      date: '2024-01-15T00:00:00Z',
      url: 'https://github.com/PizzaDAO/onboarding/commit/abc123',
    },
  ],
}

describe('ProjectCard', () => {
  it('renders project name and description', () => {
    render(<ProjectCard project={mockProject} />)

    expect(screen.getByText('onboarding')).toBeInTheDocument()
    expect(screen.getByText('PizzaDAO onboarding application')).toBeInTheDocument()
  })

  it('shows status badge with correct color for active status', () => {
    render(<ProjectCard project={mockProject} />)

    const badge = screen.getByText('Active')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('bg-green-500')
  })

  it('shows status badge with correct color for maintenance status', () => {
    const maintenanceProject = { ...mockProject, status: 'maintenance' as const }
    render(<ProjectCard project={maintenanceProject} />)

    const badge = screen.getByText('Maintenance')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('bg-yellow-500')
  })

  it('shows status badge with correct color for archived status', () => {
    const archivedProject = { ...mockProject, status: 'archived' as const }
    render(<ProjectCard project={archivedProject} />)

    const badge = screen.getByText('Archived')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('bg-red-500')
  })

  it('shows status badge with correct color for planning status', () => {
    const planningProject = { ...mockProject, status: 'planning' as const }
    render(<ProjectCard project={planningProject} />)

    const badge = screen.getByText('Planning')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('bg-blue-500')
  })

  it('displays tech stack tags', () => {
    render(<ProjectCard project={mockProject} />)

    expect(screen.getByText('TypeScript')).toBeInTheDocument()
    expect(screen.getByText('Next.js')).toBeInTheDocument()
    expect(screen.getByText('Tailwind CSS')).toBeInTheDocument()
  })

  it('shows open PRs count', () => {
    render(<ProjectCard project={mockProject} />)

    expect(screen.getByText(/3.*PRs/)).toBeInTheDocument()
  })

  it('shows open issues count', () => {
    render(<ProjectCard project={mockProject} />)

    expect(screen.getByText(/5.*Issues/)).toBeInTheDocument()
  })

  it('shows activity indicator based on activity level', () => {
    render(<ProjectCard project={mockProject} />)

    // Should show some indicator of recent activity
    expect(screen.getByTestId('activity-indicator')).toBeInTheDocument()
  })

  it('renders GitHub link', () => {
    render(<ProjectCard project={mockProject} />)

    const githubLink = screen.getByRole('link', { name: /github/i })
    expect(githubLink).toHaveAttribute('href', 'https://github.com/PizzaDAO/onboarding')
  })

  it('renders live URL link when available', () => {
    render(<ProjectCard project={mockProject} />)

    const liveLink = screen.getByRole('link', { name: /live/i })
    expect(liveLink).toHaveAttribute('href', 'https://pizzadao.org')
  })

  it('does not render live URL link when not available', () => {
    const projectWithoutLiveUrl = { ...mockProject, liveUrl: undefined }
    render(<ProjectCard project={projectWithoutLiveUrl} />)

    expect(screen.queryByRole('link', { name: /live/i })).not.toBeInTheDocument()
  })

  it('shows task summary when tasks are available', () => {
    const projectWithTasks = {
      ...mockProject,
      tasks: {
        todo: 5,
        doing: 2,
        done: 10,
        stuck: 1,
        topPriority: [],
      },
    }
    render(<ProjectCard project={projectWithTasks} />)

    // Check for task counts - using text content with the number
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('To Do')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Doing')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('handles project with no description', () => {
    const projectWithoutDescription = { ...mockProject, description: null }
    render(<ProjectCard project={projectWithoutDescription} />)

    expect(screen.getByText('onboarding')).toBeInTheDocument()
    expect(screen.getByText('No description available')).toBeInTheDocument()
  })
})
