import axios, { AxiosResponse } from 'axios';
import type { 
  SessionCreationRequest,
  SessionCreationResponse,
  PlanningSession,
  SessionResumeResponse,
  ApiResponse
} from '@/types/session';

// API configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
const API_TIMEOUT = 10000; // 10 seconds

// Create axios instance
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for auth tokens
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Handle authentication errors
      localStorage.removeItem('authToken');
      // Could redirect to login here
    }
    
    if (error.response?.status >= 500) {
      // Handle server errors
      console.error('Server error:', error.response.data);
    }
    
    if (error.code === 'ECONNABORTED') {
      // Handle timeout errors
      error.message = 'Request timeout. Please check your connection and try again.';
    }
    
    return Promise.reject(error);
  }
);

// Session API methods
export const sessionApi = {
  // Create a new planning session
  async createSession(request: SessionCreationRequest): Promise<AxiosResponse<SessionCreationResponse>> {
    try {
      const response = await apiClient.post('/api/sessions', request);
      
      // Store session info in localStorage for anonymous users
      if (request.anonymous) {
        const sessionInfo = {
          sessionId: response.data.session.id,
          createdAt: response.data.session.createdAt,
          projectInput: request.projectInput
        };
        localStorage.setItem('anonymousSession', JSON.stringify(sessionInfo));
      }
      
      return response;
    } catch (error) {
      console.error('Failed to create session:', error);
      throw error;
    }
  },

  // Get existing session by ID
  async getSession(sessionId: string): Promise<AxiosResponse<SessionResumeResponse>> {
    try {
      return await apiClient.get(`/api/sessions/${sessionId}`);
    } catch (error) {
      console.error('Failed to get session:', error);
      throw error;
    }
  },

  // Update session data
  async updateSession(sessionId: string, updates: Partial<PlanningSession>): Promise<AxiosResponse<PlanningSession>> {
    try {
      return await apiClient.patch(`/api/sessions/${sessionId}`, updates);
    } catch (error) {
      console.error('Failed to update session:', error);
      throw error;
    }
  },

  // Delete/end session
  async endSession(sessionId: string): Promise<AxiosResponse<ApiResponse>> {
    try {
      const response = await apiClient.delete(`/api/sessions/${sessionId}`);
      
      // Clean up localStorage
      const storedSession = localStorage.getItem('anonymousSession');
      if (storedSession) {
        const sessionInfo = JSON.parse(storedSession);
        if (sessionInfo.sessionId === sessionId) {
          localStorage.removeItem('anonymousSession');
        }
      }
      
      return response;
    } catch (error) {
      console.error('Failed to end session:', error);
      throw error;
    }
  },

  // Submit user response/message
  async submitMessage(sessionId: string, message: string, messageType: 'user' | 'system' = 'user'): Promise<AxiosResponse<ApiResponse>> {
    try {
      return await apiClient.post(`/api/sessions/${sessionId}/messages`, {
        content: message,
        type: messageType,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to submit message:', error);
      throw error;
    }
  },

  // Get session analytics/metrics
  async getSessionMetrics(sessionId: string): Promise<AxiosResponse<any>> {
    try {
      return await apiClient.get(`/api/sessions/${sessionId}/metrics`);
    } catch (error) {
      console.error('Failed to get session metrics:', error);
      throw error;
    }
  }
};

// Health check API
export const healthApi = {
  async checkHealth(): Promise<AxiosResponse<{ status: string; timestamp: string }>> {
    return await apiClient.get('/health');
  },

  async checkReady(): Promise<AxiosResponse<{ status: string; checks: Record<string, string> }>> {
    return await apiClient.get('/ready');
  }
};

// Utility functions
export const getApiErrorMessage = (error: any): string => {
  if (error.response?.data?.error?.message) {
    return error.response.data.error.message;
  }
  
  if (error.response?.data?.message) {
    return error.response.data.message;
  }
  
  if (error.message) {
    return error.message;
  }
  
  return 'An unexpected error occurred. Please try again.';
};

export const isNetworkError = (error: any): boolean => {
  return error.code === 'NETWORK_ERROR' || 
         error.code === 'ECONNABORTED' ||
         error.message?.includes('Network Error') ||
         !error.response;
};

export const shouldRetry = (error: any): boolean => {
  // Retry on network errors and 5xx server errors
  return isNetworkError(error) || 
         (error.response?.status >= 500 && error.response?.status < 600);
};

// Retry wrapper for API calls
export const withRetry = async <T>(
  apiCall: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error;
      }
      
      // Exponential backoff
      const delay = delayMs * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      console.log(`API call failed, retrying (${attempt}/${maxRetries})...`);
    }
  }
  
  throw lastError;
};

export default apiClient;