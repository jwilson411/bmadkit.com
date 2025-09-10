import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { cn } from '@/utils/cn';
import { useSession } from '@/hooks/useSession';
import { useWebSocket } from '@/hooks/useWebSocket';
import { 
  selectCurrentSession, 
  selectConversationHistory, 
  selectProgress 
} from '@/store/sessionSlice';
import { 
  AIProcessingIndicator, 
  ConnectionStatus, 
  ProgressBar, 
  AgentIndicator,
  LoadingSpinner 
} from '@/components/LoadingStates';

export default function Planning() {
  const navigate = useNavigate();
  const currentSession = useSelector(selectCurrentSession);
  const conversationHistory = useSelector(selectConversationHistory);
  const progress = useSelector(selectProgress);
  
  const { isSessionActive, isLoading } = useSession();
  const { isConnected, connectionStatus, emit } = useWebSocket();

  // Redirect if no session
  useEffect(() => {
    if (!isLoading && !currentSession) {
      navigate('/');
    }
  }, [currentSession, isLoading, navigate]);

  // Send ping periodically to maintain connection
  useEffect(() => {
    if (isConnected) {
      const pingInterval = setInterval(() => {
        emit('ping', undefined, (response: any) => {
          console.log('Ping response:', response);
        });
      }, 30000); // Ping every 30 seconds

      return () => clearInterval(pingInterval);
    }
  }, [isConnected, emit]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner size="lg" className="mx-auto mb-4" />
          <p className="text-gray-600">Loading your session...</p>
        </div>
      </div>
    );
  }

  if (!currentSession) {
    return null; // Will redirect
  }

  const currentAgent = currentSession.sessionData.metadata?.currentAgent;
  const agentStatus = currentSession.sessionData.metadata?.agentStatus || 'WORKING';
  const currentTask = currentSession.sessionData.metadata?.currentTask || 'Analyzing your project';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900">
                <span className="text-primary-600">BMAD</span> Planning Session
              </h1>
            </div>
            
            <div className="flex items-center space-x-4">
              <ConnectionStatus status={connectionStatus} />
              <button
                onClick={() => navigate('/')}
                className="btn-ghost"
              >
                End Session
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content Area */}
          <div className="lg:col-span-2 space-y-6">
            {/* Project Overview */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Project</h2>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-gray-700">{currentSession.projectInput}</p>
              </div>
            </div>

            {/* Progress Section */}
            {progress && (
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Progress</h2>
                <ProgressBar
                  percentage={progress.percentage}
                  label={progress.currentPhase}
                  className="mb-4"
                />
                <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                  <div>
                    <span className="font-medium">Completed:</span> {progress.completedTasks}/{progress.totalTasks} tasks
                  </div>
                  {progress.estimatedTimeRemaining && (
                    <div>
                      <span className="font-medium">Time remaining:</span> ~{Math.round(progress.estimatedTimeRemaining / 60)} min
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Current Agent Status */}
            {currentAgent && (
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Current Activity</h2>
                <AgentIndicator
                  agentType={currentAgent}
                  status={agentStatus}
                  task={currentTask}
                />
              </div>
            )}

            {/* Conversation History */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Session Activity</h2>
              
              {conversationHistory.length === 0 ? (
                <AIProcessingIndicator message="Session starting... Our AI experts are getting ready to analyze your project." />
              ) : (
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {conversationHistory.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        'flex space-x-3',
                        message.type === 'user' && 'flex-row-reverse space-x-reverse'
                      )}
                    >
                      <div className="flex-shrink-0">
                        {message.type === 'system' ? (
                          <div className="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                          </div>
                        ) : message.type === 'agent' ? (
                          <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z" />
                            </svg>
                          </div>
                        ) : (
                          <div className="w-8 h-8 bg-secondary-600 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className={cn(
                          'px-4 py-2 rounded-lg max-w-lg',
                          message.type === 'user' 
                            ? 'bg-primary-600 text-white ml-auto' 
                            : message.type === 'agent'
                            ? 'bg-gray-100 text-gray-900'
                            : 'bg-blue-50 text-blue-900 border border-blue-200'
                        )}>
                          <p className="text-sm">{message.content}</p>
                          {message.agentType && message.type !== 'user' && (
                            <p className="text-xs mt-1 opacity-75">
                              {message.agentType.replace('_', ' ')}
                            </p>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(message.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Session Info */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Session Info</h3>
              <div className="space-y-3">
                <div>
                  <dt className="text-sm font-medium text-gray-500">Status</dt>
                  <dd className="text-sm text-gray-900 mt-1">
                    <span className={cn(
                      'inline-flex px-2 py-1 text-xs font-medium rounded-full',
                      currentSession.status === 'ACTIVE' && 'bg-green-100 text-green-800',
                      currentSession.status === 'PAUSED' && 'bg-yellow-100 text-yellow-800',
                      currentSession.status === 'COMPLETED' && 'bg-blue-100 text-blue-800'
                    )}>
                      {currentSession.status}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Started</dt>
                  <dd className="text-sm text-gray-900 mt-1">
                    {new Date(currentSession.createdAt).toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Connection</dt>
                  <dd className="text-sm text-gray-900 mt-1">
                    <span className={cn(
                      'inline-flex items-center',
                      isConnected ? 'text-green-600' : 'text-red-600'
                    )}>
                      <div className={cn(
                        'w-2 h-2 rounded-full mr-2',
                        isConnected ? 'bg-green-500' : 'bg-red-500'
                      )} />
                      {isConnected ? 'Connected' : 'Disconnected'}
                    </span>
                  </dd>
                </div>
              </div>
            </div>

            {/* Documents Generated */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Documents</h3>
              {currentSession.sessionData.documentsGenerated.length === 0 ? (
                <p className="text-sm text-gray-500">Documents will appear here as they're generated.</p>
              ) : (
                <div className="space-y-2">
                  {currentSession.sessionData.documentsGenerated.map((docId) => (
                    <div key={docId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-gray-900">Document {docId}</p>
                        <p className="text-xs text-gray-500">Generated</p>
                      </div>
                      <button className="btn-ghost text-xs">View</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
              <div className="space-y-2">
                <button
                  onClick={() => {
                    emit('session_control', { 
                      sessionId: currentSession.id, 
                      action: currentSession.status === 'PAUSED' ? 'resume' : 'pause' 
                    });
                  }}
                  className="w-full btn-secondary text-sm"
                  disabled={!isConnected}
                >
                  {currentSession.status === 'PAUSED' ? 'Resume' : 'Pause'} Session
                </button>
                <button
                  onClick={() => navigate('/')}
                  className="w-full btn-ghost text-sm"
                >
                  End Session
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}