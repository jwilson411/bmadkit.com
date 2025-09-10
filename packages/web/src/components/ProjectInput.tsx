import React, { useState, useCallback, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { cn } from '@/utils/cn';
import { 
  validateProjectInput, 
  getCharacterCount, 
  getWordCount, 
  assessInputQuality,
  sanitizeInput 
} from '@/utils/validation';
import { 
  setInputValidation, 
  clearInputValidation, 
  createSession,
  selectIsLoading,
  selectInputValidation,
  selectError 
} from '@/store/sessionSlice';
import type { AppDispatch } from '@/store';
import type { ProjectInputFormState } from '@/types/session';

interface ProjectInputProps {
  onSubmit?: (projectInput: string) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}

const PROJECT_EXAMPLES = [
  "I want to build a mobile app that helps people find and book local services like plumbers, electricians, and handymen...",
  "I have an idea for an e-commerce platform that connects local farmers directly with restaurants...",
  "I need to create a SaaS tool for small businesses to manage their social media presence across multiple platforms...",
  "I want to develop a fitness app that creates personalized workout plans based on user goals and available equipment..."
];

export default function ProjectInput({ 
  onSubmit, 
  className, 
  placeholder, 
  autoFocus = false,
  disabled = false 
}: ProjectInputProps) {
  const dispatch = useDispatch<AppDispatch>();
  const isLoading = useSelector(selectIsLoading);
  const inputValidation = useSelector(selectInputValidation);
  const error = useSelector(selectError);
  
  const [formState, setFormState] = useState<ProjectInputFormState>({
    projectInput: '',
    isSubmitting: false,
    characterCount: 0,
    isValid: false,
    errors: []
  });
  
  const [showExamples, setShowExamples] = useState(false);
  const [selectedExample, setSelectedExample] = useState<string | null>(null);

  // Real-time validation
  const handleInputChange = useCallback((value: string) => {
    const sanitizedValue = sanitizeInput(value);
    const characterCount = getCharacterCount(sanitizedValue);
    const validation = validateProjectInput(sanitizedValue);
    
    setFormState(prev => ({
      ...prev,
      projectInput: sanitizedValue,
      characterCount: characterCount.current,
      isValid: validation.isValid,
      errors: validation.errors
    }));
    
    // Update Redux validation state
    if (!validation.isValid || validation.warnings.length > 0) {
      dispatch(setInputValidation({
        isValid: validation.isValid,
        errors: validation.errors.map(error => ({ field: 'projectInput', message: error })),
        warnings: validation.warnings.map(warning => ({ field: 'projectInput', message: warning }))
      }));
    } else {
      dispatch(clearInputValidation());
    }
  }, [dispatch]);

  // Handle form submission
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formState.isValid || isLoading || disabled) {
      return;
    }

    setFormState(prev => ({ ...prev, isSubmitting: true }));
    
    try {
      const result = await dispatch(createSession({
        projectInput: formState.projectInput,
        anonymous: true, // For MVP, all sessions are anonymous
      })).unwrap();
      
      onSubmit?.(formState.projectInput);
      
      // Reset form after successful submission
      setFormState({
        projectInput: '',
        isSubmitting: false,
        characterCount: 0,
        isValid: false,
        errors: []
      });
      dispatch(clearInputValidation());
      
    } catch (error) {
      console.error('Failed to create session:', error);
      setFormState(prev => ({ ...prev, isSubmitting: false }));
    }
  }, [formState, isLoading, disabled, dispatch, onSubmit]);

  // Handle example selection
  const handleExampleSelect = useCallback((example: string) => {
    handleInputChange(example);
    setSelectedExample(example);
    setShowExamples(false);
  }, [handleInputChange]);

  // Get character count styling
  const getCharacterCountStyle = () => {
    const percentage = (formState.characterCount / 2000) * 100;
    if (percentage >= 90) return 'text-red-600';
    if (percentage >= 75) return 'text-orange-500';
    return 'text-gray-500';
  };

  // Get input quality assessment
  const qualityAssessment = formState.projectInput ? assessInputQuality(formState.projectInput) : null;

  return (
    <div className={cn("w-full max-w-4xl mx-auto", className)}>
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Main input area */}
        <div className="relative">
          <div className="relative">
            <textarea
              value={formState.projectInput}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder={placeholder || "Describe your project idea, goals, and any specific requirements you have in mind..."}
              className={cn(
                "textarea-primary w-full min-h-[120px] max-h-[300px] text-lg",
                "placeholder:text-gray-400 placeholder:italic",
                "transition-all duration-200",
                formState.projectInput && "min-h-[150px]",
                inputValidation?.errors.length && "border-red-300 focus:border-red-500 focus:ring-red-500",
                qualityAssessment?.quality === 'good' && "border-green-300 focus:border-green-500 focus:ring-green-500"
              )}
              autoFocus={autoFocus}
              disabled={disabled || isLoading}
              rows={4}
              aria-describedby="project-input-help"
            />
            
            {/* Character count */}
            <div className="absolute bottom-3 right-3 text-sm">
              <span className={cn("font-medium", getCharacterCountStyle())}>
                {formState.characterCount}/2000
              </span>
            </div>
          </div>

          {/* Examples toggle */}
          {!formState.projectInput && (
            <button
              type="button"
              onClick={() => setShowExamples(!showExamples)}
              className="absolute top-3 right-3 text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors"
            >
              {showExamples ? 'Hide examples' : 'See examples'}
            </button>
          )}
        </div>

        {/* Example suggestions */}
        {showExamples && !formState.projectInput && (
          <div className="bg-gray-50 rounded-lg p-4 space-y-3 animate-slide-up">
            <h4 className="font-medium text-gray-900">Example project ideas:</h4>
            <div className="space-y-2">
              {PROJECT_EXAMPLES.map((example, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => handleExampleSelect(example)}
                  className="block w-full text-left p-3 text-sm text-gray-700 bg-white rounded border border-gray-200 hover:border-primary-300 hover:bg-primary-50 transition-colors duration-200"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Validation messages */}
        {inputValidation && (
          <div className="space-y-2">
            {inputValidation.errors.map((error, index) => (
              <p key={index} className="text-sm text-red-600 flex items-center">
                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {error.message}
              </p>
            ))}
            {inputValidation.warnings?.map((warning, index) => (
              <p key={index} className="text-sm text-orange-600 flex items-center">
                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {warning.message}
              </p>
            ))}
          </div>
        )}

        {/* Quality indicator */}
        {qualityAssessment && formState.projectInput.length > 20 && (
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Input Quality</span>
              <div className="flex items-center space-x-2">
                <div className="flex space-x-1">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <div
                      key={level}
                      className={cn(
                        "w-2 h-2 rounded-full",
                        qualityAssessment.score >= level * 20 
                          ? qualityAssessment.quality === 'good' 
                            ? 'bg-green-500' 
                            : qualityAssessment.quality === 'fair' 
                            ? 'bg-yellow-500' 
                            : 'bg-red-500'
                          : 'bg-gray-300'
                      )}
                    />
                  ))}
                </div>
                <span className={cn(
                  "text-xs font-medium",
                  qualityAssessment.quality === 'good' && 'text-green-600',
                  qualityAssessment.quality === 'fair' && 'text-yellow-600',
                  qualityAssessment.quality === 'needs-improvement' && 'text-red-600'
                )}>
                  {qualityAssessment.quality.replace('-', ' ')}
                </span>
              </div>
            </div>
            {qualityAssessment.feedback.length > 0 && (
              <div className="text-xs text-gray-600">
                <p>Suggestions:</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  {qualityAssessment.feedback.map((feedback, index) => (
                    <li key={index}>{feedback}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Submit button */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="text-sm text-gray-600">
            <span className="font-medium">{getWordCount(formState.projectInput)}</span> words • 
            <span className="ml-1">Takes ~2 minutes to analyze</span>
          </div>
          
          <button
            type="submit"
            disabled={!formState.isValid || isLoading || disabled}
            className={cn(
              "btn-primary touch-target",
              "min-w-[200px] sm:min-w-[160px]",
              (!formState.isValid || isLoading || disabled) && "opacity-50 cursor-not-allowed"
            )}
          >
            {isLoading ? (
              <div className="flex items-center justify-center">
                <div className="loading-spinner w-4 h-4 mr-2" />
                Creating Session...
              </div>
            ) : (
              'Start Planning Session'
            )}
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex">
              <svg className="w-5 h-5 text-red-400 mt-0.5 mr-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <h4 className="text-red-800 font-medium">Unable to start session</h4>
                <p className="text-red-700 text-sm mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}
      </form>

      {/* Help text */}
      <div id="project-input-help" className="mt-6 text-sm text-gray-600">
        <p>💡 <strong>Pro tip:</strong> The more details you provide about your goals, constraints, and vision, the better our AI experts can help you create a comprehensive plan.</p>
      </div>
    </div>
  );
}