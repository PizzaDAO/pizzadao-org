import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchPizzaDAORepos,
  fetchRepoDetails,
  detectTechStack,
  calculateActivityLevel,
  transformGitHubRepo,
} from './github'
import type { GitHubRepo, GitHubPullRequest, GitHubContributor, GitHubCommit } from './types'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Minimal Response-like object: github.ts reads bodies via response.text()
function mockJsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  }
}

describe('GitHub API Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fetchPizzaDAORepos', () => {
    it('should return an array of repos from PizzaDAO organization', async () => {
      const mockRepos: GitHubRepo[] = [
        {
          id: 1,
          name: 'onboarding',
          full_name: 'PizzaDAO/onboarding',
          description: 'PizzaDAO onboarding app',
          html_url: 'https://github.com/PizzaDAO/onboarding',
          homepage: null,
          default_branch: 'main',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2024-01-15T00:00:00Z',
          pushed_at: '2024-01-15T00:00:00Z',
          open_issues_count: 5,
          language: 'TypeScript',
          topics: ['nextjs', 'typescript'],
          archived: false,
          fork: false,
        },
        {
          id: 2,
          name: 'rsv-pizza',
          full_name: 'PizzaDAO/rsv-pizza',
          description: 'Pizza party RSVP app',
          html_url: 'https://github.com/PizzaDAO/rsv-pizza',
          homepage: null,
          default_branch: 'main',
          created_at: '2023-06-01T00:00:00Z',
          updated_at: '2024-01-10T00:00:00Z',
          pushed_at: '2024-01-10T00:00:00Z',
          open_issues_count: 3,
          language: 'TypeScript',
          topics: ['react', 'typescript'],
          archived: false,
          fork: false,
        },
      ]

      mockFetch.mockResolvedValueOnce(mockJsonResponse(mockRepos))

      const repos = await fetchPizzaDAORepos()

      expect(repos).toBeInstanceOf(Array)
      expect(repos.length).toBe(2)
      expect(repos[0].name).toBe('onboarding')
      expect(repos[1].name).toBe('rsv-pizza')
    })

    it('should filter out forked repositories', async () => {
      const mockRepos: GitHubRepo[] = [
        {
          id: 1,
          name: 'onboarding',
          full_name: 'PizzaDAO/onboarding',
          description: 'PizzaDAO onboarding app',
          html_url: 'https://github.com/PizzaDAO/onboarding',
          homepage: null,
          default_branch: 'main',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2024-01-15T00:00:00Z',
          pushed_at: '2024-01-15T00:00:00Z',
          open_issues_count: 5,
          language: 'TypeScript',
          topics: [],
          archived: false,
          fork: false,
        },
        {
          id: 2,
          name: 'forked-repo',
          full_name: 'PizzaDAO/forked-repo',
          description: 'A forked repo',
          html_url: 'https://github.com/PizzaDAO/forked-repo',
          homepage: null,
          default_branch: 'main',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          pushed_at: '2024-01-01T00:00:00Z',
          open_issues_count: 0,
          language: 'JavaScript',
          topics: [],
          archived: false,
          fork: true,
        },
      ]

      mockFetch.mockResolvedValueOnce(mockJsonResponse(mockRepos))

      const repos = await fetchPizzaDAORepos()

      expect(repos.length).toBe(1)
      expect(repos[0].name).toBe('onboarding')
    })

    it('should throw an error when API call fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers(),
      })

      await expect(fetchPizzaDAORepos()).rejects.toThrow('GitHub API error (fetching repos): 403 Forbidden')
    })
  })

  describe('fetchRepoDetails', () => {
    it('should return repo details with PRs, issues, and contributors', async () => {
      const mockPRs: GitHubPullRequest[] = [
        {
          id: 1,
          number: 42,
          title: 'Add new feature',
          state: 'open',
          html_url: 'https://github.com/PizzaDAO/onboarding/pull/42',
          user: { login: 'contributor1', avatar_url: 'https://avatar.com/1' },
          head: { ref: 'feature/new-thing' },
          created_at: '2024-01-10T00:00:00Z',
          updated_at: '2024-01-12T00:00:00Z',
        },
      ]

      const mockContributors: GitHubContributor[] = [
        {
          login: 'contributor1',
          avatar_url: 'https://avatar.com/1',
          contributions: 50,
          html_url: 'https://github.com/contributor1',
        },
      ]

      const mockCommits: GitHubCommit[] = [
        {
          sha: 'abc123',
          commit: {
            message: 'Initial commit',
            author: { name: 'John', date: '2024-01-15T00:00:00Z' },
          },
          author: { login: 'contributor1', avatar_url: 'https://avatar.com/1' },
          html_url: 'https://github.com/PizzaDAO/onboarding/commit/abc123',
        },
      ]

      // Mock for PRs
      mockFetch.mockResolvedValueOnce(mockJsonResponse(mockPRs))
      // Mock for contributors
      mockFetch.mockResolvedValueOnce(mockJsonResponse(mockContributors))
      // Mock for commits
      mockFetch.mockResolvedValueOnce(mockJsonResponse(mockCommits))

      const details = await fetchRepoDetails('onboarding')

      expect(details.openPRs).toBe(1)
      expect(details.contributors.length).toBe(1)
      expect(details.contributors[0].login).toBe('contributor1')
      expect(details.recentCommits.length).toBe(1)
      expect(details.recentCommits[0].sha).toBe('abc123')
    })
  })

  describe('detectTechStack', () => {
    it('should detect TypeScript from repo language', () => {
      const repo: GitHubRepo = {
        id: 1,
        name: 'test-repo',
        full_name: 'PizzaDAO/test-repo',
        description: null,
        html_url: 'https://github.com/PizzaDAO/test-repo',
        homepage: null,
        default_branch: 'main',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2024-01-15T00:00:00Z',
        pushed_at: '2024-01-15T00:00:00Z',
        open_issues_count: 0,
        language: 'TypeScript',
        topics: ['nextjs'],
        archived: false,
        fork: false,
      }

      const techStack = detectTechStack(repo)

      expect(techStack).toContain('TypeScript')
      expect(techStack).toContain('Next.js')
    })

    it('should detect Solidity from topics', () => {
      const repo: GitHubRepo = {
        id: 1,
        name: 'smart-contract',
        full_name: 'PizzaDAO/smart-contract',
        description: null,
        html_url: 'https://github.com/PizzaDAO/smart-contract',
        homepage: null,
        default_branch: 'main',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2024-01-15T00:00:00Z',
        pushed_at: '2024-01-15T00:00:00Z',
        open_issues_count: 0,
        language: 'Solidity',
        topics: ['ethereum', 'solidity', 'hardhat'],
        archived: false,
        fork: false,
      }

      const techStack = detectTechStack(repo)

      expect(techStack).toContain('Solidity')
      expect(techStack).toContain('Ethereum')
      expect(techStack).toContain('Hardhat')
    })

    it('should return empty array for repo with no language', () => {
      const repo: GitHubRepo = {
        id: 1,
        name: 'docs-only',
        full_name: 'PizzaDAO/docs-only',
        description: null,
        html_url: 'https://github.com/PizzaDAO/docs-only',
        homepage: null,
        default_branch: 'main',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2024-01-15T00:00:00Z',
        pushed_at: '2024-01-15T00:00:00Z',
        open_issues_count: 0,
        language: null,
        topics: [],
        archived: false,
        fork: false,
      }

      const techStack = detectTechStack(repo)

      expect(techStack).toEqual([])
    })
  })

  describe('calculateActivityLevel', () => {
    it('should return "active" for repos updated within 30 days', () => {
      const recentDate = new Date()
      recentDate.setDate(recentDate.getDate() - 15) // 15 days ago

      const level = calculateActivityLevel(recentDate.toISOString())

      expect(level).toBe('active')
    })

    it('should return "stale" for repos updated between 30-90 days ago', () => {
      const staleDate = new Date()
      staleDate.setDate(staleDate.getDate() - 60) // 60 days ago

      const level = calculateActivityLevel(staleDate.toISOString())

      expect(level).toBe('stale')
    })

    it('should return "dormant" for repos not updated for 90+ days', () => {
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 120) // 120 days ago

      const level = calculateActivityLevel(oldDate.toISOString())

      expect(level).toBe('dormant')
    })
  })

  describe('transformGitHubRepo', () => {
    it('should transform GitHub repo to Project interface', () => {
      const repo: GitHubRepo = {
        id: 1,
        name: 'onboarding',
        full_name: 'PizzaDAO/onboarding',
        description: 'PizzaDAO onboarding app',
        html_url: 'https://github.com/PizzaDAO/onboarding',
        homepage: null,
        default_branch: 'main',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2024-01-15T00:00:00Z',
        pushed_at: '2024-01-15T00:00:00Z',
        open_issues_count: 5,
        language: 'TypeScript',
        topics: ['nextjs'],
        archived: false,
        fork: false,
      }

      const config = {
        status: 'active' as const,
        liveUrl: 'https://pizzadao.org',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/123',
      }

      const project = transformGitHubRepo(repo, config)

      expect(project.name).toBe('onboarding')
      expect(project.slug).toBe('onboarding')
      expect(project.description).toBe('PizzaDAO onboarding app')
      expect(project.githubUrl).toBe('https://github.com/PizzaDAO/onboarding')
      expect(project.status).toBe('active')
      expect(project.liveUrl).toBe('https://pizzadao.org')
      expect(project.techStack).toContain('TypeScript')
      expect(project.techStack).toContain('Next.js')
    })

    it('should default status to "planning" for non-archived repos without a live URL', () => {
      const repo: GitHubRepo = {
        id: 1,
        name: 'new-repo',
        full_name: 'PizzaDAO/new-repo',
        description: null,
        html_url: 'https://github.com/PizzaDAO/new-repo',
        homepage: null,
        default_branch: 'main',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2024-01-15T00:00:00Z',
        pushed_at: '2024-01-15T00:00:00Z',
        open_issues_count: 0,
        language: null,
        topics: [],
        archived: false,
        fork: false,
      }

      const project = transformGitHubRepo(repo)

      expect(project.status).toBe('planning')
    })

    it('should default status to "active" when the repo has a homepage', () => {
      const repo: GitHubRepo = {
        id: 1,
        name: 'live-repo',
        full_name: 'PizzaDAO/live-repo',
        description: null,
        html_url: 'https://github.com/PizzaDAO/live-repo',
        homepage: 'https://live.pizzadao.org',
        default_branch: 'main',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2024-01-15T00:00:00Z',
        pushed_at: '2024-01-15T00:00:00Z',
        open_issues_count: 0,
        language: null,
        topics: [],
        archived: false,
        fork: false,
      }

      const project = transformGitHubRepo(repo)

      expect(project.status).toBe('active')
      expect(project.liveUrl).toBe('https://live.pizzadao.org')
    })

    it('should set status to "archived" for archived repos', () => {
      const repo: GitHubRepo = {
        id: 1,
        name: 'old-repo',
        full_name: 'PizzaDAO/old-repo',
        description: null,
        html_url: 'https://github.com/PizzaDAO/old-repo',
        homepage: null,
        default_branch: 'main',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-15T00:00:00Z',
        pushed_at: '2023-01-15T00:00:00Z',
        open_issues_count: 0,
        language: null,
        topics: [],
        archived: true,
        fork: false,
      }

      const project = transformGitHubRepo(repo)

      expect(project.status).toBe('archived')
    })
  })
})
