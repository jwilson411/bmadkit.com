import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import sessionReducer from '@/store/sessionSlice';
import ProjectInput from '@/components/ProjectInput';
import { localStorageMock } from '@/test/setup';

// Mock API
vi.mock('@/services/api', () => ({
  sessionApi: {
    createSession: vi.fn(() => Promise.resolve({
      data: {
        session: {
          id: 'test-session-123',
          projectInput: 'Test project',
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sessionData: {
            conversationHistory: [],
            currentPhase: 'Analysis',
            agentSequence: ['ANALYST'],
            documentsGenerated: [],
            metadata: {}
          }
        },
        followUpQuestions: []
      }
    }))
  }
}));

const createTestStore = () =>
  configureStore({
    reducer: {
      session: sessionReducer,
    },
  });

const renderWithStore = (component: React.ReactElement) => {
  const store = createTestStore();
  return {
    ...render(
      <Provider store={store}>
        {component}
      </Provider>
    ),
    store,
  };
};

describe('ProjectInput Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it('renders project input form', () => {
    renderWithStore(<ProjectInput />);
    
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start planning session/i })).toBeInTheDocument();
    expect(screen.getByText(/see examples/i)).toBeInTheDocument();
  });

  it('shows character count', async () => {
    const user = userEvent.setup();
    renderWithStore(<ProjectInput />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Hello world');
    
    expect(screen.getByText('11/2000')).toBeInTheDocument();
  });

  it('validates minimum input length', async () => {
    const user = userEvent.setup();
    renderWithStore(<ProjectInput />);
    
    const textarea = screen.getByRole('textbox');
    const submitButton = screen.getByRole('button', { name: /start planning session/i });
    
    await user.type(textarea, 'Short');
    
    expect(submitButton).toBeDisabled();
    expect(screen.getByText(/please describe your project idea in at least 10 characters/i)).toBeInTheDocument();
  });

  it('validates maximum input length', async () => {
    const user = userEvent.setup();
    renderWithStore(<ProjectInput />);
    
    const textarea = screen.getByRole('textbox');
    const longText = 'a'.repeat(2001);
    
    await user.type(textarea, longText);
    
    expect(screen.getByText(/project description must be less than 2000 characters/i)).toBeInTheDocument();
  });

  it('shows project examples when requested', async () => {
    const user = userEvent.setup();
    renderWithStore(<ProjectInput />);
    
    const examplesButton = screen.getByText(/see examples/i);
    await user.click(examplesButton);
    
    expect(screen.getByText(/example project ideas/i)).toBeInTheDocument();
    expect(screen.getByText(/mobile app that helps people find/i)).toBeInTheDocument();
  });

  it('fills input with selected example', async () => {
    const user = userEvent.setup();
    renderWithStore(<ProjectInput />);
    
    const examplesButton = screen.getByText(/see examples/i);
    await user.click(examplesButton);
    
    const firstExample = screen.getByText(/mobile app that helps people find/i);
    await user.click(firstExample);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue(expect.stringContaining('mobile app that helps people find'));
    expect(screen.queryByText(/example project ideas/i)).not.toBeInTheDocument();
  });

  it('shows input quality assessment', async () => {
    const user = userEvent.setup();
    renderWithStore(<ProjectInput />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'I want to build a comprehensive mobile application that helps users manage their daily tasks and goals');
    
    await waitFor(() => {
      expect(screen.getByText(/input quality/i)).toBeInTheDocument();
    });
  });

  it('shows word count', async () => {
    const user = userEvent.setup();
    renderWithStore(<ProjectInput />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Hello world this is a test');
    
    expect(screen.getByText(/6 words/i)).toBeInTheDocument();
  });

  it('enables submit button with valid input', async () => {
    const user = userEvent.setup();
    renderWithStore(<ProjectInput />);
    
    const textarea = screen.getByRole('textbox');
    const submitButton = screen.getByRole('button', { name: /start planning session/i });
    
    await user.type(textarea, 'I want to build a mobile app for task management');
    
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
  });

  it('calls onSubmit when form is submitted', async () => {
    const mockOnSubmit = vi.fn();
    const user = userEvent.setup();
    
    renderWithStore(<ProjectInput onSubmit={mockOnSubmit} />);
    
    const textarea = screen.getByRole('textbox');
    const submitButton = screen.getByRole('button', { name: /start planning session/i });
    
    await user.type(textarea, 'I want to build a mobile app for task management');
    
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
    
    await user.click(submitButton);
    
    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith('I want to build a mobile app for task management');
    });
  });

  it('shows loading state during submission', async () => {
    const user = userEvent.setup();
    renderWithStore(<ProjectInput />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'I want to build a mobile app for task management');
    
    const submitButton = screen.getByRole('button', { name: /start planning session/i });
    await user.click(submitButton);
    
    expect(screen.getByText(/creating session/i)).toBeInTheDocument();
  });

  it('handles API errors gracefully', async () => {
    // Mock API failure
    const { sessionApi } = await import('@/services/api');
    vi.mocked(sessionApi.createSession).mockRejectedValueOnce(new Error('Network error'));
    
    const user = userEvent.setup();
    renderWithStore(<ProjectInput />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'I want to build a mobile app for task management');
    
    const submitButton = screen.getByRole('button', { name: /start planning session/i });
    await user.click(submitButton);
    
    await waitFor(() => {
      expect(screen.getByText(/unable to start session/i)).toBeInTheDocument();
    });
  });

  it('sanitizes input to prevent XSS', async () => {
    const user = userEvent.setup();
    renderWithStore(<ProjectInput />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'I want to build <script>alert("xss")</script> a mobile app');
    
    expect(textarea).toHaveValue('I want to build alert("xss") a mobile app');
  });

  it('provides accessibility features', () => {
    renderWithStore(<ProjectInput />);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('aria-describedby', 'project-input-help');
    
    const helpText = screen.getByText(/pro tip/i);
    expect(helpText).toBeInTheDocument();
  });

  it('supports keyboard navigation', async () => {
    const user = userEvent.setup();
    renderWithStore(<ProjectInput />);
    
    // Tab to textarea
    await user.tab();
    expect(screen.getByRole('textbox')).toHaveFocus();
    
    // Tab to examples button
    await user.tab();
    expect(screen.getByText(/see examples/i)).toHaveFocus();
  });

  it('auto-focuses when autoFocus prop is true', () => {
    renderWithStore(<ProjectInput autoFocus />);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveFocus();
  });

  it('disables input when disabled prop is true', () => {
    renderWithStore(<ProjectInput disabled />);
    
    const textarea = screen.getByRole('textbox');
    const submitButton = screen.getByRole('button', { name: /start planning session/i });
    
    expect(textarea).toBeDisabled();
    expect(submitButton).toBeDisabled();
  });
});