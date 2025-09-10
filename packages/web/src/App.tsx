import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from '@/pages/Home';
import Planning from '@/pages/Planning';
import ErrorBoundary from '@/components/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <div className="App">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/planning" element={<Planning />} />
          <Route path="*" element={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-center"><h1 className="text-2xl font-bold text-gray-900 mb-2">Page Not Found</h1><p className="text-gray-600 mb-4">The page you're looking for doesn't exist.</p><a href="/" className="btn-primary">Go Home</a></div></div>} />
        </Routes>
      </div>
    </ErrorBoundary>
  );
}

export default App;