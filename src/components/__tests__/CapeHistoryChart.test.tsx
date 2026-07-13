import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import CapeHistoryChart from '../CapeHistoryChart';

describe('CapeHistoryChart Component', () => {
  it('should tier 2600 J/kg as Extreme Instability', () => {
    // Generate a mock history with the most recent entry being 2600
    const mockHistory = [
      { time: '12:00', timestamp: 1234, cape: 1000 },
      { time: '12:05', timestamp: 1235, cape: 2600 }
    ];
    
    // We mock ResizeObserver which is needed by Recharts
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    render(<CapeHistoryChart history={mockHistory} currentCape={2600} loading={false} />);
    
    // Assert the component evaluates 2600 as Extreme
    expect(screen.getByText(/Extreme Instability/i)).toBeInTheDocument();
    expect(screen.getByText(/Violent tornadoes/i)).toBeInTheDocument();
  });

  it('should tier 800 J/kg as Marginal Instability', () => {
    const mockHistory = [
      { time: '12:00', timestamp: 1234, cape: 800 }
    ];
    
    render(<CapeHistoryChart history={mockHistory} currentCape={800} loading={false} />);
    
    expect(screen.getByText(/Marginal Instability/i)).toBeInTheDocument();
  });
});
