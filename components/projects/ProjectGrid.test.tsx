import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProjectGrid } from './ProjectGrid'
import type { Project } from '@/app/lib/projects/types'

const mockProjects: Project[] = [
  {
    name: 'onboarding',
    slug: 'onboarding',
    description: 'PizzaDAO onboarding application',
    githubUrl: 'https://github.com/PizzaDAO/onboarding',
    defaultBranch: 'main',
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2024-01-15T00:00:00Z',
    pushedAt: '2024-01-15T00:00:00Z',
    techStack: ['TypeScript', 'Next.js'],
    activityLevel: 'active',
    status: 'active',
    liveUrl: 'https://pizzadao.org',
    openPRs: 3,
    openIssues: 5,
    contributors: [],
    recentCommits: [],
  },
  {
    name: 'rsv-pizza',
    slug: 'rsv-pizza',
    description: 'Pizza party RSVP app',
    githubUrl: 'https://github.com/PizzaDAO/rsv-pizza',
    defaultBranch: 'main',
    createdAt: '2023-06-01T00:00:00Z',
    updatedAt: '2024-01-10T00:00:00Z',
    pushedAt: '2024-01-10T00:00:00Z',
    techStack: ['TypeScript', 'React'],
    activityLevel: 'active',
    status: 'active',
    liveUrl: 'https://rsv.pizza',
    openPRs: 1,
    openIssues: 2,
    contributors: [],
    recentCommits: [],
  },
  {
    name: 'smart-contracts',
    slug: 'smart-contracts',
    description: 'PizzaDAO smart contracts',
    githubUrl: 'https://github.com/PizzaDAO/smart-contracts',
    defaultBranch: 'main',
    createdAt: '2022-01-01T00:00:00Z',
    updatedAt: '2023-06-01T00:00:00Z',
    pushedAt: '2023-06-01T00:00:00Z',
    techStack: ['Solidity', 'Hardhat'],
    activityLevel: 'stale',
    status: 'maintenance',
    openPRs: 0,
    openIssues: 1,
    contributors: [],
    recentCommits: [],
  },
]

describe('ProjectGrid', () => {
  it('renders a grid of ProjectCards', () => {
    render(<ProjectGrid projects={mockProjects} />)

    expect(screen.getByText('onboarding')).toBeInTheDocument()
    expect(screen.getByText('rsv-pizza')).toBeInTheDocument()
    expect(screen.getByText('smart-contracts')).toBeInTheDocument()
  })

  it('renders the correct number of project cards', () => {
    render(<ProjectGrid projects={mockProjects} />)

    // Each project has a GitHub link
    const githubLinks = screen.getAllByRole('link', { name: /github/i })
    expect(githubLinks).toHaveLength(3)
  })

  it('has responsive grid layout classes', () => {
    const { container } = render(<ProjectGrid projects={mockProjects} />)

    const grid = container.firstChild as HTMLElement
    expect(grid).toHaveClass('grid')
    // Check for responsive grid column classes
    expect(grid.className).toMatch(/grid-cols-1/)
    expect(grid.className).toMatch(/md:grid-cols-2/)
    expect(grid.className).toMatch(/lg:grid-cols-3/)
  })

  it('renders empty state when no projects', () => {
    render(<ProjectGrid projects={[]} />)

    expect(screen.getByText('No Projects Found')).toBeInTheDocument()
  })

  it('renders loading skeleton when loading prop is true', () => {
    render(<ProjectGrid projects={[]} loading={true} />)

    // Should have skeleton cards
    const skeletons = screen.getAllByTestId('project-skeleton')
    expect(skeletons.length).toBeGreaterThan(0)
  })
})
