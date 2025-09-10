import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/utils/cn';
import ProjectInput from './ProjectInput';

export default function LandingPage() {
  const navigate = useNavigate();
  const [showInput, setShowInput] = useState(false);

  const handleGetStarted = () => {
    setShowInput(true);
  };

  const handleProjectSubmit = (projectInput: string) => {
    // Navigate to planning session after successful submission
    navigate('/planning');
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-lg border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">
                <span className="text-primary-600">BMAD</span>
              </h1>
            </div>
            <div className="hidden sm:flex items-center space-x-6">
              <a href="#how-it-works" className="text-gray-600 hover:text-gray-900 transition-colors">
                How it works
              </a>
              <a href="#examples" className="text-gray-600 hover:text-gray-900 transition-colors">
                Examples
              </a>
              <button className="btn-ghost">
                Sign In
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="pt-16">
        <div className="relative overflow-hidden">
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary-50 via-white to-secondary-50" />
          
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20 lg:py-28">
            <div className="text-center max-w-4xl mx-auto">
              {/* Main headline */}
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 leading-tight mb-6 animate-fade-in">
                <span className="text-balance">
                  Start making your{' '}
                  <span className="text-transparent bg-clip-text gradient-primary">
                    dreams a reality
                  </span>
                </span>
              </h1>

              {/* Subheadline */}
              <p className="text-xl sm:text-2xl text-gray-600 mb-8 max-w-3xl mx-auto text-balance animate-fade-in" style={{ animationDelay: '0.2s' }}>
                Transform your ideas into detailed business plans with our AI expert team. 
                Get professional analysis, architecture, and roadmaps in minutes.
              </p>

              {/* Value proposition */}
              <div className="flex flex-wrap justify-center items-center gap-6 sm:gap-8 mb-12 animate-fade-in" style={{ animationDelay: '0.4s' }}>
                <div className="flex items-center text-gray-700">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center mr-3">
                    <svg className="w-4 h-4 text-primary-600" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <span className="font-medium">AI Expert Team</span>
                </div>
                <div className="flex items-center text-gray-700">
                  <div className="w-8 h-8 bg-secondary-100 rounded-full flex items-center justify-center mr-3">
                    <svg className="w-4 h-4 text-secondary-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span className="font-medium">Minutes, Not Months</span>
                </div>
                <div className="flex items-center text-gray-700">
                  <div className="w-8 h-8 bg-accent-100 rounded-full flex items-center justify-center mr-3">
                    <svg className="w-4 h-4 text-accent-600" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm0 2h12v8H4V6z" />
                    </svg>
                  </div>
                  <span className="font-medium">Professional Documents</span>
                </div>
              </div>

              {/* CTA Section */}
              <div className="animate-fade-in" style={{ animationDelay: '0.6s' }}>
                {!showInput ? (
                  <div className="space-y-6">
                    <button
                      onClick={handleGetStarted}
                      className="btn-primary text-lg px-8 py-4 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
                    >
                      Get Started - It's Free
                    </button>
                    <p className="text-sm text-gray-500">
                      No account required • Try it instantly • Professional results
                    </p>
                  </div>
                ) : (
                  <div className="max-w-4xl mx-auto">
                    <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6">
                      Tell us about your project
                    </h2>
                    <ProjectInput 
                      onSubmit={handleProjectSubmit}
                      autoFocus
                      placeholder="I want to build an app that..."
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Social Proof Section */}
        {!showInput && (
          <section className="py-16 bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  Join thousands of entrepreneurs who've transformed their ideas
                </h2>
                <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                  From concept to comprehensive business plan, our AI experts guide you through every step.
                </p>
              </div>

              {/* Feature grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
                <div className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Instant Analysis</h3>
                  <p className="text-gray-600">
                    Our AI Analyst immediately evaluates your idea for market potential, feasibility, and competitive advantages.
                  </p>
                </div>

                <div className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 bg-secondary-100 rounded-lg flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-secondary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Complete Documentation</h3>
                  <p className="text-gray-600">
                    Get professional project briefs, technical architecture, user stories, and implementation roadmaps.
                  </p>
                </div>

                <div className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 bg-accent-100 rounded-lg flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-accent-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Expert Team Collaboration</h3>
                  <p className="text-gray-600">
                    Watch as our AI Product Manager, UX Expert, and Software Architect work together on your project.
                  </p>
                </div>
              </div>

              {/* CTA */}
              <div className="text-center">
                <button
                  onClick={handleGetStarted}
                  className="btn-primary text-lg px-8 py-4"
                >
                  Start Your Free Planning Session
                </button>
              </div>
            </div>
          </section>
        )}

        {/* How It Works Section */}
        {!showInput && (
          <section id="how-it-works" className="py-16 bg-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-16">
                <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
                  How BMAD Works
                </h2>
                <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                  Our proven methodology transforms ideas into actionable business plans through collaborative AI expertise.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                {[
                  {
                    step: '01',
                    title: 'Describe Your Idea',
                    description: 'Tell us about your project vision, goals, and any specific requirements or constraints.',
                    icon: (
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    )
                  },
                  {
                    step: '02',
                    title: 'AI Expert Analysis',
                    description: 'Our AI Analyst evaluates market potential, identifies opportunities and challenges.',
                    icon: (
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    )
                  },
                  {
                    step: '03',
                    title: 'Collaborative Planning',
                    description: 'Watch as our PM, UX Expert, and Architect work together to create comprehensive plans.',
                    icon: (
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                      </svg>
                    )
                  },
                  {
                    step: '04',
                    title: 'Professional Deliverables',
                    description: 'Receive detailed project brief, technical architecture, user stories, and implementation roadmap.',
                    icon: (
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )
                  }
                ].map((item, index) => (
                  <div key={index} className="relative">
                    <div className="flex flex-col items-center text-center">
                      <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center text-primary-600 mb-4">
                        {item.icon}
                      </div>
                      <div className="text-xs font-bold text-primary-600 mb-2">STEP {item.step}</div>
                      <h3 className="text-xl font-semibold text-gray-900 mb-3">{item.title}</h3>
                      <p className="text-gray-600">{item.description}</p>
                    </div>
                    {index < 3 && (
                      <div className="hidden lg:block absolute top-8 left-full w-full">
                        <svg className="w-full h-2 text-gray-300" fill="currentColor" viewBox="0 0 100 2">
                          <path d="M0 1h98l-4-1v2z" />
                        </svg>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Examples Section */}
        {!showInput && (
          <section id="examples" className="py-16 bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  Success Stories
                </h2>
                <p className="text-lg text-gray-600">
                  See how BMAD has helped transform ideas across different industries
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {[
                  {
                    title: "Local Services Marketplace",
                    category: "Mobile App",
                    description: "Connected homeowners with trusted local contractors through a seamless booking platform.",
                    metrics: ["3-month MVP plan", "Market analysis included", "Technical architecture defined"]
                  },
                  {
                    title: "Farm-to-Restaurant Platform",
                    category: "E-commerce",
                    description: "Direct connection between local farmers and restaurants with inventory management.",
                    metrics: ["Supply chain optimized", "User personas defined", "Revenue model validated"]
                  },
                  {
                    title: "Social Media Management SaaS",
                    category: "B2B Software",
                    description: "All-in-one platform for small businesses to manage their social media presence.",
                    metrics: ["Feature roadmap created", "Pricing strategy defined", "Integration plans mapped"]
                  }
                ].map((example, index) => (
                  <div key={index} className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
                    <div className="text-sm text-primary-600 font-medium mb-2">{example.category}</div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-3">{example.title}</h3>
                    <p className="text-gray-600 mb-4">{example.description}</p>
                    <div className="space-y-2">
                      {example.metrics.map((metric, idx) => (
                        <div key={idx} className="flex items-center text-sm text-gray-700">
                          <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          {metric}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="bg-gray-900 text-white py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold mb-4">
                Ready to transform your idea?
              </h2>
              <p className="text-gray-300 mb-8 max-w-2xl mx-auto">
                Join thousands of entrepreneurs who've used BMAD to turn their vision into actionable business plans.
              </p>
              {!showInput && (
                <button
                  onClick={handleGetStarted}
                  className="btn-primary text-lg px-8 py-4"
                >
                  Start Your Free Session Now
                </button>
              )}
            </div>
            
            <div className="border-t border-gray-800 mt-12 pt-8 text-center text-gray-400">
              <p>&copy; 2025 BMAD. All rights reserved. • Privacy Policy • Terms of Service</p>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}