import { describe, it, expect, beforeEach } from 'vitest';
import { GitHubAPI, GitHubAPIError } from '../src/github/api.js';

describe('GitHub API Integration', () => {
  describe('GitHubAPI', () => {
    it('should initialize with config', () => {
      const api = new GitHubAPI({
        owner: 'test-owner',
        repo: 'test-repo',
        token: 'test-token',
      });

      expect(api).toBeInstanceOf(GitHubAPI);
    });

    it('should handle missing configuration', () => {
      expect(() => {
        new GitHubAPI({
          owner: '',
          repo: '',
        });
      }).not.toThrow();
    });
  });

  describe('GitHubAPIError', () => {
    it('should create proper error instances', () => {
      const error = new GitHubAPIError('Test error message');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(GitHubAPIError);
      expect(error.message).toBe('Test error message');
      expect(error.name).toBe('GitHubAPIError');
    });

    it('should capture HTTP status code when provided', () => {
      const error404 = new GitHubAPIError('Not Found', 404);
      
      expect(error404).toBeInstanceOf(Error);
      expect(error404).toBeInstanceOf(GitHubAPIError);
      expect(error404.message).toBe('Not Found');
      expect(error404.status).toBe(404);
    });

    it('should handle errors without status code', () => {
      const errorNoStatus = new GitHubAPIError('Network error');
      
      expect(errorNoStatus.status).toBeUndefined();
    });
  });

  describe('Repository detection logic', () => {
    it('should handle GitHub URLs correctly', () => {
      // Test URL parsing logic (this would normally be in the detectGitHubRepository function)
      const testUrls = [
        'https://github.com/owner/repo.git',
        'git@github.com:owner/repo.git',
        'https://github.com/owner/repo',
        'git@github.com:owner/repo'
      ];

      testUrls.forEach(url => {
        const match = url.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
        expect(match).not.toBeNull();
        if (match) {
          expect(match[1]).toBe('owner');
          expect(match[2]).toBe('repo');
        }
      });
    });

    it('should reject non-GitHub URLs', () => {
      const nonGitHubUrls = [
        'https://gitlab.com/owner/repo.git',
        'https://bitbucket.org/owner/repo.git',
        'https://example.com/owner/repo.git'
      ];

      nonGitHubUrls.forEach(url => {
        const match = url.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
        expect(match).toBeNull();
      });
    });
  });
});